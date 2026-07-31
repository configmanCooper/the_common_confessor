import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAction,
  beginVisit,
  createGame,
  departureCandidates,
  validateDeparturePlan
} from "../js/simulation.js";
import { advancePopulationDay } from "../js/population.js";
import { compactReplayHistory, deserializeState, serializeState } from "../js/state.js";

test("seasons and weather deterministically change material conditions", () => {
  const first = createGame("material-season-seed");
  const second = createGame("material-season-seed");
  for (let day = 1; day <= 400; day += 1) {
    for (const state of [first, second]) {
      state.calendar.absoluteDay = day;
      state.calendar.dayIndex = day % 7;
      state.calendar.week = Math.floor(day / 7) + 1;
      advancePopulationDay(state);
    }
  }
  assert.deepEqual(first.material, second.material);
  assert.ok(["Spring", "Summer", "Autumn", "Winter"].includes(first.material.season));
  assert.ok(first.material.grainPrice >= 0 && first.material.grainPrice <= 100);
});

test("repair and food counsel change household material state", () => {
  const state = createGame("material-actions");
  const actor = state.residents[0];
  const target = state.residents.find((person) => person.householdId !== actor.householdId);
  const source = state.households.find((household) => household.id === actor.householdId);
  const destination = state.households.find((household) => household.id === target.householdId);
  source.food = 80;
  destination.food = 5;
  applyAction(state, { actorId: actor.id, targetId: target.id, actionType: "share_food", intensity: 4, title: "", description: "" });
  assert.ok(source.food < 80);
  assert.ok(destination.food > 5);
  const infrastructure = state.material.infrastructure;
  applyAction(state, { actorId: actor.id, targetId: null, actionType: "repair", intensity: 4, title: "", description: "" });
  assert.ok(state.material.infrastructure > infrastructure);
  const poor = createGame("resource-gated-construction");
  const poorActor = poor.residents.find((person) => person.occupation === "laborer") || poor.residents[0];
  const poorHousehold = poor.households.find((household) => household.id === poorActor.householdId);
  poorHousehold.wealth = 0;
  poorHousehold.food = 0;
  poor.material.infrastructure = 0;
  const prosperity = poor.town.metrics.prosperity;
  const safety = poor.town.metrics.safety;
  assert.equal(applyAction(poor, { actorId: poorActor.id, targetId: null, actionType: "repair", intensity: 5, title: "", description: "" }), null);
  assert.equal(poor.material.infrastructure, 0);
  assert.equal(poor.town.metrics.prosperity, prosperity);
  assert.equal(poor.town.metrics.safety, safety);
});

test("seasonal grain prices change household wealth outcomes", () => {
  const spring = createGame("seasonal-price-economy");
  const winter = createGame("seasonal-price-economy");
  for (const state of [spring, winter]) {
    state.households.forEach((household) => {
      household.food = 20;
      household.wealth = 50;
    });
  }
  spring.calendar.absoluteDay = 1;
  spring.calendar.dayIndex = 1;
  spring.material.grainPrice = 40;
  winter.calendar.absoluteDay = 300;
  winter.calendar.dayIndex = 6;
  winter.calendar.week = 43;
  winter.material.grainPrice = 80;
  advancePopulationDay(spring);
  advancePopulationDay(winter);
  assert.notEqual(spring.households[0].wealth, winter.households[0].wealth);
});

test("material state saves and migrates", () => {
  const state = createGame("material-save");
  state.calendar.absoluteDay = 100;
  state.calendar.dayIndex = 2;
  state.calendar.week = 15;
  advancePopulationDay(state);
  compactReplayHistory(state);
  const restored = deserializeState(serializeState(state));
  assert.deepEqual(restored.material, state.material);
});

test("abandoned households do not distort food security and justice reduces crime", () => {
  const state = createGame("occupied-household-material");
  const occupied = state.households[0];
  occupied.food = 0;
  for (const household of state.households.slice(1)) {
    household.food = 100;
    household.memberIds.forEach((id) => {
      const person = state.residents.find((resident) => resident.id === id);
      person.active = false;
    });
  }
  state.calendar.absoluteDay = 1;
  state.calendar.dayIndex = 1;
  advancePopulationDay(state);
  assert.ok(state.material.foodSecurity < 20);
  const actor = state.residents.find((person) => person.active);
  const before = state.material.crime;
  applyAction(state, { actorId: actor.id, targetId: null, actionType: "report_crime", intensity: 4, title: "", description: "" });
  assert.ok(state.material.crime < before);
});

