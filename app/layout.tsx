import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SYZYGY",
  description: "An autonomous SDR team built on Qloo's taste data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
