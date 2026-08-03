import assert from "node:assert/strict";
import test from "node:test";
import { applyVisitOpening, beginVisit, createGame, replayGame } from "../js/simulation.js";
import {
  buildGeneratedScenarioArchetypes,
  GENERATED_SCENARIO_ARCHETYPE_COUNT
} from "../js/scenario_catalog.js";

test("scenario catalog contains at least one hundred generated archetypes", () => {
  assert.ok(GENERATED_SCENARIO_ARCHETYPE_COUNT >= 100, GENERATED_SCENARIO_ARCHETYPE_COUNT);
});

test("generated openings speak in the visitor's voice instead of narrating the visitor", () => {
  const scenarios = buildGeneratedScenarioArchetypes({
    person: "Radel Roseham",
    relation: "Odowyn Oakshaw",
    victim: "Anias Applecombe",
    official: "Oswyn Page",
    resource: "the common field",
    sum: 8,
    creditor: "Edwin Price",
    debtSum: 14,
    deadlineDays: 4
  });
  for (const scenario of scenarios) {
    assert.match(scenario.opening, /^(?:Father|Forgive|I\b|There\b|May\b|Something\b)/);
    assert.doesNotMatch(scenario.opening, /\bRadel Roseham\b/);
  }
  const grain = scenarios.find((scenario) => scenario.id === "embezzled_grain_2");
  assert.match(grain.opening, /I diverted 8 sacks of grain/i);
  assert.match(grain.opening, /my own household will feel the loss/i);
});

