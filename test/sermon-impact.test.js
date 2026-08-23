import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  applySermon,
  fallbackSermonOutcome,
  beginVisit,
  recordExchange,
  finishVisit,
  fallbackConversation,
  fallbackDeparturePlan
} from "../js/simulation.js";
import { sermonForce, sermonNovelty, sermonRelevance } from "../js/parish.js";

function sundayState(seed, priest = {}) {
  const state = createGame(seed);
  state.calendar.absoluteDay = 6;
  state.calendar.dayIndex = 6;
  state.calendar.week = 1;
  Object.assign(state.priest, priest);
  return state;
}

/* Play a handful of ordinary visits so some parishioners have actually sat
   opposite the priest, which is what the sermon is supposed to weigh. */
function withVisitors(seed, count, priest = {}) {
  const state = createGame(seed);
  for (let index = 0; index < count; index += 1) {
    beginVisit(state);
    for (let turn = 0; turn < 3; turn += 1) {
      const line = "Tell me plainly what is wrong, and I will help if I can.";
      recordExchange(state, line, { ...fallbackConversation(state, line), source: "fallback" });
    }
    finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
  }
  return state;
}

const STRONG = "There is a quarrel in this parish that has outlived the wrong that began it, and there are households going hungry while their neighbours have plenty. Forgive the man you are angry with, carry bread to the house that has none, and do it this week before the anger hardens.";

test("a sermon is only as strong as the priest and the craft behind it", () => {
  const state = sundayState("force");
  const mumbled = sermonForce(state, "Be good.", 70);
  const preached = sermonForce(state, STRONG, 70);
  assert.ok(preached > mumbled * 3, "a written sermon should carry further than three words");

  const trusted = sundayState("force", { localTrust: 95, moralAuthority: 95 });
  const ruined = sundayState("force", { localTrust: 10, moralAuthority: 12, scandal: 90 });
  assert.ok(sermonForce(trusted, STRONG, 70) > sermonForce(state, STRONG, 70));
  assert.ok(sermonForce(ruined, STRONG, 70) < sermonForce(state, STRONG, 70) * 0.5);
});

test("a sermon is more relevant to someone whose trouble it names", () => {
  const state = sundayState("relevance");
  const person = state.residents.find((entry) => entry.alive && entry.active);
  const household = state.households.find((entry) => entry.id === person.householdId);
  household.food = 8;
  household.wealth = 4;

  const words = new Set("bread hungry poor cold winter alms charity".split(" "));
  const other = new Set("mill roof cart timber road".split(" "));
  const spoken = sermonRelevance(state, person, "Charity", words, household);
  const unrelated = sermonRelevance(state, person, "Charity", other, household);

  assert.ok(spoken.score > unrelated.score, "hunger should hear a sermon about bread");
  assert.ok(spoken.reasons.length > 0, "it should be able to say why");
});

test("a strong sermon changes people, and a feeble one does not", () => {
  const strong = withVisitors(sundayState("aftermath-strong", { localTrust: 85, moralAuthority: 82 }), 6);
  strong.calendar.absoluteDay = 6;
  strong.calendar.dayIndex = 6;
  applySermon(strong, "Forgiveness", STRONG, { ...fallbackSermonOutcome(strong, "Forgiveness", STRONG), source: "fallback" });

  const feeble = sundayState("aftermath-feeble", { localTrust: 20, moralAuthority: 18, scandal: 70 });
  applySermon(feeble, "Forgiveness", "Be good.", { ...fallbackSermonOutcome(feeble, "Forgiveness", "Be good."), source: "fallback" });

  assert.ok(strong.lastSermonAftermath.affected.length > 0, "nobody was moved by a strong sermon");
  assert.equal(feeble.lastSermonAftermath.affected.length, 0, "a mumble from a disgraced priest moved someone");
  const biggest = strong.lastSermonAftermath.affected[0];
  assert.ok(Math.abs(biggest.deltas.faith) >= 4, `the strongest effect was only ${biggest.deltas.faith}`);
});

