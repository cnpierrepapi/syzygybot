// Reply sorting without a model, for while Gemini is off (lib/llm.ts). It only names the two classes that change what
// happens next: an opt-out (do-not-contact, unsent cancelled) and an out-of-office. Everything else is "other", which
// still reaches a person with the thread, so nothing a human wrote is lost.
const OPT_OUT = /\b(unsubscribe|opt[- ]?out|remove me|take me off|stop (e-?mailing|contacting|sending|writing)|do not (contact|e-?mail|write)|don'?t (contact|e-?mail|write)|no longer (contact|e-?mail))\b/i;
const OOO = /\b(out of (the )?office|on (annual |parental |maternity |paternity )?leave|auto(matic)?[- ]?reply|away (from (my )?(desk|email) )?until|limited access to (my )?e-?mail|currently travel?ling)\b/i;

export function ruleClass(text: string): "opt_out" | "ooo" | "other" {
  if (OPT_OUT.test(text)) return "opt_out";
  if (OOO.test(text)) return "ooo";
  return "other";
}

/** The same shape a model reply has, so callers parse it the same way. */
export const ruleReply = (text: string) =>
  ({ text: JSON.stringify({ class: ruleClass(text), summary: "" }), costUsd: 0 as number | null });
