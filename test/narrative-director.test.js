import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceNarrativeDirector,
  beginVisit,
  createGame,
  executeDueCommitments,
  fallbackConversation,
  fallbackDeparturePlan,
  finishVisit,
  recordExchange
} from "../js/simulation.js";
import { compactReplayHistory, serializeState } from "../js/state.js";

function prepareReliefChoice(state) {
  const thread = state.narrativeThreads[0];
  const parish = state.neighboringParishes.find((entry) => entry.id === thread.neighborParishId);
  state.calendar.absoluteDay = 7;
  state.calendar.dayIndex = 0;
  state.calendar.week = 2;
  state.calendar.slot = 0;
  state.material.foodSecurity = 75;
  state.churchResources.grain = 20;
  state.priest.localTrust = 70;
  state.pacing.lastMajorDay = -999;
  parish.pressures.food = 90;
  thread.pressure = 90;
  thread.stage = "pressure";
  thread.status = "active";
  return { thread, parish };
}

test("new campaigns contain three causal neighboring parish seeds", () => {
  const state = createGame("neighboring-parish-seeds");
  assert.equal(state.neighboringParishes.length, 3);
  assert.equal(state.narrativeThreads.filter((thread) => thread.type === "external_relief_request").length, 3);
  for (const parish of state.neighboringParishes) {
    assert.ok(parish.priestName.startsWith("Father "));
    assert.match(parish.stewardName, /Steward/);
    assert.match(parish.lordName, /Lord|Lady/);
    assert.ok(parish.travelDays >= 1 && parish.travelDays <= 4);
  }
  assert.ok(state.narrativeThreads.every((thread) => thread.causeEventIds.length >= 1));
});

test("relief requests require home capacity and become a named external visit", () => {
  const blocked = createGame("neighbor-relief-blocked");
  const blockedSetup = prepareReliefChoice(blocked);
  blocked.material.foodSecurity = 30;
  advanceNarrativeDirector(blocked, blocked.events.at(-1).id);
  assert.equal(blocked.eventQueue.some((event) => event.role === "neighbor_priest"), false);

  const state = createGame("neighbor-relief-choice");
  const { thread, parish } = prepareReliefChoice(state);
  advanceNarrativeDirector(state, state.events.at(-1).id);
  const request = state.eventQueue.find((event) => event.role === "neighbor_priest");
  assert.ok(request);
  assert.equal(request.payload.neighborParishId, parish.id);
  assert.equal(thread.stage, "choice");
  state.calendar.absoluteDay = request.dueDay;
  state.calendar.dayIndex = request.dueDay % 7;
  state.calendar.week = Math.floor(request.dueDay / 7) + 1;
  const visit = beginVisit(state);
  const visitor = state.externalActors.find((person) => person.id === visit.personId);
  assert.equal(visitor.role, "neighbor_priest");
  assert.equal(visitor.name, parish.priestName);
  assert.match(visit.issue.opening, new RegExp(parish.name));
  assert.ok(visit.scenarioFacts.some((fact) => fact.id === "authority"));
  assert.ok(visit.scenarioFacts.some((fact) => fact.id === "timeline"));
});

test("promised grain is reserved, delivered once after travel, and changes the thread", () => {
  const state = createGame("neighbor-relief-delivery");
  const { parish } = prepareReliefChoice(state);
  advanceNarrativeDirector(state, state.events.at(-1).id);
  const request = state.eventQueue.find((event) => event.role === "neighbor_priest");
  state.calendar.absoluteDay = request.dueDay;
  state.calendar.dayIndex = request.dueDay % 7;
  state.calendar.week = Math.floor(request.dueDay / 7) + 1;
  const visit = beginVisit(state);
  const beforeGrain = state.churchResources.grain;
  const promise = "We will give your church four sacks of grain.";
  /* The words send a delegation; the grain goes because it was handed over.
     Aid used to be read out of the priest's speech and taken straight from the
     stores, which is how a priest who had refused alms lost a dose of medicine
     to the man in front of him - the same fault, aimed at a parish. */
  const response = fallbackConversation(state, promise);
  response.churchGifts = [{ resource: "grain", amount: 4 }];
  recordExchange(state, promise, response);
  const commitment = state.commitments.find((entry) => entry.targetId === parish.id && entry.status === "open");
  assert.ok(commitment);
  assert.equal(commitment.type, "neighbor_relief_resource");
  assert.equal(state.churchResources.grain, beforeGrain - 4);
  finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
  state.calendar.absoluteDay = commitment.dueDay;
  state.calendar.dayIndex = commitment.dueDay % 7;
  state.calendar.week = Math.floor(commitment.dueDay / 7) + 1;
  executeDueCommitments(state, state.events.at(-1).id);
  assert.equal(commitment.status, "fulfilled");
  assert.equal(parish.status, "aided");
  assert.ok(state.chronicle.some((entry) => entry.title === `Aid reaches ${parish.name}`));
  const chronicleCount = state.chronicle.length;
  executeDueCommitments(state, state.events.at(-1).id);
  assert.equal(state.chronicle.length, chronicleCount);
  compactReplayHistory(state);
  assert.doesNotThrow(() => serializeState(state));
});

test("the priest may refuse a neighboring appeal without creating travel or aid", () => {
  const state = createGame("neighbor-relief-refusal");
  const { thread, parish } = prepareReliefChoice(state);
  advanceNarrativeDirector(state, state.events.at(-1).id);
  const request = state.eventQueue.find((event) => event.role === "neighbor_priest");
  state.calendar.absoluteDay = request.dueDay;
  state.calendar.dayIndex = request.dueDay % 7;
  state.calendar.week = Math.floor(request.dueDay / 7) + 1;
  beginVisit(state);
  const refusal = "We cannot spare grain, and I refuse this request.";
  recordExchange(state, refusal, fallbackConversation(state, refusal));
  assert.equal(state.commitments.some((entry) => entry.targetId === parish.id && entry.status === "open"), false);
  assert.equal(parish.status, "aid_declined");
  assert.equal(thread.stage, "resolved");
});

test("a promise to a neighbouring parish sends a delegation, not the grain", () => {
  /* The same fault as the phantom alms, aimed at a parish instead of at the
     man in front of the priest: aid was read out of his words and taken
     straight from the stores. Words send someone to look; only what is handed
     over is carried there. */
  const state = createGame("neighbor-relief-words-only");
  const { parish } = prepareReliefChoice(state);
  advanceNarrativeDirector(state, state.events.at(-1).id);
  const request = state.eventQueue.find((event) => event.role === "neighbor_priest");
  state.calendar.absoluteDay = request.dueDay;
  state.calendar.dayIndex = request.dueDay % 7;
  state.calendar.week = Math.floor(request.dueDay / 7) + 1;
  beginVisit(state);
  const beforeGrain = state.churchResources.grain;
  const promise = "We will give your church four sacks of grain.";
  recordExchange(state, promise, fallbackConversation(state, promise));
  assert.equal(state.churchResources.grain, beforeGrain, "speech alone emptied the stores");
  const commitment = state.commitments.find((entry) => entry.targetId === parish.id && entry.status === "open");
  if (commitment) {
    assert.equal(
      commitment.type,
      "neighbor_relief_assessment",
      "a promise alone should send a delegation, not goods"
    );
  }
});
