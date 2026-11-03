"use client";

import { useAccount } from "wagmi";
import { useWallet } from "@/app/providers";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import type { ConsultationMeta, Doctor } from "@/libs/types";
import { decryptHandles } from "@/libs/fhe-utils";
import { getErrorMessage } from "@/libs/errors";
import { CONTRACT_ADDRESS, DELEGATION_DAYS, PATIENT_WALLET_TOPUP_ETH } from "@/libs/config";
import { fundIfNeeded, GAS_BUDGET } from "@/libs/patient-wallets";
import { revokeThenClose } from "@/libs/delegation";

const STATUS_LABEL = ["Open", "Doctor Responded", "Closed"];
const STATUS_BADGE  = ["badge-blue", "badge-green", "badge-gray"];

function TxOverlay({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="tx-overlay">
      <div className="tx-overlay-card">
        <div className="tx-spinner" />
        <div className="tx-overlay-title">{title}</div>
        <div className="tx-overlay-sub">{sub}</div>
      </div>
    </div>
  );
}

function ConsultDetail({ consult, doctor, onClose, onRefresh }: {
  consult: ConsultationMeta; doctor: Doctor | null;
  onClose: () => void; onRefresh: () => void;
}) {
  const { wallet, provider, getPatientWallet, getPatientSdk } = useWallet();
  const [response, setResponse]   = useState("");
  const [decrypting, setDecrypting] = useState(false);
  const [busy, setBusy]           = useState<"" | "closing" | "revoking" | "delegating">("");
  const [status, setStatus]       = useState("");
  const [accessUntil, setAccessUntil] = useState<number | null>(null); // unix seconds; 0 = no delegation

  const contract = wallet.contract;

  // Delegation from this consultation's patient wallet to its doctor (covers all consultations with that doctor).
  const loadAccess = useCallback(async () => {
    if (!doctor) return;
    try {
      const patientWallet = await getPatientWallet(consult.doctorId);
      const { delegationExpiresAt } = await import("@/libs/zama");
      setAccessUntil(await delegationExpiresAt(await getPatientSdk(consult.doctorId), CONTRACT_ADDRESS, patientWallet.address, doctor.wallet));
    } catch (e) { console.error(e); }
  }, [consult.doctorId, doctor, getPatientWallet, getPatientSdk]);

  useEffect(() => { loadAccess(); }, [loadAccess]);

  // Every patient action is sent from the per-doctor wallet, topped up from the main wallet if needed.
  const asPatient = async (gasBudget: bigint) => {
    if (!provider) throw new Error("Wallet not connected");
    const patientWallet = await getPatientWallet(consult.doctorId);
    await fundIfNeeded(patientWallet, await provider.getSigner(), gasBudget, ethers.parseEther(PATIENT_WALLET_TOPUP_ETH));
    return patientWallet;
  };

  const decryptResponse = async () => {
    if (!consult.hasResponse || !contract) return;
    try {
      setDecrypting(true);
      setStatus("🔓 Requesting decryption from Zama relayer...");
      const { handles, count } = await contract.getResponseHandles(consult.id);
      const contractAddress = await contract.getAddress();
      const handleList = Array.from({ length: Number(count) }, (_, i) => handles[i] as string);
      const text = await decryptHandles(handleList, contractAddress, await getPatientSdk(consult.doctorId));
      setResponse(text);
      setStatus("");
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      setStatus(`❌ Decryption failed: ${msg}`);
    } finally {
      setDecrypting(false);
    }
  };

  const delegateAccess = async () => {
    if (!doctor) return;
    try {
      setBusy("delegating");
      setStatus(`🔑 Delegating decryption to the doctor for ${DELEGATION_DAYS} days...`);
      await asPatient(GAS_BUDGET.delegate);
      const { delegateToDoctor } = await import("@/libs/zama");
      await delegateToDoctor(await getPatientSdk(consult.doctorId), CONTRACT_ADDRESS, doctor.wallet);
      setStatus(`✅ The doctor can decrypt your consultations with them for ${DELEGATION_DAYS} days, until you revoke access or close.`);
      await loadAccess();
    } catch (err: unknown) {
      setStatus(`❌ ${getErrorMessage(err)}`);
    } finally {
      setBusy("");
    }
  };

  const revokeDoctorAccess = async () => {
    if (!doctor) throw new Error("Doctor not loaded");
    const { revokeDoctor } = await import("@/libs/zama");
    await revokeDoctor(await getPatientSdk(consult.doctorId), CONTRACT_ADDRESS, doctor.wallet);
  };

  const revokeAccess = async () => {
    try {
      setBusy("revoking");
      setStatus("🚫 Revoking the doctor's decryption access...");
      await asPatient(GAS_BUDGET.revoke);
      await revokeDoctorAccess();
      setStatus("✅ Access revoked for all your consultations with this doctor. The doctor can no longer decrypt them; anything they already read cannot be un-read.");
      await loadAccess();
    } catch (err: unknown) {
      setStatus(`❌ ${getErrorMessage(err)}`);
    } finally {
      setBusy("");
    }
  };

  // One user action, up to two transactions: revoke the doctor's delegation (if active), then close.
  const handleClose = async () => {
    if (!contract) return;
    try {
      setBusy("closing");
      const patientWallet = await asPatient(GAS_BUDGET.revoke + GAS_BUDGET.close);
      const asPatientContract = contract.connect(patientWallet) as ethers.Contract;
      await revokeThenClose({
        isDoctorDelegated: async () => (await contract.isDoctorDelegated(consult.id)) as boolean,
        revoke: revokeDoctorAccess,
        close: async () => {
          const tx: ethers.ContractTransactionResponse = await asPatientContract.closeConsultation(consult.id);
          await tx.wait();
        },
        onStep: (step) => {
          if (step === "revoking") setStatus("🚫 Step 1/2: revoking the doctor's access...");
          if (step === "closing") setStatus("📁 Closing the consultation...");
        },
      });
      onRefresh();
      onClose();
    } catch (err: unknown) {
      setStatus(`❌ ${getErrorMessage(err)}`);
      await loadAccess();
    } finally {
      setBusy("");
    }
  };

  const accessActive = (accessUntil ?? 0) > 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        {decrypting && <TxOverlay title="Decrypting Response" sub="Zama is verifying your private patient wallet's access permission." />}
        {busy === "delegating" && <TxOverlay title="Delegating Doctor Access" sub="Sending the delegation from your private patient wallet." />}
        {busy === "revoking" && <TxOverlay title="Revoking Doctor Access" sub="Sending the revocation from your private patient wallet." />}
        {busy === "closing" && <TxOverlay title="Closing Consultation" sub={accessActive ? "Revoking the doctor's access first, then closing (two transactions from your private patient wallet)." : "Sending the close from your private patient wallet."} />}

        <div className="modal-header">
          <h2 className="modal-title">Consultation #{consult.id}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".75rem", marginBottom: "1.25rem" }}>
          <div className="card card--flat">
            <div className="form-label">Doctor</div>
            <div style={{ fontWeight: 600, marginTop: ".25rem" }}>{doctor?.name ?? `#${consult.doctorId}`}</div>
            <div style={{ fontSize: ".78rem", color: "var(--text-muted)" }}>{doctor?.specialty}</div>
          </div>
          <div className="card card--flat">
            <div className="form-label">Status</div>
            <span className={`badge ${STATUS_BADGE[consult.status]}`} style={{ marginTop: ".25rem", display: "inline-block" }}>
              {STATUS_LABEL[consult.status]}
            </span>
          </div>
        </div>

        <div className="card card--flat" style={{ marginBottom: "1rem" }}>
          <div className="form-label" style={{ marginBottom: ".5rem" }}>Doctor Access</div>
          <div className="fhe-box" style={{ marginBottom: 0 }}>
            <span className="fhe-box-icon">{accessActive ? "🔓" : "🔒"}</span>
            <p>
              {accessUntil === null ? "Checking..."
                : accessActive ? <>The doctor can decrypt your consultations with them, including their own reply, until <strong>{new Date(accessUntil! * 1000).toLocaleString()}</strong>. Revoking or closing ends this for all your consultations with this doctor. Anything the doctor has already read cannot be un-read.</>
                : "The doctor cannot decrypt your consultations with them (access not granted, revoked or expired)."}
            </p>
          </div>
        </div>

        {consult.hasResponse && (
          <div className="card card--flat" style={{ marginBottom: "1rem" }}>
            <div className="form-label" style={{ marginBottom: ".5rem" }}>Doctor&apos;s Response</div>
            {response ? (
              <div style={{ background: "var(--surface2)", borderRadius: 8, padding: ".9rem", fontSize: ".88rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {response}
              </div>
            ) : (
              <>
                <div className="fhe-box" style={{ marginBottom: ".6rem" }}>
                  <span className="fhe-box-icon">🔒</span>
                  <p>Response is encrypted. Click decrypt to read it privately.</p>
                </div>
                <button className="btn btn-success btn-sm" onClick={decryptResponse} disabled={decrypting}>
                  {decrypting ? <><span className="spinner" /> Decrypting...</> : "🔓 Decrypt Response"}
                </button>
              </>
            )}
          </div>
        )}

        {status && (
          <div className={`status-msg ${status.startsWith("❌") ? "status-msg--error" : status.startsWith("✅") ? "status-msg--success" : ""}`}>
            {status}
          </div>
        )}

        <div className="modal-actions" style={{ flexWrap: "wrap", gap: ".6rem" }}>
          {consult.status !== 2 && accessActive && (
            <button className="btn btn-ghost btn-sm" onClick={revokeAccess} disabled={busy !== ""}>
              {busy === "revoking" ? <><span className="spinner" /> Revoking...</> : "🚫 Revoke Doctor Access"}
            </button>
          )}
          {consult.status !== 2 && accessUntil === 0 && (
            <button className="btn btn-ghost btn-sm" onClick={delegateAccess} disabled={busy !== ""}>
              {busy === "delegating" ? <><span className="spinner" /> Delegating...</> : `🔑 Grant Doctor Access (${DELEGATION_DAYS} days)`}
            </button>
          )}
          {consult.status !== 2 && (
            <button className="btn btn-ghost" onClick={handleClose} disabled={busy !== ""}
              title={accessActive ? "Revokes the doctor's access to all your consultations with this doctor, then closes this one (two transactions)." : undefined}>
              {busy === "closing" ? "Closing..." : accessActive ? "Revoke Access & Close" : "Close Consultation"}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function ConsultationsContent() {
  const { wallet, fheLoading, getPatientWallet, hasPatientSeed } = useWallet();
  const { openConnectModal }      = useConnectModal();
  const { isConnected }           = useAccount();
  const [mounted, setMounted]     = useState(false);
  const [consultations, setConsultations] = useState<ConsultationMeta[]>([]);
  const [doctors, setDoctors]     = useState<Map<number, Doctor>>(new Map());
  const [loadingData, setLoadingData] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected]   = useState<ConsultationMeta | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Consultations live on the per-doctor patient wallets, so loading them needs the seed signature.
  const loadAll = useCallback(async () => {
    const contract = wallet.contract;
    if (!contract || !wallet.account) return;
    setLoadingData(true);
    setLoadError("");
    try {
      const docIds = (await contract.getAllDoctorIds() as bigint[]).map(Number);
      const docMap = new Map<number, Doctor>();
      const ids: bigint[] = [];
      for (const docId of docIds) {
        const d = await contract.doctors(docId);
        docMap.set(docId, {
          id: Number(d.id), wallet: d.wallet as string, name: d.name as string,
          specialty: d.specialty as string, credentials: d.credentials as string,
          active: d.active as boolean, consultationCount: Number(d.consultationCount),
        });
        const patientWallet = await getPatientWallet(docId);
        ids.push(...(await contract.getPatientConsultations(patientWallet.address) as bigint[]));
      }
      const loaded: ConsultationMeta[] = await Promise.all(
        ids.map(async (id) => {
          const m = await contract.getConsultationMeta(id);
          return {
            id: Number(id), patient: m.patient as string,
            doctorId: Number(m.doctorId), status: Number(m.status) as 0 | 1 | 2,
            createdAt: Number(m.createdAt), complaintChunkCount: Number(m.complaintChunkCount),
            hasResponse: m.hasResponse as boolean, responseChunkCount: Number(m.responseChunkCount),
          };
        })
      );
      setConsultations(loaded.sort((a, b) => b.id - a.id));
      setDoctors(docMap);
    } catch (e) {
      console.error(e);
      setLoadError(getErrorMessage(e));
    }
    finally { setLoadingData(false); }
  }, [wallet.contract, wallet.account, getPatientWallet]);

  // Load automatically once the seed is unlocked (e.g. after submitting from the doctors page).
  useEffect(() => {
    if (wallet.contract && wallet.account && hasPatientSeed) loadAll();
  }, [wallet.contract, wallet.account, hasPatientSeed, loadAll]);

  if (!mounted) return null;

  if (!isConnected) return (
    <main className="page-sm" style={{ textAlign: "center", paddingTop: "4rem" }}>
      <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🔒</div>
      <h1 className="page-title">My Consultations</h1>
      <p className="page-sub">Connect your wallet to view your encrypted consultations.</p>
      <button className="btn btn-primary" onClick={() => openConnectModal?.()} disabled={fheLoading}>
        {fheLoading ? "Connecting..." : "Connect Wallet"}
      </button>
    </main>
  );

  if (!hasPatientSeed) return (
    <main className="page-sm" style={{ textAlign: "center", paddingTop: "4rem" }}>
      <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🔑</div>
      <h1 className="page-title">My Consultations</h1>
      <p className="page-sub">Your consultations are held by private wallets, one per doctor, derived from a signature by your main wallet. Nothing is stored; sign to unlock them for this session.</p>
      <button className="btn btn-primary" onClick={loadAll} disabled={loadingData || !wallet.contract}>
        {loadingData ? "Unlocking..." : "Unlock My Consultations"}
      </button>
      {loadError && <div className="status-msg status-msg--error" style={{ marginTop: "1rem" }}>❌ {loadError}</div>}
    </main>
  );

  const open      = consultations.filter((c) => c.status === 0);
  const responded = consultations.filter((c) => c.status === 1);
  const closed    = consultations.filter((c) => c.status === 2);

  return (
    <main className="page-md">
      <div className="section-header">
        <div>
          <h1 className="page-title">My Consultations</h1>
          <p className="page-sub">All complaints are encrypted on-chain. Only you, and a doctor you have delegated access to, can decrypt.</p>
        </div>
        <a href="/doctors" className="btn btn-primary btn-sm">+ New Consultation</a>
      </div>

      <div className="stats-row">
        <div className="stat-card"><div className="stat-value">{open.length}</div><div className="stat-label">Open</div></div>
        <div className="stat-card"><div className="stat-value">{responded.length}</div><div className="stat-label">Awaiting Read</div></div>
        <div className="stat-card"><div className="stat-value">{closed.length}</div><div className="stat-label">Closed</div></div>
      </div>

      {loadingData ? (
        <div className="empty-state"><div className="spinner" style={{ width: 32, height: 32, borderTopColor: "var(--accent)" }} /></div>
      ) : consultations.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">📋</span>
          <h3>No consultations yet</h3>
          <p>Start a private consultation with a verified doctor.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
          {consultations.map((c) => {
            const doc = doctors.get(c.doctorId);
            return (
              <div key={c.id} className="consult-row" onClick={() => setSelected(c)}>
                <div className="consult-id">#{c.id}</div>
                <div className="consult-info">
                  <div className="consult-title">{doc?.name ?? `Doctor #${c.doctorId}`}</div>
                  <div className="consult-meta">{doc?.specialty} · {new Date(c.createdAt * 1000).toLocaleDateString()}</div>
                </div>
                <div className="consult-actions">
                  {c.hasResponse && c.status !== 2 && <span className="badge badge-green">Response ready</span>}
                  <span className={`badge ${STATUS_BADGE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <ConsultDetail consult={selected} doctor={doctors.get(selected.doctorId) ?? null}
          onClose={() => setSelected(null)} onRefresh={loadAll} />
      )}
    </main>
  );
}

export default function ConsultationsPage() {
  return <ConsultationsContent />;
}
