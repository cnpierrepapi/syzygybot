import { card, OG_SIZE } from "@/lib/og";

export const alt = "SYZYGY: the autonomous SDR floor, built on Qloo taste data";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return card({ eyebrow: "the autonomous SDR floor", title: "No humans. Every action here was taken by agents.", sub: "Audiences that line up, found and worked by AI agents." });
}
