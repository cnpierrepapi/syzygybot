import { handlesInHtml, wikidataHandles } from "../lib/handles";
import { score } from "../lib/rubric";

const html = `<a href="https://www.netflix.com/browse">x</a><a href="https://twitter.com/A24">t</a>
<a href="https://x.com/intent/tweet?text=hi">s</a><a href="https://x.com/blumhouse">b</a>`;
console.log("html handles:", handlesInHtml(html));

for (const site of ["https://a24films.com", "https://www.blumhouse.com"]) {
  try { const r = await fetch(site, { headers: { "user-agent": "SyzygyBot/0.1" } }); console.log(site, r.status, handlesInHtml(await r.text())); }
  catch (e) { console.log(site, "ERR", (e as Error).message); }
}
console.log("wikidata Q16248298:", await wikidataHandles("Q16248298").catch(e => e.message));

// 2 Oct live numbers: A24 -> Phoebe Bridgers 0.942, back 0.848.
const base = { sameType: false, sameIndustry: null, popA: 0.9, popB: 0.8, listSize: 50, tagsA: ["indie", "melancholy", "film"], tagsB: ["indie", "melancholy", "folk"],
  ageA: { a: 0.3, b: 0.1, c: -0.2 }, ageB: { a: 0.2, b: 0.2, c: -0.3 }, cellsA: ["dr5r", "9q5c"], cellsB: ["dr5r", "c23n"], momentumA: null, momentumB: 0.1 };
const s1 = score({ ...base, pullAB: 0.942, pullBA: 0.848, rankBinA: 30, rankAinB: null });
console.log("A24×Phoebe", s1.band, s1.score.toFixed(3), Object.fromEntries(Object.entries(s1.dims).map(([k, v]) => [k, +v.score.toFixed(2)])));
const s2 = score({ ...base, sameType: true, pullAB: 0.733, pullBA: 0.733, rankBinA: 4, rankAinB: 6 });
console.log("Patagonia×LiquidDeath", s2.band, s2.score.toFixed(3), s2.gate);

// Writer hard rules and the Verifier's page test (13 Oct).
import { writerChecks } from "../lib/outreach";
import { judgePerson } from "../lib/contacts";
import { pageBacking } from "../lib/web";
const ok = (name: string, cond: boolean) => { console.log(cond ? "PASS" : "FAIL", name); if (!cond) process.exitCode = 1; };
const good = "I am Syzygy, an AI agent. This is built on Qloo's taste data. A24 fans show 0.94 affinity.";
ok("writer: good draft passes", Object.values(writerChecks(good, "Subject")).every(Boolean));
ok("writer: posing as Qloo fails", !writerChecks(good + " We at Qloo would love to help.", "x").not_posing_as_qloo);
ok("writer: no AI disclosure fails", !writerChecks("Hello there. ".repeat(30) + "I am an AI agent.", "x").discloses_ai);
ok("writer: em dash fails", !writerChecks(good + " — really", "x").no_em_dash);
ok("writer: affinity as a percentage fails", !writerChecks(good + " 91% of fans like you.", "x").no_percentages);
const page = (text: string, date: string | null, url = "https://trade.example/a") => ({ url, status: 200, text, date, emails: [] });
const recent = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
ok("verifier: confirmed", judgePerson([page("A24 named Graham Retzik its head of marketing.", recent)], "Graham Retzik", "Head of Marketing", "A24", "a24films.com").status === "confirmed");
ok("verifier: old page is stale", judgePerson([page("A24 named Graham Retzik its head of marketing.", "2019-01-01")], "Graham Retzik", "Head of Marketing", "A24", "a24films.com").status === "stale");
ok("verifier: own site counts undated", judgePerson([page("Graham Retzik, Head of Marketing, A24", null, "https://a24films.com/team")], "Graham Retzik", "Head of Marketing", "A24", "a24films.com").status === "confirmed");
ok("verifier: name without company fails", judgePerson([page("Graham Retzik spoke about marketing.", recent)], "Graham Retzik", "Head of Marketing", "A24", null).status === "unconfirmed");
ok("strategist: trigger backed", !!pageBacking([page("Duolingo and Taco Bell launch a global partnership for Taco Day with Duo sauce", recent)], "Duolingo", "Duolingo and Taco Bell launch a global marketing partnership for Taco Day"));
ok("strategist: unrelated page rejected", !pageBacking([page("Duolingo reports quarterly earnings", recent)], "Duolingo", "Duolingo and Taco Bell launch a global marketing partnership for Taco Day"));

