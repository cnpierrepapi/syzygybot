// The only Gemini spend left (lib/llm.ts): a desk's first run, and reading a new business's site to set its desk up.
// Both draw on one daily allowance, so a busy day can't run up the bill again.
import { sql } from "../db";

const PER_DAY = Number(process.env.GEMINI_NEW_DESKS_PER_DAY ?? 5);
const PER_DESK = 2;  // first runs one desk may have (the first can fail on a slow model)

/** Gemini uses left today. */
export async function geminiLeft() {
  const [{ n }] = (await sql()`select
      (select count(*) from runs where gemini and started_at > now() - interval '1 day')
    + (select count(*) from actions where kind = 'desk.anchored' and created_at > now() - interval '1 day') as n`) as { n: string | number }[];
  return Math.max(0, PER_DAY - Number(n));
}

/** May this desk's next run use Gemini: it has never been opened before, and the allowance has room. */
export async function firstRunAllowed(personaId: string) {
  const [{ first, before }] = (await sql()`select count(*) filter (where gemini)::int first,
    count(*) filter (where not gemini and replay_of is null)::int before from runs where persona = ${personaId}`) as { first: number; before: number }[];
  return before === 0 && first < PER_DESK && (await geminiLeft()) > 0;
}
