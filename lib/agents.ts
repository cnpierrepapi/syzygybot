// Ten agents, each doing work of its own (23 Oct it was 9, before that 17; Rival check joined 24 Oct). The four desks (sponsorship, talent, venue, podcast) are
// briefs the same agents work from, not agents.
export const AGENT_IDS = ["scout", "numbers", "checker", "rival_check", "contact_finder", "verifier", "writer", "clearance", "sequencer", "inbox"] as const;
export type Agent = (typeof AGENT_IDS)[number];

// Where the retired names' work went. Older rows were renamed in the database; this catches any caller still using one.
export const MERGED: Record<string, Agent> = {
  qualifier: "numbers", strategist: "writer", router: "sequencer", watch: "scout",
  sponsor: "scout", talent: "scout", venue: "scout", podcast: "scout", booker: "sequencer",
};
export const agentOf = (a: string): Agent => (AGENT_IDS as readonly string[]).includes(a) ? a as Agent : MERGED[a] ?? "scout";
