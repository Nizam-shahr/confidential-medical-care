"use client";

import { useAccount } from "wagmi";
import { useWallet } from "@/app/providers";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import type { ConsultationMeta } from "@/libs/types";
import { encryptText, decryptHandlesDelegated } from "@/libs/fhe-utils";
import { getErrorMessage } from "@/libs/errors";

const STATUS_LABEL = ["Open", "Responded", "Closed"];
const STATUS_BADGE  = ["badge-blue", "badge-green", "badge-gray"];
type ResponseStep = "read" | "encrypting" | "sending" | "done";

interface CaseDetailProps {
  consult: ConsultationMeta;
  onClose: () => void;
  onRefresh: () => void;
}

function TxOverlay({ title, sub, steps, activeStep }: {
  title: string; sub: string;
  steps?: { icon: string; label: string }[];
  activeStep?: number;
}) {
  return (
    <div className="tx-overlay">
      <div className="tx-overlay-card">
        <div className="tx-spinner" />
        <div className="tx-overlay-title">{title}</div>
        <div className="tx-overlay-sub">{sub}</div>
        {steps && steps.length > 0 && (
          <div className="tx-overlay-steps">
            {steps.map((s, i) => (
              <div key={s.label} className={`tx-overlay-step ${
                i === activeStep ? "tx-overlay-step--active"
                : i < (activeStep ?? 0) ? "tx-overlay-step--done" : ""
              }`}>
                <span className="tx-overlay-step-icon">
                  {i < (activeStep ?? 0) ? "✅" : s.icon}
                </span>
                {s.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CaseDetail({ consult, onClose, onRefresh }: CaseDetailProps) {
  const { wallet } = useWallet();
  const [complaint, setComplaint]     = useState("");
  const [responseText, setResponseText] = useState("");
  const [decrypting, setDecrypting]   = useState(false);
  const [step, setStep]               = useState<ResponseStep>("read");
  const [status, setStatus]           = useState("");
  const charMax = 256;

  const [delegated, setDelegated]     = useState<boolean | null>(null);

  // Guard: contract must be non-null to proceed
  const contract = wallet.contract;

  useEffect(() => {
    if (!contract) return;
    (contract.isDoctorDelegated(consult.id) as Promise<boolean>).then(setDelegated).catch(() => setDelegated(null));
  }, [contract, consult.id]);

  // v3: the doctor decrypts on behalf of the patient's per-doctor wallet, via its delegation.
  const decryptComplaint = async () => {
    if (!wallet.zama || !contract) return;
    try {
      setDecrypting(true);
      setStatus("🔓 Requesting delegated decryption from Zama relayer...");
      const { handles, count } = await contract.getComplaintHandles(consult.id);
      const contractAddress = await contract.getAddress();
      const handleList = Array.from({ length: Number(count) }, (_, i) => handles[i] as string);
      const text = await decryptHandlesDelegated(handleList, contractAddress, consult.patient, wallet.zama);
      setComplaint(text);
      setStatus("");
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      setStatus(/not authorized|not delegated|delegation|not entitled/i.test(msg)
        ? "❌ The patient has not delegated access to you, or has revoked it, or it expired, or closed the consultation. A new delegation can take a few seconds to reach Zama's gateway."
        : `❌ Decryption failed: ${msg}`);
    } finally {
      setDecrypting(false);
    }
  };

  const handleRespond = async () => {
    if (!responseText.trim()) { setStatus("Please write a response."); return; }
    if (!wallet.zama || !contract) { setStatus("FHE not ready."); return; }
    try {
      setStep("encrypting");
      setStatus("🔐 Encrypting your response with FHE...");
      const contractAddress = await contract.getAddress();
      const { handles, inputProof, chunkCount } = await encryptText(
        responseText, contractAddress, wallet.account, wallet.zama
      );
      setStep("sending");
      setStatus("📡 Submitting encrypted response on-chain...");
      const tx: ethers.ContractTransactionResponse = await contract.submitResponse(
        consult.id, handles, inputProof, chunkCount
      );
      setStatus("⏳ Waiting for confirmation...");
      await tx.wait();
      setStep("done");
      setStatus("✅ Response submitted. The patient will be notified.");
      onRefresh();
    } catch (err: unknown) {
      setStatus(`❌ ${getErrorMessage(err)}`);
      setStep("read");
    }
  };

  const respondSteps = [
    { icon: "🔐", label: "Encrypt response" },
    { icon: "⛓️", label: "Submit on-chain" },
  ];
  const respondStepIndex = step === "encrypting" ? 0 : step === "sending" ? 1 : -1;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 580 }} onClick={(e) => e.stopPropagation()}>
        {decrypting && (
          <TxOverlay
            title="Decrypting Complaint"
            sub="Please sign in your wallet. Zama is verifying the patient's delegation to you."
          />
        )}
        {(step === "encrypting" || step === "sending") && (
          <TxOverlay
            title={step === "encrypting" ? "Encrypting Response" : "Sending On-chain"}
            sub={step === "encrypting"
              ? "Your response is being FHE-encrypted so only the patient can read it."
              : "Submitting to Ethereum. Please confirm in your wallet."}
            steps={respondSteps}
            activeStep={respondStepIndex}
          />
        )}

        <div className="modal-header">
          <h2 className="modal-title">Case #{consult.id}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ display: "flex", gap: ".75rem", marginBottom: "1rem" }}>
          <span className={`badge ${STATUS_BADGE[consult.status]}`}>{STATUS_LABEL[consult.status]}</span>
          <span className="badge badge-gray">{new Date(consult.createdAt * 1000).toLocaleDateString()}</span>
          <span className="badge badge-pink">🕵️ Patient anonymous</span>
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <div className="form-label" style={{ marginBottom: ".5rem" }}>Patient Complaint</div>
          {complaint ? (
            <div style={{ background: "var(--surface2)", borderRadius: 10, padding: "1rem", fontSize: ".88rem", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
              {complaint}
            </div>
          ) : (
            <>
              <div className="fhe-box">
                <span className="fhe-box-icon">🔒</span>
                <p>
                  Complaint is FHE-encrypted. Decrypt to read it. <strong>Patient identity stays hidden.</strong>
                  {delegated === false && <> The patient has not given you access (or revoked it, closed the consultation, or it expired).</>}
                </p>
              </div>
              <button className="btn btn-primary btn-sm" style={{ marginTop: ".6rem" }} onClick={decryptComplaint} disabled={decrypting}>
                {decrypting ? <><span className="spinner" /> Decrypting...</> : "🔓 Decrypt Complaint"}
              </button>
            </>
          )}
        </div>

        <hr className="divider" />

        {!consult.hasResponse && step !== "done" && (
          <div>
            <div className="form-label" style={{ marginBottom: ".5rem" }}>Your Response (encrypted for the patient; no other doctor can read it)</div>
            <div className="fhe-box" style={{ marginBottom: ".75rem" }}>
              <span className="fhe-box-icon">⚡</span>
              <p>Your response will be FHE-encrypted. <strong>Only the patient can decrypt it.</strong> You won&apos;t be able to re-read it after submission.</p>
            </div>
            {step === "read" && (
              <>
                <textarea className="form-textarea" placeholder="Write your medical advice here..." value={responseText}
                  onChange={(e) => setResponseText(e.target.value.slice(0, charMax))} rows={4} />
                <div className="form-hint" style={{ textAlign: "right" }}>{responseText.length}/{charMax}</div>
              </>
            )}
            {step !== "read" && (
              <div className="steps">
                {["Encrypt", "Send", "Done"].map((l, i) => {
                  const idx = ["encrypting", "sending", "done"].indexOf(step);
                  return (
                    <span key={l} style={{ display: "contents" }}>
                      <div className={`step ${idx > i ? "step--done" : idx === i ? "step--active" : ""}`}>
                        <span className="step-num">{idx > i ? "✓" : i + 1}</span>
                        <span>{l}</span>
                      </div>
                      {i < 2 && <div className="step-bar" />}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {consult.hasResponse && (
          <div className="banner banner-success">✅ You have already responded to this case.</div>
        )}

        {status && (
          <div className={`status-msg ${status.startsWith("❌") ? "status-msg--error" : step === "done" ? "status-msg--success" : ""}`}>
            {status}
          </div>
        )}

        <div className="modal-actions">
          {!consult.hasResponse && step === "read" && (
            <button className="btn btn-success" onClick={handleRespond} disabled={!responseText.trim()} style={{ minWidth: 180 }}>
              🔒 Encrypt &amp; Send Response
            </button>
          )}
          {(step === "encrypting" || step === "sending") && (
            <button className="btn btn-success" disabled style={{ minWidth: 180 }}>
              <span className="spinner" />
              {step === "encrypting" ? "Encrypting..." : "Sending..."}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function InboxContent() {
  const { wallet, fheLoading } = useWallet();
  const { openConnectModal } = useConnectModal();
  const { isConnected } = useAccount();
  const [mounted, setMounted]       = useState(false);
  const [cases, setCases]           = useState<ConsultationMeta[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [selected, setSelected]     = useState<ConsultationMeta | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const loadCases = useCallback(async () => {
    const contract = wallet.contract;
    if (!contract) return;
    setLoadingData(true);
    try {
      const ids = await contract.getDoctorConsultations(wallet.isDoctorId) as bigint[];
      const loaded: ConsultationMeta[] = await Promise.all(
        ids.map(async (id) => {
          const m = await contract.getConsultationMeta(id);
          return {
            id: Number(id),
            patient: m.patient as string,
            doctorId: Number(m.doctorId),
            status: Number(m.status) as 0 | 1 | 2,
            createdAt: Number(m.createdAt),
            complaintChunkCount: Number(m.complaintChunkCount),
            hasResponse: m.hasResponse as boolean,
            responseChunkCount: Number(m.responseChunkCount),
          };
        })
      );
      setCases(loaded.reverse());
    } catch (e) { console.error(e); }
    finally { setLoadingData(false); }
  }, [wallet.contract, wallet.isDoctorId]);

  useEffect(() => {
    if (wallet.contract && wallet.isDoctorId > 0) loadCases();
  }, [wallet.contract, wallet.isDoctorId, loadCases]);

  if (!mounted) return null;

  if (!isConnected) return (
    <main className="page-sm" style={{ textAlign: "center", paddingTop: "4rem" }}>
      <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🩺</div>
      <h1 className="page-title">Doctor Inbox</h1>
      <p className="page-sub">Connect your wallet to view your assigned cases.</p>
      <button className="btn btn-primary" onClick={() => openConnectModal?.()} disabled={fheLoading}>
        {fheLoading ? "Connecting..." : "Connect Wallet"}
      </button>
    </main>
  );

  if (wallet.isDoctorId === 0) return (
    <main className="page-sm" style={{ textAlign: "center", paddingTop: "4rem" }}>
      <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🚫</div>
      <h1 className="page-title">Not a Doctor</h1>
      <p className="page-sub">Your wallet is not registered as a doctor on this platform.</p>
    </main>
  );

  const pending   = cases.filter((c) => !c.hasResponse && c.status === 0);
  const responded = cases.filter((c) => c.hasResponse);

  return (
    <main className="page-md">
      <div className="section-header">
        <div>
          <h1 className="page-title">Doctor Inbox</h1>
          <p className="page-sub">Patient identities are never revealed. Complaints are FHE-encrypted; you can decrypt them only while the patient&apos;s delegation to you is active (14 days by default, ended early if the patient revokes access or closes). Your own reply is readable to you under the same delegation.</p>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card"><div className="stat-value">{pending.length}</div><div className="stat-label">Awaiting Response</div></div>
        <div className="stat-card"><div className="stat-value">{responded.length}</div><div className="stat-label">Responded</div></div>
        <div className="stat-card"><div className="stat-value">{cases.length}</div><div className="stat-label">Total Cases</div></div>
      </div>

      {loadingData ? (
        <div className="empty-state"><div className="spinner" style={{ width: 32, height: 32, borderTopColor: "var(--accent)" }} /></div>
      ) : cases.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">📥</span>
          <h3>No cases yet</h3>
          <p>Cases assigned to you will appear here.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
          {cases.map((c) => (
            <div key={c.id} className="consult-row" onClick={() => setSelected(c)}>
              <div className="consult-id">#{c.id}</div>
              <div className="consult-info">
                <div className="consult-title">Anonymous Patient</div>
                <div className="consult-meta">{new Date(c.createdAt * 1000).toLocaleDateString()} · 🕵️ Identity hidden</div>
              </div>
              <div className="consult-actions">
                {!c.hasResponse && c.status === 0 && <span className="badge badge-yellow">Needs Response</span>}
                {c.hasResponse && <span className="badge badge-green">Responded</span>}
                {c.status === 2 && <span className="badge badge-gray">Closed</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && <CaseDetail consult={selected} onClose={() => setSelected(null)} onRefresh={loadCases} />}
    </main>
  );
}

export default function InboxPage() {
  return <InboxContent />;
}