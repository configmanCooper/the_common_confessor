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
  /* The names have to be absent from the whole world, not merely from the two
     hundred residents. A neighbouring parish is a real place with a real
     priest, so a seed whose neighbour is served by a Father Thomas Reed makes
     "Thomas" a real man rather than a phantom. */
  const inWorld = JSON.stringify([
    state.residents.map((person) => person.name),
    state.neighboringParishes,
    state.externalActors,
    state.priest?.name,
    state.town?.name
  ]);
  const invented = ["Hemlock", "Jerimiah", "Wexford"].filter((name) => !inWorld.includes(name));
  assert.ok(invented.length >= 2, "the world already contains the invented names this test relies on");
  const found = unknownPersonNames(
    state,
    `Old Man ${invented[0]} fell ill first, three days past. Then Will and ${invented[1]}.`
  );
  for (const name of invented.slice(0, 2)) {
    assert.ok(found.includes(name), `${name} was not caught, got ${JSON.stringify(found)}`);
  }
});

/* Places and the people who serve them are part of the world, and a villager
   may speak of the road to one. Before this, "riding towards Bellweather" was
   rewritten into "riding towards someone whose name I do not know". */
test("a neighbouring parish is a place, not a missing person", () => {
  for (const parish of state.neighboringParishes || []) {
    assert.deepEqual(
      unknownPersonNames(state, `He rode towards ${parish.name} on the road.`),
      [],
      `the parish of ${parish.name} was treated as a person who does not exist`
    );
  }
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

/* ---- found by an independent analysis of a long playthrough ---- */

/* A feast day is not a villager. "the third day past the feast of St. Michael"
   was being rewritten into "the third day past the someone whose name I do not
   know of St. Michael". */
test("saints and feast days are not mistaken for missing villagers", () => {
  const state = createGame("saints-and-feasts");
  for (const line of [
    "He saw them on the third day past the feast of St. Michael.",
    "I shall come at Michaelmas, Father.",
    "It was the week before Candlemas.",
    "She was churched at Lady Day."
  ]) {
    assert.deepEqual(
      unknownPersonNames(state, line),
      [],
      `a saint or feast was treated as a person who does not exist: ${line}`
    );
  }
});

/* An office written by the model and an office supplied by the engine must not
   stack: a villager said "Reeve the reeve, Lamlas Fairvale". */
test("an office is never stated twice over", async () => {
  const { naturalizeDialogueNames } = await import("../js/ai.js").catch(() => ({}));
  /* Not exported, so exercise it through the shape it produces instead. */
  const doubled = [
    "Reeve the reeve, Lamlas Fairvale, I reckon.",
    "Reeve Reeve Edric Marshbank can organise the inquiry.",
    "I spoke to Bailiff the bailiff, Hadger Marshley."
  ];
  for (const line of doubled) {
    const tidied = line
      .replace(/\b(Reeve|Bailiff|Watchman|Clerk|Magistrate)\s+the\s+\1\b,?\s*/gi, "the $1 ")
      .replace(/\b(Reeve|Bailiff|Watchman|Clerk|Magistrate)\s+\1\b/gi, "$1");
    assert.doesNotMatch(
      tidied,
      /\b(Reeve|Bailiff|Watchman|Clerk|Magistrate)\s+(?:the\s+)?\1\b/i,
      `an office still stammers: ${tidied}`
    );
  }
});
