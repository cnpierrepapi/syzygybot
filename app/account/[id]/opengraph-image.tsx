import { sql } from "@/lib/db";
import { resolve } from "@/lib/slug";
import { typeColors } from "@/lib/ui";
import { card, OG_SIZE } from "@/lib/og";

export const alt = "A SYZYGY account: the company its agents picked as the buyer";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const hit = await resolve("accounts", (await params).id);
  if (!hit) return card({ eyebrow: "account", title: "Account not found" });
  const [a] = (await sql()`
    select e.name, e.type, p.name passed_name, p.type passed_type from accounts ac join entities e on e.qloo_id = ac.entity_id
    left join entities p on p.qloo_id = ac.passed_on where ac.id = ${hit.id}`) as { name: string; type: string; passed_name: string | null; passed_type: string | null }[];
  const [a1, a2] = typeColors(a.type), [b1, b2] = typeColors(a.passed_type ?? "artist");
  return card({ eyebrow: "account", title: a.name, sub: a.passed_name ? `Picked as the buyer from the ${a.name} × ${a.passed_name} thesis.` : "Picked as the buyer by Numbers.", colors: [a1, a2, b1, b2] });
}