test("scenario variants add a related practical stake rather than an unrelated debt", () => {
  const scenarios = buildGeneratedScenarioArchetypes({
    person: "Radel Roseham",
    relation: "Odowyn Oakshaw",
    victim: "Anias Applecombe",
    official: "Oswyn Page",
    resource: "the common field",
    sum: 8,
    creditor: "Edwin Price",
    debtSum: 14,
    deadlineDays: 10
  });
  const grain = scenarios.find((scenario) => scenario.id === "embezzled_grain_2");
  assert.match(grain.blueprint.pressure, /Radel Roseham's household bears material risk/i);
  assert.doesNotMatch(grain.blueprint.pressure, /owes 14 silver pennies/i);
  assert.match(grain.blueprint.mechanism, /inventory now points suspicion/i);
});

test("AI-written openings persist through canonical replay", () => {
  const state = createGame("ai-opening-replay");
  const visit = beginVisit(state);
  const opening = "Father, I have turned this over all night, and each answer seems to leave someone hungry. I need you to hear what happened before fear makes the choice for me.";
  applyVisitOpening(state, opening, "ai");
  assert.equal(visit.history[0].text, opening);
  const replayed = replayGame(state.seed, state.commandLog, state.replayBase);
  assert.equal(replayed.currentVisit.history[0].text, opening);
  assert.equal(replayed.commandLog[0].source, "ai");
  assert.equal(replayed.aiProposals.length, 1);
});

test("consecutive visitors avoid recently used scenario archetypes", () => {
  const state = createGame("scenario-rotation");
  const seen = [];
  for (let index = 0; index < 14; index += 1) {
    if (state.calendar.dayIndex === 6) {
      state.calendar.absoluteDay += 1;
      state.calendar.dayIndex = state.calendar.absoluteDay % 7;
      state.calendar.week = Math.floor(state.calendar.absoluteDay / 7) + 1;
    }
    const visit = beginVisit(state);
    const scenarioId = visit.issue.scenarioId;
    assert.ok(scenarioId);
    assert.ok(!seen.slice(-10).includes(scenarioId), `${scenarioId} repeated too soon`);
    seen.push(scenarioId);
    const thread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
    if (thread) thread.status = "resolved";
    state.currentVisit = null;
    state.calendar.slot = (state.calendar.slot + 1) % 4;
    if (state.calendar.slot === 0) {
      state.calendar.absoluteDay += 1;
      state.calendar.dayIndex = state.calendar.absoluteDay % 7;
      state.calendar.week = Math.floor(state.calendar.absoluteDay / 7) + 1;
    }
  }
  assert.ok(new Set(seen).size >= 11);
});

test("first-visitor generation spans many fundamentally different scenarios", () => {
  const ids = new Set();
  const openings = new Set();
  for (let index = 0; index < 120; index += 1) {
    const state = createGame(`scenario-breadth-${index}`);
    const visit = beginVisit(state);
    ids.add(visit.issue.scenarioId);
    openings.add(visit.history[0].text);
    assert.doesNotMatch(visit.history[0].text, /share in (?:sexton|soldier|child laborer|unemployed) work/i);
  }
  assert.ok(ids.size >= 35, ids.size);
  assert.ok(openings.size >= 110, openings.size);
});

test("scenario facts always provide concrete consequences and an alternative", () => {
  for (let index = 0; index < 50; index += 1) {
    const state = createGame(`scenario-facts-${index}`);
    const visit = beginVisit(state);
    assert.ok(visit.scenarioFacts.length >= 4);
    assert.ok(visit.scenarioFacts.some((fact) => fact.id === "stakes"));
    assert.ok(visit.scenarioFacts.some((fact) => fact.id === "alternative"));
    assert.ok(visit.scenarioFacts.every((fact) => fact.text.length > 25));
  }
});

test("every generated family exposes a normalized blueprint and separate mechanical facts", () => {
  const scenarios = buildGeneratedScenarioArchetypes({
    town: "Alderwick",
    person: "Radel Roseham",
    relation: "Odowyn Oakshaw",
    victim: "Anias Applecombe",
    official: "Oswyn Page",
    resource: "the common field",
    sum: 8,
    creditor: "Edwin Price",
    debtSum: 14,
    deadlineDays: 6,
    occupation: "peddler",
    age: 30,
    relationOccupation: "merchant"
  });
  for (const scenario of scenarios) {
    assert.ok(scenario.blueprint);
    assert.ok(scenario.blueprint.mechanism.length > 30);
    assert.ok(scenario.blueprint.responseDomains.length >= 2);
    assert.ok(scenario.factRecords.some((fact) => fact.id === "mechanism" && fact.speakable));
    assert.ok(scenario.factRecords.some((fact) => fact.category === "mechanical" && !fact.speakable));
    assert.doesNotMatch(scenario.opening, /direct practical stake|matter reached me through|decision is expected within/i);
  }
});

test("armed-company and sickness rumors are separate scenario families", () => {
  const scenarios = buildGeneratedScenarioArchetypes({
    town: "Alderwick",
    person: "Radel Roseham",
    relation: "Odowyn Oakshaw",
    victim: "Anias Applecombe",
    official: "Oswyn Page",
    resource: "the south road",
    sum: 8,
    creditor: "Edwin Price",
    debtSum: 14,
    deadlineDays: 6,
    occupation: "peddler",
    age: 30,
    relationOccupation: "merchant"
  });
  const armed = scenarios.find((scenario) => scenario.id === "panic_rumor_armed_1");
  const sickness = scenarios.find((scenario) => scenario.id === "panic_rumor_sickness_1");
  assert.ok(armed && sickness);
  assert.match(armed.blueprint.mechanism, /banner|armed travelers/i);
  assert.doesNotMatch(armed.opening, /plague|pestilence|sickness/i);
  assert.match(sickness.blueprint.mechanism, /infected travelers|symptom/i);
  assert.doesNotMatch(sickness.opening, /soldiers|armed company|invasion/i);
});

test("fallback openings avoid framework provenance and artificial deadline language", () => {
  for (let index = 0; index < 120; index += 1) {
    const state = createGame(`natural-fallback-opening-${index}`);
    const visit = beginVisit(state);
    assert.doesNotMatch(
      visit.issue.opening,
      /matter reached me through my household, work, travel|direct practical stake|decision is expected within|advice on the choice itself/i
    );
  }
});
