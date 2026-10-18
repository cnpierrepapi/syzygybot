// Messages between the pages and the sky (components/Constellation.tsx). Kept out of the component
// files so React Fast Refresh can hot-swap those without reloading the page.

export const TYPE_HUE: Record<string, string> = {
  brand: "#ff6b5e", artist: "#22d3ee", tv_show: "#a3e635", movie: "#ffb020", book: "#c084fc", podcast: "#f472b6",
};

export type PulseEvent = { agent: string; stars: string[] };
export type FocusEvent = { stars: string[] };
/** Legend filter on the homepage: isolate one star type, or one band of thesis line. Null clears it. */
export type SkyFilter = { type: string } | { band: string } | null;
export const filterSky = (f: SkyFilter) => dispatchEvent(new CustomEvent<SkyFilter>("syzygy:filter", { detail: f }));

/** The feed calls this whenever an agent action lands: light leaves that agent and lands on those stars. */
export const pulse = (agent: string, stars: string[]) => dispatchEvent(new CustomEvent<PulseEvent>("syzygy:pulse", { detail: { agent, stars } }));
