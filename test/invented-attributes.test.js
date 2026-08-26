/* Two things a villager should not be able to invent under pressure.

   An age, and a plan the priest has already forbidden.

   Aldric named an infant as his eyewitness and, pressed for the child's age,
   gave "a babe", "barely a few months old", "born three weeks ago" and "just
   shy of four months" in one conversation, along with two different fathers.
   Every name in it was real - the phantom guard held - and the parish record
   had the child's age all along. The fabrication was in the attributes, which
   nothing checked.

   Julian had withdrawn every fact behind his accusation: he had not seen the
   receipts, did not know the claimants, the name "just came to mind", and he
   had not made the promise he claimed. He still went on saying "I will retract
   the charge to both Similda and Edold and ask Edold's pardon" for the rest of
   the hour, while the priest told him repeatedly not to approach either child,
   because doing so would spread an accusation neither had heard.
*/

import test from "node:test";
import assert from "node:assert/strict";

import { createGame, beginVisit, materializeResident, recordExchange } from "../js/simulation.js";
import { unsupportedAgeClaims, unknownPersonNames, unsupportedDebtClaims } from "../js/ai.js";
import { naturalClient } from "./semantic-test-client.js";

function scene(seed) {
  const state = createGame(seed);
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  return { state, visit, person };
}

/** Somebody with a first name nobody else in the parish shares. */
function unambiguous(state, person) {
  return state.residents.find((resident) => (
    resident.id !== person.id
      && resident.active
      && !state.residents.some((other) => other.id !== resident.id && other.firstName === resident.firstName)
  ));
}

test("an age that contradicts the record is caught", () => {
  const { state, person } = scene("age-contradiction");
  const other = unambiguous(state, person);
  const wrong = Number(other.age) + 11;
  const found = unsupportedAgeClaims(state, person, `${other.firstName} is ${wrong} years old, Father.`);
  assert.equal(found.length, 1, `nothing was caught: ${JSON.stringify(found)}`);
  assert.match(found[0], new RegExp(String(other.age)));
});

test("the age the record actually holds passes", () => {
  /* The roster hands the model everyone's age. Repeating it correctly is the
     behaviour being asked for and must never be flagged. */
  const { state, person } = scene("age-correct");
  const other = unambiguous(state, person);
  assert.deepEqual(
    unsupportedAgeClaims(state, person, `${other.firstName} is ${other.age} years old, Father.`),
    []
  );
});

test("a villager may say their own age", () => {
  const { state, person } = scene("age-own");
  assert.deepEqual(
    unsupportedAgeClaims(state, person, `I am ${Number(person.age) + 5} years old, Father.`),
    []
  );
  assert.deepEqual(
    unsupportedAgeClaims(state, person, `${person.firstName} is ${Number(person.age) + 5} years old.`),
    []
  );
});

test("speaking vaguely about age is left alone", () => {
  /* People do not talk like a clerk reading a roll. A guard that punished
     "a babe" or "getting on in years" would flatten every villager. */
  const { state, person } = scene("age-vague");
  const other = unambiguous(state, person);
  for (const line of [
    `${other.firstName} is a babe, Father.`,
    `${other.firstName} is getting on in years.`,
    `${other.firstName} is past sixty, I should think.`,
    `${other.firstName} is old enough to work.`
  ]) {
    assert.deepEqual(unsupportedAgeClaims(state, person, line), [], line);
  }
});

test("an age is not called wrong merely because a name is shared", () => {
  /* A first name is not unique in this parish. If anybody of that name fits
     the claim, the villager may have meant them - the same rule the kinship
     check uses, and the reason it stopped accusing truthful people. */
  const { state, person } = scene("age-shared-name");
  const shared = state.residents.find((resident) => (
    resident.id !== person.id
      && state.residents.some((other) => other.id !== resident.id && other.firstName === resident.firstName)
  ));
  if (!shared) return;
  assert.deepEqual(
    unsupportedAgeClaims(state, person, `${shared.firstName} is ${shared.age} years old.`),
    []
  );
});

