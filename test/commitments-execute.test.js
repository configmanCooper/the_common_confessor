/* The priest's summonses have to be carried out.
   An officer_duty and an authority_petition are aimed at a person, not at a
   neighbouring parish. The only branch that could resolve them looked their
   target up among the parishes, found nothing, and marked the errand failed -
   silently, so nothing ever said so. Thirteen of the eighteen commitments in a
   fourteen-day run were failed that way and none of them truly. These tests
   hold the two kinds to actually running. */

import test from "node:test";
import assert from "node:assert/strict";

import {
  createGame,
  executeDueCommitments,
  summonOfficer,
  petitionAuthority,
  availableOfficers
} from "../js/simulation.js";

function parish() {
  return createGame("commitments-execute");
}

/** The first person an officer could plausibly be sent about. */
function someoneToBeSentAbout(state, officer) {
  return state.residents.find((resident) => (
    resident.active && resident.alive && resident.id !== officer.id && resident.age >= 18
  ));
}

test("an officer sent out does not silently fail for want of a parish", () => {
  const state = parish();
  const officer = availableOfficers(state)[0];
  assert.ok(officer, "the parish should have an officer to send");
  const subject = someoneToBeSentAbout(state, officer);

  const sent = summonOfficer(state, {
    officerId: officer.id,
    subjectId: subject.id,
    purpose: "protect",
    reason: "There has been shouting at her door after dark."
  });
  assert.ok(sent, "the summons should be accepted");

  const commitment = state.commitments.find((entry) => entry.id === sent.commitmentId);
  assert.equal(commitment.status, "open");

  state.calendar.absoluteDay = commitment.dueDay;
  executeDueCommitments(state, null);

  assert.notEqual(
    commitment.status,
    "open",
    "a duty that has come due should be settled one way or the other"
  );
  assert.ok(
    commitment.fulfilledEventId,
    "however it went, the errand should leave a record of what came of it"
  );
});

test("what came of the errand reaches the chronicle and the priest", () => {
  const state = parish();
  const officer = availableOfficers(state)[0];
  const subject = someoneToBeSentAbout(state, officer);

  const sent = summonOfficer(state, {
    officerId: officer.id,
    subjectId: subject.id,
    purpose: "investigate",
    reason: "Grain is going from the store and nobody will say by whose hand."
  });
  const commitment = state.commitments.find((entry) => entry.id === sent.commitmentId);

  const chronicleBefore = state.chronicle.length;
  state.calendar.absoluteDay = commitment.dueDay;
  executeDueCommitments(state, null);

  assert.ok(
    state.chronicle.length > chronicleBefore,
    "the parish should have something to say about what the officer did"
  );

  const outcome = state.chronicle.find((entry) => entry.eventId === commitment.fulfilledEventId);
  assert.ok(outcome, "the outcome should be findable by the id the commitment kept");
  assert.ok(
    outcome.text.includes(subject.name),
    "the account should name the person the errand concerned"
  );

  /* The officer brings it back himself. Without this the priest sends the
     watch and never learns whether anything came of it. */
  const report = state.eventQueue.find((event) => (
    event.type === "resident_followup" && event.sourcePersonId === officer.id
  ));
  assert.ok(report, "the officer should return to report");
  assert.equal(report.payload.commitmentId, commitment.id);
  assert.equal(report.payload.concernedId, subject.id);
  assert.equal(typeof report.payload.kept, "boolean");
});

test("an errand is not called failed merely because its target is a person", () => {
  /* The specific regression. Every summons in a long run came back failed
     because the resolver only knew how to find neighbouring parishes. */
  const state = parish();
  const officer = availableOfficers(state)[0];
  const subject = someoneToBeSentAbout(state, officer);

  summonOfficer(state, { officerId: officer.id, subjectId: subject.id, purpose: "protect" });
  petitionAuthority(state, {
    role: "steward",
    subjectId: subject.id,
    matter: "The assessment against this household looks heavier than the roll allows."
  });

  const aimedAtPeople = state.commitments.filter((entry) => (
    entry.type === "officer_duty" || entry.type === "authority_petition"
  ));
  assert.equal(aimedAtPeople.length, 2);

  state.calendar.absoluteDay = Math.max(...aimedAtPeople.map((entry) => entry.dueDay));
  executeDueCommitments(state, null);

  assert.ok(
    aimedAtPeople.every((entry) => entry.status !== "open"),
    "both should have been taken up"
  );
  assert.ok(
    aimedAtPeople.some((entry) => entry.status === "fulfilled"),
    "they should not all come back failed the way they used to"
  );
});

