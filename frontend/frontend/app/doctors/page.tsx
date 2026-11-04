"use client";

import { useAccount } from "wagmi";
import { useWallet } from "@/app/providers";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import type { Doctor } from "@/libs/types";
import { encryptText, textToUint64Chunks } from "@/libs/fhe-utils";
import { getErrorMessage } from "@/libs/errors";
import { CONTRACT_ADDRESS, DELEGATION_DAYS, PATIENT_WALLET_TOPUP_ETH } from "@/libs/config";
import { fundIfNeeded, submitAndDelegateGas } from "@/libs/patient-wallets";

function DoctorCard({ doc, onSelect }: { doc: Doctor; onSelect: () => void }) {
  const initials = doc.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className={`doctor-card ${!doc.active ? "doctor-card--inactive" : ""}`} onClick={doc.active ? onSelect : undefined}>
      <div style={{ display: "flex", gap: ".9rem", alignItems: "flex-start" }}>
        <div className="doctor-avatar">{initials}</div>
        <div style={{ flex: 1 }}>
          <div className="doctor-name">{doc.name}</div>
          <div className="doctor-specialty">{doc.specialty}</div>
          <div className="doctor-creds" style={{ marginTop: ".3rem" }}>{doc.credentials}</div>
        </div>
        {doc.active
          ? <span className="badge badge-green">Available</span>
          : <span className="badge badge-gray">Inactive</span>}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="doctor-meta">🩺 {doc.consultationCount} consultations</span>
        {doc.active && <span style={{ fontSize: ".78rem", color: "var(--accent)" }}>Click to consult →</span>}
      </div>
    </div>
  );
}

type Step = "write" | "encrypting" | "submitting" | "granting" | "done";

