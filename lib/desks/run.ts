// Every persona's pitching desks now work in live runs (lib/live). What stays here is Market Watch, which reads the news
// for each persona on its own clock.
import { PERSONAS, type Persona } from "../personas";
import { runWatch } from "./watch";

export async function runPersonaWatch(p: Persona) {
  try { return { watch: (await runWatch(p)).length }; }
  catch (e) { return { watch: `failed: ${(e as Error).message.slice(0, 120)}` }; }
}

export async function runAllWatch() {
  const out: Record<string, unknown> = {};
  for (const p of PERSONAS) out[p.id] = await runPersonaWatch(p);
  return out;
}
