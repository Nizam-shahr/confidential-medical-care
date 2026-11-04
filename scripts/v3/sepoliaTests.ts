/**
 * results/v3/sepolia_plan.md §4–§9 on Sepolia, in order. Synthetic data only; every delegation has an explicit expiry.
 *   SECTIONS=all npx hardhat run scripts/v3/sepoliaTests.ts --network sepolia
 * SECTIONS (comma list, in this order): setup,T1a,T5,T4,T1d,T1b,T2,T3,S9
 * Rows are appended to results/v3/sepolia_requests.csv and results/v3/sepolia_timing.csv.
 * Stops (throws) if the base fee is above 5 gwei, if the hand-built relayer request never succeeds, or if a forged
 * permit is ever answered with shares.
 */
import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { short } from "../lib/common";
import { delegatedDecrypt, disposeAll, encryptUint64, sdkFor, userDecrypt } from "../lib/zama";
import { revokeThenClose } from "../../frontend/frontend/libs/delegation";
import { ACL_ABI, ACL_ADDRESS, assertFee, planAndSend, readV3Deployment, SEED_TEXT, textToUint64Chunks, V3_DIR, v3Wallets } from "./lib";
import { buildBody, postDelegated, RawOutcome, signDelegatedPermit } from "./lib/rawRelayer";

const REQ_CSV = path.join(V3_DIR, "sepolia_requests.csv");
const TIMING_CSV = path.join(V3_DIR, "sepolia_timing.csv");
const REQ_COLS = ["test", "case", "path", "delegator", "delegate", "handle", "acl_delegated", "block_start", "t_start", "seconds",
  "expected", "verdict", "pass", "http", "label", "message", "shares", "plaintext_ok", "control"];
const TIMING_COLS = ["test", "cycle", "event", "event_block", "event_time", "last_success_s", "last_success_blocks",
  "first_refusal_s", "first_refusal_blocks", "grant_to_first_decrypt_s", "requests", "notes"];
const DAY = 86_400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function append(file: string, cols: string[], row: Record<string, unknown>) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, cols.join(",") + "\n");
  fs.appendFileSync(file, cols.map((c) => csvCell(row[c])).join(",") + "\n");
}

