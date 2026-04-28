"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { useWallet } from "@/app/providers";

export default function Nav() {
  const path = usePathname();
  const { isConnected } = useAccount();
  const { wallet } = useWallet();
  const { fhevmReady, isAdmin, isDoctorId } = wallet;

  // Prevent hydration flash — don't render wallet UI until client is ready
const mounted = typeof window !== "undefined";

  const links = [
    { href: "/doctors",       label: "Find a Doctor" },
    { href: "/consultations", label: "My Consultations", auth: true },
    ...(isDoctorId > 0 ? [{ href: "/inbox", label: "Doctor Inbox", auth: true }] : []),
    ...(isAdmin        ? [{ href: "/admin", label: "Admin",        auth: true }] : []),
    { href: "/how-it-works",  label: "How It Works" },
  ];

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="nav-brand">
          <span className="nav-brand-icon">🏥</span>
          <span className="nav-brand-text">ConfidentialCare</span>
        </Link>

        <div className="nav-links">
          {links.map((l) =>
            (!l.auth || (mounted && isConnected)) ? (
              <Link
                key={l.href}
                href={l.href}
                className={`nav-link ${path === l.href ? "nav-link--active" : ""}`}
              >
                {l.label}
              </Link>
            ) : null
          )}
        </div>

        <div className="nav-right">
          {mounted && fhevmReady && (
            <div className="fhe-pill">
              <span className="fhe-dot" />
              FHE Active
            </div>
          )}

          {/* Only render after mount to avoid SSR/hydration mismatch */}
          {mounted && (
            <ConnectButton
              showBalance={false}
              chainStatus="icon"
              accountStatus="avatar"
            />
          )}
        </div>
      </div>
    </nav>
  );
}
