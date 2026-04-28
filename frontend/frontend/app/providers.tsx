"use client";

import {
  useState, createContext, useContext,
  ReactNode, useEffect,
} from "react";
import { RainbowKitProvider, darkTheme, getDefaultConfig } from "@rainbow-me/rainbowkit";
import type { WalletState, EIP1193Provider, FhevmInstance } from "@/libs/types";
import { WagmiProvider, useWalletClient, useAccount, type Config } from "wagmi";
import { sepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cookieToInitialState } from "wagmi";
import { ethers, type BrowserProvider } from "ethers";
import { CONTRACT_ADDRESS } from "@/libs/config";
import ABI from "@/libs/abi";
import "@rainbow-me/rainbowkit/styles.css";

// ── Wagmi / RainbowKit config ─────────────────────────────────────────────────
const wagmiConfig = getDefaultConfig({
  appName: "ConfidentialCare",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "demo",
  chains: [sepolia],
  ssr: true,
});

const queryClient = new QueryClient();

// ── Window type helpers ───────────────────────────────────────────────────────
// Defined at module level so TypeScript sees them everywhere
type WindowWithWallets = Window & {
  okxwallet?: EIP1193Provider;
  ethereum?: EIP1193Provider;
};

// Index signature is required for string-key access (w[k], w[key])
type WindowWithSDK = Window & {
  fhevm?: unknown;
  FheRelayerSdk?: unknown;
  relayerSdk?: unknown;
  [key: string]: unknown;
};

// ── Wallet context ────────────────────────────────────────────────────────────
const EMPTY: WalletState = {
  account: "",
  contract: null,
  fhevmInstance: null,
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
}

const WalletCtxDef = createContext<WalletCtx>({
  wallet: EMPTY,
  provider: null,
  fheLoading: false,
  fheError: "",
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

  // Init FHE when wallet connects — SDK loaded from CDN script in layout.tsx
  useEffect(() => {
    if (!wallet.account || wallet.fhevmReady || fheLoading) return;

    const initFhe = async () => {
      const win = window as WindowWithWallets;
      const walletProvider: EIP1193Provider | undefined = win.okxwallet ?? win.ethereum;
      if (!walletProvider) return;

      try {
        setFheLoading(true);
        setFheError("");

        // Poll window until CDN script exposes the SDK as a global
        const sdk = await findSdkOnWindow();

        console.log("[FHE] SDK found:", Object.keys(sdk).slice(0, 6));
        if (typeof sdk.initSDK === "function") {
          await sdk.initSDK();
        }
        const instance = await sdk.createInstance({
          ...sdk.SepoliaConfig,
          network: walletProvider,
        });

        setWallet(prev => ({ ...prev, fhevmInstance: instance as FhevmInstance, fhevmReady: true }));
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
  }, [wallet.account, wallet.fhevmReady, fheLoading]);

  return (
    <WalletCtxDef.Provider value={{ wallet, provider, fheLoading, fheError }}>
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

// ── Find Zama SDK on window ───────────────────────────────────────────────────
// Extracted as a named function to keep useEffect clean and avoid inline any.
// The SDK is loaded via <script> CDN tag in layout.tsx — we poll until it appears.
type ZamaSdk = {
  initSDK?: () => Promise<void>;
  createInstance: (config: Record<string, unknown>) => Promise<unknown>;
  SepoliaConfig: Record<string, unknown>;
  [key: string]: unknown;
};

function isSdk(value: unknown): value is ZamaSdk {
  return (
    value !== null &&
    typeof value === "object" &&
    "createInstance" in value &&
    "SepoliaConfig" in value
  );
}

function findSdkOnWindow(): Promise<ZamaSdk> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;

    const poll = () => {
      // WindowWithSDK has [key: string]: unknown so w[k] is typed correctly
      const w = window as unknown as WindowWithSDK;

      // Try known global names first
      const direct = w.fhevm ?? w.FheRelayerSdk ?? w.relayerSdk;
      if (isSdk(direct)) { resolve(direct); return; }

      // Scan all window keys as fallback
      const foundKey = Object.keys(w).find((k) => isSdk(w[k]));
      if (foundKey) {
        resolve(w[foundKey] as ZamaSdk);
        return;
      }

      if (Date.now() > deadline) {
        reject(new Error("FHE SDK not found on window after 10s"));
        return;
      }
      setTimeout(poll, 300);
    };

    poll();
  });
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