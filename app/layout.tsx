import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SITE } from "@/lib/slug";
import Sky from "./components/Sky";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", weight: ["400", "500", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "700"] });

const DESCRIPTION =
  "Your audience data, finally doing the work. SYZYGY is a complete, fully automated commercial team for entertainment: 17 agents turn what an audience loves into booked rooms, sold sponsorships, signed ambassadors and filled ad slots. All in one place. You approve every send.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "SYZYGY · your audience data, finally doing the work", template: "%s · SYZYGY" },
  description: DESCRIPTION,
  applicationName: "SYZYGY",
  authors: [{ name: "Onenept Studios Inc.", url: "https://onenept.com" }],
  creator: "Onenept Studios Inc.",
  publisher: "Onenept Studios Inc.",
  keywords: ["all-in-one", "fully automated", "AI agents", "tour routing", "sponsorship sales", "brand ambassadors", "AI SDR", "brand partnerships", "audience overlap", "Qloo", "taste data", "cultural partnerships", "brand collaboration"],
  openGraph: { type: "website", siteName: "SYZYGY", url: "/", title: "SYZYGY · your audience data, finally doing the work", description: DESCRIPTION, locale: "en_US" },
  twitter: { card: "summary_large_image", title: "SYZYGY · your audience data, finally doing the work", description: DESCRIPTION },
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
