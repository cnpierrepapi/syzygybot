// Shared colours. Agent and dimension colours are categorical identity, assigned in a fixed
// order from a palette validated for CVD separation on the dark surface; a text label always
// sits beside them, so colour is never the only cue. Decorative gradients live in globals.css.

export const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

export const AGENTS = [
  "scout", "qualifier", "numbers", "contact_finder", "verifier",
  "strategist", "writer", "sequencer", "inbox", "booker",
] as const;

export const AGENT_LABEL: Record<string, string> = {
  scout: "Scout", qualifier: "Qualifier", numbers: "Numbers", contact_finder: "Contact finder",
  verifier: "Verifier", strategist: "Strategist", writer: "Writer", sequencer: "Sequencer",
  inbox: "Inbox", booker: "Booker",
};

// Brighter steps of the same hues for chips and glows on the dark panels (text stays in ink colours).
const BRIGHT = ["#5aa2ff", "#ff7a45", "#2fd39a", "#ffb31f", "#ff6fa6", "#3fbf3f", "#a99cff", "#ff8080"];

export function agentColor(agent: string) {
  const i = AGENTS.indexOf(agent as (typeof AGENTS)[number]);
  return BRIGHT[(i < 0 ? 0 : i) % BRIGHT.length];
}

// Chart marks use the validated steps (all checks pass on #161140); chips use BRIGHT beside a label.
export const DIM_COLOR: Record<string, string> = {
  fit: PALETTE[0], surprise: PALETTE[1], mutuality: PALETTE[2], category: PALETTE[3],
  shared: PALETTE[4], reach: PALETTE[5], where: PALETTE[6], timing: PALETTE[7],
};

export const DIM_LABEL: Record<string, string> = {
  fit: "Fit", surprise: "Surprise", mutuality: "Mutuality", category: "Category",
  shared: "Shared taste", reach: "Reach", where: "Where", timing: "Timing",
};

export const TYPE_COLOR: Record<string, [string, string]> = {
  brand: ["#ff3d9a", "#ff8a3d"],
  artist: ["#3de0ff", "#9b7bff"],
  tv_show: ["#b6f23d", "#3de0a0"],
  movie: ["#ffd23d", "#ff8a3d"],
};

export const typeColors = (t: string) => TYPE_COLOR[t] ?? ["#9b7bff", "#3de0ff"];


/** Public pages never show a full address: first letter, then the domain. */
export const maskEmail = (e: string | null) => (e ? e.replace(/^(.)[^@]*/, "$1***") : null);

export const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  confirmed: { label: "VERIFIED", color: "#2fd39a" },
  stale: { label: "STALE", color: "#ffb31f" },
  unconfirmed: { label: "NOT CONFIRMED", color: "#ff8080" },
};