function ConsultModal({ doctor, onClose, onDone }: { doctor: Doctor; onClose: () => void; onDone: () => void }) {
  const { wallet, provider, getPatientWallet, getPatientSdk } = useWallet();
  const [text, setText]                         = useState("");
  const [step, setStep]                         = useState<Step>("write");
  const [status, setStatus]                     = useState("");
  const [doctorNotifyUrl, setDoctorNotifyUrl]   = useState("");
  const [doctorNotifyMessage, setDoctorNotifyMessage] = useState("");
  const [messageCopied, setMessageCopied]       = useState(false);

  const maxChars = 256;

  const handleSubmit = async () => {
    if (!text.trim()) { setStatus("Please describe your symptoms."); return; }
    const contract = wallet.contract;
    if (!contract || !provider) { setStatus("Wallet not connected."); return; }

    try {
      setStep("encrypting");
      // Each doctor gets its own patient wallet, so a delegation to this doctor can never cover
      // consultations with another doctor (the contract enforces one doctor per patient address).
      setStatus("✍️ Sign once to unlock your private patient wallet for this doctor...");
      const patientWallet = await getPatientWallet(doctor.id);
      const bound = Number(await contract.patientDoctor(patientWallet.address));
      if (bound !== 0 && bound !== doctor.id) throw new Error("This patient wallet is already bound to another doctor.");

      setStatus("⛽ Funding your private wallet from your main wallet (this transfer is public)...");
      await fundIfNeeded(patientWallet, await provider.getSigner(), submitAndDelegateGas(textToUint64Chunks(text).length), ethers.parseEther(PATIENT_WALLET_TOPUP_ETH));

      setStatus("🔐 Encrypting your symptoms with FHE...");
      const contractAddress = await contract.getAddress();
      const patientSdk = await getPatientSdk(doctor.id);
      const { handles, inputProof, chunkCount } = await encryptText(
        text, contractAddress, patientWallet.address, patientSdk
      );

      setStep("submitting");
      setStatus("📡 Submitting encrypted consultation on-chain...");
      const asPatient = contract.connect(patientWallet) as ethers.Contract;
      const tx: ethers.ContractTransactionResponse = await asPatient.submitConsultation(
        doctor.id, handles, inputProof, chunkCount
      );
      setStatus("⏳ Waiting for confirmation...");
      const receipt = await tx.wait();

      let cId = 0;
      if (receipt) {
        const iface = contract.interface;
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog(log);
            if (parsed?.name === "ConsultationCreated") {
              cId = Number(parsed.args.consultationId);
              break;
            }
          } catch { /* skip unparseable logs */ }
        }
      }

      setStep("granting");
      setStatus(`🔑 Delegating decryption to the doctor for ${DELEGATION_DAYS} days...`);
      // The doctor gets a revocable, expiring delegation — never an ACL grant it could re-share.
      // Scoped to this contract only (never the all-contracts wildcard) and sent from the wallet bound to this doctor.
      const { delegateToDoctor } = await import("@/libs/zama");
      await delegateToDoctor(patientSdk, CONTRACT_ADDRESS, doctor.wallet);

      setStep("done");

      const doctorEthermailAddress = `${doctor.wallet}@ethermail.io`;
      const subject = encodeURIComponent(`New ConfidentialCare Consultation #${cId}`);
      setDoctorNotifyUrl(
        `https://ethermail.io/webmail/compose?to=${doctorEthermailAddress}&subject=${subject}`
      );
      setDoctorNotifyMessage(
        `Hello Dr. ${doctor.name},\n\nA patient has submitted an encrypted consultation #${cId} for your review on ConfidentialCare.\n\nPlease log in to your Doctor Inbox to decrypt and respond:\nhttps://${window.location.host}/inbox\n\nNote: The patient's identity is fully anonymous and their symptoms are encrypted using Zama FHE.\n\n— ConfidentialCare`
      );
      setStatus(`✅ Consultation #${cId} submitted! Notify the doctor using the message below.`);
    } catch (err: unknown) {
      setStatus(`❌ ${getErrorMessage(err)}`);
      setStep("write");
    }
  };

  const steps: { key: Step; label: string }[] = [
    { key: "encrypting", label: "Encrypt" },
    { key: "submitting", label: "Submit" },
    { key: "granting",   label: "Grant Access" },
    { key: "done",       label: "Done" },
  ];
  const stepIdx = steps.findIndex((s) => s.key === step);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">🔒 Private Consultation</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="card card--flat" style={{ marginBottom: "1rem", display: "flex", gap: ".9rem", alignItems: "center" }}>
          <div className="doctor-avatar" style={{ width: 40, height: 40, fontSize: "1rem" }}>
            {doctor.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: ".95rem" }}>{doctor.name}</div>
            <div style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>{doctor.specialty}</div>
          </div>
        </div>

        <div className="fhe-box">
          <span className="fhe-box-icon">⚡</span>
          <p>Your symptoms will be <strong>FHE-encrypted in your browser</strong> and sent from a private wallet used only for this doctor. The doctor can decrypt your consultations with them for {DELEGATION_DAYS} days, until you revoke access or close the consultation; the doctor cannot pass that access on, but can keep what they have already read. Your main wallet funds that private wallet, and that transfer is visible on-chain.</p>
        </div>

        {step === "write" && (
          <div className="form-group">
            <label className="form-label">Describe your symptoms *</label>
            <textarea className="form-textarea"
              placeholder="e.g. I have had a persistent cough and night sweats for 3 weeks..."
              value={text} onChange={(e) => setText(e.target.value.slice(0, maxChars))} rows={5} />
            <div className="form-hint" style={{ textAlign: "right" }}>{text.length}/{maxChars} characters</div>
          </div>
        )}

        {step !== "write" && (
          <div className="steps">
            {steps.map((s, i) => (
              <span key={s.key} style={{ display: "contents" }}>
                <div className={`step ${stepIdx > i ? "step--done" : stepIdx === i ? "step--active" : ""}`}>
                  <span className="step-num">{stepIdx > i ? "✓" : i + 1}</span>
                  <span>{s.label}</span>
                </div>
                {i < steps.length - 1 && <div className="step-bar" />}
              </span>
            ))}
          </div>
        )}

        {step !== "write" && step !== "done" && (
          <div className="tx-overlay">
            <div className="tx-overlay-card">
              <div className="tx-spinner" />
              <div className="tx-overlay-title">
                {step === "encrypting" ? "Encrypting with FHE"
                  : step === "submitting" ? "Submitting On-chain"
                  : "Granting Access"}
              </div>
              <div className="tx-overlay-sub">
                {step === "encrypting"
                  ? "Your symptoms are being locked with FHE encryption in your browser."
                  : step === "submitting"
                  ? "Sending your encrypted consultation from your private patient wallet."
                  : "Delegating decryption to the doctor from your private patient wallet."}
              </div>
              <div className="tx-overlay-steps">
                {(["encrypting", "submitting", "granting"] as const).map((k, i) => {
                  const icons = { encrypting: "🔐", submitting: "⛓️", granting: "🔑" };
                  const labels = { encrypting: "Encrypt symptoms", submitting: "Submit on-chain", granting: "Grant doctor access" };
                  const cur = ["encrypting", "submitting", "granting"].indexOf(step);
                  return (
                    <div key={k} className={`tx-overlay-step ${i === cur ? "tx-overlay-step--active" : i < cur ? "tx-overlay-step--done" : ""}`}>
                      <span className="tx-overlay-step-icon">{i < cur ? "✅" : icons[k]}</span>
                      {labels[k]}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {status && (
          <div className={`status-msg ${step === "done" ? "status-msg--success" : status.startsWith("❌") ? "status-msg--error" : ""}`}>
            {status}
          </div>
        )}

        {step === "done" && doctorNotifyUrl && (
          <div style={{ background: "rgba(79,142,247,.07)", border: "1px solid rgba(79,142,247,.2)", borderRadius: 12, padding: "1rem 1.1rem", margin: ".75rem 0" }}>
            <div style={{ fontWeight: 700, fontSize: ".88rem", marginBottom: ".5rem" }}>📬 Notify Doctor via EtherMail</div>
            <p style={{ fontSize: ".78rem", color: "var(--text-muted)", marginBottom: ".75rem", lineHeight: 1.5 }}>
              Click the button to open EtherMail with the recipient pre-filled, then copy and paste the message below into the body.
            </p>
            <div style={{ fontSize: ".75rem", fontWeight: 700, color: "var(--accent)", marginBottom: ".4rem", textTransform: "uppercase", letterSpacing: ".04em" }}>
              Step 1 — Open EtherMail
            </div>
            <a href={doctorNotifyUrl} target="_blank" rel="noopener noreferrer"
              className="btn btn-primary btn-sm" style={{ marginBottom: ".85rem", display: "inline-flex" }}>
              ✉️ Open EtherMail Compose
            </a>
            <div style={{ fontSize: ".75rem", fontWeight: 700, color: "var(--accent)", marginBottom: ".4rem", textTransform: "uppercase", letterSpacing: ".04em" }}>
              Step 2 — Copy this message into the body
            </div>
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem", fontSize: ".78rem", lineHeight: 1.65, whiteSpace: "pre-wrap", color: "var(--text-muted)", marginBottom: ".6rem", fontFamily: "monospace" }}>
              {doctorNotifyMessage}
            </div>
            <button
              className={`btn btn-ghost btn-sm ${messageCopied ? "btn-success" : ""}`}
              onClick={() => { navigator.clipboard.writeText(doctorNotifyMessage); setMessageCopied(true); setTimeout(() => setMessageCopied(false), 2000); }}
            >
              {messageCopied ? "✅ Copied!" : "📋 Copy Message"}
            </button>
          </div>
        )}

        <div className="modal-actions">
          {step === "done" ? (
            <button className="btn btn-success" onClick={onDone}>View My Consultations</button>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={onClose} disabled={step !== "write"}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSubmit}
                disabled={step !== "write" || !text.trim()} style={{ minWidth: 160 }}>
                {step === "encrypting" ? <><span className="spinner" /> Encrypting...</>
                  : step === "submitting" ? <><span className="spinner" /> Submitting...</>
                  : step === "granting"   ? <><span className="spinner" /> Granting Access...</>
                  : <>🔒 Encrypt &amp; Submit</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DoctorListContent() {
  const { wallet, fheLoading } = useWallet();
  const { openConnectModal }   = useConnectModal();
  const { isConnected }        = useAccount();
  const [mounted, setMounted]       = useState(false);
  const [doctors, setDoctors]       = useState<Doctor[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [selected, setSelected]     = useState<Doctor | null>(null);
  const [filter, setFilter]         = useState("");

  useEffect(() => { setMounted(true); }, []);

  const loadDoctors = useCallback(async () => {
    const contract = wallet.contract;
    if (!contract) return;
    setLoadingDocs(true);
    try {
      const count = await contract.doctorCount() as bigint;
      if (Number(count) === 0) { setDoctors([]); return; }
      const ids = await contract.getAllDoctorIds() as bigint[];
      const loaded: Doctor[] = await Promise.all(ids.map(async (id) => {
        const d = await contract.doctors(id);
        return {
          id: Number(d.id), wallet: d.wallet as string, name: d.name as string,
          specialty: d.specialty as string, credentials: d.credentials as string,
          active: d.active as boolean, consultationCount: Number(d.consultationCount),
        };
      }));
      setDoctors(loaded);
    } catch (e) { console.error(e); }
    finally { setLoadingDocs(false); }
  }, [wallet.contract]);

  useEffect(() => {
    if (wallet.contract) loadDoctors();
  }, [wallet.contract, loadDoctors]);

  const filtered   = doctors.filter((d) =>
    filter === "" || d.specialty.toLowerCase().includes(filter.toLowerCase()) || d.name.toLowerCase().includes(filter.toLowerCase())
  );
  const specialties = [...new Set(doctors.map((d) => d.specialty))];

  return (
    <main className="page">
      <div className="section-header">
        <div>
          <h1 className="page-title">Find a Doctor</h1>
          <p className="page-sub">All consultations are end-to-end encrypted. Your identity is never revealed.</p>
        </div>
        {mounted && !isConnected && (
          <button className="btn btn-primary" onClick={() => openConnectModal?.()} disabled={fheLoading}>
            {fheLoading ? "Connecting..." : "Connect Wallet"}
          </button>
        )}
      </div>

      {doctors.length > 0 && (
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
          <button className={`badge ${filter === "" ? "badge-blue" : "badge-gray"}`}
            style={{ cursor: "pointer", padding: ".35rem .85rem" }} onClick={() => setFilter("")}>All</button>
          {specialties.map((s) => (
            <button key={s} className={`badge ${filter === s ? "badge-blue" : "badge-gray"}`}
              style={{ cursor: "pointer", padding: ".35rem .85rem" }} onClick={() => setFilter(s === filter ? "" : s)}>{s}</button>
          ))}
        </div>
      )}

      {loadingDocs ? (
        <div className="empty-state"><div className="spinner" style={{ width: 32, height: 32, borderTopColor: "var(--accent)" }} /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🩺</div>
          <h3>No doctors found</h3>
          <p>Doctors will appear here once added by the admin.</p>
        </div>
      ) : (
        <div className="grid-2">
          {filtered.map((d) => (
            <DoctorCard key={d.id} doc={d} onSelect={() => {
              if (!isConnected) { openConnectModal?.(); return; }
              setSelected(d);
            }} />
          ))}
        </div>
      )}

      {selected && (
        <ConsultModal doctor={selected} onClose={() => setSelected(null)}
          onDone={() => { setSelected(null); window.location.href = "/consultations"; }} />
      )}
    </main>
  );
}

export default function DoctorsPage() {
  return <DoctorListContent />;
}