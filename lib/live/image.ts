// A picture for every desk, so no tile is blank: Qloo's own image of the record first (search results carry one), else the
// lead image of the Wikipedia page with that name. Null when neither has one; the tile falls back to initials.
const WIKI = "https://en.wikipedia.org/api/rest_v1/page/summary/";

export const qlooImage = (e: { properties?: unknown }) => {
  const p = (e.properties ?? {}) as { image?: { url?: string } };
  const u = p.image?.url;
  return u && /^https:\/\/images\.qloo\.com\//.test(u) ? u : null;
};

export async function wikiImage(name: string): Promise<string | null> {
  try {
    const r = await fetch(WIKI + encodeURIComponent(name.replace(/\s+/g, "_")), {
      headers: { "user-agent": "SYZYGY (syzygybot.com)" }, signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { type?: string; thumbnail?: { source?: string } };
    // A disambiguation page's picture belongs to no one in particular.
    return j.type === "disambiguation" ? null : j.thumbnail?.source ?? null;
  } catch { return null; }
}

export const imageFor = async (name: string, qloo: string | null) => qloo ?? wikiImage(name);
