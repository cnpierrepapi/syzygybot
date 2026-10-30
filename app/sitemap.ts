import type { MetadataRoute } from "next";
import { sql } from "@/lib/db";
import { SITE } from "@/lib/slug";

export const revalidate = 3600;

// The floor, the desk picker, every published thesis (PITCH and WATCH), and every account. Desks themselves are per-visitor
// workspaces and carry noindex.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const home = { url: SITE, changeFrequency: "hourly" as const, priority: 1 };
  const desk = { url: `${SITE}/desk`, changeFrequency: "daily" as const, priority: 0.9 };
  const pricing = { url: `${SITE}/pricing`, changeFrequency: "monthly" as const, priority: 0.7 };
  if (!process.env.DATABASE_URL) return [home, desk, pricing];
  const [theses, accounts] = await Promise.all([
    sql()`select slug, called_at from pairs where band in ('PITCH','WATCH') and thesis is not null and slug is not null order by called_at desc`,
    sql()`select slug, created_at from accounts where slug is not null order by created_at desc`,
  ]) as [{ slug: string; called_at: string }[], { slug: string; created_at: string }[]];
  return [
    home, desk, pricing,
    ...theses.map(t => ({ url: `${SITE}/thesis/${t.slug}`, lastModified: new Date(t.called_at), changeFrequency: "weekly" as const, priority: 0.8 })),
    ...accounts.map(a => ({ url: `${SITE}/account/${a.slug}`, lastModified: new Date(a.created_at), changeFrequency: "daily" as const, priority: 0.6 })),
  ];
}
