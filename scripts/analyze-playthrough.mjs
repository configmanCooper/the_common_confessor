/* Read a watched playthrough and report what is wrong with the game.
 *
 * A fortnight of play produces far more dialogue than anyone will read, and
 * the faults worth fixing are the ones that only appear at that length:
 * lines the framework wrote instead of the model, sentences repeated across
 * different visitors, scenario prose reaching the screen verbatim, systems
 * nobody ever touched, and visits that end without anything being decided.
 *
 *   node scripts/analyze-playthrough.mjs exports/watch-ai-....log.json
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function newestLog() {
  const dir = join(root, "exports");
  const files = readdirSync(dir).filter((name) => name.endsWith(".log.json")).sort();
  if (!files.length) throw new Error("no playthrough logs in exports/");
  return join(dir, files[files.length - 1]);
}

const logPath = process.argv[2] || newestLog();
const data = JSON.parse(readFileSync(logPath, "utf8"));
const visits = data.log.filter((entry) => entry.kind === "visit");
const sermons = data.log.filter((entry) => entry.kind === "sermon");
const exchanges = visits.flatMap((visit) => (visit.exchanges || []).filter((entry) => entry.visitor));

function normalize(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function overlap(a, b) {
  const left = new Set(normalize(a).split(" ").filter((word) => word.length > 3));
  const right = normalize(b).split(" ").filter((word) => word.length > 3);
  if (!left.size || !right.length) return 0;
  return right.filter((word) => left.has(word)).length / Math.max(left.size, right.length);
}

const findings = [];
const report = {
  source: logPath,
  model: data.model,
  seed: data.seed,
  days: data.days,
  minutes: Math.round(data.elapsedMs / 60000),
  visits: visits.length,
  sermons: sermons.length,
  exchanges: exchanges.length,
  agentCalls: data.agentCalls,
  refusedMoves: data.refusedMoves,
  agentFailures: data.agentFailures
};

/* 1. How often did the framework speak instead of the model? */
const bySource = {};
for (const exchange of exchanges) bySource[exchange.source] = (bySource[exchange.source] || 0) + 1;
report.replySource = bySource;
const frameworkWritten = exchanges.filter((entry) => (
  entry.source === "scripted_reaction" || entry.source === "framework_emergency_fallback" || entry.source === "fallback"
)).length;
report.frameworkWrittenShare = exchanges.length
  ? Number((frameworkWritten / exchanges.length).toFixed(3))
  : 0;
if (report.frameworkWrittenShare > 0.05) {
  findings.push(`The framework wrote ${(report.frameworkWrittenShare * 100).toFixed(1)}% of visible replies; it should be rare.`);
}

/* 2. Transformations applied to model prose. */
const transformCounts = {};
for (const exchange of exchanges) {
  for (const type of exchange.transformations || []) {
    transformCounts[type] = (transformCounts[type] || 0) + 1;
  }
}
report.transformations = transformCounts;

/* 3. Scenario prose reaching the screen verbatim. */
const REPORTY = [
  /no formal deadline is known/i,
  /a decision is expected within/i,
  /the matter reached me through/i,
  /household has a direct practical stake/i,
  /response domains?:/i,
  /the immediate need is/i,
  /^i can carry a message to a named person/i,
  /any plan must account for/i
];
const reporty = exchanges.filter((entry) => REPORTY.some((pattern) => pattern.test(entry.visitor)));
report.frameworkProseLines = reporty.length;
if (reporty.length) {
  findings.push(`${reporty.length} visitor lines read as scenario notes rather than speech, e.g. "${reporty[0].visitor.slice(0, 110)}"`);
}

/* 4. Stray formatting the player should never see. */
const formatting = exchanges.filter((entry) => (
  /^["'\u201c]/.test(entry.visitor.trim())
  || /\*/.test(entry.visitor)
  || /\b(?:VISITOR|PRIEST)\s*[—:-]/.test(entry.visitor)
  || /[a-z]{4,}[A-Z][a-z]{3,}/.test(entry.visitor)
));
report.formattingArtifacts = formatting.length;
if (formatting.length) {
  findings.push(`${formatting.length} replies carried stray formatting, e.g. "${formatting[0].visitor.slice(0, 90)}"`);
}

/* 5. Repetition, both within a visit and across different visitors. */
let withinVisit = 0;
for (const visit of visits) {
  const lines = (visit.exchanges || []).map((entry) => entry.visitor).filter(Boolean);
  for (let i = 1; i < lines.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (overlap(lines[i], lines[j]) >= 0.7) { withinVisit += 1; break; }
    }
  }
}
report.repeatedWithinVisit = withinVisit;
if (withinVisit > visits.length * 0.5) {
  findings.push(`${withinVisit} visitor lines closely repeated an earlier line in the same visit.`);
}

const openings = visits.map((visit) => visit.opening).filter(Boolean);
let similarOpenings = 0;
for (let i = 1; i < openings.length; i += 1) {
  for (let j = 0; j < i; j += 1) {
    if (overlap(openings[i], openings[j]) >= 0.6) { similarOpenings += 1; break; }
  }
}
report.similarOpenings = similarOpenings;
if (similarOpenings > openings.length * 0.25) {
  findings.push(`${similarOpenings} of ${openings.length} visitors opened in nearly the same words.`);
}

/* 6. Variety of situations the parish actually produced. */
const issues = {};
for (const visit of visits) issues[visit.issue] = (issues[visit.issue] || 0) + 1;
report.issueKinds = issues;
const commonest = Object.entries(issues).sort((a, b) => b[1] - a[1])[0];
if (commonest && commonest[1] > visits.length * 0.35) {
  findings.push(`"${commonest[0]}" was ${Math.round(commonest[1] / visits.length * 100)}% of all visits; the parish feels repetitive.`);
}
const locations = {};
for (const visit of visits) locations[visit.location] = (locations[visit.location] || 0) + 1;
report.locations = locations;

/* 7. Did the priest's generosity actually reach anyone? */
const gifts = exchanges.filter((entry) => entry.churchGift);
report.giftsGiven = gifts.length;
report.giftedResources = gifts.reduce((totals, entry) => {
  totals[entry.churchGift.resource] = (totals[entry.churchGift.resource] || 0) + entry.churchGift.amount;
  return totals;
}, {});

/* 8. Visits that simply ran out of turns without a decision. */
const ranOut = visits.filter((visit) => (visit.exchanges || []).length >= 10 && !visit.endedBecause);
report.visitsThatRanOutOfTurns = ranOut.length;
if (ranOut.length > visits.length * 0.5) {
  findings.push(`${ranOut.length} of ${visits.length} visits used every turn without the priest choosing to close; the ten-turn hour may be too long, or closing is unattractive.`);
}

/* 9. Sermon variety. */
report.sermonThemes = sermons.reduce((totals, entry) => {
  totals[entry.theme] = (totals[entry.theme] || 0) + 1;
  return totals;
}, {});

/* 10. Did the model understand the priest, turn by turn? */
const noUnderstanding = exchanges.filter((entry) => !entry.understoodAs).length;
report.repliesWithoutInterpretation = noUnderstanding;

report.findings = findings;

console.log(JSON.stringify(report, null, 2));
console.log("\n=== FINDINGS ===");
if (!findings.length) console.log("Nothing above threshold.");
for (const finding of findings) console.log(`- ${finding}`);
