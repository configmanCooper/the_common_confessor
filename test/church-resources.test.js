import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  createGame,
  fallbackDeparturePlan,
  finishVisit,
  materializeResident,
  recordExchange,
  replayGame,
  validateDeparturePlan
} from "../js/simulation.js";
import { deserializeState, sealState, serializeState } from "../js/state.js";

test("new parishes begin with named church stores", () => {
  const state = createGame("church-resource-start");
  assert.deepEqual(state.churchResources, {
    coin: 24,
    grain: 14,
    bread: 18,
    beans: 12,
    onions: 16,
    saltedFish: 8,
    cheese: 6,
    firewood: 20,
    medicine: 5
  });
});

test("promised church aid transfers real stores to the visitor's household", () => {
  const state = createGame("church-resource-aid");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const household = state.households.find((entry) => entry.id === person.householdId);
  const breadBefore = state.churchResources.bread;
  const foodBefore = household.food;
  recordExchange(state, "The church will give you 3 loaves of bread.", {
    reply: "Thank you, Father. That will feed us tonight.",
    memory: "The church promised bread."
  });
  assert.equal(state.churchResources.bread, breadBefore - 3);
  assert.equal(household.food, Math.min(100, foodBefore + 6));
  const replayed = replayGame(state.seed, state.commandLog, state.replayBase);
  assert.equal(replayed.churchResources.bread, state.churchResources.bread);
});

test("visitors can donate specific resources to the church after counsel", () => {
  const state = createGame("church-resource-donation");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  person.age = Math.max(18, person.age);
  const household = state.households.find((entry) => entry.id === person.householdId);
  household.food = 80;
  const grainBefore = state.churchResources.grain;
  recordExchange(state, "Please donate 2 sacks of grain to the church for hungry families.", {
    reply: "Yes, Father. I can bring two sacks.",
    memory: "The visitor agreed to donate grain."
  });
  const plan = fallbackDeparturePlan(state);
  assert.equal(plan.steps[0].actionType, "donate");
  assert.equal(plan.steps[0].targetId, "priest");
  assert.equal(plan.steps[0].detail, "grain:2");
  assert.equal(validateDeparturePlan(state, plan).complete, true);
  finishVisit(state, { ...plan, source: "fallback" });
  assert.equal(state.churchResources.grain, grainBefore + 2);
  assert.equal(household.food, 72);
});

test("schema-10 parishes gain church stores during migration", () => {
  const legacy = createGame("church-resource-migration");
  delete legacy.churchResources;
  legacy.schemaVersion = 10;
  legacy.version = 10;
  sealState(legacy);
  const migrated = deserializeState(JSON.stringify(legacy));
  assert.equal(migrated.schemaVersion, 13);
  assert.equal(migrated.churchResources.bread, 18);
  assert.doesNotThrow(() => serializeState(migrated));
});
