// npm run qloo:backfill [-- --dry]   -> measures, in Qloo and both ways, every filed card that only carries our rough
// estimate (the old desks' cards from before live runs), and writes Qloo's numbers onto the card as its score.
import { sql } from "../lib/db";
import { qlooCallsMade, type EntityType } from "../lib/qloo";
import { affinities, resolve, type Ent } from "../lib/live/qx";

const dry = process.argv.includes("--dry");
type Row = { id: string; persona: string; desk: string; title: string; org: string; talent: string[] | null; facts: string[]; ours: number | null };
const rows = (await sql()`select r.id, r.persona, r.desk, r.title, r.target->>'org' org, r.target->'talent' talent, r.evidence->'facts' facts,
    (r.evidence->'match'->>'score')::int ours
  from permission_requests r
  where r.evidence->'match' is not null and r.evidence->'match' <> 'null'::jsonb
    and (r.evidence->'match'->'qloo' is null or r.evidence->'match'->'qloo' = 'null'::jsonb)`) as Row[];

const sig = (name: string, type: EntityType) => ({ name, type });
/** Whose audience a card was about, and what kind of thing it pitched. */
async function sides(r: Row): Promise<{ signal: { name: string; type: EntityType }[]; target: { name: string; type: EntityType } } | null> {
  if (r.desk === "tour") return { signal: [sig(r.title.replace(/^Hold .+ for /, ""), "artist")], target: sig(r.org, "place") };
  if (r.persona === "twist-sponsorship") return { signal: [sig("This Week in Startups", "podcast")], target: sig(r.org, "brand") };
  if (r.persona === "cedric-brands" && r.desk === "talent") return { signal: [sig("Cedric the Entertainer", "person")], target: sig(r.org, "brand") };
  if (r.persona === "cedric-brands") return { signal: [sig("Cedric the Entertainer", "person"), sig("Anthony Anderson", "person")], target: sig(r.org, "brand") };
  if (r.desk === "venue") {
    const room = r.title.replace(/^.+ at /, "");
    const [v] = (await sql()`select profile->'recentActs' acts from venues where name = ${room} limit 1`) as { acts: string[] | null }[];
    return v?.acts?.length ? { signal: v.acts.slice(0, 6).map(a => sig(a, "artist")), target: sig(r.org, "brand") } : null;
  }
  // Qloo's sales seat: the brand was picked off a partner whose fans lean toward it ("X is evidence only").
  const partner = r.facts.map(f => /; (.+?) is evidence only/.exec(f)?.[1]).find(Boolean);
  if (partner) {
    for (const t of ["artist", "tv_show", "movie", "brand", "person"] as EntityType[]) if (await resolve(partner, t)) return { signal: [sig(partner, t)], target: sig(r.org, "brand") };
  }
  return null;
}

const c0 = qlooCallsMade();
let done = 0;
const skipped: string[] = [];
for (const r of rows) {
  const s = await sides(r);
  const sigs = s ? (await Promise.all(s.signal.map(x => resolve(x.name, x.type)))).filter((e): e is Ent => !!e) : [];
  const tgt = s ? await resolve(s.target.name, s.target.type) : null;
  if (!s || !sigs.length || !tgt) { skipped.push(`${r.title} (${!s ? "no audience on record" : !sigs.length ? `Qloo has no ${s.signal[0].name}` : `Qloo has no ${s.target.type} called "${s.target.name}"`})`); continue; }
  // Toward: the audience's lean toward the target. Back: the target's audience toward each member, averaged.
  const toward = (await affinities(sigs.map(x => x.id), [tgt.id], tgt.type)).get(tgt.id) ?? null;
  const backs = [...(await affinities([tgt.id], sigs.map(x => x.id), sigs[0].type)).values()].filter((v): v is number => v != null);
  const back = backs.length ? backs.reduce((a, b) => a + b, 0) / backs.length : null;
  console.log(`${r.title}: toward ${toward?.toFixed(2) ?? "n/a"}, back ${back?.toFixed(2) ?? "n/a"}, ours ${r.ours ?? "n/a"}/100`);
  if (toward == null || back == null) { skipped.push(`${r.title} (Qloo returned no number)`); continue; }
  done++;
  if (dry) continue;
  await sql()`update permission_requests set evidence = jsonb_set(evidence, '{match,qloo}', ${JSON.stringify({ toward: +toward.toFixed(3), back: +back.toFixed(3), band: "backfill" })}::jsonb)
    where id = ${r.id}`;
  if (r.ours != null) await sql()`insert into estimate_checks (source, a_id, b_id, a_name, b_name, ours, qloo_toward, qloo_back)
    values ('backfill', ${sigs.map(x => x.id).join("+")}, ${tgt.id}, ${sigs.map(x => x.name).join(" + ")}, ${tgt.name}, ${r.ours}, ${toward}, ${back})
    on conflict (source, a_id, b_id) do update set ours = excluded.ours, qloo_toward = excluded.qloo_toward, qloo_back = excluded.qloo_back, created_at = now()`;
}
console.log(`\n${done} of ${rows.length} cards measured${dry ? " (dry run, nothing written)" : ""} · ${qlooCallsMade() - c0} Qloo calls`);
if (skipped.length) console.log(`Not measured:\n  ${skipped.join("\n  ")}`);
