import { card, OG_SIZE } from "@/lib/og";

export const alt = "SYZYGY: taste data that books the deal";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return card({ eyebrow: "Built on Qloo's taste data", title: "Taste data that books the deal.", sub: "Sponsorships, features, room bookings, ambassadors, co-branded drops. You say yes." });
}