test("ordinary labor preserves infrastructure through twelve weeks", () => {
  const state = createGame("infrastructure-equilibrium");
  for (let day = 1; day <= 84; day += 1) {
    state.calendar.absoluteDay = day;
    state.calendar.dayIndex = day % 7;
    state.calendar.week = Math.floor(day / 7) + 1;
    advancePopulationDay(state);
  }
  assert.ok(state.material.infrastructure > 5);
  assert.ok(state.material.infrastructure < 95);
  const occupied = state.households.filter((household) => household.memberIds.some((id) => {
    const person = state.residents.find((resident) => resident.id === id);
    return person?.active && person.alive;
  }));
  const averageFood = occupied.reduce((sum, household) => sum + household.food, 0) / occupied.length;
  const averageWealth = occupied.reduce((sum, household) => sum + household.wealth, 0) / occupied.length;
  assert.ok(averageFood < 95);
  assert.ok(averageWealth < 95);
});

test("loans, donations, price relief, and organized aid move real resources", () => {
  const state = createGame("material-counsel-transfers");
  const actor = state.residents[0];
  const target = state.residents.find((person) => person.householdId !== actor.householdId);
  const source = state.households.find((household) => household.id === actor.householdId);
  const destination = state.households.find((household) => household.id === target.householdId);
  source.wealth = 80;
  source.food = 80;
  destination.wealth = 5;
  destination.food = 5;
  applyAction(state, { actorId: actor.id, targetId: target.id, actionType: "lend_money", intensity: 3, title: "", description: "" });
  assert.ok(destination.wealth > 5 && destination.debt > 0);
  const afterLoan = destination.wealth;
  applyAction(state, { actorId: actor.id, targetId: target.id, actionType: "donate", intensity: 2, title: "", description: "" });
  assert.ok(destination.wealth > afterLoan);
  const price = state.material.grainPrice;
  applyAction(state, { actorId: actor.id, targetId: null, actionType: "lower_prices", intensity: 3, title: "", description: "" });
  assert.ok(state.material.grainPrice < price);
  const food = destination.food;
  applyAction(state, { actorId: actor.id, targetId: null, actionType: "organize_aid", intensity: 3, title: "", description: "" });
  assert.ok(destination.food >= food);
});

test("failed or intra-household material transfers produce no benefits", () => {
  const state = createGame("failed-material-transfer");
  const actor = state.residents[0];
  const sameHouseholdTarget = state.residents.find((person) => person.id !== actor.id && person.householdId === actor.householdId);
  const household = state.households.find((entry) => entry.id === actor.householdId);
  household.wealth = 0;
  household.food = 0;
  const mercy = state.town.metrics.mercy;
  const result = applyAction(state, { actorId: actor.id, targetId: null, actionType: "donate", intensity: 3, title: "", description: "" });
  assert.equal(result, null);
  assert.equal(state.town.metrics.mercy, mercy);
  if (sameHouseholdTarget) {
    household.wealth = 50;
    const debt = household.debt;
    assert.equal(applyAction(state, {
      actorId: actor.id,
      targetId: sameHouseholdTarget.id,
      actionType: "lend_money",
      intensity: 3,
      title: "",
      description: ""
    }), null);
    assert.equal(household.debt, debt);
    const mercyBefore = state.town.metrics.mercy;
    assert.equal(applyAction(state, {
      actorId: actor.id,
      targetId: sameHouseholdTarget.id,
      actionType: "donate",
      intensity: 3,
      title: "",
      description: ""
    }), null);
    assert.equal(state.town.metrics.mercy, mercyBefore);
  }
});

test("AI validation rejects unfunded or abandoned-household transfers", () => {
  const state = createGame("invalid-material-plan");
  const visit = beginVisit(state);
  const actor = state.residents.find((person) => person.id === visit.personId);
  const target = state.residents.find((person) => person.householdId !== actor.householdId);
  if (!actor.relationshipIds.includes(target.id)) actor.relationshipIds.push(target.id);
  const source = state.households.find((household) => household.id === actor.householdId);
  source.food = 0;
  visit.counsel.push("Give and share food with this household.");
  assert.equal(validateDeparturePlan(state, {
    steps: [{ actorId: actor.id, targetId: target.id, actionType: "share_food", intensity: 3 }]
  }, departureCandidates(state)).complete, false);
  source.food = 50;
  const destination = state.households.find((household) => household.id === target.householdId);
  destination.memberIds.forEach((id) => {
    const person = state.residents.find((resident) => resident.id === id);
    person.active = false;
  });
  assert.equal(validateDeparturePlan(state, {
    steps: [{ actorId: actor.id, targetId: target.id, actionType: "share_food", intensity: 3 }]
  }, [actor, target]).complete, false);
});
