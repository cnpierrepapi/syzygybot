import type { Metadata } from "next";
import { Figtree, Inter, Fira_Code } from "next/font/google";
import "./globals.css";
import "./theme.css";
import { SITE } from "@/lib/slug";

// Qloo's type, as close as free fonts get: a geometric display face (Circular-like), Inter for text, Fira Code for data.
const display = Figtree({ subsets: ["latin"], variable: "--font-display", weight: ["400", "500", "600", "700"] });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });
const mono = Fira_Code({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500"] });

const DESCRIPTION =
  "Taste data that books the deal. SYZYGY's agents read Qloo's taste data to see whose fans lean toward whom, then find the person who decides and write the pitch: sponsorships, artist features, room bookings, ambassador deals, co-branded drops and podcast ads. Nothing goes out until you approve it.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "SYZYGY · taste data that books the deal", template: "%s · SYZYGY" },
  description: DESCRIPTION,
  applicationName: "SYZYGY",
  authors: [{ name: "Onenept Studios Inc.", url: "https://onenept.com" }],
  creator: "Onenept Studios Inc.",
  publisher: "Onenept Studios Inc.",
  keywords: ["AI agents", "tour routing", "sponsorship sales", "brand ambassadors", "AI SDR", "brand partnerships", "audience overlap", "Qloo", "taste data", "cultural partnerships", "brand collaboration"],
  openGraph: { type: "website", siteName: "SYZYGY", url: "/", title: "SYZYGY · taste data that books the deal", description: DESCRIPTION, locale: "en_US" },
  twitter: { card: "summary_large_image", title: "SYZYGY · taste data that books the deal", description: DESCRIPTION },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // next/font variables go on <html> so every element can use them.
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        {children}
      </body>
    </html>
  );
}
