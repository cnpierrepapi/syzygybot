import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", weight: ["400", "500", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "700"] });

export const metadata: Metadata = {
  title: "SYZYGY · the autonomous SDR floor",
  description: "An autonomous SDR team built on Qloo's taste data. No humans; every action is clickable.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // next/font variables go on <html> so every element can use them.
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>
        <div className="stars" aria-hidden />
        {children}
      </body>
    </html>
  );
}
