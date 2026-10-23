// Shared colours. Agent and dimension colours are categorical identity, assigned in a fixed
// order from a palette validated for CVD separation on the dark surface; a text label always
// sits beside them, so colour is never the only cue. Decorative gradients live in globals.css.

export const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

import { AGENT_IDS, agentOf } from "./agents";

// The nine agents, in the order a card meets them.
export const AGENTS = AGENT_IDS;

const LABEL: Record<string, string> = {
  scout: "Scout", numbers: "Numbers", checker: "Deal check", contact_finder: "Contact finder", verifier: "Verifier",
  writer: "Writer", clearance: "Clearance", sequencer: "Sequencer", inbox: "Inbox",
};
// Older rows and links may carry a retired name (Qualifier, Strategist...): they show as the agent that does that work now.
export const AGENT_LABEL: Record<string, string> = new Proxy(LABEL, { get: (t, k: string) => t[agentOf(k)] });

// Brighter steps of the same hues for chips and glows on the dark panels (text stays in ink colours).
const BRIGHT = ["#5aa2ff", "#ff7a45", "#2fd39a", "#ffb31f", "#ff6fa6", "#3fbf3f", "#a99cff", "#ff8080"];

// Fixed per agent, so adding one never recolours the others.
const AGENT_COLOR: Record<string, string> = {
  scout: BRIGHT[0], clearance: BRIGHT[1], numbers: BRIGHT[2], contact_finder: BRIGHT[3], verifier: BRIGHT[4],
  writer: BRIGHT[6], sequencer: BRIGHT[7], inbox: "#e879f9", checker: "#5eead4",
};

export const agentColor = (agent: string) => AGENT_COLOR[agentOf(agent)] ?? BRIGHT[0];

// Chart marks use the validated steps (all checks pass on #161140); chips use BRIGHT beside a label.
export const DIM_COLOR: Record<string, string> = {
  fit: PALETTE[0], surprise: PALETTE[1], mutuality: PALETTE[2], category: PALETTE[3],
  shared: PALETTE[4], reach: PALETTE[5], where: PALETTE[6], timing: PALETTE[7],
};

export const DIM_LABEL: Record<string, string> = {
  fit: "Fit", surprise: "Surprise", mutuality: "Mutuality", category: "Category",
  shared: "Shared taste", reach: "Reach", where: "Where", timing: "Timing",
};

// Entity types: a bright hue and a deeper one, matching the stars in the sky (components/Constellation.tsx).
export const TYPE_COLOR: Record<string, [string, string]> = {
  brand: ["#ff6b5e", "#b8323f"],
  artist: ["#22d3ee", "#2563eb"],
  tv_show: ["#a3e635", "#15803d"],
  movie: ["#ffb020", "#c2410c"],
};

export const typeColors = (t: string) => TYPE_COLOR[t] ?? ["#8b7cf6", "#4c1d95"];


/** Public pages never show a full address: first letter, then the domain. */
export const maskEmail = (e: string | null) => (e ? e.replace(/^(.)[^@]*/, "$1***") : null);

export const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  confirmed: { label: "VERIFIED", color: "#2fd39a" },
  stale: { label: "STALE", color: "#ffb31f" },
  departed: { label: "LEFT THE ROLE", color: "#9aa3b8" },
  unconfirmed: { label: "NOT CONFIRMED", color: "#ff8080" },
};
