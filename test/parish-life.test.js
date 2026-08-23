import test from "node:test";
import assert from "node:assert/strict";
import { createGame, applySermon, fallbackSermonOutcome } from "../js/simulation.js";
import { advancePopulationDay, inflictInjury } from "../js/population.js";
import { grantChurchResource } from "../js/church.js";
import { appendEvent } from "../js/state.js";

function runDays(state, days, eachDay) {
  const tally = {};
  for (let day = 0; day < days; day += 1) {
    state.calendar.absoluteDay = day;
    eachDay?.(state, day);
    for (const event of advancePopulationDay(state)) {
      tally[event.type] = (tally[event.type] || 0) + 1;
    }
  }
  return tally;
}

function makeIll(state, count, illness = "lung sickness") {
  const sick = state.residents.filter((person) => person.alive && person.age > 14).slice(0, count);
  for (const person of sick) {
    person.illness = illness;
    person.illnessDays = 12;
    person.health = 20;
  }
  return sick;
}

test("an untended sickness kills, and a tended one mostly does not", () => {
  const neglected = createGame("mortality-neglected");
  makeIll(neglected, 60);
  for (const household of neglected.households) {
    household.food = 6;
    household.wealth = 3;
  }
  const neglectedTally = runDays(neglected, 60);

  const tended = createGame("mortality-neglected");
  for (const person of makeIll(tended, 60)) {
    person.flags = [...(person.flags || []), "tended_by_church_until_day_90"];
  }
  for (const household of tended.households) {
    household.food = 85;
    household.wealth = 70;
  }
  const tendedTally = runDays(tended, 60);

  assert.ok((neglectedTally.death || 0) > 5, "a neglected epidemic should kill people");
  assert.ok((tendedTally.death || 0) * 3 < (neglectedTally.death || 0),
    `care should matter: ${tendedTally.death || 0} tended against ${neglectedTally.death || 0} neglected`);
});

test("a wound left alone festers, and a dressed one closes", () => {
  const state = createGame("injury-progress");
  const [neglected, tended] = state.residents.filter((person) => person.alive && person.age > 20).slice(0, 2);

  const neglectedHousehold = state.households.find((entry) => entry.id === neglected.householdId);
  neglectedHousehold.food = 5;
  neglectedHousehold.wealth = 2;
  for (const member of state.residents.filter((person) => person.householdId === neglected.householdId)) {
    if (["healer", "herbalist", "midwife"].includes(member.occupation)) member.occupation = "laborer";
  }

  inflictInjury(state, neglected, "deep cut", 50, [], "work");
  inflictInjury(state, tended, "deep cut", 50, [], "work");
  state.calendar.absoluteDay = 1;
  grantChurchResource(state, tended, "medicine", 2);

  assert.equal(tended.injury?.treated ?? true, true, "the church's medicine should dress a wound");
  const neglectedBefore = neglected.injury.severity;
  runDays(state, 12);

  assert.ok(!tended.injury || tended.injury.severity < 50, "a dressed wound should be closing");
  assert.ok(!neglected.injury || neglected.injury.severity >= neglectedBefore,
    "an untended wound should not quietly heal itself");
});

test("a wound can turn to fever and kill", () => {
  const state = createGame("injury-fatal");
  for (const household of state.households) {
    household.food = 4;
    household.wealth = 1;
  }
  for (const person of state.residents.filter((entry) => entry.alive && entry.age > 20).slice(0, 40)) {
    inflictInjury(state, person, "deep cut", 85, [], "work");
  }
  const tally = runDays(state, 90);
  assert.ok((tally.illness_began || 0) > 0, "no wound went bad in ninety days");
  const woundDeaths = state.residents.filter((person) => (
    !person.alive && /wound|injur/i.test(String(person.causeOfDeath))
  ));
  assert.ok(woundDeaths.length > 0, "no one died of an untended wound in ninety days");
});

test("violence needs a bond that has genuinely soured", () => {
  const peaceable = createGame("violence-peaceable");
  const peacefulTally = runDays(peaceable, 180);
  assert.equal(peacefulTally.killing || 0, 0, "an ordinary parish should not produce killings");
  assert.ok((peacefulTally.assault || 0) <= 2, "an ordinary parish should be mostly peaceable");

  const bitter = createGame("violence-bitter");
  for (const bond of bitter.relationships.slice(0, 80)) {
    bond.resentment = 96;
    bond.affection = 3;
    const actor = bitter.residents.find((person) => person.id === bond.actorId);
    if (actor) {
      actor.stress = 95;
      actor.morale = 6;
      actor.faith = 8;
      actor.trustPriest = 8;
      actor.personality = { ...(actor.personality || {}), traits: ["vengeful", "violent"] };
    }
  }
  for (const household of bitter.households) {
    household.food = 5;
    household.wealth = 2;
  }
  bitter.town.metrics.harmony = 8;
  bitter.town.metrics.safety = 8;
  bitter.town.metrics.mercy = 5;
  const bitterTally = runDays(bitter, 365);
  assert.ok((bitterTally.assault || 0) > 5, "a parish full of hatred should come to blows");
  assert.ok((bitterTally.killing || 0) > 0, "killing should be possible where hatred is total");
  assert.ok((bitterTally.killing || 0) < (bitterTally.assault || 0),
    "killing should stay rarer than a beating");
});

