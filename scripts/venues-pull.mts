// npm run venues:pull -- out.json "San Juan" "El Paso" ...   -> concert rooms within 30 km of each metro, from Wikidata
// (the 18 Oct pull for the first 50 metros used the same query). Then: npm run venues -- import out.json
import { writeFileSync } from "node:fs";
import { METROS } from "../lib/geo";

const KINDS = ["Q8719053", "Q1060829", "Q641226", "Q483110", "Q181623", "Q24354", "Q622425", "Q11707"]; // music venue, concert hall, arena, stadium, amphitheatre, theatre, nightclub, (restaurant excluded below)
const [out, ...names] = process.argv.slice(2);
const rows: Record<string, unknown>[] = [];
for (const name of names) {
  const m = METROS.find(x => x[0] === name);
  if (!m) { console.log(`no metro "${name}"`); continue; }
  const q = `SELECT ?v ?vLabel ?cap ?opLabel ?ownLabel ?site ?coord ?cc (GROUP_CONCAT(DISTINCT ?kLabel; separator=", ") AS ?kinds) WHERE {
    SERVICE wikibase:around { ?v wdt:P625 ?coord. bd:serviceParam wikibase:center "Point(${m[2]} ${m[1]})"^^geo:wktLiteral. bd:serviceParam wikibase:radius "30". }
    ?v wdt:P31 ?k. VALUES ?k { ${KINDS.slice(0, 7).map(k => `wd:${k}`).join(" ")} }
    OPTIONAL { ?v wdt:P1083 ?cap. } OPTIONAL { ?v wdt:P137 ?op. } OPTIONAL { ?v wdt:P127 ?own. } OPTIONAL { ?v wdt:P856 ?site. } OPTIONAL { ?v wdt:P17 ?c. ?c wdt:P297 ?cc. }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,es". ?v rdfs:label ?vLabel. ?op rdfs:label ?opLabel. ?own rdfs:label ?ownLabel. ?k rdfs:label ?kLabel. }
  } GROUP BY ?v ?vLabel ?cap ?opLabel ?ownLabel ?site ?coord ?cc`;
  const r = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { "user-agent": "SYZYGY venue pull (https://syzygybot.com)" } });
  const j = await r.json() as { results: { bindings: Record<string, { value: string }>[] } };
  const seen = new Set<string>();
  for (const b of j.results.bindings) {
    const id = b.v.value.split("/").pop()!;
    if (seen.has(id) || /^Q\d+$/.test(b.vLabel?.value ?? "")) continue;
    seen.add(id);
    rows.push({ id, name: b.vLabel.value, metro: name, capacity: b.cap ? Math.round(Number(b.cap.value)) : null, operator: b.opLabel?.value ?? null,
      owner: b.ownLabel?.value ?? null, site: b.site?.value ?? null, kinds: b.kinds?.value ?? "", coord: b.coord.value, country: b.cc?.value ?? null });
  }
  console.log(`${name}: ${seen.size} rooms`);
}
writeFileSync(out, JSON.stringify(rows, null, 1));