test("being born within the year is checked against the record", () => {
  /* "Born three weeks ago" puts somebody under a year old. Said of a child
     the parish has down as four, it is the same contradiction in other
     clothes - and it is how one infant acquired a birth date, then a second
     one that disagreed with it. */
  const { state, person } = scene("age-born-recently");
  const grown = state.residents.find((resident) => (
    resident.id !== person.id
      && Number(resident.age) >= 4
      && !state.residents.some((other) => other.id !== resident.id && other.firstName === resident.firstName)
  ));
  const found = unsupportedAgeClaims(state, person, `${grown.firstName} was born three weeks ago.`);
  assert.equal(found.length, 1, `nothing was caught: ${JSON.stringify(found)}`);

  const infant = state.residents.find((resident) => Number(resident.age) === 0);
  if (infant) {
    assert.deepEqual(
      unsupportedAgeClaims(state, person, `${infant.firstName} was born three weeks ago.`),
      [],
      "a real infant may have been born within the year"
    );
  }
});

test("a name is a pair, not two words that each happen to be known", () => {
  /* Every part of "Valric Redstead" passed: there was a Valric Valebury and
     an Idard Redstead, so both halves were familiar and the man was waved
     through. He did not exist, and the priest sent for him. */
  const state = createGame("misjoined-names");
  const first = state.residents[0];
  const second = state.residents.find((resident) => resident.surname !== first.surname);
  const invented = `${first.firstName} ${second.surname}`;
  assert.ok(
    !state.residents.some((resident) => resident.name === invented),
    "this test needs a name that belongs to nobody"
  );
  assert.deepEqual(unknownPersonNames(state, `I spoke with ${invented} at the mill.`), [invented]);
});

test("real people, the priest and neighbouring clergy are not misjoined names", () => {
  const state = createGame("misjoined-names-safe");
  const real = state.residents[3];
  assert.deepEqual(unknownPersonNames(state, `I spoke with ${real.name} at the mill.`), []);
  assert.deepEqual(unknownPersonNames(state, `I spoke with ${state.priest.name} after mass.`), []);
  const parish = state.neighboringParishes[0];
  assert.deepEqual(unknownPersonNames(state, `I sent word to ${parish.priestName}.`), []);
  assert.deepEqual(unknownPersonNames(state, "It was the feast of Saint Michael."), []);
});

test("a plan the priest forbids stops being restated", async () => {
  const { state, visit, person } = scene("forbidden-plan");
  const client = naturalClient({
    understoodPlayerAs: "u",
    reply: "I will go to them and ask their pardon, Father.",
    npcIntent: "n",
    proposedActions: []
  });
  const forbid = "You must not go near either child, nor speak to them of this."
    + " Do not approach them, and do not repeat the charge to anyone.";
  recordExchange(state, forbid, await client.conversation(state, person, forbid));
  assert.ok(
    (visit.intent.forbiddenPlans || []).length,
    "the priest's prohibition was not recorded"
  );

  /* And the villager has to be told, or he will simply say it again. */
  let whole = "";
  const probe = naturalClient((parsed) => {
    whole = parsed.prompt;
    return { understoodPlayerAs: "u", reply: "Then I shall not, Father.", npcIntent: "n", proposedActions: [] };
  });
  await probe.conversation(state, person, "What will you do instead?");
  assert.match(whole, /The priest has forbidden this/);
});

test("ordinary counsel is not mistaken for a prohibition", async () => {
  /* Silencing a villager's honest intention to make amends would be far worse
     than the loop this fixes. */
  const { state, visit, person } = scene("forbidden-plan-not");
  const client = naturalClient({
    understoodPlayerAs: "u", reply: "I will, Father.", npcIntent: "n", proposedActions: []
  });
  for (const counsel of [
    "Go to him and ask his pardon, and make what restitution you can.",
    "You should speak with the reeve about this before the week is out.",
    "I do not think you are to blame for what happened at the mill."
  ]) {
    recordExchange(state, counsel, await client.conversation(state, person, counsel));
  }
  assert.deepEqual(visit.intent.forbiddenPlans || [], []);
});