test("the aftermath says who was moved, why, and by how much", () => {
  const state = withVisitors(sundayState("aftermath-detail", { localTrust: 85, moralAuthority: 82 }), 6);
  state.calendar.absoluteDay = 6;
  state.calendar.dayIndex = 6;
  applySermon(state, "Forgiveness", STRONG, { ...fallbackSermonOutcome(state, "Forgiveness", STRONG), source: "fallback" });

  const aftermath = state.lastSermonAftermath;
  assert.equal(aftermath.theme, "Forgiveness");
  assert.ok(aftermath.attendance > 0);
  assert.ok(Array.isArray(aftermath.offering.givers));
  for (const entry of aftermath.affected) {
    assert.ok(entry.name, "an affected person with no name");
    assert.ok(["moved", "hardened"].includes(entry.direction));
    assert.ok(Object.values(entry.deltas).some((value) => value !== 0), `${entry.name} was listed but nothing changed`);
  }
});

test("those who have sat with the priest are moved out of proportion to their number", () => {
  const state = withVisitors(sundayState("aftermath-known", { localTrust: 85, moralAuthority: 82 }), 8);
  state.calendar.absoluteDay = 6;
  state.calendar.dayIndex = 6;
  applySermon(state, "Forgiveness", STRONG, { ...fallbackSermonOutcome(state, "Forgiveness", STRONG), source: "fallback" });

  const aftermath = state.lastSermonAftermath;
  const acquainted = state.residents.filter((person) => person.visitCount > 0);
  const affectedAcquainted = aftermath.affected.filter((entry) => entry.knownToPriest).length;

  const shareOfAffected = affectedAcquainted / Math.max(1, aftermath.affected.length);
  const shareOfParish = acquainted.length / Math.max(1, aftermath.attendance);
  assert.ok(shareOfAffected > shareOfParish,
    `those he has met were ${(shareOfAffected * 100).toFixed(0)}% of those moved but ${(shareOfParish * 100).toFixed(0)}% of the room`);
});

test("a sermon that speaks to a trouble takes weight off the trouble", () => {
  const state = withVisitors(sundayState("aftermath-threads", { localTrust: 88, moralAuthority: 85 }), 8);
  state.calendar.absoluteDay = 6;
  state.calendar.dayIndex = 6;
  const before = new Map((state.issueThreads || []).map((thread) => [thread.id, thread.pressure]));
  applySermon(state, "Forgiveness", STRONG, { ...fallbackSermonOutcome(state, "Forgiveness", STRONG), source: "fallback" });

  const eased = state.lastSermonAftermath.affected.flatMap((entry) => entry.easedThreadIds);
  for (const threadId of eased) {
    const thread = state.issueThreads.find((entry) => entry.id === threadId);
    assert.ok(thread.pressure < before.get(threadId), `${threadId} was said to ease but did not`);
  }
});

test("the same sermon preached again lands lighter than a new one", () => {
  const state = sundayState("novelty");
  const spoken = new Set("hungry bread neighbour quarrel forgive spare".split(" "));
  assert.equal(sermonNovelty(state, "Charity", spoken), 1, "the first sermon has nothing to repeat");

  state.sermons.push({ day: 0, theme: "Charity", text: "The hungry need bread. Forgive your neighbour and spare what you can for the quarrel between you." });
  state.sermons.push({ day: 7, theme: "Charity", text: "The hungry need bread. Forgive your neighbour and spare what you can for the quarrel between you." });
  const stale = sermonNovelty(state, "Charity", spoken);
  const fresh = sermonNovelty(state, "Justice", new Set("theft reeve court witness testify punish".split(" ")));

  assert.ok(stale < 0.8, `a word-perfect repeat should go stale, was ${stale}`);
  assert.ok(fresh > stale, "an unrelated sermon should be fresher than a repeated one");
});

test("weekly preaching does not saturate the parish", () => {
  const state = createGame("novelty-soak");
  const text = "There are households going hungry while their neighbours have plenty. Carry bread to the house that has none, and forgive the man you are angry with.";
  for (let week = 1; week <= 12; week += 1) {
    state.calendar.absoluteDay = week * 7 - 1;
    state.calendar.dayIndex = 6;
    state.calendar.week = week;
    applySermon(state, "Charity", text, { ...fallbackSermonOutcome(state, "Charity", text), source: "fallback" });
  }
  const living = state.residents.filter((person) => person.alive && person.active);
  const saturated = living.filter((person) => person.faith >= 99).length;
  assert.ok(saturated < living.length * 0.15,
    `twelve weeks of the same sermon left ${saturated} of ${living.length} at total faith`);
});
