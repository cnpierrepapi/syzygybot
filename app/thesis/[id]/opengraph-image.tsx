import { sql } from "@/lib/db";
import { resolve } from "@/lib/slug";
import { typeColors } from "@/lib/ui";
import { card, OG_SIZE } from "@/lib/og";

export const alt = "A SYZYGY partnership thesis";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const hit = await resolve("pairs", (await params).id);
  if (!hit) return card({ eyebrow: "partnership thesis", title: "Thesis not found" });
  const [p] = (await sql()`
    select p.band, p.score, a.name a_name, a.type a_type, b.name b_name, b.type b_type
    from pairs p join entities a on a.qloo_id = p.a_id join entities b on b.qloo_id = p.b_id where p.id = ${hit.id}`) as
    { band: string; score: number; a_name: string; a_type: string; b_name: string; b_type: string }[];
  const [a1, a2] = typeColors(p.a_type), [b1, b2] = typeColors(p.b_type);
  return card({
    eyebrow: "partnership thesis", title: `${p.a_name} × ${p.b_name}`,
    sub: "Two audiences that line up on Qloo taste data.", badge: `${p.band} ${Number(p.score).toFixed(2)}`, colors: [a1, a2, b1, b2],
  });
}
