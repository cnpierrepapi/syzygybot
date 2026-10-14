import { card, OG_SIZE } from "@/lib/og";

export const alt = "SYZYGY: every brand has a Qloo number it hasn't seen yet";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return card({ eyebrow: "AI sales team · runs on Qloo", title: "Every brand has a Qloo number it hasn't seen yet.", sub: "SYZYGY digs them up and tells the person who should hear it." });
}
