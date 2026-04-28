"use client";

import { useAccount } from "wagmi";
import { useWallet } from "@/app/providers";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import type { Doctor } from "@/libs/types";
import { getErrorMessage } from "@/libs/errors";

function AddDoctorModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { wallet } = useWallet();
  const [form, setForm]     = useState({ wallet: "", name: "", specialty: "", credentials: "" });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const handleAdd = async () => {
    if (!form.wallet || !ethers.isAddress(form.wallet)) { setStatus("Invalid wallet address"); return; }
    if (!form.name.trim()) { setStatus("Name required"); return; }
    if (!form.specialty.trim()) { setStatus("Specialty required"); return; }
    const contract = wallet.contract;
    if (!contract) { setStatus("Wallet not connected."); return; }
    try {
      setLoading(true);
      setStatus("Adding doctor on-chain...");
      const tx: ethers.ContractTransactionResponse = await contract.addDoctor(
        form.wallet, form.name, form.specialty, form.credentials
      );
      await tx.wait();
      setStatus("✅ Doctor added successfully!");
      setTimeout(onAdded, 1000);
    } catch (err: unknown) {
      setStatus(`❌ ${getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const specialties = [
    "General Practice", "HIV/AIDS Specialist", "Mental Health",
    "Sexual Health", "Infectious Disease", "Internal Medicine",
    "Psychiatry", "Oncology", "Pediatrics", "Cardiology",
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">➕ Add Doctor</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-group">
          <label className="form-label">Wallet Address *</label>
          <input className="form-input" placeholder="0x..." value={form.wallet}
            onChange={(e) => setForm({ ...form, wallet: e.target.value })} disabled={loading} />
        </div>
        <div className="form-group">
          <label className="form-label">Full Name *</label>
          <input className="form-input" placeholder="e.g. Dr. Amina Hassan" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={loading} />
        </div>
        <div className="form-group">
          <label className="form-label">Specialty *</label>
          <select className="form-select" value={form.specialty}
            onChange={(e) => setForm({ ...form, specialty: e.target.value })} disabled={loading}>
            <option value="">Select specialty...</option>
            {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Credentials</label>
          <input className="form-input" placeholder="e.g. MD, FWACP, Lagos University Teaching Hospital"
            value={form.credentials} onChange={(e) => setForm({ ...form, credentials: e.target.value })} disabled={loading} />
        </div>
        {status && (
          <div className={`status-msg ${status.startsWith("❌") ? "status-msg--error" : status.startsWith("✅") ? "status-msg--success" : ""}`}>
            {status}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAdd} disabled={loading}>
            {loading ? <><span className="spinner" /> Adding...</> : "Add Doctor"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminContent() {
  const { wallet, fheLoading }    = useWallet();
  const { openConnectModal }      = useConnectModal();
  const { isConnected }           = useAccount();
  const [mounted, setMounted]     = useState(false);
  const [doctors, setDoctors]     = useState<Doctor[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [showAdd, setShowAdd]     = useState(false);
  const [deactivating, setDeactivating] = useState<number | null>(null);
  const [stats, setStats]         = useState({ total: 0, active: 0, consultations: 0 });

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
      setStats({
        total: loaded.length,
        active: loaded.filter((d) => d.active).length,
        consultations: loaded.reduce((a, d) => a + d.consultationCount, 0),
      });
    } catch (e) { console.error(e); }
    finally { setLoadingDocs(false); }
  }, [wallet.contract]);

  useEffect(() => {
    if (wallet.contract && wallet.isAdmin) loadDoctors();
  }, [wallet.contract, wallet.isAdmin, loadDoctors]);

  const handleDeactivate = async (id: number) => {
    if (!confirm("Deactivate this doctor? They will no longer receive new consultations.")) return;
    const contract = wallet.contract;
    if (!contract) return;
    try {
      setDeactivating(id);
      const tx: ethers.ContractTransactionResponse = await contract.deactivateDoctor(id);
      await tx.wait();
      loadDoctors();
    } catch (e: unknown) { alert(getErrorMessage(e)); }
    finally { setDeactivating(null); }
  };

  if (!mounted) return null;

  if (!isConnected) return (
    <main className="page-sm" style={{ textAlign: "center", paddingTop: "4rem" }}>
      <h1 className="page-title">Admin Panel</h1>
      <p className="page-sub">Connect the admin wallet to manage doctors.</p>
      <button className="btn btn-primary" onClick={() => openConnectModal?.()} disabled={fheLoading}>
        {fheLoading ? "Connecting..." : "Connect Wallet"}
      </button>
    </main>
  );

  if (!wallet.isAdmin) return (
    <main className="page-sm" style={{ textAlign: "center", paddingTop: "4rem" }}>
      <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🚫</div>
      <h1 className="page-title">Access Denied</h1>
      <p className="page-sub">Only the contract admin can access this page.</p>
    </main>
  );

  return (
    <main className="page">
      <div className="section-header">
        <div>
          <h1 className="page-title">👑 Admin Panel</h1>
          <p className="page-sub">Manage verified doctors on the ConfidentialCare platform.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Doctor</button>
      </div>

      <div className="stats-row">
        <div className="stat-card"><div className="stat-value">{stats.total}</div><div className="stat-label">Total Doctors</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: "var(--accent2)" }}>{stats.active}</div><div className="stat-label">Active</div></div>
        <div className="stat-card"><div className="stat-value">{stats.consultations}</div><div className="stat-label">Total Consultations</div></div>
      </div>

      {loadingDocs ? (
        <div className="empty-state"><div className="spinner" style={{ width: 32, height: 32, borderTopColor: "var(--accent)" }} /></div>
      ) : doctors.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🩺</div>
          <h3>No doctors yet</h3>
          <p>Add verified doctors to the platform.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
          {doctors.map((d) => (
            <div key={d.id} className="card card--flat" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <div className="doctor-avatar" style={{ width: 42, height: 42, fontSize: "1rem", flexShrink: 0 }}>
                {d.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{d.name}</div>
                <div style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>{d.specialty} · {d.credentials}</div>
                <div style={{ fontSize: ".75rem", color: "var(--text-muted)", fontFamily: "monospace", marginTop: ".15rem" }}>
                  {d.wallet.slice(0, 10)}...{d.wallet.slice(-6)}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
                <span className="badge badge-gray">🩺 {d.consultationCount} cases</span>
                {d.active ? <span className="badge badge-green">Active</span> : <span className="badge badge-gray">Inactive</span>}
                {d.active && (
                  <button className="btn btn-danger btn-sm" onClick={() => handleDeactivate(d.id)} disabled={deactivating === d.id}>
                    {deactivating === d.id ? "..." : "Deactivate"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {showAdd && <AddDoctorModal onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); loadDoctors(); }} />}
    </main>
  );
}

export default function AdminPage() {
  return <AdminContent />;
}