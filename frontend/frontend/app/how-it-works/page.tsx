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
    detail: "Text is encoded to bytes, split into 8-byte chunks, and each chunk is encrypted as euint64 with the Zama SDK, together with a proof that binds the ciphertext to your wallet and this contract. The plaintext never touches the blockchain.",
  },
  {
    num: "03", icon: "⛓️", title: "Submit On-Chain",
    color: "var(--accent)",
    desc: "The encrypted chunks are submitted from a private wallet used only for this doctor, derived from one signature by your main wallet.",
    detail: "The contract stores FHE ciphertext handles and lets a patient wallet consult only one doctor, so access you give one doctor never covers another. Your main wallet pays this private wallet's gas, and that transfer is public.",
  },
  {
    num: "04", icon: "🔑", title: "Delegate Access",
    color: "var(--accent2)",
    desc: "Your private wallet delegates decryption to the doctor for 14 days. You can revoke it at any time, and closing the consultation revokes it.",
    detail: "The delegation is recorded on Zama's ACL for this contract only. The doctor holds no ACL permission of their own, so they cannot pass access on or make your data public. It covers all your consultations with that doctor, and anything the doctor has already read cannot be taken back.",
  },
  {
    num: "05", icon: "🩺", title: "Doctor Decrypts",
    color: "#f472b6",
    desc: "Doctor opens their inbox and decrypts on your behalf while the delegation is active.",
    detail: "Zama's key-management nodes check the delegation and return the value re-encrypted to a temporary key held in the doctor's browser, which decrypts it locally. The plaintext never appears on-chain.",
  },
  {
    num: "06", icon: "💊", title: "Encrypted Response",
    color: "var(--accent2)",
    desc: "Doctor writes their advice. It is FHE-encrypted and ACL permission goes to your private wallet only; no other doctor can read it.",
    detail: "The doctor gets no ACL permission on the response. While your delegation to them is active they can still decrypt their own reply through it, as it covers everything your private wallet can decrypt in this contract.",
  },
  {
    num: "07", icon: "🔓", title: "Patient Reads",
    color: "var(--accent)",
    desc: "Patient decrypts the doctor's response in their browser. The consultation is complete — identity never revealed.",
    detail: "Your private wallet requests the decryption; the decrypted text exists only in your browser. Closing the consultation first revokes the doctor's delegation, then closes it — two transactions, one click.",
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
          The blockchain nodes and the contract owner cannot see your data; decryption needs a threshold of Zama&apos;s independent key-management nodes to cooperate.
        </div>
      </div>

      {/* Steps */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "3rem" }}>
        {steps.map((s) => (
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
            { icon: "🕵️", title: "No Identity", desc: "Only wallet addresses are stored. No name, no email. Your main wallet's gas top-up to each private wallet is public, so the wallets can be linked to each other." },
            { icon: "🔒", title: "Encrypted at Rest", desc: "Symptoms and responses are stored as FHE ciphertexts. Even if the blockchain is public, your data is safe." },
            { icon: "🎯", title: "Revocable Access", desc: "A doctor reads only while your delegation is active: 14 days by default, ended by revoking or closing. Doctors cannot pass access on." },
            { icon: "🚫", title: "Doctor Isolation", desc: "Each doctor's consultations sit in a separate private wallet, so one doctor never gains access to what you sent another." },
            { icon: "⛓️", title: "On-Chain Verifiable", desc: "All permissions, delegations and revocations are on-chain. Auditable without seeing the underlying data, but their timing is public." },
            { icon: "🌐", title: "No App Server", desc: "No ConfidentialCare backend or database. Encryption proofs and decryption go through Zama's relayer, which never sees plaintext." },
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
