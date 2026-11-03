"use client";

import {
  useState, createContext, useContext,
  ReactNode, useEffect, useRef, useCallback, useMemo,
} from "react";
import { RainbowKitProvider, darkTheme, getDefaultConfig } from "@rainbow-me/rainbowkit";
import type { WalletState } from "@/libs/types";
import type { ZamaSdk } from "@/libs/zama";
import { WagmiProvider, useWalletClient, useAccount, type Config } from "wagmi";
import { sepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cookieToInitialState } from "wagmi";
import { ethers, type BrowserProvider } from "ethers";
import { CONTRACT_ADDRESS, SEPOLIA_RPC_URL } from "@/libs/config";
import ABI from "@/libs/abi";
import { deriveDoctorWallet, signPatientSeed } from "@/libs/patient-wallets";
import "@rainbow-me/rainbowkit/styles.css";

// ── Wagmi / RainbowKit config ─────────────────────────────────────────────────
const wagmiConfig = getDefaultConfig({
  appName: "ConfidentialCare",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "demo",
  chains: [sepolia],
  ssr: true,
});

const queryClient = new QueryClient();

// ── Wallet context ────────────────────────────────────────────────────────────
const EMPTY: WalletState = {
  account: "",
  contract: null,
  zama: null,
  fhevmReady: false,
  walletName: "",
  isAdmin: false,
  isDoctorId: 0,
};

interface WalletCtx {
  wallet: WalletState;
  provider: BrowserProvider | null;
  fheLoading: boolean;
  fheError: string;
  /** Per-doctor patient wallet, derived from one signature by the main wallet (prompts once per session). */
  getPatientWallet: (doctorId: number) => Promise<ethers.Wallet>;
  /** Zama SDK bound to the per-doctor patient wallet (encrypts, decrypts, delegates and revokes as that wallet). */
  getPatientSdk: (doctorId: number) => Promise<ZamaSdk>;
  hasPatientSeed: boolean;
}

const WalletCtxDef = createContext<WalletCtx>({
  wallet: EMPTY,
  provider: null,
  fheLoading: false,
  fheError: "",
  getPatientWallet: async () => { throw new Error("Wallet not connected"); },
  getPatientSdk: async () => { throw new Error("Wallet not connected"); },
  hasPatientSeed: false,
});

export function useWallet() { return useContext(WalletCtxDef); }

