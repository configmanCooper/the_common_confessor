import assert from "node:assert/strict";
import test from "node:test";
import {
  advancePriestStanding,
  availableOfficers,
  beginVisit,
  createGame,
  fallbackConversation,
  fallbackDeparturePlan,
  finishVisit,
  letterRecipients,
  patronConnections,
  petitionAuthority,
  recordExchange,
  sendLetter,
  summonOfficer
} from "../js/simulation.js";
import { legalMoves } from "../js/agent.js";
import { appendEvent, deserializeState, serializeState } from "../js/state.js";

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

/* -------------------------------------------------------------- letters --- */

function letterScene(seed) {
  const state = createGame(seed);
  /* Someone the priest has actually met, so there is a person to write to. */
  for (let index = 0; index < 3; index += 1) {
    beginVisit(state);
    const line = "Tell me what troubles you.";
    recordExchange(state, line, { ...fallbackConversation(state, line), source: "fallback" });
    finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
  }
  return state;
}

test("the priest may only write to people he could actually reach", () => {
  const state = letterScene("letters-who");
  const { villagers, outside } = letterRecipients(state);
  assert.ok(villagers.length > 0, "he has met people and should be able to write to them");
  for (const entry of villagers) {
    const person = state.residents.find((row) => row.id === entry.id);
    assert.ok(person.active && person.alive, "a letter was offered to someone gone from the parish");
    assert.ok(person.age >= 14, "a letter was offered to a child");
  }
  /* The manor always; the diocese only once it has taken notice. */
  assert.deepEqual(outside.map((entry) => entry.id).sort(), ["lord", "steward"]);
});

test("what a letter says decides what it does", () => {
  const state = letterScene("letters-tone");
  const target = letterRecipients(state).villagers[0];
  const before = state.residents.find((row) => row.id === target.id).trustPriest;

  const kind = sendLetter(state, {
    recipientKind: "villager", recipientId: target.id,
    text: "Come and sit with me this week; you need not speak if you would rather not.",
    reading: { tone: "kind", asks: "visit", summary: "An invitation to grieve." }
  });
  assert.ok(kind, "a plain letter should send");
  const afterKind = state.residents.find((row) => row.id === target.id).trustPriest;
  assert.ok(afterKind > before, "a kind letter should warm them to him");

  const other = letterRecipients(state).villagers[1];
  const otherBefore = state.residents.find((row) => row.id === other.id).trustPriest;
  sendLetter(state, {
    recipientKind: "villager", recipientId: other.id,
    text: "Restore what you took, or I shall name you from the pulpit.",
    reading: { tone: "threatening", asks: "act", summary: "A threat of public shaming." }
  });
  const person = state.residents.find((row) => row.id === other.id);
  assert.ok(person.trustPriest < otherBefore, "a threatening letter should cost him their trust");
  assert.ok(person.stress > 50, "and should frighten them");
});

test("writing to the manor brings the manor", () => {
  const state = letterScene("letters-manor");
  const result = sendLetter(state, {
    recipientKind: "external", recipientId: "lord",
    text: "My lord, a family is being put off land they have held three generations.",
    reading: { tone: "pleading", asks: "act", summary: "An eviction the steward will not address." }
  });
  assert.ok(result.comingInDays >= 1, "the lord should be on his way");
  assert.ok(
    state.eventQueue.some((event) => event.type === "external_visit" && event.role === "lord"),
    "a visit from the lord should be queued"
  );
});

test("a letter to nobody, or an empty letter, does nothing", () => {
  const state = letterScene("letters-bounds");
  assert.equal(sendLetter(state, { recipientKind: "villager", recipientId: "person-999", text: "Hello." }), null);
  assert.equal(sendLetter(state, { recipientKind: "villager", recipientId: letterRecipients(state).villagers[0].id, text: "   " }), null);
  assert.equal(sendLetter(state, { recipientKind: "nonsense", recipientId: "lord", text: "Hello." }), null);
});

test("letters, summonses and petitions all survive a reload", () => {
  const state = letterScene("letters-replay");
  const officers = availableOfficers(state);
  const target = letterRecipients(state).villagers.find((entry) => (
    officers.every((officer) => officer.id !== entry.id)
  ));

  sendLetter(state, {
    recipientKind: "villager", recipientId: target.id,
    text: "Come to me before Sunday.",
    reading: { tone: "plain", asks: "visit", summary: "A summons to the church." }
  });
  sendLetter(state, {
    recipientKind: "external", recipientId: "steward",
    text: "The mill road is impassable and the carts cannot pass.",
    reading: { tone: "plain", asks: "act", summary: "A broken road." }
  });
  summonOfficer(state, { officerId: officers[0].id, subjectId: target.id, purpose: "protect", reason: "keep the peace" });
  petitionAuthority(state, { role: "lord", subjectId: target.id, matter: "a disputed tenancy" });

  const restored = deserializeState(serializeState(state));
  assert.deepEqual(
    restored.commandLog.map((command) => command.type).filter((type) => (
      ["send_letter", "summon_officer", "petition_authority"].includes(type)
    )),
    ["send_letter", "send_letter", "summon_officer", "petition_authority"]
  );
  assert.equal(
    restored.commitments.filter((entry) => entry.type === "officer_duty").length,
    state.commitments.filter((entry) => entry.type === "officer_duty").length,
    "the watch was sent a different number of times on replay"
  );
  assert.equal(
    restored.events.filter((event) => event.type === "letter_sent").length,
    state.events.filter((event) => event.type === "letter_sent").length,
    "letters were duplicated or lost on replay"
  );
});

test("a summons made during a conversation is not also sent a second time", () => {
  const state = createGame("summons-single");
  beginVisit(state);
  const visit = state.currentVisit;
  const officer = availableOfficers(state).find((entry) => entry.id !== visit.personId);
  const line = "I will see that no harm comes to you.";
  recordExchange(state, line, {
    ...fallbackConversation(state, line),
    source: "fallback",
    officerSummons: [{ officerId: officer.id, subjectId: visit.personId, purpose: "protect", reason: "safety" }]
  });
  const duties = state.commitments.filter((entry) => entry.type === "officer_duty");
  assert.equal(duties.length, 1, "the officer was sent more than once for one instruction");
  /* It travels inside the conversation command, not as a command of its own. */
  assert.ok(!state.commandLog.some((command) => command.type === "summon_officer"));
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});
