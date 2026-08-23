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

/* 11. Did the simulation's numbers actually move?
   This is the part a transcript cannot tell you. Every value sampled during
   the run is compared start against end; anything that never moved is either
   unreachable through play or quietly broken. */
const snapshots = data.snapshots || [];
if (snapshots.length >= 2) {
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const movement = {};
  const stuck = [];

  const walk = (a, b, path) => {
    for (const key of Object.keys(a || {})) {
      const left = a[key];
      const right = b?.[key];
      const label = path ? `${path}.${key}` : key;
      if (left && typeof left === "object") {
        walk(left, right || {}, label);
        continue;
      }
      if (typeof left !== "number") continue;
      const delta = Number(((right ?? left) - left).toFixed(2));
      movement[label] = { start: left, end: right ?? left, delta };
      const everMoved = snapshots.some((entry) => {
        const value = label.split(".").reduce((node, part) => node?.[part], entry);
        return typeof value === "number" && value !== left;
      });
      if (!everMoved) stuck.push(label);
    }
  };
  walk(
    { churchStores: first.churchStores, priest: first.priest, town: first.town, population: first.population, counts: first.counts },
    { churchStores: last.churchStores, priest: last.priest, town: last.town, population: last.population, counts: last.counts },
    ""
  );

  report.stateMovement = movement;
  report.neverMoved = stuck;
  report.daysSampled = last.day - first.day;
  if (stuck.length) {
    findings.push(`${stuck.length} tracked values never changed across ${last.day - first.day} days: ${stuck.slice(0, 12).join(", ")}${stuck.length > 12 ? "…" : ""}`);
  }
  const spentStores = Object.entries(last.churchStores)
    .filter(([key, value]) => value < first.churchStores[key]).length;
  if (!spentStores) {
    findings.push("The church stores were never drawn down; charity is either unreachable or unattractive.");
  }
} else {
  report.stateMovement = "no snapshots in this run";
}

/* 12. Were the individual people actually changed by any of it?
   Averages across two hundred villagers hide everything. What matters is
   whether the person who sat down with the priest, and the third parties they
   named, were measurably different afterwards. */
const tracked = data.trackedPeople || [];
if (tracked.length) {
  const compare = (person) => {
    const fields = ["stress", "health", "faith", "trustPriest", "memories", "relationships", "wealth", "food"];
    const moved = fields.filter((field) => (
      typeof person.start?.[field] === "number"
      && typeof person.end?.[field] === "number"
      && person.start[field] !== person.end[field]
    ));
    return moved;
  };
  const rows = tracked.map((person) => ({
    name: person.name,
    why: person.why,
    changed: compare(person)
  }));
  const visitors = rows.filter((row) => row.why === "visited the priest");
  const thirdParties = rows.filter((row) => row.why !== "visited the priest");
  const untouchedVisitors = visitors.filter((row) => !row.changed.length);
  const untouchedThirdParties = thirdParties.filter((row) => !row.changed.length);

  report.people = {
    tracked: rows.length,
    visitors: visitors.length,
    thirdParties: thirdParties.length,
    visitorsUnchanged: untouchedVisitors.length,
    thirdPartiesUnchanged: untouchedThirdParties.length,
    fieldsThatMoved: rows.reduce((totals, row) => {
      for (const field of row.changed) totals[field] = (totals[field] || 0) + 1;
      return totals;
    }, {}),
    examples: rows.slice(0, 8)
  };

  if (untouchedVisitors.length) {
    findings.push(`${untouchedVisitors.length} of ${visitors.length} people who spoke with the priest ended the fortnight completely unchanged: ${untouchedVisitors.slice(0, 5).map((row) => row.name).join(", ")}.`);
  }
  if (thirdParties.length && untouchedThirdParties.length === thirdParties.length) {
    findings.push(`None of the ${thirdParties.length} third parties named in conversation were affected at all; consequences are not reaching people who were talked about.`);
  }
}

report.findings = findings;

console.log(JSON.stringify(report, null, 2));
console.log("\n=== FINDINGS ===");
if (!findings.length) console.log("Nothing above threshold.");
for (const finding of findings) console.log(`- ${finding}`);
