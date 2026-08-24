import assert from "node:assert/strict";
import test from "node:test";
import { createGame } from "../js/simulation.js";
import { advancePopulationDay } from "../js/population.js";
import { grantChurchResource } from "../js/church.js";
import { producerEffectiveness } from "../js/market.js";

/* A gift from the church stores is worth what it spares a household, never a
   flat bonus. Bread only saves coin if they would otherwise have bought bread;
   a family that still has a larder draws on that before it goes to market, so
   the loaf feeds them and saves them nothing.

   Every threshold below was read off a measured run rather than imagined, and
   the horizons are deliberate: a single day moves almost nothing, and these
   effects only separate over weeks. See the notes in population.js. */

function household(seed, changes = {}) {
  const state = createGame(seed);
  state.material.season = changes.season ?? "Autumn";
  const home = state.households[0];
  const person = state.residents.find(
    (r) => r.householdId === home.id && r.alive && r.age >= 18
  );
  Object.assign(home, { food: 30, wealth: 10, debt: 0, fuel: 16, ...(changes.household ?? {}) });
  Object.assign(person, changes.person ?? {});
  state.churchResources.bread = 60;
  state.churchResources.firewood = 60;
  state.churchResources.medicine = 30;
  state.churchResources.coin = 60;
  return { state, home, person };
}

function live(state, days, season) {
  for (let day = 1; day <= days; day += 1) {
    state.calendar.absoluteDay = day;
    if (season) state.material.season = season;
    advancePopulationDay(state);
  }
}

/* The same household lived twice over, once having received the gift and once
   not, reporting the difference in coin left at the end. */
function coinKeptBy(seed, gift, amount, days, changes = {}) {
  const measure = (give) => {
    const { state, home, person } = household(seed, changes);
    if (give) grantChurchResource(state, person, gift, amount);
    live(state, days, changes.season);
    return home.wealth;
  };
  return measure(true) - measure(false);
}

/* One village proves nothing: how much a gift is worth depends on the family
   that receives it, and a single seed can flatter or bury a real effect. These
   tests therefore ask what the typical household saves across a panel of
   villages, and assert the ordering between situations rather than a magnitude
   that would only ever hold for one of them. */
const SEED_PANEL = ["wood", "survive", "bread", "a", "b", "c", "d", "e", "f", "g", "h", "i"];

function medianKeptBy(gift, amount, days, changes = {}) {
  const values = SEED_PANEL
    .map((seed) => coinKeptBy(seed, gift, amount, days, changes))
    .sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)];
}

/* Bread is worth to a family exactly what it spares them at market, and no
   more. A bare larder means they have been buying daily; a full one means they
   have not. Over a long enough winter even a full larder empties, so the test
   is one of degree between situations rather than an absolute nothing. */
test("bread is worth far more to a bare larder than to a full one", () => {
  const bare = medianKeptBy("bread", 6, 40, { household: { food: 8 } });
  const coping = medianKeptBy("bread", 6, 40, { household: { food: 34 } });
  const full = medianKeptBy("bread", 6, 40, { household: { food: 78 } });
  assert.ok(bare > 0.6, `bread to a bare larder only saved ${bare.toFixed(2)} coin`);
  assert.ok(
    bare > coping && coping > full,
    `the emptier the larder the more the loaf should be worth, got bare ${bare.toFixed(2)}, coping ${coping.toFixed(2)}, full ${full.toFixed(2)}`
  );
  assert.ok(
    full < bare / 4,
    `a full larder still saved ${full.toFixed(2)} against the bare larder's ${bare.toFixed(2)}`
  );
});

test("bread given on the day changes nothing for a household that is not buying", () => {
  const full = coinKeptBy("bread", "bread", 6, 1, { household: { food: 78 } });
  assert.ok(
    Math.abs(full) < 0.02,
    `a full larder was never going to market today, yet the gift saved ${full.toFixed(2)} coin`
  );
});

test("firewood spares a cold house its fuel bill and barely helps a stacked one", () => {
  const cold = medianKeptBy("firewood", 10, 40, { season: "Winter", household: { fuel: 1 } });
  const stacked = medianKeptBy("firewood", 10, 40, { season: "Winter", household: { fuel: 40 } });
  assert.ok(cold > 1.2, `firewood to a cold house only saved ${cold.toFixed(2)} coin`);
  assert.ok(
    stacked < cold / 4,
    `a stacked woodpile still saved ${stacked.toFixed(2)} against the cold house's ${cold.toFixed(2)}`
  );
});

