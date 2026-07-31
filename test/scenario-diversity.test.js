import assert from "node:assert/strict";
import test from "node:test";
import { beginVisit, createGame } from "../js/simulation.js";
import { GENERATED_SCENARIO_ARCHETYPE_COUNT } from "../js/scenario_catalog.js";

test("scenario catalog contains at least one hundred generated archetypes", () => {
  assert.ok(GENERATED_SCENARIO_ARCHETYPE_COUNT >= 100, GENERATED_SCENARIO_ARCHETYPE_COUNT);
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