test("an age written in words is caught as readily as one in figures", () => {
  /* Villagers do not write "11". The real transcript said "He is eleven years
     old, and a child laborer", and a check that read only digits saw none of
     the fabrication it was written for. */
  const { state, person } = scene("age-in-words");
  const other = state.residents.find((resident) => (
    resident.id !== person.id
      && Number(resident.age) !== 11
      && !state.residents.some((o) => o.id !== resident.id && o.firstName === resident.firstName)
  ));
  const found = unsupportedAgeClaims(state, person, `${other.firstName} is eleven years old, a child laborer.`);
  assert.equal(found.length, 1, `nothing was caught: ${JSON.stringify(found)}`);
});

test("an age hung on a pronoun is still an age", () => {
  /* "Danger is my son, Danger. He is eleven years old." The age belongs to
     the person named in the sentence before, which is how people talk and how
     the fabrication actually reached the priest. */
  const { state, person } = scene("age-pronoun");
  const other = state.residents.find((resident) => (
    resident.id !== person.id
      && Number(resident.age) !== 11
      && !state.residents.some((o) => o.id !== resident.id && o.firstName === resident.firstName)
  ));
  const found = unsupportedAgeClaims(
    state,
    person,
    `${other.firstName} is my witness. He is eleven years old, and a child laborer.`
  );
  assert.equal(found.length, 1, `nothing was caught: ${JSON.stringify(found)}`);
  assert.match(found[0], new RegExp(other.firstName));
});

test("a pronoun carrying a true age is left alone", () => {
  const { state, person } = scene("age-pronoun-true");
  const other = state.residents.find((resident) => (
    resident.id !== person.id
      && Number(resident.age) > 0
      && !state.residents.some((o) => o.id !== resident.id && o.firstName === resident.firstName)
  ));
  assert.deepEqual(
    unsupportedAgeClaims(state, person, `${other.firstName} spoke to me. She is ${other.age} years old.`),
    []
  );
});

/** A visit whose household is clear and whose matter is not about money. */
function clearOfDebt() {
  for (let index = 0; index < 20; index += 1) {
    const state = createGame(`debt-denial-${index}`);
    const visit = beginVisit(state);
    const person = materializeResident(state, visit.personId, true);
    const household = state.households.find((entry) => entry.id === person.householdId);
    const moneyFacts = (visit.scenarioFacts || [])
      .map((fact) => String(fact.text))
      .filter((fact) => /\bdebt|owes?|owed|unpaid|wages\b/i.test(fact));
    if (Number(household.debt) > 0.5 || moneyFacts.length) continue;
    return { state, visit, person };
  }
  return null;
}

test("a villager denying a debt is not accused of inventing one", async () => {
  /* "We owe no one anything" was reported as claiming a debt: the denial sits
     after the verb and the word is "anything", so neither half of the old
     negation check saw it. The priest was then sent to relieve a debt the man
     had just told him he did not have - a false accusation, which is worse
     than the invention it guards against. */
  const found = clearOfDebt();
  assert.ok(found, "no debt-free visit could be generated");
  const { state, visit, person } = found;
  for (const line of [
    "My son Hugh is nineteen. The nine measures of grain are sacks. We owe no one anything.",
    "We owe nothing to anybody, Father.",
    "I owe no man a penny.",
    "We owe none of them anything.",
    "I do not owe twenty pennies.",
    "We owe not a farthing."
  ]) {
    assert.deepEqual(unsupportedDebtClaims(state, person, visit, line), [], line);
  }
});

test("an invented debt is still caught", () => {
  /* Clearing the denials must not switch the guard off: a villager naming a
     sum his household does not owe sends the priest to work on nothing. */
  const { state, visit, person } = clearOfDebt();
  assert.deepEqual(
    unsupportedDebtClaims(state, person, visit, "I owe twenty silver pennies to the miller."),
    ["twenty silver pennies"]
  );
});