// ── Inner provider ────────────────────────────────────────────────────────────
function FheProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [wallet, setWallet] = useState<WalletState>(EMPTY);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [fheLoading, setFheLoading] = useState(false);
  const [fheError, setFheError] = useState("");

  // Seed signature for the per-doctor patient wallets: memory only, dropped on account change.
  const seedRef = useRef<string | null>(null);
  const [hasPatientSeed, setHasPatientSeed] = useState(false);
  const rpcProvider = useMemo(() => new ethers.JsonRpcProvider(SEPOLIA_RPC_URL), []);

  // One SDK per derived patient wallet, created on first use.
  const patientSdks = useRef(new Map<string, ZamaSdk>());

  // Main-wallet SDK; replaced whenever the connected account changes.
  const mainSdk = useRef<ZamaSdk | null>(null);

  useEffect(() => {
    seedRef.current = null;
    setHasPatientSeed(false);
    for (const sdk of patientSdks.current.values()) sdk.terminate();
    patientSdks.current.clear();
    mainSdk.current?.terminate();
    mainSdk.current = null;
    setWallet(prev => ({ ...prev, zama: null, fhevmReady: false }));
  }, [address]);

  const getPatientWallet = useCallback(async (doctorId: number) => {
    if (!provider) throw new Error("Wallet not connected");
    if (!seedRef.current) {
      const signer = await provider.getSigner();
      // Signs twice once per session to make sure the wallet's signatures are reproducible.
      seedRef.current = await signPatientSeed(signer, CONTRACT_ADDRESS, 11155111, true);
      setHasPatientSeed(true);
    }
    return deriveDoctorWallet(seedRef.current, doctorId, rpcProvider);
  }, [provider, rpcProvider]);

  const getPatientSdk = useCallback(async (doctorId: number) => {
    const patientWallet = await getPatientWallet(doctorId);
    let sdk = patientSdks.current.get(patientWallet.address);
    if (!sdk) {
      const { createZamaSdk } = await import("@/libs/zama");
      sdk = createZamaSdk(patientWallet);
      patientSdks.current.set(patientWallet.address, sdk);
    }
    return sdk;
  }, [getPatientWallet]);

  // Build ethers contract + detect roles when wallet connects
  useEffect(() => {
    if (!isConnected || !address || !walletClient) {
      setWallet(EMPTY);
      setProvider(null);
      return;
    }

    const setup = async () => {
      try {
        const ethersProvider = new ethers.BrowserProvider(
          walletClient.transport as ethers.Eip1193Provider
        );
        const signer = await ethersProvider.getSigner();
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

        let isAdmin = false;
        let isDoctorId = 0;
        try {
          const adminAddr = await contract.admin() as string;
          isAdmin = address.toLowerCase() === adminAddr.toLowerCase();
          const docId = await contract.doctorIdByAddress(address) as bigint;
          isDoctorId = Number(docId);
        } catch (e) {
          console.warn("Role check failed:", e);
        }

        setProvider(ethersProvider);
        setWallet(prev => ({
          ...prev,
          account: address,
          contract,
          walletName: detectWalletName(),
          isAdmin,
          isDoctorId,
        }));
      } catch (e) {
        console.error("Wallet setup failed:", e);
      }
    };

    setup();
  }, [address, isConnected, walletClient]);

  // Create the Zama SDK for the main wallet once it is connected (WASM loads on first use).
  useEffect(() => {
    if (!wallet.account || !provider || wallet.fhevmReady || fheLoading) return;

    const initFhe = async () => {
      try {
        setFheLoading(true);
        setFheError("");
        const { createZamaSdk } = await import("@/libs/zama");
        const signer = await provider.getSigner();
        // The provider may still belong to the previous account during a switch; wait for the new one.
        if (signer.address.toLowerCase() !== wallet.account.toLowerCase()) return;
        const sdk = createZamaSdk(signer);
        mainSdk.current = sdk;
        setWallet(prev => ({ ...prev, zama: sdk, fhevmReady: true }));
      } catch (e: unknown) {
        console.warn("FHE init failed:", e);
        setFheError(
          "FHE encryption not ready. You can browse but cannot submit consultations."
        );
      } finally {
        setFheLoading(false);
      }
    };

    initFhe();
  }, [wallet.account, wallet.fhevmReady, provider, fheLoading]);

  return (
    <WalletCtxDef.Provider value={{ wallet, provider, fheLoading, fheError, getPatientWallet, getPatientSdk, hasPatientSeed }}>
      {/* FHE init overlay */}
      {fheLoading && (
        <div className="tx-overlay">
          <div className="tx-overlay-card">
            <div className="tx-spinner" />
            <div className="tx-overlay-title">Activating FHE Encryption</div>
            <div className="tx-overlay-sub">
              Loading the Zama encryption engine into your browser.
              This only happens once per session.
            </div>
            <div className="tx-overlay-steps" style={{ marginTop: "1rem" }}>
              <div className="tx-overlay-step tx-overlay-step--done">
                <span className="tx-overlay-step-icon">✅</span>
                Wallet connected
              </div>
              <div className="tx-overlay-step tx-overlay-step--active">
                <span className="tx-overlay-step-icon">🔐</span>
                Loading FHE engine (Zama TFHE-rs)
              </div>
              <div className="tx-overlay-step">
                <span className="tx-overlay-step-icon">⚡</span>
                Ready to encrypt
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FHE error banner */}
      {fheError && !fheLoading && (
        <div
          className="banner banner-warn"
          style={{ margin: "0 2rem", position: "relative", zIndex: 10 }}
        >
          ⚠️ {fheError}
          <button
            className="banner-btn"
            style={{ marginLeft: "auto" }}
            onClick={() => setFheError("")}
          >
            Dismiss
          </button>
        </div>
      )}

      {children}
    </WalletCtxDef.Provider>
  );
}

// ── Wallet name detection ─────────────────────────────────────────────────────
function detectWalletName(): string {
  if (typeof window === "undefined") return "";
  const w = window as Window & {
    okxwallet?: unknown;
    ethereum?: { isMetaMask?: boolean; isCoinbaseWallet?: boolean };
  };
  if (w.okxwallet) return "OKX";
  if (w.ethereum?.isMetaMask) return "MetaMask";
  if (w.ethereum?.isCoinbaseWallet) return "Coinbase";
  return "Wallet";
}

// ── Root providers ────────────────────────────────────────────────────────────
export function Providers({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  const initialState = cookieToInitialState(wagmiConfig as Config, cookies);
  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#4f8ef7",
            accentColorForeground: "white",
            borderRadius: "medium",
            fontStack: "system",
            overlayBlur: "small",
          })}
        >
          <FheProvider>
            {children}
          </FheProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}