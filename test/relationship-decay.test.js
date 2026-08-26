/* Feeling fades when nothing feeds it.

   Every bond in the parish used to be permanent. `lastInteractionDay` was
   written on each adjustment and validated on load, but nothing ever read it,
   so a grudge struck in the first month was exactly as sharp five years later.
   That is an ugly asymmetry when resentment carries a murder threshold: one
   bad week between two men could end, seasons later, in a killing that nothing
   in the intervening years had any power to prevent.

   Four properties are pinned here, and they pull against each other.

   Drift only ever forgets. Every axis is raised by things that happen and
   lowered by nothing at all, so drift is the sole force for forgetting and
   forgetting is all it may do. Made symmetrical it did real harm - see the
   test that counts bonds cold enough for violence.

   It goes toward the middle, not to nothing, so a village settles back to its
   own ordinary temperature rather than becoming strangers who feel nothing.

   Strong feeling outlasts mild feeling, which is the opposite of ordinary
   decay and is the whole point of the shape.

   And only what has been left alone drifts at all.
*/

import test from "node:test";
import assert from "node:assert/strict";

import {
  createGame,
  replayGame,
  beginVisit,
  finishVisit,
  fallbackDeparturePlan,
  fallbackSermonOutcome,
  applySermon
} from "../js/simulation.js";
import {
  advancePopulationDay,
  adjustRelationship,
  getRelationship,
  decayedRelationshipValue
} from "../js/population.js";

const AXES = ["familiarity", "trust", "affection", "fear", "respect", "resentment", "obligation"];
/* The one axis that must not fade at all. Marriage asks for fifty-two of it
   and the parish only ever generates up to forty-five, so no resting point
   exists that would keep the gate out of drift's reach. */
const KEPT = ["attraction"];

/** Where an axis is headed, found by letting it run rather than restating it. */
function settlesNear(field) {
  let value = 100;
  for (let week = 0; week < 20000; week += 1) {
    const next = decayedRelationshipValue(field, value);
    if (Math.abs(next - value) < 1e-9) break;
    value = next;
  }
  return value;
}

/** Weeks of silence for one axis to fall from one value to another. */
function weeksToFall(field, from, to) {
  let value = from;
  for (let week = 0; week < 20000; week += 1) {
    if (value <= to) return week;
    const next = decayedRelationshipValue(field, value);
    if (Math.abs(next - value) < 1e-12) return Infinity;
    value = next;
  }
  return Infinity;
}

/** A parish, and one pair of people who know each other. */
function pair(seed) {
  const state = createGame(seed);
  const actor = state.residents.find((resident) => resident.active && resident.relationshipIds.length);
  return { state, actorId: actor.id, targetId: actor.relationshipIds[0] };
}

/** Run the parish forward a number of days. */
function runDays(state, days) {
  for (let index = 0; index < days; index += 1) {
    state.calendar.absoluteDay += 1;
    advancePopulationDay(state);
  }
}

test("drift never lifts a bond, only lets it fall", () => {
  /* The rule everything else rests on. Nothing in the engine lowers any of
     these axes, so a drift that pushed upward would invent feeling nobody
     earned and nothing could take back. */
  for (const field of AXES) {
    const settled = settlesNear(field);
    for (const below of [0, 1, settled / 2, settled - 1]) {
      const start = Math.max(0, below);
      assert.equal(
        decayedRelationshipValue(field, start),
        start,
        `${field} at ${start} was warmed toward ${settled} by nothing at all`
      );
    }
    assert.ok(decayedRelationshipValue(field, 95) < 95, `${field} did not fall from above`);
  }
});

test("attraction is never taken away by mere time", () => {
  /* Marriage asks for fifty-two of it and the parish generates at most
     forty-five, so there is no resting point that would put the gate out of
     drift's reach. Where nothing can be made safe, nothing drifts. */
  for (const field of KEPT) {
    for (const value of [0, 5, 23, 45, 60, 95, 100]) {
      assert.equal(
        decayedRelationshipValue(field, value),
        value,
        `${field} at ${value} was worn away by time alone`
      );
    }
  }
});

