import assert from "node:assert/strict";
import test from "node:test";
import {
  applySermon,
  beginVisit,
  createGame,
  fallbackSermonOutcome,
  recordExchange,
  sundayAttendanceReport
} from "../js/simulation.js";
import { resolveCongregationReactions, sermonConsistency } from "../js/parish.js";

test("Sunday reports explain notable absences", () => {
  const state = createGame("attendance-reasons");
  state.calendar.absoluteDay = 6;
  state.calendar.dayIndex = 6;
  const sick = state.residents[0];
  sick.illness = "fever";
  sick.health = 20;
  const report = sundayAttendanceReport(state);
  assert.equal(report.find((entry) => entry.person.id === sick.id).reason, "too ill to attend");
  const chance = sick.attendanceChance;
  const outcome = fallbackSermonOutcome(state, "Mercy", "Show mercy.");
  applySermon(state, "Mercy", "Show mercy.", outcome);
  assert.equal(sick.memories.some((memory) => memory.type === "sermon"), false);
  assert.equal(sick.attendanceChance, chance);
});

test("sermon consistency and factions create congregation consequences", () => {
  const state = createGame("sermon-politics");
  state.calendar.absoluteDay = 6;
  state.calendar.dayIndex = 6;
  state.priest.positions.push({
    id: "position-00001",
    personId: state.residents[0].id,
    publicPosition: true,
    intent: "judgment",
    summary: "Condemn wrongdoers.",
    day: 5
  });
  state.nextPositionSequence = 2;
  state.residents.forEach((person) => {
    person.faith = 100;
    person.trustPriest = 100;
  });
  assert.ok(sermonConsistency(state, "Mercy", "Show mercy to every wrongdoer.") < 70);
  const outcome = fallbackSermonOutcome(state, "Repentance", "Confess and make amends.");
  assert.ok(outcome.responseTags.includes("confession"));
  applySermon(state, "Repentance", "Confess and make amends.", outcome);
  assert.ok(state.priest.positions.some((position) => position.publicPosition && position.intent === "truth"));
  assert.ok(state.priest.positions.some((position) => position.publicPosition && position.personId === null));
  assert.ok(state.sermonReactions.length === 1);
  assert.ok(state.chronicle.some((entry) => /confess|protest|procession/i.test(entry.title)));
  assert.ok(state.eventQueue.some((entry) => entry.type === "sermon_followup"));
  const followup = state.eventQueue.find((entry) => entry.type === "sermon_followup");
  state.calendar.absoluteDay = followup.dueDay;
  state.calendar.dayIndex = followup.dueDay % 7;
  state.calendar.week = Math.floor(followup.dueDay / 7) + 1;
  state.calendar.slot = 0;
  const visit = beginVisit(state);
  assert.equal(visit.issue.kind, "sermon follow-up");
  const followupPerson = state.residents.find((person) => person.id === visit.personId);
  assert.ok(followupPerson.memories.some((memory) => memory.type === "sermon_reaction"));
  assert.equal(followupPerson.visitCount, 1);
  assert.equal(followupPerson.lastVisitDay, state.calendar.absoluteDay);
});

test("theme intent detects contradictions with prior public sermons", () => {
  const state = createGame("theme-intent-consistency");
  state.priest.positions.push({
    id: "position-00001",
    personId: null,
    publicPosition: true,
    intent: "forgiveness",
    summary: "Forgive wrongdoers.",
    day: 1
  });

  test("public forgiveness contradicts later judgment counsel", () => {
    const state = createGame("forgiveness-judgment-contradiction");
    state.priest.positions.push({
      id: "position-00001",
      personId: null,
      publicPosition: true,
      intent: "forgiveness",
      summary: "Forgive wrongdoers.",
      day: 1
    });
    state.nextPositionSequence = 2;
    beginVisit(state);
    const before = state.residents.find((person) => person.id === state.currentVisit.personId).trustPriest;
    recordExchange(state, "I condemn the wicked.", {
      reply: "That is severe.",
      memory: "The priest condemned wrongdoers."
    });
    assert.equal(state.commandLog.at(-1).payload.response.contradictionId, "position-00001");
    assert.ok(state.residents.find((person) => person.id === state.currentVisit.personId).trustPriest < before);
  });
  assert.ok(sermonConsistency(state, "Justice", "Justice must be done.") < 70);
  state.priest.positions = [{
    id: "position-00002",
    personId: null,
    publicPosition: true,
    intent: "secrecy",
    summary: "Keep this hidden.",
    day: 2
  }];
  assert.ok(sermonConsistency(state, "Repentance", "Tell the truth.") < 70);

  state.priest.positions = [
    {
      id: "position-00003",
      personId: null,
      publicPosition: true,
      intent: "judgment",
      summary: "Condemn wrongdoers.",
      day: 3
    },
    {
      id: "position-00004",
      personId: null,
      publicPosition: true,
      intent: "forgiveness",
      summary: "Forgive wrongdoers.",
      day: 4
    }
  ];
  assert.ok(sermonConsistency(state, "Mercy", "Show mercy.") >= 70);
});

test("protest tags without a protest leader do not crash", () => {
  const state = createGame("leaderless-protest");
  const attendee = state.residents[0];
  const result = resolveCongregationReactions(state, "Justice", "Justice matters.", [attendee], {
    responseTags: ["protest"]
  });
  assert.ok(Array.isArray(result.events));
});

test("AI sermon tags cannot bypass deterministic event prerequisites", () => {
  const state = createGame("sermon-tag-validation");
  const attendees = state.residents.slice(0, 30);
  const result = resolveCongregationReactions(state, "Hope", "Let hope sustain us.", attendees, {
    responseTags: ["confession", "protest", "procession", "disruption"]
  });

  test("contradictory low-trust sermons can reach protest outcomes", () => {
    const state = createGame("reachable-protest");
    state.priest.positions.push({
      id: "position-public",
      personId: null,
      publicPosition: true,
      intent: "forgiveness",
      summary: "Forgive wrongdoers.",
      day: 1
    });
    state.residents.forEach((person) => {
      person.trustPriest = 0;
      person.faith = 20;
    });
    const attendees = state.parishFactions
      .map((faction) => state.residents.find((person) => person.id === faction.memberIds[0]))
      .filter(Boolean);
    const traditionalist = attendees.find((person) => state.parishFactions[0].memberIds.includes(person.id));
    traditionalist.faith = 65;
    const result = resolveCongregationReactions(state, "Justice", "Condemn wrongdoers.", attendees, {
      responseTags: ["protest", "disruption"]
    });
    assert.ok(result.consistency <= 55);
    assert.ok(result.events.some((event) => event.type === "sermon_protest"));
    assert.ok(result.events.some((event) => event.type === "church_disruption"));
  });
  assert.equal(result.events.length, 0);
});
