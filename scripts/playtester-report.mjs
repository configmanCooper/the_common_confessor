/* A report on what the playtesting priest found.
 *
 * The AiHumanPlaytester checks every answer against the parish record and
 * records each contradiction beside the words that produced it. This turns that
 * log into something readable: what was claimed, what the record actually
 * holds, who said it, and whether the guards in front of the model caught it
 * before it reached the player.
 *
 *   node scripts/playtester-report.mjs exports/playtester-v2/run-playtester.log.json
 */

import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/playtester-report.mjs <run-playtester.log.json>");
  process.exit(1);
}

const log = JSON.parse(readFileSync(path, "utf8"));
const findings = log.recordAudit || [];
const visits = log.log || [];
const turns = log.turns || 0;

const guards = {};
let exchanges = 0;
for (const visit of visits) {
  for (const exchange of visit.exchanges || []) {
    if (exchange.priest === undefined && exchange.visitor === undefined) continue;
    exchanges += 1;
    for (const transformation of exchange.transformations || []) {
      guards[transformation] = (guards[transformation] || 0) + 1;
    }
  }
}

const line = (label, value) => console.log(`${String(label).padEnd(46)}${value}`);

console.log("THE COMMON CONFESSOR — what the playtesting priest found");
console.log("=".repeat(70));
line("days played", `${log.daysPlayed} of ${log.days}`);
line("spoken exchanges", exchanges);
line("model failures", log.agentFailures);
line("illegal moves refused", log.refusedMoves);
console.log("");

console.log("CONTRADICTIONS BETWEEN DIALOGUE AND THE PARISH RECORD");
console.log("-".repeat(70));
line("total found", findings.length);
line("as a share of spoken turns", `${turns ? (findings.length / turns * 100).toFixed(1) : "0.0"}%`);
const byKind = {};
for (const finding of findings) byKind[finding.kind] = (byKind[finding.kind] || 0) + 1;
for (const [kind, count] of Object.entries(byKind).sort((left, right) => right[1] - left[1])) {
  line(`  ${kind.replace(/_/g, " ")}`, count);
}
if (!findings.length) {
  console.log("  Nothing. Every claim the record could settle matched it.");
}
console.log("");

if (findings.length) {
  console.log("EVERY CONTRADICTION, IN THE WORDS THAT PRODUCED IT");
  console.log("-".repeat(70));
  for (const finding of findings) {
    console.log(`day ${finding.day} — ${finding.visitor}${finding.whenSaid === "opening" ? " (opening words)" : ""}`);
    console.log(`  said : ${String(finding.said).slice(0, 150)}`);
    console.log(`  claim: ${finding.claim}`);
    console.log(`  truth: ${finding.truth}`);
    console.log("");
  }
}

console.log("GUARDS IN FRONT OF THE MODEL");
console.log("-".repeat(70));
if (!Object.keys(guards).length) {
  console.log("  None fired.");
}
for (const [name, count] of Object.entries(guards).sort((left, right) => right[1] - left[1])) {
  line(`  ${name.replace(/_/g, " ")}`, count);
}
console.log("");

/* A contradiction that survived every guard is the one that matters: it means
   the layered defence let something reach the player. */
const survived = findings.length;
const caught = (guards.ungrounded_detail_regeneration || 0)
  + (guards.invented_villager_stripped || 0);
console.log("VERDICT");
console.log("-".repeat(70));
line("ungrounded details the guards caught", caught);
line("contradictions that still reached the player", survived);
console.log(
  survived === 0
    ? "  The parish never contradicted its own record in front of the player."
    : "  Some contradictions survived every guard. Each is listed above."
);