test("every gate that asks for more than a number sits below its resting point", () => {
  /* The invariant that makes the whole thing safe. Drift only forgets and
     never steps past the resting point, so it can never carry a bond *below*
     that point - which means a "more than" gate underneath it can never be
     drifted out of reach. This is why affection rests at fifty rather than at
     its seeded midpoint of forty-three: marriage asks for more than
     forty-five, and forty-three would have put the gate above the resting
     point, where drift could empty it. */
  const gates = [
    ["affection", 45, "marriage"],
    ["familiarity", 45, "teaching a trade"],
    ["familiarity", 40, "praying together"],
    ["trust", 35, "being named a safe helper"]
  ];
  for (const [field, gate, what] of gates) {
    const settled = settlesNear(field);
    assert.ok(
      gate < settled,
      `${what} asks for ${field} above ${gate}, which drift can reach: it settles at ${settled}`
    );
    /* And concretely: a bond just above the gate must never fall through it. */
    let value = gate + 0.5;
    for (let week = 0; week < 2000; week += 1) value = decayedRelationshipValue(field, value);
    assert.ok(value > gate, `${field} fell through the ${what} gate to ${value}`);
  }
});

test("a village does not quietly stop pairing off", () => {
  /* The property the exclusion protects, measured on a parish rather than
     argued from the arithmetic. */
  const state = createGame("decay-marriage-gate");
  const share = () => state.relationships.filter((bond) => bond.affection > 45).length
    / state.relationships.length;
  const before = share();
  runDays(state, 730);
  assert.ok(before > 0.25, `the parish began with too few fond bonds to judge by: ${before}`);
  assert.ok(
    share() > before - 0.05,
    `two years of drift closed the marriage gate: ${(before * 100).toFixed(0)}% -> ${(share() * 100).toFixed(0)}%`
  );
});

test("a symmetrical drift would disable violence, and this one does not", () => {
  /* The measurement that caught it. `processViolence` needs affection at
     thirty or under; when drift was symmetrical it lifted every neglected bond
     to a floor of thirty-three, and since nothing else can lower affection the
     lift was permanent - bonds cold enough for violence fell from 292 to 2
     across one year, quietly removing the darkest thing the parish can do. */
  const state = createGame("violence-floor");
  const coldEnough = () => state.relationships.filter((bond) => bond.affection <= 30).length;
  const before = coldEnough();
  assert.ok(before > 50, `the parish began too warm to judge by: ${before}`);

  runDays(state, 365);

  assert.ok(
    coldEnough() >= before * 0.8,
    `a year of drift warmed the parish out of violence: ${before} -> ${coldEnough()}`
  );
});

test("every axis heads for a middling value, not for nothing", () => {
  for (const field of AXES) {
    const settled = settlesNear(field);
    assert.ok(settled > 0, `${field} drains to nothing`);
    assert.ok(settled < 100, `${field} stays at the ceiling`);
  }
  assert.ok(settlesNear("resentment") < 30, "resentment should settle low, if not at nothing");
  assert.ok(settlesNear("trust") > 40 && settlesNear("trust") < 60, "trust should settle near the middle");
});

test("strong feeling outlasts mild feeling", () => {
  /* The opposite of how decay usually works, and deliberate: a passing
     annoyance is forgotten within a season, a consuming hatred is still there
     years later. */
  const consuming = 95 - decayedRelationshipValue("resentment", 95);
  const middling = 60 - decayedRelationshipValue("resentment", 60);
  assert.ok(consuming < middling, "a consuming grudge faded faster than a middling one");
  assert.ok(
    weeksToFall("resentment", 95, 90) > weeksToFall("resentment", 60, 55),
    "five points cost less from a consuming hatred than from a middling one"
  );
});

test("the drift is slow enough to be a season's work, not a week's", () => {
  /* A priest should be able to work against a feud; he should not be able to
     wait one out over a fortnight. */
  assert.ok(weeksToFall("resentment", 95, 92) >= 6, "hatred cooled below the killing mark too readily");
  assert.ok(weeksToFall("fear", 95, 60) >= 25, "a deep terror evaporated within the year");
  assert.ok(weeksToFall("affection", 95, 70) >= 20, "a deep attachment evaporated within the season");
  /* But it must arrive, or it is permanence with extra arithmetic. */
  assert.ok(Number.isFinite(weeksToFall("resentment", 95, 30)), "consuming hatred never fades at all");
});

test("a bond slows as it settles and never overshoots", () => {
  /* A fixed step is a ratchet: it pins every bond in the village to the same
     number. The approach eases off instead, so bonds keep their order and
     their spread. */
  for (const field of AXES) {
    const settled = settlesNear(field);
    const far = Math.abs(decayedRelationshipValue(field, settled + 25) - (settled + 25));
    const near = Math.abs(decayedRelationshipValue(field, settled + 2) - (settled + 2));
    assert.ok(near < far, `${field} closed the last stretch as fast as the first`);
    for (const offset of [0.05, 0.5, 2, 9]) {
      const start = settled + offset;
      assert.ok(
        decayedRelationshipValue(field, start) >= settled - 1e-9,
        `${field} overshot the middle from ${start}`
      );
    }
  }
});

