"use client";

import { useWallet } from "@/app/providers";
import { useConnectModal } from "@rainbow-me/rainbowkit";

import Link from "next/link";

const STEPS = [
  {
    num: "01", icon: "🔍", color: "var(--accent)",
    title: "Pick a Doctor",
    desc: "Browse specialists in HIV, mental health, STIs, and more. All doctors are verified by the platform admin.",
  },
  {
    num: "02", icon: "✍️", color: "var(--accent2)",
    title: "Describe Your Symptoms",
    desc: "Type freely. Before your message leaves your device, it's locked with military-grade encryption. Nobody — not us, not the blockchain — can read it.",
  },
  {
    num: "03", icon: "🔑", color: "var(--accent4)",
    title: "You Control Who Reads It",
    desc: "You decide when to unlock your message for the doctor. You can revoke access any time. Your data, your rules.",
  },
  {
    num: "04", icon: "💊", color: "var(--accent3)",
    title: "Get Private Advice",
    desc: "The doctor replies — also encrypted, just for your eyes. Your name, face, and identity are never part of the picture.",
  },
];

const FEATURES = [
  {
    icon: "🔒", color: "blue",
    title: "Your words stay private",
    desc: "Symptoms are encrypted in your browser before they're sent anywhere. Even the servers storing your data can't read it.",
  },
  {
    icon: "🕵️", color: "green",
    title: "No identity required",
    desc: "No name, no email, no profile. You're just a wallet address. Doctors help without knowing who you are.",
  },
  {
    icon: "🎛️", color: "pink",
    title: "You hold the keys",
    desc: "A doctor can only read your complaint after you grant permission. You control access — and can revoke it instantly.",
  },
  {
    icon: "⛓️", color: "purple",
    title: "Powered by blockchain",
    desc: "Every permission and every access grant is recorded on Ethereum. Transparent, auditable, tamper-proof.",
  },
];

const CONDITIONS = [
  { icon: "🦠", label: "HIV / AIDS" },
  { icon: "🧠", label: "Mental Health" },
  { icon: "🔬", label: "Sexual Health" },
  { icon: "💊", label: "Addiction" },
  { icon: "👁️", label: "Stigmatized Conditions" },
  { icon: "🌍", label: "High-Risk Regions" },
];

