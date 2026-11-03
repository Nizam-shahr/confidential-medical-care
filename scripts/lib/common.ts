import * as fs from "fs";
import * as path from "path";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { vars } from "hardhat/config";
import { ethers } from "ethers";
import { ACL_ADDRESS } from "./zama";

const ROOT = path.join(__dirname, "..", "..");
const V2_RESULTS = path.join(ROOT, "results", "v2");

// Which deployment the scripts run against: CC_TARGET=v2 selects v2, anything else v1.
export const TARGET: "v1" | "v2" = process.env.CC_TARGET === "v2" ? "v2" : "v1";
export const V1_ADDRESS = "0x52e7a7c4414921d7a68b00d5abae51e2861e83aa";
const v2Deployment = () => JSON.parse(fs.readFileSync(path.join(V2_RESULTS, "deployment.json"), "utf8"));

export const CONTRACT_ADDRESS: string = TARGET === "v2" ? v2Deployment().address : V1_ADDRESS;
export const RESULTS_DIR = TARGET === "v2" ? V2_RESULTS : path.join(ROOT, "results");
export const STATUS = ["Open", "DoctorResponded", "Closed"];

// Hardhat vars holding keys we control. Values are only ever turned into wallets, never printed.
const KEY_VARS = ["DEPLOYER_PRIVATE_KEY", "DOCTOR1_PRIVATE_KEY", "DOCTOR2_PRIVATE_KEY"];

// ── Formatting ────────────────────────────────────────────────────────────────
export function short(addr: string | null | undefined): string {
  if (!addr) return "";
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

// Replace every 20-byte address in free text (e.g. SDK error messages) with its short form.
export function shortenAddressesIn(text: string): string {
  return text.replace(/0x[0-9a-fA-F]{64}/g, (h) => `${h.slice(0, 10)}…${h.slice(-4)}`)
    .replace(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g, (a) => short(a));
}

export function utc(ts: number | bigint): string {
  return new Date(Number(ts) * 1000).toISOString().replace(".000Z", "Z");
}

export function writeCsv(file: string, rows: Record<string, unknown>[], columns: string[]): void {
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

export function mdTable(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${columns.map((c) => cell(r[c])).join(" | ")} |`),
  ].join("\n");
}

// ── Wallets we control ────────────────────────────────────────────────────────
export type OwnWallet = { source: string; address: string; wallet: ethers.Wallet };

export function loadOwnWallets(provider: ethers.Provider): OwnWallet[] {
  const out: OwnWallet[] = [];
  for (const name of KEY_VARS) {
    if (!vars.has(name)) continue;
    const raw = vars.get(name).trim();
    const wallet = new ethers.Wallet(raw.startsWith("0x") ? raw : `0x${raw}`, provider);
    out.push({ source: name, address: wallet.address, wallet });
  }
  if (vars.has("MNEMONIC")) {
    const phrase = vars.get("MNEMONIC").trim();
    for (let i = 0; i < 10; i++) {
      const w = ethers.HDNodeWallet.fromPhrase(phrase, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
      if (!out.some((o) => o.address === w.address)) {
        out.push({ source: `MNEMONIC#${i}`, address: w.address, wallet: w as unknown as ethers.Wallet });
      }
    }
  }
  return out;
}

// ── ABIs ──────────────────────────────────────────────────────────────────────
// v1 ABI comes from hardhat-deploy's record; v2 from the snapshot taken at deployment
// (artifacts/ would change if the source is edited again).
export function contractAbi(): ethers.InterfaceAbi {
  if (TARGET === "v2") return JSON.parse(fs.readFileSync(path.join(V2_RESULTS, "ConfidentialCare.abi.json"), "utf8"));
  return JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", "sepolia", "ConfidentialCare.json"), "utf8")).abi;
}

export function deploymentBlock(): number {
  if (TARGET === "v2") return v2Deployment().block;
  return JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", "sepolia", "ConfidentialCare.json"), "utf8")).receipt.blockNumber;
}

// Zama host contracts (ACL, executor, input verifier) — used to decode their logs.
export function zamaInterfaces(): { name: string; iface: ethers.Interface }[] {
  // ABIs from the FHEVM v0.13 cleartext host contracts (same events and errors as the Sepolia deployment).
  const base = path.join(__dirname, "..", "..", "node_modules", "@fhevm", "host-contracts-cleartext", "abi");
  return ["ACL", "FHEVMExecutor", "InputVerifier", "KMSVerifier", "HCULimit"].flatMap((name) => {
    const file = path.join(base, `Cleartext${name}.json`);
    if (!fs.existsSync(file)) return [];
    return [{ name, iface: new ethers.Interface(JSON.parse(fs.readFileSync(file, "utf8"))) }];
  });
}

// ── Etherscan V2 ──────────────────────────────────────────────────────────────
export type EtherscanTx = {
  hash: string; from: string; to: string; input: string; gasUsed: string;
  timeStamp: string; blockNumber: string; isError: string; contractAddress: string;
};