test("a village left to itself keeps its variety", () => {
  /* The degeneracy this shape exists to avoid. A fixed step left thirteen
     hundred bonds on one value; putting a dead band round the middle only
     moved the pile-up to the band's edge, where three bonds in five sat on one
     of two numbers. Measured on resentment, which does drift. */
  const state = createGame("decay-keeps-its-texture");
  /* Two years is long enough: a fixed step of a point a week crosses the whole
     scale in half that, so if it were going to pile up it would have. */
  runDays(state, 730);

  const counts = new Map();
  for (const bond of state.relationships) {
    counts.set(bond.resentment, (counts.get(bond.resentment) || 0) + 1);
  }
  const biggestPile = Math.max(...counts.values()) / state.relationships.length;
  assert.ok(counts.size > 30, `two years of quiet left only ${counts.size} distinct grudges`);
  assert.ok(biggestPile < 0.15, `${(biggestPile * 100).toFixed(0)}% of the village piled onto one value`);
});

test("a parish left to itself cools over the seasons", () => {
  /* Asked of the parish rather than a chosen pair, because the village is
     alive and any one bond may be provoked afresh while the test runs. */
  const state = createGame("decay-over-time");
  for (const bond of state.relationships) {
    bond.resentment = 90;
    bond.lastInteractionDay = state.calendar.absoluteDay;
  }
  const sampled = state.relationships.length;
  runDays(state, 84);

  const cooled = state.relationships.filter((bond) => bond.resentment < 90).length;
  assert.ok(cooled > sampled / 2, `only ${cooled} of ${sampled} bonds cooled`);
  /* But twelve weeks must not undo a hatred entirely - measured only on the
     bonds the village genuinely left alone, since anything it acted upon has
     had resentment added to it by something other than time. */
  const neglected = state.relationships.filter((bond) => (
    bond.lastInteractionDay <= 0 && bond.resentment < 90
  ));
  assert.ok(neglected.length, "the village touched every bond, so nothing was left to measure");
  assert.ok(
    neglected.every((bond) => bond.resentment > 55),
    `twelve weeks wiped out a deep grudge: ${Math.min(...neglected.map((bond) => bond.resentment))}`
  );
});

test("a feud that is still being fed does not cool", () => {
  /* What lastInteractionDay was always for. A quarrel renewed every week stays
     hot; it is the forgotten grudge that fades. */
  const { state, actorId, targetId } = pair("decay-fed-feud");
  const bond = getRelationship(state, actorId, targetId, true);
  bond.resentment = 80;
  bond.lastInteractionDay = state.calendar.absoluteDay;

  for (let week = 0; week < 12; week += 1) {
    runDays(state, 7);
    adjustRelationship(state, actorId, targetId, {}, state.calendar.absoluteDay);
  }
  assert.equal(bond.resentment, 80, `a live feud cooled anyway: ${bond.resentment}`);
});

test("a feud left for a fortnight begins to cool", () => {
  const { state, actorId, targetId } = pair("decay-abandoned-feud");
  const bond = getRelationship(state, actorId, targetId, true);
  bond.resentment = 80;
  bond.lastInteractionDay = state.calendar.absoluteDay;

  runDays(state, 21);
  assert.ok(bond.resentment < 80, `a forgotten feud stayed perfectly sharp: ${bond.resentment}`);
});

test("a beating counts as having happened", () => {
  /* processViolence wrote the bond's fields directly, which was the only place
     in the engine that bypassed adjustRelationship. The day went unrecorded,
     so the worst thing two people can do to each other looked like neglect -
     and on any day divisible by seven the drift pass, running later the same
     tick, clawed part of it straight back.

     This has to drive a real assault. An earlier version of this test called
     adjustRelationship directly and asserted the day was recorded, which is
     behaviour adjustRelationship always had: the fix could be reverted whole
     and the test stayed green. */
  const state = createGame("decay-beating-recorded");
  const actor = state.residents.find((resident) => (
    resident.active && resident.alive && resident.age >= 20 && resident.age <= 60
      && resident.relationshipIds.length
  ));
  const targetId = actor.relationshipIds.find((id) => {
    const other = state.residents.find((resident) => resident.id === id);
    return other?.active && other.alive;
  });
  const bond = getRelationship(state, actor.id, targetId, true);

  /* Everything that makes a man strike his neighbour, so the roll is reached. */
  bond.resentment = 95;
  bond.affection = 0;
  bond.lastInteractionDay = -1;
  actor.personality = { ...(actor.personality || {}), traits: ["violent", "vengeful"] };
  actor.stress = 100;
  actor.morale = 0;
  actor.faith = 0;
  actor.trustPriest = 0;
  state.town.metrics.harmony = 0;
  state.town.metrics.mercy = 0;
  state.town.metrics.safety = 0;
  state.material.foodSecurity = 0;

  for (let index = 0; index < 400; index += 1) {
    state.calendar.absoluteDay += 1;
    const events = advancePopulationDay(state);
    if (events.some((event) => event.type === "assault" && event.actorId === actor.id)) {
      assert.equal(
        bond.lastInteractionDay,
        state.calendar.absoluteDay,
        "a beating was recorded as though nothing had passed between them"
      );
      return;
    }
  }
  assert.fail("no assault occurred, so the recording could not be checked");
});

