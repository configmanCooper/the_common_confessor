import assert from "node:assert/strict";
import test from "node:test";
import { createGame } from "../js/simulation.js";
import { serializeState, deserializeState } from "../js/state.js";

/* A parish that begins with two hundred identical cottages is not a village.

   Every household once started with exactly fifty in coin, fifty in the larder,
   no debt and the same woodpile, so there were no rich and no poor and the
   priest's charity had nowhere meaningful to land. Nobody had a memory either,
   so the first person through the door carried no grief, no old quarrel and no
   hard winter behind them. These cover the world the game now opens with. */

const PANEL = ["seeded-a", "seeded-b", "seeded-c", "seeded-d"];

test("households differ in what they own", () => {
  const state = createGame("means-spread");
  const wealth = state.households.map((home) => Math.round(home.wealth));
  const food = state.households.map((home) => Math.round(home.food));
  assert.ok(
    new Set(wealth).size >= 20,
    `households should not all be equally rich, saw ${new Set(wealth).size} distinct values`
  );
  assert.ok(new Set(food).size >= 20, "households should not all hold the same larder");
  assert.ok(Math.max(...wealth) - Math.min(...wealth) >= 40, "no meaningful gap between rich and poor");
  assert.ok(
    state.households.some((home) => home.debt > 0),
    "no household in the parish owes anything"
  );
  assert.ok(
    state.households.some((home) => home.debt === 0),
    "every household is in debt, which is not a village either"
  );
});

test("a household's standing follows the work its people do", () => {
  /* Averaged over several parishes, houses with a reeve, miller or blacksmith
     in them should be better off than houses of labourers and shepherds. */
  const wellSet = [];
  const poorSet = [];
  for (const seed of PANEL) {
    const state = createGame(seed);
    for (const home of state.households) {
      const trades = home.memberIds
        .map((id) => state.residents.find((person) => person.id === id)?.occupation)
        .filter(Boolean);
      if (trades.some((trade) => ["reeve", "bailiff", "merchant", "miller", "blacksmith", "innkeeper"].includes(trade))) {
        wellSet.push(home.wealth);
      } else if (trades.every((trade) => ["laborer", "shepherd", "servant", "child laborer", "infant", "retired"].includes(trade))) {
        poorSet.push(home.wealth);
      }
    }
  }
  assert.ok(wellSet.length && poorSet.length, "the panel produced no comparison to make");
  const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
  assert.ok(
    mean(wellSet) > mean(poorSet) + 8,
    `trade should tell: well-placed ${mean(wellSet).toFixed(1)} against poor ${mean(poorSet).toFixed(1)}`
  );
});

test("the parish opens with graves, and they are not counted among the living", () => {
  for (const seed of PANEL) {
    const state = createGame(seed);
    const living = state.residents.filter((person) => person.alive !== false);
    const departed = state.residents.filter((person) => person.alive === false);
    assert.equal(living.length, 200, `${seed}: the living parish must be exactly two hundred`);
    assert.ok(departed.length >= 8, `${seed}: only ${departed.length} graves`);
    for (const grave of departed) {
      assert.equal(grave.active, false, `${seed}: ${grave.name} is dead but still active`);
      assert.ok(grave.causeOfDeath, `${seed}: ${grave.name} died of nothing`);
      assert.ok(grave.departureDay < 0, `${seed}: ${grave.name} was buried after the game began`);
      assert.ok(
        grave.arrivalDay <= grave.departureDay,
        `${seed}: ${grave.name} left before arriving`
      );
    }
    /* They must never be fed, taxed or counted as mouths. */
    const inRolls = state.households.reduce((total, home) => (
      total + home.memberIds.filter((id) => departed.some((grave) => grave.id === id)).length
    ), 0);
    assert.equal(inRolls, 0, `${seed}: ${inRolls} dead villagers are still on a household roll`);
  }
});

test("a cause of death fits the age of the body", () => {
  for (const seed of PANEL) {
    const state = createGame(seed);
    for (const grave of state.residents.filter((person) => person.alive === false)) {
      if (grave.causeOfDeath === "old age") {
        assert.ok(grave.age >= 62, `${grave.name} died of old age at ${grave.age}`);
      }
      if (grave.causeOfDeath === "childbed") {
        assert.equal(grave.sex, "female", `${grave.name} died in childbed`);
        assert.ok(grave.age >= 15 && grave.age <= 44, `${grave.name} died in childbed at ${grave.age}`);
      }
    }
  }
});

test("the living remember their dead", () => {
  const state = createGame("grief-seeded");
  const living = state.residents.filter((person) => person.alive !== false);
  const bereaved = living.filter((person) => (
    (person.memories || []).some((memory) => memory.type === "bereavement")
  ));
  assert.ok(bereaved.length >= 10, `only ${bereaved.length} people carry a grave`);
  for (const person of bereaved) {
    for (const memory of person.memories.filter((entry) => entry.type === "bereavement")) {
      const grave = state.residents.find((entry) => entry.id === memory.subjectId);
      assert.ok(grave, `${person.name} mourns somebody who does not exist`);
      assert.equal(grave.alive, false, `${person.name} mourns ${grave.name}, who is alive`);
    }
  }
  assert.ok(
    living.some((person) => person.widowedFromId),
    "no widow or widower in the whole parish"
  );
});

test("people arrive in the world with a past", () => {
  const state = createGame("history-seeded");
  const living = state.residents.filter((person) => person.alive !== false);
  const withPast = living.filter((person) => (person.memories || []).length);
  assert.ok(
    withPast.length >= living.length * 0.9,
    `only ${withPast.length} of ${living.length} villagers remember anything`
  );
  const kinds = new Set();
  for (const person of living) for (const memory of person.memories || []) kinds.add(memory.type);
  for (const expected of ["grievance", "kindness", "hardship"]) {
    assert.ok(kinds.has(expected), `nobody in the parish carries a ${expected}`);
  }
  /* A remembered quarrel must be with somebody real, and must predate play. */
  for (const person of living) {
    for (const memory of person.memories || []) {
      assert.ok(memory.day <= 0, `${person.name} remembers something from the future`);
      assert.ok(
        state.residents.some((entry) => entry.id === memory.subjectId),
        `${person.name} remembers somebody who does not exist`
      );
    }
  }
});

test("the seeded world survives being saved and loaded", () => {
  const state = createGame("seeded-roundtrip");
  const restored = deserializeState(serializeState(state));
  const graves = (parish) => parish.residents.filter((person) => person.alive === false).length;
  const memories = (parish) => parish.residents.reduce(
    (total, person) => total + (person.memories || []).length,
    0
  );
  assert.equal(graves(restored), graves(state), "graves were lost on reload");
  assert.equal(memories(restored), memories(state), "remembered pasts were lost on reload");
  assert.deepEqual(
    restored.households.map((home) => Math.round(home.wealth)),
    state.households.map((home) => Math.round(home.wealth)),
    "household standing was lost on reload"
  );
});
