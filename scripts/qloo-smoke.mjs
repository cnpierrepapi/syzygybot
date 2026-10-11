// Checks the Qloo key and prints response SHAPES (keys), never the key itself.
const BASE = process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";
const key = process.env.QLOO_API_KEY;
if (!key) { console.error("QLOO_API_KEY missing from .env"); process.exit(1); }

async function get(path, params) {
  const res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers: { "X-Api-Key": key } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
const shape = (o, d = 0) =>
  o && typeof o === "object" && d < 3
    ? Array.isArray(o) ? [o.length ? shape(o[0], d + 1) : "[]"] : Object.fromEntries(Object.keys(o).slice(0, 15).map(k => [k, shape(o[k], d + 1)]))
    : typeof o;

const s = await get("/search", { query: "A24", take: "1" });
console.log("search", s.status);
if (s.status !== 200) process.exit(1);
const first = Array.isArray(s.body?.results) ? s.body.results[0] : s.body?.results?.entities?.[0];
console.log("search shape", JSON.stringify(shape(s.body)));
console.log("first:", first?.name, first?.entity_id, "twitter:", first?.properties?.external?.twitter);

const p = await get("/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.entities": first.entity_id, take: "3" });
console.log("insights", p.status, JSON.stringify(shape(p.body)));
