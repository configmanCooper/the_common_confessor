import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  createGame,
  dailyAppointmentLimit,
  fallbackDeparturePlan,
  finishVisit,
  recordExchange,
  requestVisits
} from "../js/simulation.js";
import { deserializeState, sealState, serializeState } from "../js/state.js";

function finishCurrentVisit(state) {
  const visit = beginVisit(state);
  recordExchange(state, "Thank you. Consider the honest course carefully.", {
    reply: "I will consider it, Father.",
    memory: "The priest urged an honest course."
  });
  finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
  return visit;
}

function advanceToTuesday(state) {
  while (state.calendar.absoluteDay === 0) finishCurrentVisit(state);
  assert.equal(state.calendar.absoluteDay, 1);
}

test("requested visits unlock on the second day and allow four named villagers", () => {
  const state = createGame("requested-visits-day-two");
  assert.throws(() => requestVisits(state, [state.residents[0].id]), /second day/i);
  advanceToTuesday(state);
  const candidates = state.residents.slice(0, 4);
  for (const person of candidates) {
    person.trustPriest = 100;
    person.attendanceChance = 100;
    person.stress = 0;
    person.illness = null;
  }
  const results = requestVisits(state, candidates.map((person) => person.id), "Discuss the tax assessment.");
  assert.equal(results.length, 4);
  assert.ok(results.every((result) => ["accepted", "declined"].includes(result.status)));
  assert.ok(results.some((result) => result.status === "accepted"));
  assert.throws(() => requestVisits(state, [state.residents[5].id]), /at most four/i);
  assert.doesNotThrow(() => serializeState(state));
});

test("accepted requested visitors come after the four ordinary appointments", () => {
  const state = createGame("requested-visits-extra-hours");
  advanceToTuesday(state);
  const candidates = state.residents.slice(0, 4);
  for (const person of candidates) {
    person.trustPriest = 100;
    person.attendanceChance = 100;
    person.stress = 0;
    person.illness = null;
  }
  const results = requestVisits(state, candidates.map((person) => person.id), "Discuss parish work.");
  const acceptedIds = results.filter((result) => result.status === "accepted").map((result) => result.personId);
  assert.ok(acceptedIds.length > 0);
  assert.equal(dailyAppointmentLimit(state), 4 + acceptedIds.length);
  for (let index = 0; index < 4; index += 1) finishCurrentVisit(state);
  assert.equal(state.calendar.absoluteDay, 1);
  assert.equal(state.calendar.slot, 4);
  const requestedVisit = beginVisit(state);
  assert.equal(requestedVisit.personId, acceptedIds[0]);
  assert.equal(requestedVisit.issue.requestedByPriest, true);
  assert.doesNotThrow(() => serializeState(state));
});

test("some future appointments arise from consequences involving other villagers", () => {
  let queued = false;
  for (let index = 0; index < 30 && !queued; index += 1) {
    const state = createGame(`causal-followup-${index}`);
    beginVisit(state);
    recordExchange(state, "Report this to the reeve and seek justice.", {
      reply: "I will make the report.",
      memory: "The priest urged a report."
    });
    finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
    queued = state.eventQueue.some((event) => event.type === "resident_followup");
  }
  assert.equal(queued, true);
});

test("schema-11 parishes gain requested-visit scheduling state", () => {
  const legacy = createGame("requested-visit-migration");
  delete legacy.visitRequests;
  delete legacy.nextVisitRequestSequence;
  legacy.schemaVersion = 11;
  legacy.version = 11;
  sealState(legacy);
  const migrated = deserializeState(JSON.stringify(legacy));
  assert.equal(migrated.schemaVersion, 12);
  assert.deepEqual(migrated.visitRequests, []);
  assert.equal(migrated.nextVisitRequestSequence, 1);
});