export async function fetchContractTxs(chainId: number, address: string, startBlock: number): Promise<EtherscanTx[]> {
  const all: EtherscanTx[] = [];
  for (let page = 1; ; page++) {
    const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=txlist&address=${address}` +
      `&startblock=${startBlock}&endblock=latest&page=${page}&offset=1000&sort=asc&apikey=${vars.get("ETHERSCAN_API_KEY")}`;
    const res = await fetch(url);
    const body = (await res.json()) as { status: string; message: string; result: EtherscanTx[] | string };
    if (body.status !== "1") {
      if (body.message === "No transactions found") break;
      throw new Error(`Etherscan txlist failed: ${body.message} ${typeof body.result === "string" ? body.result : ""}`);
    }
    all.push(...(body.result as EtherscanTx[]));
    if ((body.result as EtherscanTx[]).length < 1000) break;
  }
  return all;
}

// ── Inventory ─────────────────────────────────────────────────────────────────
export type DecodedLog = {
  index: number; emitter: string; emitterName: string; event: string;
  args: Record<string, string>; addresses: string[];
};

export type TxRecord = {
  hash: string; fn: string; from: string; consultId: number | null; gasUsed: number;
  blockTime: string; block: number; failed: boolean; logs: DecodedLog[];
};

export type Doctor = { id: number; wallet: string; specialty: string; active: boolean; consultationCount: number };

export type Consultation = {
  id: number; patient: string; doctorId: number; status: string; createdAt: string;
  complaintChunkCount: number; hasResponse: boolean; responseChunkCount: number;
};

export type Inventory = {
  admin: string; doctors: Doctor[]; consultations: Consultation[]; txs: TxRecord[];
  own: OwnWallet[]; aclAddress: string;
};

function argsToStrings(frag: ethers.EventFragment, args: ethers.Result): { args: Record<string, string>; addresses: string[] } {
  const out: Record<string, string> = {};
  const addresses: string[] = [];
  frag.inputs.forEach((input, i) => {
    const v = args[i];
    if (input.type === "address") addresses.push(String(v));
    if (input.type === "address[]") addresses.push(...(v as string[]).map(String));
    out[input.name || `arg${i}`] = Array.isArray(v) ? `[${(v as unknown[]).length} items]` : String(v);
  });
  return { args: out, addresses };
}

export function decodeLog(
  log: ethers.Log, main: ethers.Interface, zama: { name: string; iface: ethers.Interface }[],
): DecodedLog {
  const isMain = log.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase();
  const candidates = isMain ? [{ name: "ConfidentialCare", iface: main }] : zama;
  for (const { name, iface } of candidates) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed) continue;
      const { args, addresses } = argsToStrings(parsed.fragment, parsed.args);
      return { index: log.index, emitter: log.address, emitterName: name, event: parsed.name, args, addresses };
    } catch {
      /* try next interface */
    }
  }
  // Undecodable: still surface any 32-byte topics that look like left-padded addresses.
  const addresses = log.topics.slice(1)
    .filter((t) => /^0x0{24}[0-9a-fA-F]{40}$/.test(t))
    .map((t) => ethers.getAddress(`0x${t.slice(26)}`));
  return { index: log.index, emitter: log.address, emitterName: "unknown", event: `topic0 ${log.topics[0]?.slice(0, 10)}…`, args: {}, addresses };
}

export async function buildInventory(hre: HardhatRuntimeEnvironment): Promise<Inventory> {
  const provider = hre.ethers.provider;
  const abi = contractAbi();
  const iface = new ethers.Interface(abi);
  const c = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);
  const zama = zamaInterfaces();

  const admin: string = await c.admin();

  const doctors: Doctor[] = [];
  for (const id of (await c.getAllDoctorIds()) as bigint[]) {
    const d = await c.doctors(id);
    doctors.push({ id: Number(id), wallet: d.wallet, specialty: d.specialty, active: d.active, consultationCount: Number(d.consultationCount) });
  }

  const consultations: Consultation[] = [];
  const count = Number(await c.consultationCount());
  for (let i = 1; i <= count; i++) {
    const m = await c.getConsultationMeta(i);
    consultations.push({
      id: i, patient: m.patient, doctorId: Number(m.doctorId), status: STATUS[Number(m.status)] ?? String(m.status),
      createdAt: utc(m.createdAt), complaintChunkCount: Number(m.complaintChunkCount),
      hasResponse: m.hasResponse, responseChunkCount: Number(m.responseChunkCount),
    });
  }

  const chainId = Number((await provider.getNetwork()).chainId);
  const raw = await fetchContractTxs(chainId, CONTRACT_ADDRESS, deploymentBlock());
  const txs: TxRecord[] = [];
  for (const t of raw) {
    let fn = t.to ? "unknown" : "deploy (constructor)";
    let consultId: number | null = null;
    try {
      const parsed = iface.parseTransaction({ data: t.input });
      if (parsed) {
        fn = parsed.name;
        if (["grantDoctorAccess", "revokeDoctorAccess", "markAccessWithdrawn", "closeConsultation", "submitResponse"].includes(fn)) {
          consultId = Number(parsed.args[0]);
        }
      }
    } catch {
      /* non-matching input */
    }
    const receipt = await provider.getTransactionReceipt(t.hash);
    const logs = (receipt?.logs ?? []).map((l) => decodeLog(l, iface, zama));
    if (fn === "submitConsultation") {
      const created = logs.find((l) => l.event === "ConsultationCreated");
      if (created) consultId = Number(created.args.consultationId);
    }
    txs.push({
      hash: t.hash, fn, from: ethers.getAddress(t.from), consultId, gasUsed: Number(t.gasUsed),
      blockTime: utc(Number(t.timeStamp)), block: Number(t.blockNumber), failed: t.isError === "1", logs,
    });
  }

  return { admin, doctors, consultations, txs, own: loadOwnWallets(provider), aclAddress: ACL_ADDRESS };
}

// Every on-chain role an address holds.
export function rolesOf(addr: string, inv: Inventory): string[] {
  const roles: string[] = [];
  if (addr === inv.admin) roles.push("admin");
  for (const d of inv.doctors) if (d.wallet === addr) roles.push(`doctor ${d.id}`);
  const patientOf = inv.consultations.filter((c) => c.patient === addr).map((c) => c.id);
  if (patientOf.length) roles.push(`patient of #${patientOf.join(",#")}`);
  return roles;
}

export function ownLabel(addr: string, inv: Inventory): string {
  return inv.own.find((o) => o.address === addr)?.source ?? "";
}
