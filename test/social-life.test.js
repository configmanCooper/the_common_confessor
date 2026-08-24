import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  beginVisit,
  recordExchange,
  finishVisit,
  fallbackConversation,
  fallbackDeparturePlan,
  applySermon,
  fallbackSermonOutcome,
  applyAction
} from "../js/simulation.js";
import { serializeState, deserializeState } from "../js/state.js";
import {
  MAX_CHAIN_DEPTH,
  planWeeklySocialLife,
  recentSocialLog,
  resolveDueIntentions,
  scheduleIntention,
  scheduleSocialAnswer
} from "../js/social.js";

/* Play the parish for a while so the village has relationships, troubles and
   reasons to act. */
function livedIn(seed, days = 28) {
  const state = createGame(seed);
  for (let day = 0; day < days; day += 1) {
    if (state.calendar.dayIndex === 6) {
      const text = "Carry bread to the house that has none, and forgive the man you are angry with.";
      applySermon(state, "Charity", text, { ...fallbackSermonOutcome(state, "Charity", text), source: "fallback" });
      /* Deliberately not cleared: the aftermath belongs to the sermon command,
         and wiping it here would make the save disagree with its own replay. */
      continue;
    }
    for (let visit = 0; visit < 4; visit += 1) {
      beginVisit(state);
      const line = "Tell me what troubles you, and do right by your neighbour.";
      recordExchange(state, line, { ...fallbackConversation(state, line), source: "fallback" });
      finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
    }
  }
  return state;
}

test("an intention waits for its day and then happens", () => {
  const state = createGame("intention-timing");
  const [actor, target] = state.residents.filter((person) => person.alive && person.age > 20);
  const intention = scheduleIntention(state, {
    actorId: actor.id,
    targetId: target.id,
    actionType: "share_food",
    dueDay: state.calendar.absoluteDay + 3,
    causeSummary: "what the priest said"
  });
  assert.ok(intention, "the intention should be accepted");

  assert.equal(resolveDueIntentions(state, applyAction).length, 0, "it should not happen early");
  state.calendar.absoluteDay += 3;
  resolveDueIntentions(state, applyAction);
  /* Between resolving and doing, a person may think better of it - that is the
     whole point of the delay - so what the day guarantees is that the matter is
     settled one way or the other, not which way. */
  assert.notEqual(intention.status, "pending", "the day came and nothing was settled");
  assert.ok(["done", "thought_better_of_it", "failed"].includes(intention.status));
});

test("the same person does not resolve on the same errand twice", () => {
  const state = createGame("intention-dedup");
  const [actor, target] = state.residents.filter((person) => person.alive && person.age > 20);
  const options = { actorId: actor.id, targetId: target.id, actionType: "comfort", dueDay: 2 };
  assert.ok(scheduleIntention(state, options));
  assert.equal(scheduleIntention(state, options), null, "a second identical resolve should be ignored");
});

test("nothing is scheduled for the dead, or for an act that does not exist", () => {
  const state = createGame("intention-bounds");
  const [actor, target] = state.residents.filter((person) => person.alive && person.age > 20);
  assert.equal(scheduleIntention(state, {
    actorId: actor.id, targetId: target.id, actionType: "invent_a_new_sin", dueDay: 1
  }), null);

  target.alive = false;
  target.active = false;
  assert.equal(scheduleIntention(state, {
    actorId: actor.id, targetId: target.id, actionType: "comfort", dueDay: 1
  }), null);
});

test("an act provokes an answer, and the chain runs out", () => {
  const state = createGame("intention-chain");
  const [actor, target] = state.residents.filter((person) => person.alive && person.age > 20);
  const answer = scheduleSocialAnswer(state, {
    actorId: target.id,
    subjectId: actor.id,
    actionType: "share_food",
    causeSummary: "a kindness"
  });
  if (answer) {
    assert.equal(answer.depth, 2, "an answer to a first act is the second link");
    assert.ok(answer.dueDay > state.calendar.absoluteDay, "an answer takes a day or two");
  }

  /* Nothing may be scheduled beyond the promised depth. */
  assert.equal(scheduleSocialAnswer(state, {
    actorId: target.id, subjectId: actor.id, actionType: "share_food", depth: MAX_CHAIN_DEPTH
  }), null);
});

test("the village acts on its own, and the acts trace back to a cause", () => {
  const state = livedIn("social-lived");
  const log = recentSocialLog(state, { limit: 500 });
  assert.ok(log.length > 5, `the village barely stirred in four weeks (${log.length} acts)`);

  for (const entry of log) {
    assert.ok(entry.actorName, "an act with no one doing it");
    assert.ok(entry.day >= 0 && entry.week >= 1, "an act outside the calendar");
    assert.ok(entry.depth >= 1 && entry.depth <= MAX_CHAIN_DEPTH, `a chain ran to depth ${entry.depth}`);
    assert.ok(entry.causeSummary, "an act with no reason recorded");
  }

  const depths = new Set(log.map((entry) => entry.depth));
  assert.ok(depths.has(1), "nothing happened of its own accord");
  assert.ok(depths.has(2), "nothing was ever answered");
});

test("what the village does is varied rather than one thing over and over", () => {
  const state = livedIn("social-variety", 42);
  const log = recentSocialLog(state, { limit: 900 });
  const kinds = new Set(log.map((entry) => entry.actionType));
  assert.ok(kinds.size >= 4, `only ${kinds.size} kinds of act in six weeks: ${[...kinds].join(", ")}`);

  const counts = {};
  for (const entry of log) counts[entry.actionType] = (counts[entry.actionType] || 0) + 1;
  const commonest = Math.max(...Object.values(counts));
  assert.ok(commonest / log.length < 0.75, "one kind of act drowned out everything else");
});

test("the same parish lives the same life twice", () => {
  const first = recentSocialLog(livedIn("social-determinism", 21), { limit: 400 });
  const second = recentSocialLog(livedIn("social-determinism", 21), { limit: 400 });
  assert.equal(first.length, second.length, "the village behaved differently on a second run");
  assert.deepEqual(
    first.map((entry) => `${entry.day}:${entry.actorId}:${entry.actionType}`),
    second.map((entry) => `${entry.day}:${entry.actorId}:${entry.actionType}`)
  );
});

test("the parish's social life survives being saved and reloaded", () => {
  const state = livedIn("social-replay", 14);
  const restored = deserializeState(serializeState(state));
  assert.equal(
    restored.socialLog.length,
    state.socialLog.length,
    "the record of what the village did changed on reload"
  );
  assert.equal(
    restored.intentions.filter((entry) => entry.status === "pending").length,
    state.intentions.filter((entry) => entry.status === "pending").length,
    "what the village meant to do next changed on reload"
  );
});

test("a week of parish life is planned after the sermon", () => {
  const state = livedIn("social-weekly", 8);
  const before = state.intentions.length;
  planWeeklySocialLife(state);
  assert.ok(state.intentions.length >= before, "the week should be planned, not unplanned");
  for (const intention of state.intentions.filter((entry) => entry.status === "pending")) {
    assert.ok(intention.dueDay >= state.calendar.absoluteDay, "nothing may be planned for the past");
  }
});

test("the log can be read for one person", () => {
  const state = livedIn("social-person", 21);
  const all = recentSocialLog(state, { limit: 500 });
  assert.ok(all.length > 0);
  const someone = all[0].actorId;
  const theirs = recentSocialLog(state, { limit: 500, personId: someone });
  assert.ok(theirs.length > 0);
  for (const entry of theirs) {
    assert.ok(entry.actorId === someone || entry.targetId === someone,
      "the log for one person included somebody else's business");
  }
});