async function main() {
  if (hre.network.name !== "sepolia") throw new Error("Run with --network sepolia");
  const provider = hre.ethers.provider;
  const rpc = (hre.network.config as { url: string }).url;
  const dep = readV3Deployment();
  const W = await v3Wallets(provider, dep.address);
  const c = new ethers.Contract(dep.address, (await hre.artifacts.readArtifact("ConfidentialCareV3")).abi, provider);
  const acl = new ethers.Contract(ACL_ADDRESS, ACL_ABI, provider);
  const [hsA] = await c.getComplaintHandles(1);
  const [hsB] = await c.getComplaintHandles(2);
  const hA: string = hsA[0], hB: string = hsB[0];
  const expectA = textToUint64Chunks(SEED_TEXT[1])[0], expectB = textToUint64Chunks(SEED_TEXT[2])[0];
  const plain = new Map<string, bigint>([[hA.toLowerCase(), expectA], [hB.toLowerCase(), expectB]]);
  const sections = (process.env.SECTIONS ?? "all") === "all"
    ? ["setup", "T1a", "T5", "T4", "T1d", "T1b", "T2", "T3", "S9"] : process.env.SECTIONS!.split(",");
  const name = (a: string) => ({ [W.walletA.address]: "walletA", [W.walletB.address]: "walletB", [W.doctor1.address]: "doctor1",
    [W.doctor2.address]: "doctor2" } as Record<string, string>)[a] ?? short(a);
  console.log(`v3 ${short(dep.address)} · sections ${sections.join(",")}`);

  // ── transactions ────────────────────────────────────────────────────────────
  const delegate = async (from: ethers.Wallet | ethers.HDNodeWallet, doctor: string, expiry: bigint, label = "") => {
    const r = await planAndSend(`delegate ${name(from.address)} → ${name(doctor)} ${label}`, [{
      label: `delegateForUserDecryption(${name(doctor)}, v3, ${expiry}) [${new Date(Number(expiry) * 1000).toISOString()}]`, signer: from,
      request: await acl.delegateForUserDecryption.populateTransaction(doctor, dep.address, expiry) }], provider);
    return r[0];
  };
  const revoke = async (from: ethers.Wallet | ethers.HDNodeWallet, doctor: string) => {
    const r = await planAndSend(`revoke ${name(from.address)} → ${name(doctor)}`, [{
      label: `revokeDelegationForUserDecryption(${name(doctor)}, v3)`, signer: from,
      request: await acl.revokeDelegationForUserDecryption.populateTransaction(doctor, dep.address) }], provider);
    return r[0];
  };
  const latestTs = async () => BigInt((await provider.getBlock("latest"))!.timestamp);

  // ── requests ────────────────────────────────────────────────────────────────
  type Req = { outcome: RawOutcome; block: number; aclView: boolean };
  const raw = async (doctor: ethers.Wallet | ethers.HDNodeWallet, delegator: string, handle: string, mutate?: (b: any) => any): Promise<Req> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const block = await provider.getBlockNumber();
    const aclView: boolean = await acl.isHandleDelegatedForUserDecryption(delegator, doctor.address, dep.address, handle);
    const { signedPermit } = await signDelegatedPermit(provider, doctor as unknown as ethers.Wallet, delegator, dep.address);
    let body = buildBody(signedPermit, [handle], dep.address);
    if (mutate) body = mutate(body);
    return { outcome: await postDelegated(body), block, aclView };
  };
  let controlOk = false;
  const record = async (test: string, kase: string, doctor: ethers.Wallet | ethers.HDNodeWallet, delegator: string, handle: string,
    expected: "DECRYPT" | "REFUSED", r: Req, control = "") => {
    const o = r.outcome;
    let plaintextOk = "";
    if (o.verdict === "DECRYPT") {
      controlOk = true;
      const s = await delegatedDecrypt(await sdkFor(doctor, rpc), dep.address, [handle], delegator);
      plaintextOk = s.actual === "DECRYPT" ? String(s.values![0] === plain.get(handle.toLowerCase())) : `sdk ${s.actual}`;
    }
    const verdict = o.verdict === "DECRYPT" ? "DECRYPT" : o.verdict === "REFUSED_SERVER" ? "REFUSED" : o.verdict;
    const pass = expected === verdict ? "true" : verdict === "ERROR" || verdict === "REJECTED_FORMAT" ? "inconclusive" : "false";
    const row = { test, case: kase, path: "raw relayer", delegator: name(delegator), delegate: name(doctor.address), handle: handle === hA ? "hA (#1)" : handle === hB ? "hB (#2)" : short(handle),
      acl_delegated: r.aclView, block_start: r.block, t_start: new Date(o.startedAt).toISOString(), seconds: ((o.endedAt - o.startedAt) / 1000).toFixed(1),
      expected, verdict: o.verdict, pass, http: o.httpStatuses, label: o.label, message: o.message.slice(0, 220), shares: o.shares, plaintext_ok: plaintextOk, control };
    append(REQ_CSV, REQ_COLS, row);
    console.log(`  ${test.padEnd(4)} ${kase.slice(0, 44).padEnd(44)} ${name(delegator).padEnd(8)}→${name(doctor.address).padEnd(8)} acl=${String(r.aclView).padEnd(5)} ${o.verdict.padEnd(15)} ${o.httpStatuses.padEnd(18)} ${o.label} shares=${o.shares} ${plaintextOk} ${pass === "false" ? "✘ UNEXPECTED" : ""}`);
    return row;
  };
  const sdkRow = async (test: string, kase: string, doctor: ethers.Wallet | ethers.HDNodeWallet, delegator: string, handle: string, expected: string) => {
    const t = Date.now();
    const s = await delegatedDecrypt(await sdkFor(doctor, rpc), dep.address, [handle], delegator);
    append(REQ_CSV, REQ_COLS, { test, case: kase, path: "@zama-fhe/sdk", delegator: name(delegator), delegate: name(doctor.address), handle: handle === hA ? "hA (#1)" : "hB (#2)",
      acl_delegated: await acl.isHandleDelegatedForUserDecryption(delegator, doctor.address, dep.address, handle), block_start: await provider.getBlockNumber(),
      t_start: new Date(t).toISOString(), seconds: ((Date.now() - t) / 1000).toFixed(1), expected, verdict: s.actual,
      pass: String(s.actual === expected), http: "(client-side)", label: s.errorName ?? "", message: short(s.detail).slice(0, 220), shares: "", plaintext_ok: s.values ? String(s.values[0] === plain.get(handle.toLowerCase())) : "", control: "" });
    console.log(`  ${test.padEnd(4)} SDK ${kase.slice(0, 40).padEnd(40)} ${s.actual} ${s.errorName ?? ""}`);
  };
  /** A refusal only counts when a request expected to succeed, sent right after it, returns shares. */
  const refusedWithControl = async (test: string, kase: string, doctor: ethers.Wallet | ethers.HDNodeWallet, delegator: string, handle: string,
    ctl: [ethers.Wallet | ethers.HDNodeWallet, string, string]) => {
    const row = await record(test, kase, doctor, delegator, handle, "REFUSED", await raw(doctor, delegator, handle));
    const ctlRow = await record(test, `control for: ${kase}`, ctl[0], ctl[1], ctl[2], "DECRYPT", await raw(ctl[0], ctl[1], ctl[2]), "control");
    if (row.verdict === "REFUSED_SERVER" && ctlRow.verdict !== "DECRYPT") {
      console.log("    ↳ control did not decrypt: refusal is INCONCLUSIVE");
    }
  };

  for (const section of sections) {
    await assertFee(provider);
    console.log(`\n═══ ${section} ═══ ${new Date().toISOString()}`);

    if (section === "setup") {
      // Doctor 2 holds an active delegation from walletB: the control used while walletA → doctor 1 is absent.
      if (!(await acl.isHandleDelegatedForUserDecryption(W.walletB.address, W.doctor2.address, dep.address, hB))) {
        await delegate(W.walletB, W.doctor2.address, (await latestTs()) + 14n * BigInt(DAY));
      }
      const first = await record("SET", "control: walletB → doctor2 active", W.doctor2, W.walletB.address, hB, "DECRYPT", await raw(W.doctor2, W.walletB.address, hB), "control");
      if (first.verdict !== "DECRYPT") {
        // Allow for propagation once, then give up: a hand-built request that never succeeds = "relayer rejects direct requests".
        await sleep(30_000);
        const again = await record("SET", "control retry after 30 s", W.doctor2, W.walletB.address, hB, "DECRYPT", await raw(W.doctor2, W.walletB.address, hB), "control");
        if (again.verdict !== "DECRYPT") throw new Error("STOP: a direct relayer request with an active delegation did not return shares; the relayer does not accept the hand-built request");
      }
    }

    if (section === "T1a") {
      const ctl: [ethers.HDNodeWallet, string, string] = [W.doctor2, W.walletB.address, hB];
      for (let rep = 1; rep <= 2; rep++) {
        await refusedWithControl("T1a", `no delegation: doctor2 claims walletA (rep ${rep})`, W.doctor2, W.walletA.address, hA, ctl);
        await refusedWithControl("T1a", `no delegation yet: doctor1 for walletA (rep ${rep})`, W.doctor1, W.walletA.address, hA, ctl);
      }
      await sdkRow("T1a", "no delegation yet: doctor1 for walletA", W.doctor1, W.walletA.address, hA, "REFUSED");
    }

    if (section === "T5") {
      if (!(await acl.isHandleDelegatedForUserDecryption(W.walletA.address, W.doctor1.address, dep.address, hA))) {
        await delegate(W.walletA, W.doctor1.address, (await latestTs()) + 14n * BigInt(DAY));
      }
      const pairs: [string, ethers.HDNodeWallet, string, string, "DECRYPT" | "REFUSED"][] = [
        [hA, W.doctor1, W.walletA.address, "own: doctor1 for walletA", "DECRYPT"],
        [hB, W.doctor2, W.walletB.address, "own: doctor2 for walletB", "DECRYPT"],
        [hA, W.doctor2, W.walletA.address, "cross: doctor2 claims walletA", "REFUSED"],
        [hA, W.doctor2, W.walletB.address, "cross: doctor2 claims walletB for hA", "REFUSED"],
        [hB, W.doctor1, W.walletB.address, "cross: doctor1 claims walletB", "REFUSED"],
        [hB, W.doctor1, W.walletA.address, "cross: doctor1 claims walletA for hB", "REFUSED"],
      ];
      for (const [h, doc, delegator, kase, exp] of pairs) {
        if (exp === "DECRYPT") await record("T5", kase, doc, delegator, h, exp, await raw(doc, delegator, h));
        else await refusedWithControl("T5", kase, doc, delegator, h, doc === W.doctor1 ? [W.doctor1, W.walletA.address, hA] : [W.doctor2, W.walletB.address, hB]);
        await sdkRow("T5", kase, doc, delegator, h, exp);
      }
    }

    if (section === "T4") {
      const iface = new ethers.Interface(ACL_ABI);
      const sim = async (id: string, from: string, to: string, data: string, expect: string) => {
        let actual = "SUCCEEDS (simulated)", reason = "";
        try { await provider.call({ from, to, data }); } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
          actual = "REVERT";
          const d = e?.data ?? e?.info?.error?.data;
          try { reason = iface.parseError(d)!.name; } catch { reason = String(e?.shortMessage ?? e?.message).split("\n")[0]; }
        }
        append(REQ_CSV, REQ_COLS, { test: "T4", case: id, path: "eth_call", delegator: "", delegate: name(from), handle: "hA (#1)", block_start: await provider.getBlockNumber(),
          t_start: new Date().toISOString(), expected: expect, verdict: actual, pass: String(actual.startsWith(expect.split(" ")[0])), label: reason, message: "" });
        console.log(`  T4 ${id.padEnd(58)} ${actual} ${reason}`);
      };
      await sim("E1 doctor1 ACL.allow(hA, doctor2)", W.doctor1.address, ACL_ADDRESS, iface.encodeFunctionData("allow", [hA, W.doctor2.address]), "REVERT");
      await sim("E2 doctor1 ACL.allowForDecryption([hA])", W.doctor1.address, ACL_ADDRESS, iface.encodeFunctionData("allowForDecryption", [[hA]]), "REVERT");
      await sim("E4 doctor1 onward delegation to doctor2", W.doctor1.address, ACL_ADDRESS,
        iface.encodeFunctionData("delegateForUserDecryption", [W.doctor2.address, dep.address, (await latestTs()) + BigInt(DAY)]), "SUCCEEDS");
      const viewRow = { test: "T4", case: "E4 effect: isHandleDelegated(doctor1→doctor2, hA); persistAllowed(hA, doctor1)", path: "eth_call",
        verdict: `${await acl.isHandleDelegatedForUserDecryption(W.doctor1.address, W.doctor2.address, dep.address, hA)} / ${await acl.persistAllowed(hA, W.doctor1.address)}`,
        expected: "false / false", t_start: new Date().toISOString() };
      append(REQ_CSV, REQ_COLS, { ...viewRow, pass: String(viewRow.verdict === "false / false") });
      console.log(`  T4 ${viewRow.case} = ${viewRow.verdict}`);
      await sim("E1c control: walletA ACL.allow(hA, doctor2) (never sent)", W.walletA.address, ACL_ADDRESS, iface.encodeFunctionData("allow", [hA, W.doctor2.address]), "SUCCEEDS");
    }

    if (section === "T1d") {
      // Forged permits while walletA → doctor1 is ACTIVE: the relayer's ACL check passes, so only signature checks can stop them.
      const attacker = ethers.Wallet.createRandom().connect(provider);
      const ctl: [ethers.HDNodeWallet, string, string] = [W.doctor1, W.walletA.address, hA];
      // (i) attacker signs its own permit and claims to be doctor 1
      const forge1 = async () => {
        const { signedPermit } = await signDelegatedPermit(provider, attacker, W.walletA.address, dep.address);
        const body = { ...buildBody(signedPermit, [hA], dep.address), delegateAddress: W.doctor1.address };
        return { outcome: await postDelegated(body), block: await provider.getBlockNumber(),
          aclView: await acl.isHandleDelegatedForUserDecryption(W.walletA.address, W.doctor1.address, dep.address, hA) } as Req;
      };
      // (ii) doctor 1's genuine permit, but the transport public key swapped for the attacker's
      const forge2 = async () => {
        const genuine = await signDelegatedPermit(provider, W.doctor1 as unknown as ethers.Wallet, W.walletA.address, dep.address);
        const other = await signDelegatedPermit(provider, attacker, W.walletA.address, dep.address);
        const body = { ...buildBody(genuine.signedPermit, [hA], dep.address), publicKey: buildBody(other.signedPermit, [hA], dep.address).publicKey };
        return { outcome: await postDelegated(body), block: await provider.getBlockNumber(),
          aclView: await acl.isHandleDelegatedForUserDecryption(W.walletA.address, W.doctor1.address, dep.address, hA) } as Req;
      };
      for (const [kase, fn] of [["forged: attacker-signed permit claiming doctor1", forge1], ["forged: doctor1 permit with attacker public key", forge2]] as const) {
        const r = await fn();
        const row = await record("T1d", kase, W.doctor1, W.walletA.address, hA, "REFUSED", r);
        await record("T1d", `control for: ${kase}`, ctl[0], ctl[1], ctl[2], "DECRYPT", await raw(ctl[0], ctl[1], ctl[2]), "control");
        if (row.verdict === "DECRYPT") throw new Error(`STOP: SECURITY — ${kase} was answered with KMS shares`);
      }
    }

    if (section === "T1b" || section === "T2") {
      const cycles = section === "T1b" ? 1 : 5;
      for (let cycle = 1; cycle <= cycles; cycle++) {
        const label = section === "T1b" ? "T1b" : `T2.${cycle}`;
        // (re)delegate walletA → doctor1 and measure grant → first DECRYPT
        if (!(await acl.isHandleDelegatedForUserDecryption(W.walletA.address, W.doctor1.address, dep.address, hA))) {
          const g = await delegate(W.walletA, W.doctor1.address, (await latestTs()) + 14n * BigInt(DAY) + BigInt(cycle), label);
          const gTime = Date.now();
          let grantS = "";
          for (let i = 0; i < 20; i++) {
            const r = await raw(W.doctor1, W.walletA.address, hA);
            await record(section, `${label} after grant (block ${g.blockNumber})`, W.doctor1, W.walletA.address, hA, "DECRYPT", r);
            if (r.outcome.verdict === "DECRYPT") { grantS = ((r.outcome.startedAt - gTime) / 1000).toFixed(1); break; }
          }
          append(TIMING_CSV, TIMING_COLS, { test: section, cycle, event: "grant", event_block: g.blockNumber, event_time: new Date(gTime).toISOString(), grant_to_first_decrypt_s: grantS });
        }
        const rv = await revoke(W.walletA, W.doctor1.address);
        const tR = Date.now();
        const bR = rv.blockNumber;
        // Two staggered pollers until the first refusal, then 3 more requests.
        const results: { start: number; block: number; verdict: string }[] = [];
        let refusedSeen = 0, stop = false;
        const poller = async (offsetMs: number) => {
          await sleep(offsetMs);
          while (!stop && Date.now() - tR < 15 * 60_000) {
            const r = await raw(W.doctor1, W.walletA.address, hA);
            results.push({ start: r.outcome.startedAt, block: r.block, verdict: r.outcome.verdict });
            await record(section, `${label} after revoke (block ${bR})`, W.doctor1, W.walletA.address, hA, "REFUSED", r);
            if (r.outcome.verdict === "REFUSED_SERVER" && ++refusedSeen >= 4) stop = true;
          }
        };
        await Promise.all([poller(0), poller(700)]);
        const succ = results.filter((x) => x.verdict === "DECRYPT").sort((a, b) => b.start - a.start)[0];
        const ref = results.filter((x) => x.verdict === "REFUSED_SERVER").sort((a, b) => a.start - b.start)[0];
        const flapping = ref && results.some((x) => x.verdict === "DECRYPT" && x.start > ref.start);
        append(TIMING_CSV, TIMING_COLS, { test: section, cycle, event: "revoke", event_block: bR, event_time: new Date(tR).toISOString(),
          last_success_s: succ ? ((succ.start - tR) / 1000).toFixed(1) : "none", last_success_blocks: succ ? succ.block - bR : "",
          first_refusal_s: ref ? ((ref.start - tR) / 1000).toFixed(1) : "none", first_refusal_blocks: ref ? ref.block - bR : "",
          requests: results.length, notes: flapping ? "FLAPPING: a success after the first refusal" : "" });
        console.log(`  ${label}: revoke block ${bR}; last success ${succ ? ((succ.start - tR) / 1000).toFixed(1) + " s" : "none"}; first refusal ${ref ? ((ref.start - tR) / 1000).toFixed(1) + " s, " + (ref.block - bR) + " blocks" : "none"}${flapping ? " FLAPPING" : ""}`);
        if (section === "T1b") {
          console.log("  T1b: waiting 10 minutes after the revocation…");
          await sleep(Math.max(0, tR + 10 * 60_000 - Date.now()));
          for (let rep = 1; rep <= 2; rep++) await refusedWithControl("T1b", `revoked 10 min ago (rep ${rep})`, W.doctor1, W.walletA.address, hA, [W.doctor2, W.walletB.address, hB]);
          await sdkRow("T1b", "revoked", W.doctor1, W.walletA.address, hA, "REFUSED");
        }
      }
    }

    if (section === "T3") {
      // Control during T3: walletA → doctor1 must be active.
      if (!(await acl.isHandleDelegatedForUserDecryption(W.walletA.address, W.doctor1.address, dep.address, hA))) {
        await delegate(W.walletA, W.doctor1.address, (await latestTs()) + 14n * BigInt(DAY) + 99n, "(control for T3)");
      }
      for (let rep = 1; rep <= 2; rep++) {
        const g = await delegate(W.walletB, W.doctor2.address, (await latestTs()) + 300n, `(5-minute expiry, rep ${rep})`);
        const expiry = BigInt(await acl.getUserDecryptionDelegationExpirationDate(W.walletB.address, W.doctor2.address, dep.address));
        const gBlock = await provider.getBlock(g.blockNumber);
        const expiryWall = Date.now() + Number(expiry - BigInt(gBlock!.timestamp)) * 1000; // approx wall time of expiry
        for (const at of [30, 120]) {
          await sleep(Math.max(0, (gBlock!.timestamp + at) * 1000 - Date.now()));
          await record("T3", `rep ${rep}: +${at}s before expiry (${expiry})`, W.doctor2, W.walletB.address, hB, "DECRYPT", await raw(W.doctor2, W.walletB.address, hB));
        }
        await sleep(Math.max(0, expiryWall - 60_000 - Date.now()));
        const results: { start: number; block: number; ts: number; verdict: string }[] = [];
        while (Date.now() < expiryWall + 10 * 60_000) {
          const blk = await provider.getBlock("latest");
          const r = await raw(W.doctor2, W.walletB.address, hB);
          results.push({ start: r.outcome.startedAt, block: r.block, ts: blk!.timestamp, verdict: r.outcome.verdict });
          const exp = BigInt(blk!.timestamp) < expiry ? "DECRYPT" : "REFUSED";
          await record("T3", `rep ${rep}: around expiry (block ts ${blk!.timestamp} vs expiry ${expiry})`, W.doctor2, W.walletB.address, hB, exp, r);
          await sleep(8_000);
        }
        // first block with timestamp ≥ expiry
        let b = (await provider.getBlockNumber());
        while ((await provider.getBlock(b - 1))!.timestamp >= Number(expiry)) b--;
        const expiryBlock = b;
        const expiryBlockTs = (await provider.getBlock(expiryBlock))!.timestamp;
        const succ = results.filter((x) => x.verdict === "DECRYPT").sort((a, c2) => c2.start - a.start)[0];
        const ref = results.filter((x) => x.verdict === "REFUSED_SERVER").sort((a, c2) => a.start - c2.start)[0];
        append(TIMING_CSV, TIMING_COLS, { test: "T3", cycle: rep, event: "expiry", event_block: expiryBlock, event_time: new Date(expiryBlockTs * 1000).toISOString(),
          last_success_s: succ ? ((succ.start - expiryBlockTs * 1000) / 1000).toFixed(1) : "none", last_success_blocks: succ ? succ.block - expiryBlock : "",
          first_refusal_s: ref ? ((ref.start - expiryBlockTs * 1000) / 1000).toFixed(1) : "none", first_refusal_blocks: ref ? ref.block - expiryBlock : "",
          requests: results.length, notes: `expiry ${expiry}; times relative to the first block with timestamp ≥ expiry` });
        console.log(`  T3 rep ${rep}: expiry block ${expiryBlock}; last success ${succ ? ((succ.start - expiryBlockTs * 1000) / 1000).toFixed(1) + " s" : "none"}; first refusal ${ref ? ((ref.start - expiryBlockTs * 1000) / 1000).toFixed(1) + " s" : "none"}`);
        // T1c: expired 10 minutes ago, with control
        await refusedWithControl("T1c", `expired ~10 min ago (rep ${rep})`, W.doctor2, W.walletB.address, hB, [W.doctor1, W.walletA.address, hA]);
        await sdkRow("T1c", `expired (rep ${rep})`, W.doctor2, W.walletB.address, hB, "REFUSED");
      }
    }

    if (section === "S9b") {
      // Re-check the after-close refusals with a VALID control: in the first S9 run the control (walletB → doctor2)
      // had been left expired by T3, so its refusals could not be confirmed.
      if (!(await acl.isHandleDelegatedForUserDecryption(W.walletB.address, W.doctor2.address, dep.address, hB))) {
        await delegate(W.walletB, W.doctor2.address, (await latestTs()) + 14n * BigInt(DAY) + 11n, "(control for S9b)");
      }
      const [rh] = await c.getResponseHandles(1);
      const r0: string = rh[0];
      plain.set(r0.toLowerCase(), textToUint64Chunks("Synthetic test reply from doctor A")[0]);
      const ctl: [ethers.HDNodeWallet, string, string] = [W.doctor2, W.walletB.address, hB];
      await refusedWithControl("S9b", "after close: doctor1 for complaint", W.doctor1, W.walletA.address, hA, ctl);
      await refusedWithControl("S9b", "after close: doctor1 for own response", W.doctor1, W.walletA.address, r0, ctl);
      await sdkRow("S9b", "after close: doctor1 for complaint", W.doctor1, W.walletA.address, hA, "REFUSED");
    }

    if (section === "S9") {
      // Doctor 1 responds; patient (walletA) decrypts; doctor 1 can read own reply while delegated (D1); doctor 2 cannot;
      // then the frontend's revoke-then-close; afterwards doctor 1 is refused for complaint and response.
      if (!(await acl.isHandleDelegatedForUserDecryption(W.walletA.address, W.doctor1.address, dep.address, hA))) {
        await delegate(W.walletA, W.doctor1.address, (await latestTs()) + 14n * BigInt(DAY) + 7n, "(S9)");
      }
      const meta = await c.getConsultationMeta(1);
      const reply = "Synthetic test reply from doctor A";
      if (!meta.hasResponse) {
        const chunks = textToUint64Chunks(reply);
        const enc = await encryptUint64(await sdkFor(W.doctor1, rpc), dep.address, W.doctor1.address, chunks);
        await planAndSend("Doctor 1 responds to #1 (synthetic)", [{ label: `submitResponse(1, ${chunks.length} chunks)`, signer: W.doctor1,
          request: await c.submitResponse.populateTransaction(1, [...enc.handles, ...Array(32 - enc.handles.length).fill(ethers.ZeroHash)], enc.inputProof, chunks.length) }], provider);
      }
      const [rh] = await c.getResponseHandles(1);
      const r0: string = rh[0];
      plain.set(r0.toLowerCase(), textToUint64Chunks(reply)[0]);
      const u = await userDecrypt(await sdkFor(W.walletA, rpc), dep.address, [r0]);
      append(REQ_CSV, REQ_COLS, { test: "S9", case: "patient (walletA) decrypts the response", path: "@zama-fhe/sdk user decrypt", delegator: "", delegate: "walletA", handle: "response #1",
        t_start: new Date().toISOString(), expected: "DECRYPT", verdict: u.actual, pass: String(u.actual === "DECRYPT" && u.values![0] === plain.get(r0.toLowerCase())), plaintext_ok: u.values ? String(u.values[0] === plain.get(r0.toLowerCase())) : "" });
      console.log(`  S9 patient decrypts response: ${u.actual}`);
      await record("S9", "D1: doctor1 decrypts own response via delegation", W.doctor1, W.walletA.address, r0, "DECRYPT", await raw(W.doctor1, W.walletA.address, r0));
      await refusedWithControl("S9", "doctor2 claims walletA for the response", W.doctor2, W.walletA.address, r0, [W.doctor1, W.walletA.address, hA]);

      const steps: string[] = [];
      await revokeThenClose({
        isDoctorDelegated: () => c.isDoctorDelegated(1),
        revoke: async () => { await revoke(W.walletA, W.doctor1.address); },
        close: async () => { await planAndSend("Close #1", [{ label: "closeConsultation(1)", signer: W.walletA, request: await c.closeConsultation.populateTransaction(1) }], provider); },
        onStep: (s) => steps.push(s),
      });
      const after = await c.getConsultationMeta(1);
      console.log(`  S9 revokeThenClose steps ${steps.join(" → ")}; status ${after.status}; isDoctorDelegated ${await c.isDoctorDelegated(1)}`);
      append(REQ_CSV, REQ_COLS, { test: "S9", case: `revokeThenClose: ${steps.join(" → ")}`, path: "transactions", t_start: new Date().toISOString(),
        expected: "status 2, not delegated", verdict: `status ${after.status}, delegated ${await c.isDoctorDelegated(1)}`, pass: String(Number(after.status) === 2 && !(await c.isDoctorDelegated(1))) });
      await refusedWithControl("S9", "after close: doctor1 for complaint", W.doctor1, W.walletA.address, hA, [W.doctor2, W.walletB.address, hB]);
      await refusedWithControl("S9", "after close: doctor1 for own response", W.doctor1, W.walletA.address, r0, [W.doctor2, W.walletB.address, hB]);
    }
  }
  if (!controlOk && sections.some((s) => s !== "T4")) console.log("⚠ no raw request returned shares in this run");
}

main().then(() => { disposeAll(); process.exit(0); }).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