test("a decay pass survives being replayed", () => {
  /* The one thing in this feature that could silently break replay integrity.
     Every other property here is arithmetic a unit test can settle, but drift
     accumulates fractional values week after week, and if a replayed parish
     reached different numbers the save would be refused.

     This has to drive the parish through real commands. An earlier version
     advanced the calendar by hand, which records nothing, so there was no log
     to replay and the test compared a fortnight-old parish against a fresh
     one. */
  const state = createGame("decay-replays");
  let guard = 0;
  while (state.calendar.absoluteDay < 15 && guard < 400) {
    guard += 1;
    if (state.calendar.dayIndex === 6) {
      const text = "Be merciful to one another, and keep the peace of this parish.";
      applySermon(state, "Mercy", text, fallbackSermonOutcome(state, "Mercy", text));
      continue;
    }
    beginVisit(state);
    finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
  }
  assert.ok(state.calendar.absoluteDay >= 15, "the parish never reached a second week");
  assert.ok(state.commandLog.length > 20, "too little was recorded to be worth replaying");
  assert.ok(
    state.relationships.some((bond) => !Number.isInteger(bond.resentment)),
    "no bond carried an accumulated fraction, so this proves nothing"
  );

  const replayed = replayGame(state.seed, state.commandLog, state.replayBase);
  assert.equal(
    JSON.stringify(replayed.relationships),
    JSON.stringify(state.relationships),
    "a replayed parish reached different relationships"
  );
});

test("a bond born today has not been neglected since the founding", () => {
  const state = createGame("decay-new-bond");
  state.calendar.absoluteDay = 500;
  /* Two people the parish has not already introduced, or getRelationship
     hands back the bond it made on the first day. */
  const strangers = state.residents.filter((resident) => resident.active);
  const first = strangers.find((candidate) => strangers.some((other) => (
    other.id !== candidate.id && !candidate.relationshipIds.includes(other.id)
  )));
  const second = strangers.find((other) => (
    other.id !== first.id && !first.relationshipIds.includes(other.id)
  ));
  const bond = getRelationship(state, first.id, second.id, true);
  assert.equal(bond.lastInteractionDay, 500);
});

test("nothing drifts in the first week of a parish", () => {
  const state = createGame("decay-not-at-once");
  const actor = state.residents.find((resident) => resident.active && resident.relationshipIds.length);
  const bond = getRelationship(state, actor.id, actor.relationshipIds[0], true);
  bond.lastInteractionDay = -1;
  const before = AXES.map((field) => bond[field]);

  runDays(state, 6);

  assert.deepEqual(AXES.map((field) => bond[field]), before);
});

test("drift is weekly, not daily", () => {
  const { state, actorId, targetId } = pair("decay-weekly");
  const bond = getRelationship(state, actorId, targetId, true);
  bond.resentment = 80;
  bond.lastInteractionDay = -1;

  runDays(state, 7 - (state.calendar.absoluteDay % 7));
  const afterOne = bond.resentment;
  runDays(state, 6);
  assert.equal(bond.resentment, afterOne, "a bond drifted on a day that was not the week's turn");
  runDays(state, 1);
  assert.ok(bond.resentment < afterOne, "the week turned and nothing moved");
});

test("a parish left alone keeps every axis inside what the record allows", () => {
  const state = createGame("decay-parish-shape");
  runDays(state, 200);
  for (const bond of state.relationships) {
    for (const field of [...AXES, ...KEPT]) {
      assert.ok(
        Number.isFinite(bond[field]) && bond[field] >= 0 && bond[field] <= 100,
        `${field} left the allowed range: ${bond[field]}`
      );
    }
  }
});
