import assert from "node:assert/strict";
import test from "node:test";
import {
  advancePriestStanding,
  availableOfficers,
  createGame,
  patronConnections,
  petitionAuthority,
  summonOfficer
} from "../js/simulation.js";
import { appendEvent } from "../js/state.js";

/* The village has a watch, a bailiff and a reeve, and behind them a steward
   and a lord who holds four other villages from a castle half a day east.
   Watched play had a priest sending for a "constable" that did not exist, so
   these are the acts he can really perform, and the ladder that carries word
   in and out of the parish. */

function workedParish(seed, { households = 14, resolved = 8 } = {}) {
  const state = createGame(seed);
  for (const [index, person] of state.residents.slice(0, households).entries()) {
    for (let gift = 0; gift < 3; gift += 1) {
      appendEvent(state, { type: "church_aid_given", actorId: "priest", targetId: person.id, facts: {} });
    }
    if (index < 8) {
      appendEvent(state, { type: "officer_summoned", actorId: "priest", targetId: person.id, facts: { purpose: "protect" } });
    }
  }
  for (let index = 0; index < resolved; index += 1) {
    state.issueThreads.push({
      id: `thread-${index}`,
      status: "resolved",
      subjectIds: [],
      summary: "settled",
      pressure: 0,
      danger: 0,
      sourceVisitIds: [],
      causeEventIds: [],
      lastTouchedDay: 0
    });
  }
  return state;
}

test("the village has real law officers, and no constable", () => {
  const state = createGame("officers-exist");
  const officers = availableOfficers(state);
  assert.ok(officers.length > 0);
  for (const officer of officers) {
    assert.ok(["watchman", "bailiff", "reeve"].includes(officer.occupation));
  }
  assert.equal(state.residents.some((person) => person.occupation === "constable"), false);
});

test("sending the watch to protect someone really changes the parish", () => {
  const state = createGame("summon-protect");
  const officer = availableOfficers(state)[0];
  const subject = state.residents.find((person) => person.id !== officer.id && person.active);
  const stressBefore = subject.stress;
  const safetyBefore = state.town.metrics.safety;
  const result = summonOfficer(state, {
    officerId: officer.id,
    subjectId: subject.id,
    purpose: "protect",
    reason: "a crowd may gather"
  });
  assert.ok(result);
  assert.ok(subject.stress < stressBefore, "the person was not steadied");
  assert.ok(state.town.metrics.safety > safetyBefore);
  assert.equal(state.events.filter((event) => event.type === "officer_summoned").length, 1);
  assert.equal(state.commitments.filter((entry) => entry.type === "officer_duty").length, 1);
  assert.ok(subject.memories.some((memory) => /came at the priest/i.test(memory.summary)));
});

test("the steward answers within a day and the lord takes three", () => {
  const state = createGame("petition-both");
  const steward = petitionAuthority(state, { role: "steward", matter: "a boundary on the common" });
  assert.equal(steward.travelDays, 1);
  const lord = petitionAuthority(state, { role: "lord", matter: "armed men threaten a widow" });
  assert.equal(lord.travelDays, 3);
  assert.ok(state.eventQueue.some((event) => event.type === "external_visit" && event.role === "steward"));
  assert.ok(state.eventQueue.some((event) => event.type === "external_visit" && event.role === "lord"));
  assert.equal(petitionAuthority(state, { role: "lord", matter: "again" }).alreadySent, true);
  assert.equal(petitionAuthority(state, { role: "king" }), null);
});

test("recognition is earned by weight of real work, and stops at each rung", () => {
  const state = workedParish("recognition-ladder");
  petitionAuthority(state, { role: "steward", matter: "m" });
  const first = advancePriestStanding(state, null);
  assert.equal(first.kind, "commendation");
  assert.equal(first.role, "archdeacon");
  assert.ok(state.eventQueue.some((event) => event.role === "archdeacon"));
  // The same work does not earn it twice.
  state.eventQueue.length = 0;
  const again = advancePriestStanding(state, null);
  assert.notEqual(again?.role, "archdeacon");
});

test("a parish under a cloud is never commended", () => {
  const state = workedParish("recognition-blocked");
  state.priest.scandal = 70;
  const outcome = advancePriestStanding(state, null);
  assert.notEqual(outcome?.kind, "commendation");
});

test("disgrace climbs its own ladder and can end in deprivation", () => {
  const state = createGame("judgement-ladder");
  state.priest.scandal = 85;
  state.outsideAttention.church = 40;
  for (let index = 0; index < 4; index += 1) {
    state.priestReports.push({
      id: `report-${index}`,
      status: "submitted",
      reporterId: state.residents[index].id,
      auditIds: [],
      eventIds: [],
      affectedPeople: [],
      eligibleRecipients: ["bishop"]
    });
  }
  for (const person of state.residents.slice(0, 25)) person.trustPriest = 5;
  const steps = [];
  for (let index = 0; index < 3; index += 1) {
    state.eventQueue.length = 0;
    steps.push(advancePriestStanding(state, null));
  }
  assert.equal(steps[0].role, "archdeacon");
  assert.equal(steps[1].role, "bishop");
  assert.equal(steps[2].kind, "deprived");
  assert.equal(state.priest.deprived, true);
  assert.ok(state.events.some((event) => event.type === "priest_deprived"));
});

test("a villager driven past ruin may come for the priest in the night", () => {
  const state = createGame("night-attack");
  state.priest.scandal = 60;
  const desperate = state.residents.find((person) => person.active && person.alive && person.age >= 25);
  desperate.trustPriest = 2;
  desperate.stress = 95;
  state.relationships.push({ actorId: desperate.id, targetId: "priest", affection: 1, trust: 1, tension: 90 });
  const outcome = advancePriestStanding(state, null);
  assert.equal(outcome.kind, "attempt");
  assert.ok(state.priest.health < 100);
  assert.ok(state.events.some((event) => event.type === "priest_attacked_in_the_night"));
  assert.ok(state.eventQueue.some((event) => event.role === "sheriff"));
});

test("a child is never the one who comes in the night", () => {
  const state = createGame("night-attack-child");
  state.priest.scandal = 60;
  const child = state.residents.find((person) => person.active && person.alive && person.age < 16);
  assert.ok(child, "no child in the parish to test with");
  child.trustPriest = 2;
  child.stress = 95;
  state.relationships.push({ actorId: child.id, targetId: "priest", affection: 1, trust: 1, tension: 90 });
  const outcome = advancePriestStanding(state, null);
  assert.notEqual(outcome?.kind, "attempt");
});

test("an ordinary parish sees no dramatic event at all", () => {
  const state = createGame("quiet-parish");
  for (let day = 0; day < 5; day += 1) {
    assert.equal(advancePriestStanding(state, null), null, "something dramatic happened in a quiet parish");
  }
});

test("villagers with standing outside the village carry word either way", () => {
  const state = createGame("patron-word");
  const links = patronConnections(state);
  assert.ok(links.length > 0);
  assert.ok(links.every((link) => ["steward", "archdeacon", "lord"].includes(link.role)));
  const link = links[0];
  state.residents.find((person) => person.id === link.personId).trustPriest = 90;
  const outcome = advancePriestStanding(state, null);
  assert.equal(outcome.kind, "patron_word");
  assert.equal(outcome.warm, true);
  assert.ok(state.eventQueue.some((event) => event.role === link.role));
  assert.ok(state.chronicle.some((entry) => /good word carried/i.test(entry.title)));
});