function LandingContent() {
  const { wallet, fheLoading } = useWallet();
  const { openConnectModal } = useConnectModal();

  return (
    <main style={{ position: "relative" }}>
      {/* Background effects */}
      <div className="bg-mesh" />
      <div className="bg-grid" />

      {/* ── Hero ─────────────────────────────────── */}
      <section className="hero">
        <div className="hero-eyebrow">
          <span className="hero-eyebrow-dot" />
          Built on Zama Fully Homomorphic Encryption
        </div>

        <h1 className="hero-title">
          Get Medical Help<br />
          <span className="hero-gradient">Without Revealing Yourself</span>
        </h1>

        <p className="hero-sub">
          Some health conditions carry stigma. ConfidentialCare lets you talk
          to a real doctor without exposing who you are — your symptoms are
          encrypted before they leave your device.
        </p>

        <div className="hero-pills">
          {CONDITIONS.map((c) => (
            <div key={c.label} className="hero-pill">
              <span>{c.icon}</span> {c.label}
            </div>
          ))}
        </div>

        <div className="hero-cta">
          {wallet.account ? (
            <Link href="/doctors" className="btn btn-primary btn-hero">
              Find a Doctor →
            </Link>
          ) : (
            <button className="btn btn-primary btn-hero" onClick={() => openConnectModal?.()} disabled={fheLoading}>
              {fheLoading ? <><span className="spinner" /> Starting up...</> : "Start a Private Consultation"}
            </button>
          )}
          <Link href="/how-it-works" className="btn-hero-outline btn">
            See How It Works
          </Link>
        </div>
      </section>

      {/* ── Trust row ─────────────────────────────── */}
      <div className="page" style={{ paddingTop: 0, paddingBottom: 0 }}>
        <div className="trust-row">
          {[
            { icon: "🔐", text: "End-to-end encrypted" },
            { icon: "👤", text: "Zero identity required" },
            { icon: "⛓️", text: "On Ethereum Sepolia" },
            { icon: "🩺", text: "Verified doctors only" },
            { icon: "🛡️", text: "You control your data" },
          ].map((t) => (
            <div key={t.text} className="trust-item">
              <span className="trust-icon">{t.icon}</span>
              {t.text}
            </div>
          ))}
        </div>
      </div>

      {/* ── How it works ──────────────────────────── */}
      <section className="page">
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <div className="hero-eyebrow animate-fade-up" style={{ marginBottom: "1rem" }}>
            <span className="hero-eyebrow-dot" />
            Simple Process
          </div>
          <h2 className="page-title animate-fade-up anim-delay-1" style={{ fontSize: "clamp(1.8rem,4vw,2.8rem)", textAlign: "center", marginBottom: ".75rem" }}>
            How It Works
          </h2>
          <p className="page-sub animate-fade-up anim-delay-2" style={{ textAlign: "center", maxWidth: 480, margin: "0 auto 0" }}>
            Four steps — your medical concern stays private the whole way through.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px,1fr))", gap: "1.25rem", marginBottom: "3rem" }}>
          {STEPS.map((s, i) => (
            <div
              key={s.num}
              className={`card animate-fade-up anim-delay-${i + 2}`}
              style={{ cursor: "default" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: ".75rem", marginBottom: "1rem" }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: `${s.color}18`, border: `1px solid ${s.color}30`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "1.3rem",
                }}>
                  {s.icon}
                </div>
                <span style={{ fontSize: ".7rem", color: s.color, fontWeight: 800, fontFamily: "'Syne', sans-serif", letterSpacing: ".04em" }}>
                  STEP {s.num}
                </span>
              </div>
              <div className="feature-title">{s.title}</div>
              <div className="feature-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Why it matters ────────────────────────── */}
      <section className="page" style={{ paddingTop: 0 }}>
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <h2 className="page-title" style={{ fontSize: "clamp(1.8rem,4vw,2.8rem)", textAlign: "center", marginBottom: ".75rem" }}>
            Why Privacy Matters Here
          </h2>
          <p className="page-sub" style={{ textAlign: "center", maxWidth: 520, margin: "0 auto 0" }}>
            Millions of people avoid seeking help because they`&apos;`re afraid of being judged or exposed.
          </p>
        </div>

        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className={`feature-card animate-fade-up`}>
              <div className={`feature-icon feature-icon--${f.color}`}>{f.icon}</div>
              <div className="feature-title">{f.title}</div>
              <div className="feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>

        {/* Callout */}
        <div className="callout">
          <span className="callout-icon">🔐</span>
          <h3 className="callout-title">The Technology Behind the Privacy</h3>
          <p className="callout-text">
            ConfidentialCare uses <strong>Fully Homomorphic Encryption (FHE)</strong> — a
            breakthrough technology that lets computers work with data <em>without ever unlocking it</em>.
            Think of it as a doctor reading a letter inside a locked box, through special gloves,
            without ever opening it. This runs on Ethereum using the{" "}
            <strong>Zama Protocol</strong>.
          </p>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
            {wallet.account ? (
              <Link href="/doctors" className="btn btn-primary">
                Find a Doctor →
              </Link>
            ) : (
              <button className="btn btn-primary" onClick={() => openConnectModal?.()} disabled={fheLoading}>
                {fheLoading ? "Starting..." : "Start Your Private Consultation"}
              </button>
            )}
            <Link href="/how-it-works" className="btn btn-ghost">
              Deep Dive →
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function Home() {
  return <LandingContent />;
}
