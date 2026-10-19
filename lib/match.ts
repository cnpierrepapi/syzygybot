// The SYZYGY match score: our own number for how well two audiences fit, built from the patterns in the stored corpus
// (taste tags, age profile, cities). It works for anything we can profile, measured by Qloo or not. When Qloo has measured
// the pair, its affinity numbers ride along as confirmation; when it hasn't, the score stands on its own with its strength.
// It is a match score (0-100, how unusual the overlap is against random pairs in the corpus), never a Qloo affinity number.
// Checked 19 Oct on 867 measured pairs: it ranks a pair Qloo graded PITCH above one Qloo graded WATCH 78% of the time
// (AUC 0.779), and above a random corpus pair 74% of the time. Taste alone: 0.69 / 0.71; the 60/20/20 mix was the best tried.
import { loadCorpus, tagFrequencies, tagSimilarity, type Profile } from "./corpus";
import { METROS } from "./geo";

// Tags that may describe what an audience watches but must never appear in a pitch as "shared tastes".
const SENSITIVE = /prison|violen|fight|crime|criminal|murder|death|drug|addict|\bwar\b|weapon|gun|sex|erotic|nud|gay|lesbian|lgbt|queer|religio|christian|islam|jewish|politic|abuse|suicide|terror|racis|gang|alcohol/i;

export type Side = { id?: string; name: string; tags: Set<string>; age: Record<string, number> | null; metros: Map<string, number> };
export type QlooConfirm = { toward: number; back: number; band: string };
export type Match = {
  score: number;                       // 0-100
  strength: "strong" | "medium" | "weak";
  parts: { taste: number; age: number | null; cities: number };
  sharedTags: string[];
  sharedCities: string[];
  qloo: QlooConfirm | null;            // Qloo's own measurement of this pair, when it exists
};

function cosine(a: Record<string, number>, b: Record<string, number>) {
  const keys = Object.keys(a).filter(k => k in b);
  let dot = 0, na = 0, nb = 0;
  for (const k of keys) { dot += a[k] * b[k]; na += a[k] ** 2; nb += b[k] ** 2; }
  return na && nb ? dot / Math.sqrt(na * nb) : null;
}

function cityOverlap(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0, na = 0, nb = 0;
  for (const [k, w] of a) { na += w * w; const v = b.get(k); if (v) dot += w * v; }
  for (const w of b.values()) nb += w * w;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const METRO_NAMES = METROS.map(m => m[0]);
const ALIAS: Record<string, string> = { "dallas-fort worth": "Dallas", "washington": "Washington DC", "san francisco-oakland-san jose": "San Francisco", "minneapolis-st. paul": "Minneapolis", "tampa-st. petersburg": "Tampa", "miami-fort lauderdale": "Miami" };

/** "Dallas-Fort Worth", "Washington, DC" -> the metro names the corpus uses. */
export function normMetro(name: string) {
  const k = name.toLowerCase().replace(/,.*$/, "").trim();
  return ALIAS[name.toLowerCase()] ?? ALIAS[k] ?? METRO_NAMES.find(m => m.toLowerCase() === k) ?? METRO_NAMES.find(m => k.startsWith(m.toLowerCase())) ?? name;
}

/** Weights from a metro list in priority order (look-alike profiles keep metros as a ranked list). */
export const metroMap = (list: string[]) => new Map(list.map((m, i) => [normMetro(m), 1 - i / Math.max(1, list.length)]));

let ctx: { df: Map<string, number>; n: number; dist: { taste: number[]; age: number[]; cities: number[] } } | null = null;

/** Raw-part distributions over random pairs of corpus profiles: the yardstick for "how unusual is this overlap". */
async function context() {
  if (ctx) return ctx;
  const { profiles } = await loadCorpus();
  const df = tagFrequencies(profiles), n = profiles.size;
  const ps = [...profiles.values()].filter(p => p.tags.size);
  const taste: number[] = [], age: number[] = [], cities: number[] = [];
  // Deterministic sample, so the scale never shifts between runs on the same corpus.
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 4000 && ps.length > 1; i++) {
    const a = ps[Math.floor(rnd() * ps.length)], b = ps[Math.floor(rnd() * ps.length)];
    if (a === b) continue;
    taste.push(tagSimilarity(a.tags, b.tags, df, n));
    const g = a.age && b.age ? cosine(a.age, b.age) : null;
    if (g != null) age.push(g);
    cities.push(cityOverlap(a.metros, b.metros));
  }
  for (const d of [taste, age, cities]) d.sort((x, y) => x - y);
  ctx = { df, n, dist: { taste, age, cities } };
  return ctx;
}

const pct = (sorted: number[], x: number) => {
  if (!sorted.length) return 0;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < x) lo = m + 1; else hi = m; }
  return lo / sorted.length;
};

export const sideOf = (p: Profile): Side => ({ id: p.id, name: p.name, tags: p.tags, age: p.age, metros: p.metros });

export async function syzygyMatch(a: Side, b: Side): Promise<Match> {
  const { df, n, dist } = await context();
  const taste = pct(dist.taste, tagSimilarity(a.tags, b.tags, df, n));
  const g = a.age && b.age ? cosine(a.age, b.age) : null;
  const age = g == null ? null : pct(dist.age, g);
  const cities = pct(dist.cities, cityOverlap(a.metros, b.metros));
  const score = Math.round(100 * (age == null ? 0.75 * taste + 0.25 * cities : 0.6 * taste + 0.2 * age + 0.2 * cities));
  const { edges } = await loadCorpus();
  const e = a.id && b.id ? (edges.get(a.id) ?? []).find(x => x.partnerId === b.id) : undefined;
  const sharedTags = [...a.tags].filter(t => b.tags.has(t) && !SENSITIVE.test(t)).sort((x, y) => (df.get(x) ?? 0) - (df.get(y) ?? 0)).slice(0, 8);
  const sharedCities = [...a.metros.keys()].filter(m => b.metros.has(m)).slice(0, 5);
  return {
    score, strength: score >= 80 ? "strong" : score >= 60 ? "medium" : "weak",
    parts: { taste: +taste.toFixed(2), age: age == null ? null : +age.toFixed(2), cities: +cities.toFixed(2) },
    sharedTags, sharedCities,
    qloo: e ? { toward: +e.toward.toFixed(3), back: +e.back.toFixed(3), band: e.band } : null,
  };
}
