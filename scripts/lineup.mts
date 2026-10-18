// npm run lineup -- "Severance|The Bear|Hacks|The White Lotus"   -> brands for this lineup's combined audience
import { composite } from "../lib/lineup";
const r = await composite((process.argv[2] ?? "").split("|").map(s => s.trim()).filter(Boolean));
console.log(`measured by Qloo: ${r.measured.join(", ") || "none"}${r.missing.length ? ` | not in the corpus yet: ${r.missing.join(", ")}` : ""}`);
for (const b of r.brands.slice(0, 12))
  console.log(`  ${b.name.padEnd(32)} reaches ${b.reach}/${r.measured.length}  ` + b.hits.map(h => `${h.member} ${h.toward.toFixed(2)}/${h.back.toFixed(2)}`).join("  "));
console.log("shared cities:", r.sharedCities.slice(0, 8).map(c => `${c.city} (${c.members})`).join(", "));
