"use client";


const steps = [
  {
    num: "01", icon: "🔍", title: "Browse & Choose",
    color: "var(--accent)",
    desc: "Patients browse verified doctors by specialty — HIV, mental health, STIs, general practice. No wallet needed.",
    detail: "The doctor registry is fully public on-chain. You can see names, specialties, and credentials without connecting a wallet.",
  },
  {
    num: "02", icon: "✍️", title: "Write Symptoms",
    color: "var(--accent2)",
    desc: "Patient types their complaint. Before it leaves the browser, it is encrypted using Zama's Fully Homomorphic Encryption.",
    detail: "Text is encoded to bytes, split into 8-byte chunks, and each chunk is encrypted as euint64 using the Zama Relayer SDK. The plaintext never touches the blockchain.",
  },
  {
    num: "03", icon: "⛓️", title: "Submit On-Chain",
    color: "var(--accent)",
    desc: "The encrypted chunks are submitted to the ConfidentialCare smart contract on Ethereum Sepolia.",
    detail: "The smart contract stores FHE ciphertext handles — pointers to encrypted values managed by Zama's coprocessor network. Gas costs are similar to a normal transaction.",
  },
  {
    num: "04", icon: "🔑", title: "Grant Access",
    color: "var(--accent2)",
    desc: "Patient explicitly grants the chosen doctor ACL permission to decrypt the complaint. This is the core FHE access control feature.",
    detail: "FHE.allow(chunk, doctorWallet) is called for each encrypted chunk. Only the granted doctor's wallet can now trigger decryption via the Zama KMS. The patient is always in control.",
  },
  {
    num: "05", icon: "🩺", title: "Doctor Decrypts",
    color: "#f472b6",
    desc: "Doctor opens their inbox, clicks decrypt. The Zama Relayer performs user-specific re-encryption so only the doctor can read it.",
    detail: "The Relayer SDK's reencrypt() function uses the doctor's public key to re-encrypt the ciphertext. The doctor's browser decrypts locally. The plaintext never appears on-chain.",
  },
  {
    num: "06", icon: "💊", title: "Encrypted Response",
    color: "var(--accent2)",
    desc: "Doctor writes their advice. It is FHE-encrypted for the patient's eyes only — not even the doctor can re-read it after submission.",
    detail: "The response is encrypted with ACL permission granted only to the patient's wallet. The doctor submitting the response doesn't get ACL on their own response — this is response-blind design.",
  },
  {
    num: "07", icon: "🔓", title: "Patient Reads",
    color: "var(--accent)",
    desc: "Patient decrypts the doctor's response in their browser. The consultation is complete — identity never revealed.",
    detail: "Only the patient's wallet can trigger re-encryption of the response. The decrypted text exists only in the patient's browser — never stored in plaintext anywhere.",
  },
];

function HowItWorksContent() {
  return (
    <main className="page-md">
      <div style={{ textAlign: "center", marginBottom: "3rem" }}>
        <div className="hero-eyebrow">Technical Deep Dive</div>
        <h1 className="page-title">How ConfidentialCare Works</h1>
        <p className="page-sub">
          End-to-end privacy using Zama`&apos;`s Fully Homomorphic Encryption protocol on Ethereum.
          Zero identity exposure from symptom to diagnosis.
        </p>
      </div>

      {/* FHE explainer */}
      <div className="fhe-box" style={{ marginBottom: "2.5rem" }}>
        <span className="fhe-box-icon" style={{ fontSize: "1.4rem" }}>⚡</span>
        <div>
          <strong>What makes FHE different?</strong><br />
          Regular encryption protects data at rest and in transit. FHE allows computation <em>directly on encrypted data</em> —
          so the blockchain processes your encrypted symptoms without ever decrypting them.
          This is fundamentally different from any other privacy technology.
          Neither Zama, nor the blockchain nodes, nor the contract owner can see your data.
        </div>
      </div>

      {/* Steps */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "3rem" }}>
        {steps.map((s, i) => (
          <div key={s.num} className="card card--flat" style={{ display: "flex", gap: "1.25rem", alignItems: "flex-start" }}>
            <div style={{
              width: 52, height: 52, borderRadius: 12, flexShrink: 0,
              background: `${s.color}18`, border: `1px solid ${s.color}40`,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem",
            }}>
              {s.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: ".6rem", marginBottom: ".35rem" }}>
                <span style={{ fontSize: ".7rem", color: s.color, fontWeight: 700, fontFamily: "monospace" }}>STEP {s.num}</span>
                <span style={{ fontWeight: 700, fontSize: ".95rem" }}>{s.title}</span>
              </div>
              <p style={{ color: "var(--text)", fontSize: ".875rem", marginBottom: ".4rem" }}>{s.desc}</p>
              <p style={{ color: "var(--text-muted)", fontSize: ".78rem", lineHeight: 1.55 }}>{s.detail}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Privacy guarantees */}
      <div style={{ marginBottom: "2.5rem" }}>
        <h2 className="section-title" style={{ marginBottom: "1rem" }}>Privacy Guarantees</h2>
        <div className="grid-2">
          {[
            { icon: "🕵️", title: "No Identity", desc: "Only your wallet address is stored. No name, no email, no personal data anywhere on-chain." },
            { icon: "🔒", title: "Encrypted at Rest", desc: "Symptoms and responses are stored as FHE ciphertexts. Even if the blockchain is public, your data is safe." },
            { icon: "🎯", title: "ACL-Controlled", desc: "You explicitly choose who can decrypt. Revocable at any time. One doctor per consultation." },
            { icon: "🚫", title: "Response-Blind", desc: "After submitting a response, the doctor cannot re-read it. Only the patient can decrypt doctor responses." },
            { icon: "⛓️", title: "On-Chain Verifiable", desc: "All permissions and access grants are on-chain. Auditable without seeing the underlying data." },
            { icon: "🌐", title: "No Central Server", desc: "No backend, no database, no admin seeing queries. The contract is the only intermediary." },
          ].map((g) => (
            <div key={g.title} className="card card--flat">
              <div style={{ fontSize: "1.5rem", marginBottom: ".5rem" }}>{g.icon}</div>
              <div className="card-title">{g.title}</div>
              <div className="card-sub">{g.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Use cases */}
      <div>
        <h2 className="section-title" style={{ marginBottom: "1rem" }}>Real-World Use Cases</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
          {[
            ["🦠", "HIV/AIDS", "Patients avoid testing due to fear of stigma. Confidential consultation allows getting advice before committing to an in-person visit."],
            ["🧠", "Mental Health", "Depression, anxiety, and suicidal ideation carry heavy stigma. Anonymous consultation removes the barrier to seeking help."],
            ["🔬", "STIs", "Sexual health conditions are rarely discussed openly. Encrypted consultation enables private, judgment-free medical advice."],
            ["🌍", "High-Risk Regions", "In countries where certain conditions are criminalized, identity exposure carries legal risk. FHE provides genuine protection."],
            ["👶", "Sensitive Family Issues", "Domestic situations, pregnancy, and child health concerns that families are not ready to discuss publicly."],
          ].map(([icon, title, desc]) => (
            <div key={title as string} className="card card--flat" style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
              <span style={{ fontSize: "1.5rem", flexShrink: 0 }}>{icon}</span>
              <div>
                <div style={{ fontWeight: 700, marginBottom: ".25rem" }}>{title}</div>
                <div style={{ color: "var(--text-muted)", fontSize: ".85rem", lineHeight: 1.55 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

export default function HowItWorksPage() {
  return <HowItWorksContent />;
}
