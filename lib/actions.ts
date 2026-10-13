import { sql } from "./db";

export type Agent =
  | "scout" | "qualifier" | "numbers" | "contact_finder" | "verifier"
  | "strategist" | "writer" | "sequencer" | "inbox";

export interface ActionInput {
  agent: Agent;
  kind: string;
  summary: string;
  refTable?: string;
  refId?: string;
  detail?: Record<string, unknown>;
  llmCostUsd?: number | null;
}

/** Every agent step lands here. The SDR floor is a view over this table. */
export async function logAction(a: ActionInput): Promise<string> {
  const rows = (await sql()`
    insert into actions (agent, kind, summary, ref_table, ref_id, detail, llm_cost_usd)
    values (${a.agent}, ${a.kind}, ${a.summary}, ${a.refTable ?? null}, ${a.refId ?? null},
            ${JSON.stringify(a.detail ?? {})}, ${a.llmCostUsd ?? null})
    returning id`) as { id: string }[];
  return rows[0].id;
}
