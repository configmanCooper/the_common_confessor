import assert from "node:assert/strict";
import test from "node:test";
import {
  applySermon,
  beginVisit,
  createGame,
  fallbackDeparturePlan,
  fallbackSermonOutcome,
  finishVisit,
  materializeResident,
  recordExchange
} from "../js/simulation.js";
import { compactReplayHistory, deserializeState, sealState, serializeState } from "../js/state.js";
import { completeGeneratedText } from "../js/text.js";

function finishQuietly(state) {
  beginVisit(state);
  finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
}

function configureWellVisit(state) {
  const visit = state.currentVisit;
  const thread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
  visit.issue.scenarioId = "contaminated_well_2";
  visit.issue.kind = "village concern";
  visit.issue.detail = "Several households became ill after drawing from the common well.";
  visit.issue.opening = "Several households became ill after drawing from the common well.";
  visit.scenarioFacts = [{
    id: "concrete_matter",
    text: visit.issue.detail,
    anchors: ["households", "ill", "well"],
    issueId: thread.id,
    provenance: "state",
    confidence: 100,
    visibility: thread.visibility,
    allowedSpeakers: [visit.personId]
  }];
  thread.scenarioId = visit.issue.scenarioId;
  thread.kind = visit.issue.kind;
  thread.summary = visit.issue.detail;
  return { visit, thread };
}

test("generated prose ends at a complete sentence instead of a hard character cutoff", () => {
  const text = "Elria explains the risk of the well. She organizes carried water from a known-clean spring, promising to coordinate shifts and";
  const clipped = completeGeneratedText(text, 110);
  assert.match(clipped, /(?:\.|!|\?|\.\.\.)$/);
  assert.doesNotMatch(clipped, /\band$/);
});

test("carried-water promises become concrete persistent well remediation", () => {
  const state = createGame("carried-water-regression");
  beginVisit(state);
  const { visit, thread } = configureWellVisit(state);
  const pressureBefore = thread.pressure;
  const healthBefore = state.town.metrics.health;
  finishVisit(state, {
    source: "ai",
    summary: "Elria organizes a temporary clean-water effort.",
    steps: [{
      actorId: visit.personId,
      targetId: null,
      actionType: "improvise",
      intensity: 3,
      title: "Arrange Carried Water",
      description: "Elria explains the risk of the well and organizes water from a known-clean spring. She promises to coordinate shifts and",
      detail: "",
      motive: "practical",
      evidence: "She promised the priest she would arrange carried water."
    }]
  });
  const command = state.commandLog.at(-1);
  assert.equal(command.payload.plan.steps[0].actionType, "secure_clean_water");
  assert.equal(command.payload.evaluation.normalizations.some((entry) => entry.reason === "scenario_grounded_water_action"), true);
  assert.ok(state.material.modifiers.diseasePressure < 0);
  assert.ok(state.town.metrics.health > healthBefore);
  assert.ok(thread.pressure < pressureBefore);
  assert.equal(thread.visibility.scope, "public");
  assert.ok(thread.publicAwareness >= 18);
  assert.match(state.chronicle[0].text, /\.$/);
  assert.doesNotMatch(state.chronicle[0].text, /\band$/);
});

test("custom Gemma effects are bounded and applied only to improvised actions", () => {
  const state = createGame("bounded-custom-effects");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const harmonyBefore = state.town.metrics.harmony;
  const moraleBefore = person.morale;
  finishVisit(state, {
    source: "ai",
    summary: "The visitor organizes a modest neighborhood watch.",
    steps: [{
      actorId: person.id,
      targetId: null,
      actionType: "improvise",
      intensity: 2,
      title: "Organize a lantern watch",
      description: "The visitor asks nearby households to take turns watching the lane after dark.",
      detail: "organize a rotating lantern watch",
      motive: "practical",
      evidence: "The priest urged a peaceful practical response.",
      effects: [
        { scope: "town", key: "harmony", delta: 1, reason: "Neighbors cooperate." },
        { scope: "actor", key: "morale", delta: 1, reason: "The visitor has a workable plan." },
        { scope: "material", key: "crime", delta: -1, reason: "A visible watch discourages petty theft." }
      ]
    }]
  });
  assert.ok(state.town.metrics.harmony > harmonyBefore);
  assert.ok(person.morale > moraleBefore);
  assert.equal(state.material.modifiers.crime, -2);

  const invalid = createGame("invalid-custom-effects");
  const invalidVisit = beginVisit(invalid);
  finishVisit(invalid, {
    source: "ai",
    summary: "An invalid custom resource effect.",
    steps: [{
      actorId: invalidVisit.personId,
      targetId: null,
      actionType: "improvise",
      intensity: 2,
      title: "Invent grain",
      description: "The visitor creates grain from nothing.",
      detail: "invent grain",
      motive: "practical",
      evidence: "None.",
      effects: [{ scope: "material", key: "grain", delta: 3, reason: "Invented resources." }]
    }]
  });
  const invalidCommand = invalid.commandLog.at(-1);
  assert.equal(invalidCommand.payload.evaluation.submittedRejection, null);
  assert.deepEqual(invalidCommand.payload.plan.steps[0].effects, []);
  assert.equal(
    invalidCommand.payload.evaluation.normalizations.some((entry) => entry.reason === "bounded_custom_effects"),
    true
  );
});

