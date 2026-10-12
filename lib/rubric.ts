// Rubric v1. Pure scoring: raw Qloo measurements in, 0..1 dimension scores and a band out.
// Weights and cut-offs are the v1 proposal from 11 Oct; change them here and bump VERSION.

export const RUBRIC_VERSION = "v1";

export const WEIGHTS = {
  fit: 30,        // how much each audience likes the other (mean pull)
  surprise: 20,   // high affinity, but not already in each other's top lists
  mutuality: 10,  // both gain, rather than one carrying the other
  category: 10,   // cross-category = cross-promo; same category = competitors
  shared: 10,     // overlapping taste tags (source of the thesis sentence)
  reach: 10,      // audiences close enough to fit, different enough to add fans
  where: 5,       // cities where both audiences are strong
  timing: 5,      // is either side rising
} as const;

export type Dim = keyof typeof WEIGHTS;

export const CUTOFFS = { pitch: 0.72, watch: 0.55, minPull: 0.75 } as const;

export type Band = "PASS" | "WATCH" | "PITCH";

export interface Raw {
  pullAB: number | null;           // A's audience -> B
  pullBA: number | null;           // B's audience -> A
  sameType: boolean;
  sameIndustry: boolean | null;
  popA: number | null;
  popB: number | null;
  rankBinA: number | null;         // B's 1-based rank in A's top list of B's type (null = not in it)
  rankAinB: number | null;
  listSize: number;
  tagsA: string[];                 // audience taste tags (Qloo urn:tag insights)
  tagsB: string[];
  ageA: Record<string, number> | null;
  ageB: Record<string, number> | null;
  cellsA: string[];                // strongest heatmap geohashes
  cellsB: string[];
  momentumA: number | null;        // -1..1, null = no trending data (brands)
  momentumB: number | null;
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const lerp = (x: number, from: number, to: number) => clamp((x - from) / (to - from));

export function sharedTags(a: string[], b: string[]) {
  const sb = new Set(b);
  return [...new Set(a)].filter(t => sb.has(t));
}

function cosine(a: Record<string, number>, b: Record<string, number>) {
  const keys = Object.keys(a).filter(k => k in b);
  if (!keys.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (const k of keys) { dot += a[k] * b[k]; na += a[k] ** 2; nb += b[k] ** 2; }
  return na && nb ? dot / Math.sqrt(na * nb) : null;
}

export interface Scored {
  dims: Record<Dim, { score: number; raw: unknown; note: string }>;
  score: number;
  band: Band;
  gate: string | null;
}

export function score(r: Raw): Scored {
  const pulls = [r.pullAB, r.pullBA].filter((p): p is number => p != null);
  const meanPull = pulls.length ? pulls.reduce((s, p) => s + p, 0) / pulls.length : 0;
  const minPull = pulls.length ? Math.min(...pulls) : 0;

  // Same-type affinity comes back symmetric, so mutuality falls back to the popularity gap.
  let mutualityRaw: number | null = null;
  let mutualityNote: string;
  if (!r.sameType && r.pullAB != null && r.pullBA != null) {
    mutualityRaw = Math.min(r.pullAB, r.pullBA) / Math.max(r.pullAB, r.pullBA);
    mutualityNote = "ratio of the two pulls";
  } else if (r.popA != null && r.popB != null && Math.max(r.popA, r.popB) > 0) {
    mutualityRaw = Math.min(r.popA, r.popB) / Math.max(r.popA, r.popB);
    mutualityNote = "same type: popularity ratio";
  } else mutualityNote = "no signal";

  const ranks = [r.rankBinA, r.rankAinB];
  const rankScore = (k: number | null) => (k == null ? 1 : lerp(k, 1, r.listSize));
  const surprise = ranks.map(rankScore).reduce((s, x) => s + x, 0) / 2;

  const shared = sharedTags(r.tagsA, r.tagsB);
  const smaller = Math.min(new Set(r.tagsA).size, new Set(r.tagsB).size);
  const overlap = smaller ? shared.length / smaller : 0;

  const ageSim = r.ageA && r.ageB ? cosine(r.ageA, r.ageB) : null;

  const cellsB = new Set(r.cellsB);
  const cellOverlap = r.cellsA.filter(c => cellsB.has(c)).length;
  const cellBase = Math.min(r.cellsA.length, r.cellsB.length);

  const moms = [r.momentumA, r.momentumB].filter((m): m is number => m != null);

  const dims: Scored["dims"] = {
    fit: { score: lerp(meanPull, 0.6, 0.95), raw: { meanPull, pullAB: r.pullAB, pullBA: r.pullBA }, note: "mean pull, 0.60→0 to 0.95→1" },
    surprise: { score: surprise, raw: { rankBinA: r.rankBinA, rankAinB: r.rankAinB, of: r.listSize }, note: "not already in each other's top lists" },
    mutuality: { score: mutualityRaw ?? 0.5, raw: mutualityRaw, note: mutualityNote },
    category: {
      score: !r.sameType ? 1 : r.sameIndustry === false ? 0.7 : 0.3,
      raw: { sameType: r.sameType, sameIndustry: r.sameIndustry },
      note: !r.sameType ? "different entity types" : "same entity type",
    },
    shared: { score: lerp(overlap, 0, 0.4), raw: { overlap, shared }, note: "share of audience taste tags in common, 40% = full marks" },
    reach: {
      score: ageSim == null ? 0.5 : clamp(1 - Math.abs(ageSim - 0.5) / 0.5),
      raw: ageSim,
      note: ageSim == null ? "no demographic data" : "age-skew similarity, sweet spot 0.5",
    },
    where: {
      score: cellBase ? lerp(cellOverlap / cellBase, 0, 0.5) : 0.5,
      raw: { overlap: cellOverlap, of: cellBase },
      note: cellBase ? "shared strong heatmap cells" : "no heatmap data",
    },
    timing: {
      score: moms.length ? clamp(0.5 + Math.max(...moms) / 2) : 0.5,
      raw: { momentumA: r.momentumA, momentumB: r.momentumB },
      note: moms.length ? "best momentum of the two" : "no trending data (brands have none)",
    },
  };

  const total = Object.values(WEIGHTS).reduce((s, w) => s + w, 0);
  const s = (Object.keys(WEIGHTS) as Dim[]).reduce((acc, d) => acc + dims[d].score * WEIGHTS[d], 0) / total;

  const gate = minPull < CUTOFFS.minPull ? `lower pull ${minPull.toFixed(3)} < ${CUTOFFS.minPull}` : null;
  const band: Band = gate ? "PASS" : s >= CUTOFFS.pitch ? "PITCH" : s >= CUTOFFS.watch ? "WATCH" : "PASS";
  return { dims, score: s, band, gate };
}
