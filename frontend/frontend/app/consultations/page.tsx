"use client";

import { useAccount } from "wagmi";
import { useWallet } from "@/app/providers";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import type { ConsultationMeta, Doctor } from "@/libs/types";
import { decryptHandles } from "@/libs/fhe-utils";
import { getErrorMessage } from "@/libs/errors";

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
  const { wallet, provider }      = useWallet();
  const [response, setResponse]   = useState("");
  const [decrypting, setDecrypting] = useState(false);
  const [closing, setClosing]     = useState(false);
  const [regranting, setRegranting] = useState(false);
  const [status, setStatus]       = useState("");

  const contract = wallet.contract;

  const decryptResponse = async () => {
    if (!wallet.fhevmInstance || !consult.hasResponse || !contract || !provider) return;
    try {
      setDecrypting(true);
      setStatus("🔓 Requesting decryption from Zama relayer...");
      const { handles, count } = await contract.getResponseHandles(consult.id);
      const contractAddress = await contract.getAddress();
      const handleList = Array.from({ length: Number(count) }, (_, i) => handles[i] as string);
      const text = await decryptHandles(handleList, contractAddress, wallet.account, wallet.fhevmInstance, provider);
      setResponse(text);
      setStatus("");
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      const isAcl = msg.includes("500") || msg.includes("execution reverted");
      setStatus(isAcl
        ? "⏳ ACL still propagating — wait 2-3 minutes then try again."
        : `❌ Decryption failed: ${msg}`);
    } finally {
      setDecrypting(false);
    }
  };

  const regrantAccess = async () => {
    if (!contract) return;
    try {
      setRegranting(true);
      setStatus("🔑 Re-granting doctor access on-chain...");
      const tx: ethers.ContractTransactionResponse = await contract.grantDoctorAccess(consult.id);
      setStatus("⏳ Confirming... (waiting 2 blocks)");
      await tx.wait(2);
      setStatus("✅ Access re-granted! Wait 3-5 minutes for Zama to propagate, then ask the doctor to decrypt.");
    } catch (err: unknown) {
      setStatus(`❌ ${getErrorMessage(err)}`);
    } finally {
      setRegranting(false);
    }
  };

  const handleClose = async () => {
    if (!contract) return;
    try {
      setClosing(true);
      const tx: ethers.ContractTransactionResponse = await contract.closeConsultation(consult.id);
      await tx.wait();
      onRefresh();
      onClose();
    } catch (err: unknown) {
      setStatus(`❌ ${getErrorMessage(err)}`);
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        {decrypting && <TxOverlay title="Decrypting Response" sub="Please sign in your wallet. Zama is verifying your access permission." />}
        {regranting && <TxOverlay title="Re-granting Doctor Access" sub="Submitting ACL permission on-chain. Please confirm in your wallet." />}

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
          <div className="form-label" style={{ marginBottom: ".5rem" }}>Your Complaint</div>
          <div className="fhe-box" style={{ marginBottom: 0 }}>
            <span className="fhe-box-icon">🔒</span>
            <p>Stored encrypted on-chain. Only you and your doctor can decrypt it.</p>
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
          {consult.status !== 2 && (
            <button className="btn btn-ghost btn-sm" onClick={regrantAccess} disabled={regranting}
              title="Use this if the doctor gets a decryption error">
              {regranting ? <><span className="spinner" /> Re-granting...</> : "🔑 Re-grant Doctor Access"}
            </button>
          )}
          {consult.status !== 2 && (
            <button className="btn btn-ghost" onClick={handleClose} disabled={closing}>
              {closing ? "Closing..." : "Close Consultation"}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function ConsultationsContent() {
  const { wallet, fheLoading }    = useWallet();
  const { openConnectModal }      = useConnectModal();
  const { isConnected }           = useAccount();
  const [mounted, setMounted]     = useState(false);
  const [consultations, setConsultations] = useState<ConsultationMeta[]>([]);
  const [doctors, setDoctors]     = useState<Map<number, Doctor>>(new Map());
  const [loadingData, setLoadingData] = useState(false);
  const [selected, setSelected]   = useState<ConsultationMeta | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const loadAll = useCallback(async () => {
    const contract = wallet.contract;
    if (!contract || !wallet.account) return;
    setLoadingData(true);
    try {
      const ids = await contract.getPatientConsultations(wallet.account) as bigint[];
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
      setConsultations(loaded.reverse());

      const docMap = new Map<number, Doctor>();
      const docIds = [...new Set(loaded.map((c) => c.doctorId))];
      for (const docId of docIds) {
        const d = await contract.doctors(docId);
        docMap.set(docId, {
          id: Number(d.id), wallet: d.wallet as string, name: d.name as string,
          specialty: d.specialty as string, credentials: d.credentials as string,
          active: d.active as boolean, consultationCount: Number(d.consultationCount),
        });
      }
      setDoctors(docMap);
    } catch (e) { console.error(e); }
    finally { setLoadingData(false); }
  }, [wallet.contract, wallet.account]);

  useEffect(() => {
    if (wallet.contract && wallet.account) loadAll();
  }, [wallet.contract, wallet.account, loadAll]);

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

  const open      = consultations.filter((c) => c.status === 0);
  const responded = consultations.filter((c) => c.status === 1);
  const closed    = consultations.filter((c) => c.status === 2);

  return (
    <main className="page-md">
      <div className="section-header">
        <div>
          <h1 className="page-title">My Consultations</h1>
          <p className="page-sub">All complaints are encrypted on-chain. Only you and your assigned doctor can decrypt.</p>
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