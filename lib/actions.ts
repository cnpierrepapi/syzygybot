import { sql } from "./db";

export type Agent =
  | "scout" | "checker" | "qualifier" | "numbers" | "contact_finder" | "verifier"
  | "strategist" | "writer" | "sequencer" | "inbox"
  | "router" | "sponsor" | "talent" | "venue" | "watch" | "podcast" | "clearance";

export interface ActionInput {
  agent: Agent;
  kind: string;
  summary: string;
  refTable?: string;
  refId?: string;
  detail?: Record<string, unknown>;
  llmCostUsd?: number | null;
  at?: Date;           // when it happened, if it's logged after the fact (a card's steps are filed once the card exists)
}

/** Every agent step lands here. The live floor is a view over this table. */
export async function logAction(a: ActionInput): Promise<string> {
  const rows = (await sql()`
    insert into actions (agent, kind, summary, ref_table, ref_id, detail, llm_cost_usd, created_at)
    values (${a.agent}, ${a.kind}, ${a.summary}, ${a.refTable ?? null}, ${a.refId ?? null},
            ${JSON.stringify(a.detail ?? {})}, ${a.llmCostUsd ?? null}, ${(a.at ?? new Date()).toISOString()})
    returning id`) as { id: string }[];
  return rows[0].id;
}