// Sequencer windows and caps, Inbox answer rules (13 Oct).
import { nextSlot, addBusinessDays, inWindow, local, DAILY_CAP } from "../lib/sequencer";
import { answerChecks } from "../lib/inbox";
const fresh = () => ({ perDay: new Map<string, number>(), perCompanyDay: new Set<string>() });
const fri = new Date("2026-10-16T20:00:00Z"); // Friday evening UTC
const rome = nextSlot(fri, "Europe/Rome", "x", fresh());
ok("sequencer: Friday rolls to Tuesday 09:00 Rome", local(rome, "Europe/Rome").weekday === "Tue" && local(rome, "Europe/Rome").minutes === 540);
const la = nextSlot(fri, "America/Los_Angeles", "x", fresh());
ok("sequencer: LA slot is inside LA hours", inWindow(la, "America/Los_Angeles") && !inWindow(la, "Europe/Rome"));
const b = fresh(); const q1 = nextSlot(fri, "Europe/Rome", "acme", b), q2 = nextSlot(fri, "Europe/Rome", "acme", b);
ok("sequencer: one per company per day", local(q1, "Europe/Rome").date !== local(q2, "Europe/Rome").date);
const c = fresh(); let last = fri;
for (let i = 0; i <= DAILY_CAP; i++) last = nextSlot(fri, "Europe/Rome", `co${i}`, c);
ok("sequencer: daily cap pushes the 21st to another day", last.toISOString().slice(0, 10) !== q1.toISOString().slice(0, 10));
ok("sequencer: 4 business days from Thu is Wed", local(addBusinessDays(new Date("2026-10-22T08:00:00Z"), 4, "Europe/Rome"), "Europe/Rome").weekday === "Wed");
ok("inbox: good answer passes", Object.values(answerChecks("Thanks. Built on Qloo's taste data, A24 fans score Glossier at 0.81. Syzygy (an AI agent)")).every(Boolean));
ok("inbox: percentage fails", !answerChecks("Syzygy (an AI agent): 81% of fans").no_percentages);

// Source list and sweep helpers (14 Oct).
import { SOURCES, groupsFor } from "../lib/sources";
import { searchName } from "../lib/sweep";
ok("sources: 500+ unique domains listed", new Set(SOURCES.map(s => s.domain)).size >= 500);
ok("sources: no LinkedIn", !SOURCES.some(s => s.domain.includes("linkedin")));
ok("groups: skincare is beauty, not auto", groupsFor("brand", ["Skincare", "Beauty"]).includes("beauty") && !groupsFor("brand", ["Skincare", "Beauty"]).includes("auto"));
ok("groups: one red-carpet tag doesn't add film", !groupsFor("brand", ["Fashion", "Luxury brands", "Footwear", "Red Carpet Events"]).includes("film_tv"));
ok("groups: Italian brand gets EU trade press", groupsFor("brand", ["Clothing brands of Italy", "Fashion"]).includes("regional_eu"));
ok("sweep: club suffix dropped", searchName("Real Madrid CF") === "Real Madrid" && searchName("Nike, Inc.") === "Nike" && searchName("A24") === "A24");

// Readable addresses (14 Oct).
import { slugify, token, isUuid } from "../lib/slug";
ok("slug: accents, ampersand, apostrophes", slugify("Dolce & Gabbana") === "dolce-and-gabbana" && slugify("Begoña Sanz") === "begona-sanz" && slugify("Levi's") === "levis");
ok("slug: Ray-Ban x Bad Bunny", slugify("Bad Bunny x Ray-ban") === "bad-bunny-x-ray-ban");
ok("slug: opt-out token is short, random, not a uuid", token().length === 8 && token() !== token() && !isUuid(token()));
