import type { Metadata } from "next";
import { Syne, Space_Grotesk } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";
import Nav from "@/components/Nav";

const syne = Syne({
  subsets: ["latin"], weight: ["700", "800"],
  variable: "--font-syne", display: "swap",
});
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"], weight: ["300", "400", "500", "600", "700"],
  variable: "--font-body", display: "swap",
});

export const metadata: Metadata = {
  title: "ConfidentialCare — Private Medical Consultations",
  description:
    "Talk to verified doctors without revealing your identity. Symptoms encrypted with Zama FHE.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersObj = await headers();
  const cookies = headersObj.get("cookie");

  return (
    <html lang="en" className={`${syne.variable} ${spaceGrotesk.variable}`}>
      <body>
        <Providers cookies={cookies}>
          <Nav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
