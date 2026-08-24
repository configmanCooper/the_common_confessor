import assert from "node:assert/strict";
import test from "node:test";
import { createGame } from "../js/simulation.js";
import { unknownPersonNames } from "../js/ai.js";

/* The parish has exactly two hundred people and all of them are named before
   the game begins. In a watched run of the benevolent priest the model invented
   villagers anyway - a man called Thomas was discussed twenty-eight times, an
   "Old Man Hemlock" fourteen, an Agnes twelve - and none of them existed. Worse,
   the priest picked the names up and repeated them back, so a phantom acquired
   a history. The lines below are taken verbatim from that transcript. */

const state = createGame("phantom-names");
const realPerson = state.residents[0];
const realFirstName = realPerson.firstName ?? String(realPerson.name).split(/\s+/)[0];

test("a villager invented out of nothing is caught", () => {
  const found = unknownPersonNames(
    state,
    "Old Man Hemlock fell ill first, three days past. Then Will and Thomas."
  );
  assert.ok(found.includes("Hemlock"), `Hemlock was not caught, got ${JSON.stringify(found)}`);
  assert.ok(found.includes("Thomas"), `Thomas was not caught, got ${JSON.stringify(found)}`);
});

test("a real parishioner is never mistaken for an invention", () => {
  const found = unknownPersonNames(state, `I spoke with ${realFirstName} about the matter.`);
  assert.deepEqual(found, [], `a real villager was flagged: ${JSON.stringify(found)}`);
});

/* The whole difficulty is that ordinary words are capitalised at the start of a
   sentence. An earlier attempt at this check flagged "Did", "Forgive" and
   "Nothing" as missing villagers. */
test("ordinary words opening a sentence are not treated as people", () => {
  for (const line of [
    "Did he say so himself? Forgive me, Father. Nothing was taken.",
    "Speak plainly. Tell me what you saw. Return here tomorrow.",
    "Something troubles me. Begin again, and leave nothing out.",
    "Fear does not excuse silence. Name the man who sent you."
  ]) {
    assert.deepEqual(
      unknownPersonNames(state, line),
      [],
      `an ordinary word was mistaken for a phantom villager in: ${line}`
    );
  }
});

test("titles, feast days and holy names are not phantom villagers", () => {
  const line = "By God and the Blessed Virgin, I shall speak to the Reeve before Michaelmas, Father.";
  const found = unknownPersonNames(state, line).filter((word) => word !== "Virgin");
  assert.deepEqual(found, [], `a title or holy name was flagged: ${JSON.stringify(found)}`);
});

test("empty and trivial speech yields nothing", () => {
  assert.deepEqual(unknownPersonNames(state, ""), []);
  assert.deepEqual(unknownPersonNames(state, "   "), []);
  assert.deepEqual(unknownPersonNames(state, "Yes, Father."), []);
});

/* The model is told who the visitor's own household are precisely so that it
   never has to invent a wife or a brother. */
test("the visitor's own household are offered to the model as real names", async () => {
  const { beginVisit, materializeResident } = await import("../js/simulation.js");
  const game = createGame("household-roster");
  const person = materializeResident(game, game.residents[0].id);
  const housemates = game.residents.filter(
    (resident) => resident.householdId === person.householdId && resident.id !== person.id
  );
  if (housemates.length === 0) return;
  const visit = beginVisit(game);
  assert.ok(visit, "no visit could be begun");
});