test("a petition is completed by the message arriving, not by an answer", () => {
  /* The steward travels as a queued visit and speaks for himself when he gets
     here. What the commitment records is that the priest's word reached the
     manor, so it should not be reported as a failure while the man is on the
     road. */
  const state = parish();
  const subject = state.residents.find((resident) => resident.active && resident.alive);

  petitionAuthority(state, {
    role: "steward",
    subjectId: subject.id,
    matter: "A boundary is disputed and both households have stopped speaking."
  });
  const commitment = state.commitments.find((entry) => entry.type === "authority_petition");

  state.calendar.absoluteDay = commitment.dueDay;
  executeDueCommitments(state, null);

  assert.equal(commitment.status, "fulfilled");
  assert.ok(
    state.eventQueue.some((event) => event.type === "external_visit" && event.role === "steward"),
    "the steward should still be coming to answer in person"
  );
});

test("an errand about someone who has died is failed, and honestly", () => {
  const state = parish();
  const officer = availableOfficers(state)[0];
  const subject = someoneToBeSentAbout(state, officer);

  const sent = summonOfficer(state, { officerId: officer.id, subjectId: subject.id, purpose: "protect" });
  const commitment = state.commitments.find((entry) => entry.id === sent.commitmentId);

  subject.alive = false;
  subject.active = false;

  state.calendar.absoluteDay = commitment.dueDay;
  executeDueCommitments(state, null);

  assert.equal(commitment.status, "failed");
  assert.ok(
    !state.eventQueue.some((event) => (
      event.type === "resident_followup" && event.sourcePersonId === officer.id
    )),
    "there is nothing to report about an errand that could not begin"
  );
});

test("an officer with several errands reports on all of them, not one", () => {
  /* Officers are few and every duty falls due the next day, so a handful of
     outcomes land in one pass. The queue admits one visit per person, so the
     rest used to be dropped silently: the commitment was settled and the
     priest never learned of it. */
  const state = parish();
  const officer = availableOfficers(state)[0];
  const subjects = state.residents
    .filter((resident) => resident.active && resident.alive && resident.id !== officer.id && resident.age >= 18)
    .slice(0, 4);
  assert.equal(subjects.length, 4);

  for (const subject of subjects) {
    summonOfficer(state, { officerId: officer.id, subjectId: subject.id, purpose: "protect" });
  }
  const duties = state.commitments.filter((entry) => entry.type === "officer_duty");
  assert.equal(duties.length, 4);

  state.calendar.absoluteDay = duties[0].dueDay;
  executeDueCommitments(state, null);

  const reports = state.eventQueue.filter((event) => (
    event.type === "resident_followup" && event.sourcePersonId === officer.id
  ));
  assert.equal(reports.length, 1, "he can only come once");

  const carried = reports[0].payload.errands;
  assert.equal(carried.length, 4, "but he should carry every errand he was sent on");
  assert.deepEqual(
    carried.map((entry) => entry.concernedId).sort(),
    subjects.map((subject) => subject.id).sort()
  );
  for (const subject of subjects.slice(0, 3)) {
    assert.ok(
      reports[0].reason.includes(subject.name),
      `the report should name ${subject.name}`
    );
  }
});

test("a single errand still reads as one errand", () => {
  const state = parish();
  const officer = availableOfficers(state)[0];
  const subject = someoneToBeSentAbout(state, officer);

  const sent = summonOfficer(state, { officerId: officer.id, subjectId: subject.id, purpose: "investigate" });
  const commitment = state.commitments.find((entry) => entry.id === sent.commitmentId);
  state.calendar.absoluteDay = commitment.dueDay;
  executeDueCommitments(state, null);

  const report = state.eventQueue.find((event) => (
    event.type === "resident_followup" && event.sourcePersonId === officer.id
  ));
  assert.equal(report.payload.errands.length, 1);
  assert.ok(!report.reason.includes("several errands"));
  assert.ok(report.reason.includes(subject.name));
  /* The single-errand fields the follow-up already reads must survive the
     errands list being added beside them. */
  assert.equal(report.payload.concernedId, subject.id);
  assert.equal(report.payload.commitmentId, commitment.id);
});

test("the same errand is settled the same way twice over", () => {
  /* The outcome is drawn from the commitment's own id, so a replayed parish
     reaches the same result without it having to travel in the log. */
  const outcomes = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const state = parish();
    const officer = availableOfficers(state)[0];
    const subject = someoneToBeSentAbout(state, officer);
    const sent = summonOfficer(state, {
      officerId: officer.id,
      subjectId: subject.id,
      purpose: "investigate"
    });
    const commitment = state.commitments.find((entry) => entry.id === sent.commitmentId);
    state.calendar.absoluteDay = commitment.dueDay;
    executeDueCommitments(state, null);
    outcomes.push(commitment.status);
  }
  assert.equal(outcomes[0], outcomes[1]);
});
