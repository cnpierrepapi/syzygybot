import { card, OG_SIZE } from "@/lib/og";

export const alt = "SYZYGY: every brand has a Qloo number it hasn't seen yet";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return card({ eyebrow: "Built on Qloo's taste data", title: "Taste data that books the deal.", sub: "Sponsorships, features, room bookings, ambassadors, co-branded drops. You say yes." });
}
