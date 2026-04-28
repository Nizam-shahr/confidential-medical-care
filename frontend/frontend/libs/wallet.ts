import { ethers } from "ethers";
import { CONTRACT_ADDRESS, SEPOLIA_CHAIN_ID } from "./config";
import ABI from "./abi";
import type { WalletState, EIP1193Provider } from "./types";

// ── Detect wallet provider ────────────────────────────────────────────────────
type WindowWithWallets = Window & {
  okxwallet?: EIP1193Provider;
  ethereum?: EIP1193Provider;
};

export function getWalletProvider(): EIP1193Provider | null {
  if (typeof window === "undefined") return null;
  const w = window as WindowWithWallets;
  if (w.okxwallet) return w.okxwallet;
  if (w.ethereum) return w.ethereum;
  return null;
}

// ── Switch to Sepolia ─────────────────────────────────────────────────────────
export async function switchToSepolia(walletProvider: EIP1193Provider): Promise<boolean> {
  try {
    await walletProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID }],
    });
    return true;
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code === 4902) {
      try {
        await walletProvider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: SEPOLIA_CHAIN_ID,
            chainName: "Sepolia Testnet",
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://rpc.sepolia.org"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          }],
        });
        return true;
      } catch { return false; }
    }
    return false;
  }
}

// ── Connect and initialise ────────────────────────────────────────────────────
export async function connectAndInitialize(): Promise<{
  state: Partial<WalletState>;
  provider: ethers.BrowserProvider | null;
  error?: string;
}> {
  const walletProvider = getWalletProvider();
  if (!walletProvider) {
    return {
      state: {}, provider: null,
      error: "No wallet detected. Install MetaMask or OKX Wallet.",
    };
  }

  await walletProvider.request({ method: "eth_requestAccounts" });

  const chainId = await walletProvider.request({ method: "eth_chainId" }) as string;
  if (chainId.toLowerCase() !== SEPOLIA_CHAIN_ID.toLowerCase()) {
    const switched = await switchToSepolia(walletProvider);
    if (!switched) {
      return { state: {}, provider: null, error: "Please switch to Sepolia testnet." };
    }
  }

  const provider = new ethers.BrowserProvider(walletProvider as ethers.Eip1193Provider);
  const signer = await provider.getSigner();
  const account = await signer.getAddress();
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

  const adminAddr = await contract.admin() as string;
  const isAdmin = account.toLowerCase() === adminAddr.toLowerCase();

  const doctorId = await contract.doctorIdByAddress(account) as bigint;
  const isDoctorId = Number(doctorId);

  const w = window as WindowWithWallets;
  const walletName = w.okxwallet && walletProvider === w.okxwallet ? "OKX" : "MetaMask";

  return {
    state: {
      account, contract,
      fhevmInstance: null, fhevmReady: false,
      walletName, isAdmin, isDoctorId,
    },
    provider,
  };
}