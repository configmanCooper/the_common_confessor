import assert from "node:assert/strict";
import test from "node:test";
import {
  advancePriestStanding,
  availableOfficers,
  beginVisit,
  createGame,
  patronConnections,
  petitionAuthority,
  summonOfficer
} from "../js/simulation.js";
import { legalMoves } from "../js/agent.js";
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

test("sending the same officer on the same errand twice does not double the watch", () => {
  const state = createGame("summons-dedup");
  state.calendar.absoluteDay = 1;
  beginVisit(state);
  const visit = state.currentVisit;
  const officers = availableOfficers(state);
  const subject = state.residents.find((person) => person.id === visit.personId);
  const officer = officers.find((entry) => entry.id !== subject.id);
  assert.ok(officer, "the parish should have an officer to send");

  const first = summonOfficer(state, { officerId: officer.id, subjectId: subject.id, purpose: "protect", reason: "keep the peace" });
  assert.ok(first, "the first summons should go out");
  const repeat = summonOfficer(state, { officerId: officer.id, subjectId: subject.id, purpose: "protect", reason: "saying it again" });
  assert.equal(repeat, null, "he is already going; saying it again must not stack");

  const different = summonOfficer(state, { officerId: officer.id, subjectId: subject.id, purpose: "investigate", reason: "a separate errand" });
  assert.ok(different, "a genuinely different errand should still be possible");

  const duties = state.commitments.filter((entry) => entry.type === "officer_duty" && entry.status === "open");
  assert.equal(duties.length, 2, "one errand each, not one per time it was asked for");
});

test("an errand already under way is not offered to the priest again", () => {
  const state = createGame("summons-moves");
  state.calendar.absoluteDay = 1;
  beginVisit(state);
  const visit = state.currentVisit;
  const subject = state.residents.find((person) => person.id === visit.personId);
  const officer = availableOfficers(state).find((entry) => entry.id !== subject.id);
  assert.ok(officer);

  const before = legalMoves(state).filter((move) => (
    move.kind === "summon_officer" && move.officerId === officer.id && move.subjectId === subject.id
  ));
  assert.ok(before.length > 0, "the move should be available to begin with");

  summonOfficer(state, { officerId: officer.id, subjectId: subject.id, purpose: "protect", reason: "keep the peace" });
  const after = legalMoves(state).filter((move) => (
    move.kind === "summon_officer" && move.officerId === officer.id && move.subjectId === subject.id
  ));
  assert.ok(!after.some((move) => move.purpose === "protect"), "the errand under way should no longer be offered");
});

/* The zealot promised "if he refuses, I shall send the watchman" about a man
   who was neither his visitor nor the person the visit was filed under, and the
   game had no way to let him keep that promise: the watch could only ever be
   sent to two people. */
test("the watch can be sent to anyone the matter concerns, not only the visitor", () => {
  let widened = 0;
  for (let index = 0; index < 8; index += 1) {
    const state = createGame(`summons-reach-${index}`);
    beginVisit(state);
    const visit = state.currentVisit;
    const thread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
    if (!thread || thread.subjectIds.length <= 2) continue;

    const reachable = new Set(
      legalMoves(state).filter((move) => move.kind === "summon_officer").map((move) => move.subjectId)
    );
    const officerIds = new Set(availableOfficers(state).map((officer) => officer.id));
    const expected = thread.subjectIds.filter((id) => {
      const person = state.residents.find((entry) => entry.id === id);
      return person?.active && person.alive && !officerIds.has(id);
    });

    for (const id of expected.slice(0, 4)) {
      assert.ok(reachable.has(id), `a subject of the matter was out of the watch's reach in parish ${index}`);
    }
    if (reachable.size > 2) widened += 1;
  }
  assert.ok(widened > 0, "no parish exercised a matter with more than two people in it");
});

test("summonses never crowd out the rest of the priest's choices", () => {
  for (let index = 0; index < 8; index += 1) {
    const state = createGame(`summons-bound-${index}`);
    beginVisit(state);
    const moves = legalMoves(state);
    const summonses = moves.filter((move) => move.kind === "summon_officer");
    assert.ok(summonses.length <= 16, `${summonses.length} summonses offered at once`);
    assert.ok(moves.some((move) => move.kind === "speak"), "speaking must always remain on the table");
  }
});

test("the watch is never sent to a dead or departed villager", () => {
  const state = createGame("summons-dead");
  beginVisit(state);
  const visit = state.currentVisit;
  const thread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
  const other = (thread?.subjectIds || []).find((id) => id !== visit.personId);
  if (!other) return;
  const person = state.residents.find((entry) => entry.id === other);
  person.alive = false;
  person.active = false;
  const reachable = legalMoves(state)
    .filter((move) => move.kind === "summon_officer")
    .map((move) => move.subjectId);
  assert.ok(!reachable.includes(other), "the watch was offered a dead man to visit");
});