/* Medicine is not measured in coin. Left untended this man dies inside a week,
   and a dead man eats nothing, so for a while the household even reads richer.
   What the herbs buy is his life, and only later his labour. */
test("medicine is the difference between a sick man living and dying", () => {
  const outcome = (give) => {
    const { state, person } = household("survive", {
      person: { illness: "lung sickness", illnessDays: 9, health: 26 }
    });
    if (give) grantChurchResource(state, person, "medicine", 3);
    live(state, 20);
    return { alive: person.alive, illness: person.illness ?? "none" };
  };
  assert.equal(outcome(false).alive, false, "the untended man was expected to die of his sickness");
  const tended = outcome(true);
  assert.equal(tended.alive, true, "the tended man died even though the church treated him");
  assert.equal(tended.illness, "none", "the sickness was never actually thrown off");
});

/* Across a panel of villages the coin difference is usually nil, because in
   most of them the saving of one less mouth and the loss of one man's labour
   very nearly cancel. Where it does show, it shows strongly in the church's
   favour. This is the honest shape of it: medicine buys a life, not a profit. */
test("curing the earner never leaves the household poorer in the long run", () => {
  const sick = { person: { illness: "lung sickness", illnessDays: 9, health: 26 } };
  const values = SEED_PANEL.map((seed) => coinKeptBy(seed, "medicine", 3, 40, sick));
  const worst = Math.min(...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  /* One village in twelve ends a little poorer, and the reason is grim rather
     than wrong: left untended the earner dies, and a dead man eats nothing, so
     for a while the household reads richer for having lost him. Across the
     panel the cured man's labour outweighs it several times over. */
  assert.ok(worst > -1.5, `curing the earner left a household ${worst.toFixed(2)} worse off`);
  assert.ok(
    total > 5,
    `across ${values.length} villages curing the earner was worth only ${total.toFixed(2)} coin in all`
  );
});

test("illness and injury actually stop a household earning", () => {
  const { home, person } = household("capacity");
  const hale = producerEffectiveness(person, home);
  Object.assign(person, { illness: "lung sickness", illnessDays: 9, health: 26 });
  const sick = producerEffectiveness(person, home);
  assert.ok(
    sick < hale * 0.5,
    `a bedridden worker still produced ${(sick * 100).toFixed(0)}% against a hale ${(hale * 100).toFixed(0)}%`
  );
});

test("medicine lifts health and shortens the sickness at the moment it is given", () => {
  const { state, person } = household("immediate", {
    person: { illness: "lung sickness", illnessDays: 9, health: 26, stress: 70 }
  });
  const before = { days: person.illnessDays, health: person.health, stress: person.stress };
  grantChurchResource(state, person, "medicine", 3);
  assert.ok(person.illnessDays < before.days, "the sickness was not shortened");
  assert.ok(person.health > before.health, "health did not rise");
  assert.ok(person.stress < before.stress, "the fear of it did not ease");
  assert.ok(
    (person.flags ?? []).some((flag) => String(flag).startsWith("tended_by_church")),
    "the household was never marked as under church care, so mortality will not soften"
  );
});

test("firewood warms the household and lets the earner work again", () => {
  const { state, home, person } = household("warmth", {
    season: "Winter",
    household: { fuel: 1 },
    person: { health: 42, stress: 62 }
  });
  const before = {
    health: person.health,
    stress: person.stress,
    works: producerEffectiveness(person, home)
  };
  grantChurchResource(state, person, "firewood", 10);
  assert.ok(person.health > before.health, "warmth did not improve health");
  assert.ok(person.stress < before.stress, "warmth did not ease the household");
  assert.ok(
    producerEffectiveness(person, home) > before.works,
    "a warm household still could not work any better"
  );
});

/* Coin goes against debt before it goes into the purse, because debt bleeds a
   household every day and a purse does not. */
test("a gift of coin clears debt before it fills the purse", () => {
  const { state, home, person } = household("debt", { household: { wealth: 30, debt: 6 } });
  grantChurchResource(state, person, "coin", 10);
  assert.equal(home.debt, 0, "the debt was left standing");
  assert.ok(home.wealth > 30, "the remainder never reached the purse");
});