test("a killing frightens the parish and a beating marks the man who gave it", () => {
  const state = createGame("violence-effects");
  for (const bond of state.relationships.slice(0, 60)) {
    bond.resentment = 97;
    bond.affection = 2;
    const actor = state.residents.find((person) => person.id === bond.actorId);
    if (actor) {
      actor.stress = 96;
      actor.morale = 5;
      actor.personality = { ...(actor.personality || {}), traits: ["vengeful", "violent"] };
    }
  }
  for (const household of state.households) household.food = 5;
  const safetyBefore = state.town.metrics.safety;
  const tally = runDays(state, 200);
  assert.ok((tally.assault || 0) + (tally.killing || 0) > 0, "no violence occurred to measure");
  assert.ok(state.town.metrics.safety < safetyBefore, "violence should cost the parish its sense of safety");
});

test("mercy is earned by giving and lost by hoarding", () => {
  function parish(seed, aidPerDay) {
    const state = createGame(seed);
    runDays(state, 90, (current) => {
      for (const household of current.households) household.food = Math.max(household.food, 65);
      for (let index = 0; index < aidPerDay; index += 1) {
        appendEvent(current, { type: "church_aid_given", actorId: "priest", targetId: null, facts: {} });
      }
    });
    return state.town.metrics.mercy;
  }
  const giving = parish("mercy-giving", 1);
  const hoarding = parish("mercy-giving", 0);
  assert.ok(giving > hoarding + 10,
    `a giving church should be a merciful parish: ${giving.toFixed(0)} against ${hoarding.toFixed(0)}`);
});

test("every figure on the priest's panel can move in both directions", () => {
  const good = createGame("levers-good");
  Object.assign(good.priest, { moralAuthority: 95, localTrust: 95, scandal: 0 });
  good.town.metrics.faith = 85;
  runDays(good, 120, (state) => {
    for (const household of state.households) {
      household.food = Math.max(household.food, 70);
      household.wealth = Math.max(household.wealth, 60);
    }
    appendEvent(state, { type: "church_aid_given", actorId: "priest", targetId: null, facts: {} });
  });

  const bad = createGame("levers-bad");
  Object.assign(bad.priest, { moralAuthority: 10, localTrust: 8, scandal: 95 });
  for (const bond of bad.relationships.slice(0, 60)) {
    bond.resentment = 95;
    bond.affection = 3;
    const actor = bad.residents.find((person) => person.id === bond.actorId);
    if (actor) {
      actor.stress = 95;
      actor.morale = 5;
    }
  }
  runDays(bad, 120, (state) => {
    for (const household of state.households) {
      household.food = 5;
      household.wealth = 2;
    }
  });

  for (const metric of ["harmony", "faith", "prosperity", "health", "safety", "mercy"]) {
    assert.ok(good.town.metrics[metric] > bad.town.metrics[metric],
      `${metric} did not tell a good parish from a ruined one (${good.town.metrics[metric].toFixed(0)} vs ${bad.town.metrics[metric].toFixed(0)})`);
  }
  assert.ok(good.material.foodSecurity > bad.material.foodSecurity, "food security did not respond");
  assert.ok(good.material.crime < bad.material.crime, "crime did not respond");
  assert.ok(good.material.infrastructure > bad.material.infrastructure, "infrastructure did not respond");
});

test("church nursing changes survival on its own", () => {
  function epidemic(tended) {
    const state = createGame("nursing-flag");
    for (const person of makeIll(state, 60)) {
      if (tended) person.flags = [...(person.flags || []), "tended_by_church_until_day_90"];
    }
    /* Deliberately poor households, so nothing but the nursing differs. */
    for (const household of state.households) {
      household.food = 6;
      household.wealth = 3;
    }
    return runDays(state, 60).death || 0;
  }
  const untended = epidemic(false);
  const nursed = epidemic(true);
  assert.ok(nursed < untended * 0.75,
    `nursing should save lives even in a poor house: ${nursed} nursed against ${untended} untended`);
});

test("a settled trouble stops drawing sermons towards it", () => {
  const state = createGame("resolved-threads");
  state.calendar.absoluteDay = 6;
  state.calendar.dayIndex = 6;
  state.calendar.week = 1;
  for (const thread of state.issueThreads || []) thread.status = "resolved";
  const before = (state.issueThreads || []).map((thread) => thread.pressure);
  const text = "There are households going hungry while their neighbours have plenty. Carry bread to the house that has none.";
  applySermon(state, "Charity", text, { ...fallbackSermonOutcome(state, "Charity", text), source: "fallback" });
  const eased = (state.lastSermonAftermath?.affected || []).flatMap((entry) => entry.easedThreadIds);
  assert.equal(eased.length, 0, "a resolved thread should not be eased again");
  assert.deepEqual((state.issueThreads || []).map((thread) => thread.pressure), before);
});
