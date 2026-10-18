// Look-alikes: a pattern match for anything Qloo hasn't measured for us.
// 1. Gemini reads public sources and describes the brand or person in Qloo's own tag vocabulary.
// 2. That profile is matched to the nearest profiles Qloo actually measured (IDF-weighted tag cosine).
// 3. The partners Qloo measured for those look-alikes become candidates, with a match % = the share of
//    look-alike evidence pointing at each partner. It is a SYZYGY estimate, never a Qloo affinity.
// Tested 18 Oct on 10 measured brands, profiles rebuilt from the web only: the real Qloo pairing was in the
// top 3 for 8 of 10 (Qloo's own profiles: 9 of 10; guessing the biggest seeds: 32%).
import { sql } from "./db";
import { askWeb, parseJson, type WebSource } from "./llm";
import { loadCorpus, tagFrequencies, tagSimilarity, type Profile } from "./corpus";

const VOCAB_SIZE = 1500;
const NEIGHBOURS = 10;

const SYSTEM = `You build taste profiles in the style of Qloo's audience tags. Research the brand, company or person on the web:
what it is, who buys or follows it, price point, where it sells or performs, collaborations, and the music, TV, film and lifestyle
its audience is into. Then pick 35 to 50 tags ONLY from the provided vocabulary that best describe (a) the subject itself and (b) the
wider tastes of its audience, including the music genres and TV/film themes that audience likes. Also give its audience age split and
the US metros where its audience concentrates.
Reply with JSON only: {"tags": [...], "age": {"24_and_younger": 0-1, "25_to_29": .., "30_to_34": .., "35_to_44": .., "45_to_54": .., "55_and_older": ..},
"metros": ["Los Angeles", ...], "summary": "one sentence", "confidence": "high|medium|low"}`;

export type Synth = { tags: string[]; age: Record<string, number> | null; metros: string[]; summary: string; confidence: string; sources: WebSource[]; costUsd: number };

export async function synthesize(name: string, description: string): Promise<Synth> {
  const { profiles } = await loadCorpus();
  const vocab = [...tagFrequencies(profiles)].sort((a, b) => b[1] - a[1]).slice(0, VOCAB_SIZE).map(([t]) => t);
  const r = await askWeb(`Subject: ${name} (${description})\n\nVocabulary (choose only from these):\n${vocab.join(", ")}`, SYSTEM, 1500);
  const j = parseJson<Partial<Synth>>(r.text);
  const allowed = new Set(vocab);
  return {
    tags: (j?.tags ?? []).filter(t => allowed.has(t)), age: j?.age ?? null, metros: j?.metros ?? [],
    summary: j?.summary ?? "", confidence: j?.confidence ?? "low", sources: r.sources.slice(0, 8), costUsd: r.costUsd,
  };
}

/** Nearest measured profiles, then the partners Qloo measured for them. Talent matches brands; brands match talent. */
export async function match(tags: string[], kind: "brand" | "talent") {
  const { profiles, edges } = await loadCorpus();
  const df = tagFrequencies(profiles), n = profiles.size, mine = new Set(tags);
  const isTalent = (p: Profile) => p.type === "artist" || p.type === "tv_show";
  const pool = [...profiles.values()].filter(p => p.tags.size && isTalent(p) === (kind === "talent"));
  const near = pool.map(p => ({ p, s: tagSimilarity(mine, p.tags, df, n) })).sort((a, b) => b.s - a.s).slice(0, NEIGHBOURS);
  const total = near.reduce((x, y) => x + y.s, 0) || 1;
  const votes = new Map<string, { s: number; evidence: { lookalike: string; similarity: number; toward: number; back: number; band: string }[] }>();
  for (const { p, s } of near) for (const e of edges.get(p.id) ?? []) {
    const partner = profiles.get(e.partnerId);
    if (!partner || isTalent(partner) === (kind === "talent")) continue; // the other side of the market
    const v = votes.get(e.partnerId) ?? { s: 0, evidence: [] };
    v.s += s; v.evidence.push({ lookalike: p.name, similarity: +s.toFixed(3), toward: +e.toward.toFixed(3), back: +e.back.toFixed(3), band: e.band });
    votes.set(e.partnerId, v);
  }
  return {
    lookalikes: near.slice(0, 6).map(({ p, s }) => ({ id: p.id, name: p.name, type: p.type, similarity: +s.toFixed(3) })),
    // How strong the nearest look-alike is decides how much the whole match can be trusted.
    strength: near[0]?.s >= 0.2 ? "strong" : near[0]?.s >= 0.12 ? "medium" : "weak",
    partners: [...votes].sort((a, b) => b[1].s - a[1].s).slice(0, 10).map(([id, v]) => ({
      id, name: profiles.get(id)!.name, type: profiles.get(id)!.type, matchPct: Math.round((100 * v.s) / total), evidence: v.evidence.slice(0, 4),
    })),
  };
}

/** Synthesize, match and store. Re-running replaces the profile and its matches. */
export async function lookalike(name: string, description: string, kind: "brand" | "talent", pre?: Synth) {
  const s = pre ?? await synthesize(name, description);
  const m = await match(s.tags, kind);
  const [row] = (await sql()`
    insert into synthetic_profiles (name, kind, description, tags, age, metros, summary, confidence, sources, lookalikes)
    values (${name}, ${kind}, ${description}, ${JSON.stringify(s.tags)}, ${JSON.stringify(s.age)}, ${JSON.stringify(s.metros)},
            ${s.summary}, ${s.confidence}, ${JSON.stringify(s.sources)}, ${JSON.stringify({ strength: m.strength, nearest: m.lookalikes })})
    on conflict (name) do update set kind = excluded.kind, description = excluded.description, tags = excluded.tags, age = excluded.age,
      metros = excluded.metros, summary = excluded.summary, confidence = excluded.confidence, sources = excluded.sources,
      lookalikes = excluded.lookalikes, created_at = now()
    returning id`) as { id: string }[];
  await sql()`delete from pattern_matches where profile_id = ${row.id}`;
  for (const p of m.partners)
    await sql()`insert into pattern_matches (profile_id, partner_id, partner, partner_type, match_pct, evidence)
      values (${row.id}, ${p.id}, ${p.name}, ${p.type}, ${p.matchPct}, ${JSON.stringify(p.evidence)})`;
  return { id: row.id, ...s, ...m };
}
