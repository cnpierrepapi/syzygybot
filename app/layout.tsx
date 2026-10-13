import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SITE } from "@/lib/slug";
import Sky from "./components/Sky";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", weight: ["400", "500", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "700"] });

const DESCRIPTION =
  "SYZYGY is a sales team made of AI agents, built on Qloo's taste data. It finds brands, artists and shows whose audiences line up, picks the side that would buy the insight, and works the account in public. Every action is clickable.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "SYZYGY · the autonomous SDR floor", template: "%s · SYZYGY" },
  description: DESCRIPTION,
  applicationName: "SYZYGY",
  authors: [{ name: "Onenept Studios Inc.", url: "https://onenept.com" }],
  creator: "Onenept Studios Inc.",
  publisher: "Onenept Studios Inc.",
  keywords: ["AI SDR", "AI sales agents", "brand partnerships", "audience overlap", "Qloo", "taste data", "cultural partnerships", "brand collaboration"],
  openGraph: { type: "website", siteName: "SYZYGY", url: "/", title: "SYZYGY · the autonomous SDR floor", description: DESCRIPTION, locale: "en_US" },
  twitter: { card: "summary_large_image", title: "SYZYGY · the autonomous SDR floor", description: DESCRIPTION },
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
