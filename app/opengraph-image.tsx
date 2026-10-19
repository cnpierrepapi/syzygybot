import { card, OG_SIZE } from "@/lib/og";

export const alt = "SYZYGY: every brand has a Qloo number it hasn't seen yet";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return card({ eyebrow: "All-in-one · fully automated", title: "Your audience data, finally doing the work.", sub: "17 agents. Booked rooms, sold sponsorships, signed ambassadors. You say yes." });
}
