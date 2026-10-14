import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SITE } from "@/lib/slug";
import Sky from "./components/Sky";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", weight: ["400", "500", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "700"] });

const DESCRIPTION =
  "Every brand has a Qloo number it hasn't seen yet. SYZYGY is a sales team of AI agents that digs those numbers up and takes them to the one person at the brand who should hear it. Every move it makes is public and clickable.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "SYZYGY · the AI sales team that runs on Qloo", template: "%s · SYZYGY" },
  description: DESCRIPTION,
  applicationName: "SYZYGY",
  authors: [{ name: "Onenept Studios Inc.", url: "https://onenept.com" }],
  creator: "Onenept Studios Inc.",
  publisher: "Onenept Studios Inc.",
  keywords: ["AI SDR", "AI sales agents", "brand partnerships", "audience overlap", "Qloo", "taste data", "cultural partnerships", "brand collaboration"],
  openGraph: { type: "website", siteName: "SYZYGY", url: "/", title: "SYZYGY · the AI sales team that runs on Qloo", description: DESCRIPTION, locale: "en_US" },
  twitter: { card: "summary_large_image", title: "SYZYGY · the AI sales team that runs on Qloo", description: DESCRIPTION },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // next/font variables go on <html> so every element can use them.
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>
        <Sky />
        {children}
      </body>
    </html>
  );
}