test("completed appointments retain exact transcripts, audits, plans, and causal events through compaction", () => {
  const state = createGame("visit-archive-regression");
  const visit = beginVisit(state);
  const opening = visit.history[0].text;
  recordExchange(state, "Warn the households and arrange carried water from the clean spring.", {
    reply: "I will warn them and organize the carried water, Father.",
    memory: "The visitor agreed to arrange clean water."
  });
  recordExchange(state, "Go with God.", {
    reply: "Thank you, Father. I will go now.",
    memory: "The meeting ended with a blessing."
  });
  finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
  const archive = state.visitArchive.at(-1);
  assert.equal(archive.history[0].text, opening);
  assert.deepEqual(
    archive.history.map((line) => line.text),
    [
      opening,
      "Warn the households and arrange carried water from the clean spring.",
      "I will warn them and organize the carried water, Father.",
      "Go with God.",
      "Thank you, Father. I will go now."
    ]
  );
  assert.equal(archive.turnAudits.length, 2);
  assert.equal(archive.acceptedPlan.steps.length >= 1, true);
  assert.equal(archive.eventIds.every((eventId) => state.events.some((event) => event.id === eventId)), true);
  const summary = state.residents.find((person) => person.id === visit.personId).memories
    .find((memory) => memory.type === "visit_summary");
  assert.match(summary.summary, /arrange carried water/i);
  assert.doesNotMatch(summary.summary, /Go with God/i);

  compactReplayHistory(state);
  const restored = deserializeState(serializeState(state));
  const restoredArchive = restored.visitArchive.at(-1);
  assert.deepEqual(restoredArchive.history, archive.history);
  assert.equal(restoredArchive.eventIds.every((eventId) => restored.events.some((event) => event.id === eventId)), true);
});

test("daily and weekly reports cover every displayed value and all named effects", () => {
  const state = createGame("period-report-regression");
  while (state.calendar.absoluteDay === 0) finishQuietly(state);
  const monday = state.periodReports.find((report) => report.type === "day" && report.endDay === 0);
  assert.ok(monday);
  assert.equal(monday.metrics.length, 23);
  assert.deepEqual(
    [...new Set(monday.metrics.map((metric) => metric.group))],
    ["Village", "Father Benedict", "Church stores", "Parish"]
  );
  assert.ok(monday.visits.length >= 4);
  assert.ok(monday.affectedPeople.length >= 4);
  assert.deepEqual(
    state.periodTracking.dayStart.metrics.map((metric) => metric.value),
    monday.metrics.map((metric) => metric.end)
  );

  while (state.calendar.dayIndex !== 6) finishQuietly(state);
  const outcome = fallbackSermonOutcome(state, "Mercy", "Show mercy, share burdens, and protect the weak.");
  applySermon(state, "Mercy", "Show mercy, share burdens, and protect the weak.", outcome);
  const sunday = state.periodReports.find((report) => report.type === "day" && report.endDay === 6);
  const week = state.periodReports.find((report) => report.type === "week" && report.week === 1);
  assert.ok(sunday);
  assert.ok(week);
  assert.equal(week.metrics.length, 23);
  assert.ok(week.summaries.some((entry) => entry.type === "sermon_delivered"));
  assert.ok(sunday.affectedPeople.length > 0);
  assert.equal(state.calendar.week, 2);
});

test("schema-14 saves gain partial report baselines without fabricated history", () => {
  const legacy = createGame("reporting-schema-14");
  delete legacy.visitArchive;
  delete legacy.periodReports;
  delete legacy.periodTracking;
  delete legacy.nextPeriodReportSequence;
  delete legacy.material.modifiers;
  legacy.schemaVersion = 14;
  legacy.version = 14;
  sealState(legacy);
  const migrated = deserializeState(JSON.stringify(legacy));
  assert.equal(migrated.schemaVersion, 17);
  assert.deepEqual(migrated.visitArchive, []);
  assert.deepEqual(migrated.periodReports, []);
  assert.equal(migrated.periodTracking.dayStart.partial, true);
  assert.equal(migrated.periodTracking.weekStart.partial, true);
});
