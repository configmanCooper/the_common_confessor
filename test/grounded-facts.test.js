import assert from "node:assert/strict";
import test from "node:test";
import { createGame, beginVisit, finishVisit } from "../js/simulation.js";
import { advancePopulationDay } from "../js/population.js";
import { unsupportedDebtClaims } from "../js/ai.js";

/* Things the priest acts upon must be true.

   A hallucinated adjective is harmless; a hallucinated debt is not, because the
   priest will open the church stores to relieve it. These cover the three
   ungrounded claims found by auditing two watched playthroughs: invented money,
   grief for somebody still alive, and a confessed fever the simulation never
   gave anybody. */

function villageWithHistory(seed, days) {
  const state = createGame(seed);
  for (let day = 1; day <= days; day += 1) {
    state.calendar.absoluteDay = day;
    advancePopulationDay(state);
  }
  return state;
}

/* In a watched run a woman whose household owed nothing announced that she
   owed twenty silver pennies, and the priest set about relieving a debt that
   never existed. */
test("a debt the ledger does not carry is caught", () => {
  const state = createGame("debt-claims");
  const person = state.residents[0];
  const home = state.households.find((entry) => entry.id === person.householdId);
  home.debt = 0;
  for (const line of [
    "I owe her twenty silver pennies.",
    "I owe her 20 silver pennies."
  ]) {
    assert.ok(
      unsupportedDebtClaims(state, person, null, line).length > 0,
      `an invented debt went unnoticed: ${line}`
    );
  }
});

test("denials and other people's debts are not mistaken for invented ones", () => {
  const state = createGame("debt-claims");
  const person = state.residents[0];
  const home = state.households.find((entry) => entry.id === person.householdId);
  home.debt = 0;
  for (const line of [
    "I do not owe him anything.",
    "I owe nothing to any man.",
    "He owes me nine days of wages.",
    "My neighbour owes the reeve a great deal.",
    "Thank you, Father. This will help."
  ]) {
    assert.deepEqual(
      unsupportedDebtClaims(state, person, null, line),
      [],
      `an honest line was flagged as an invented debt: ${line}`
    );
  }
});

/* A debt the engine itself authored is genuine, and the visitor must be free to
   speak the sum it gave them. */
test("a sum supplied by the scenario may be spoken, but a different one may not", () => {
  const state = createGame("debt-claims");
  const person = state.residents[0];
  const home = state.households.find((entry) => entry.id === person.householdId);
  home.debt = 0;
  const visit = { scenarioFacts: [{ text: "The unpaid work totals 9 days." }] };
  assert.deepEqual(
    unsupportedDebtClaims(state, person, visit, "I owe her 9 silver pennies."),
    [],
    "the sum the engine authored was rejected"
  );
  assert.ok(
    unsupportedDebtClaims(state, person, visit, "I owe her 40 silver pennies.").length > 0,
    "a sum the engine never authored was accepted"
  );
});

test("a household that really is in debt may speak of it freely", () => {
  const state = createGame("debt-claims");
  const person = state.residents[0];
  const home = state.households.find((entry) => entry.id === person.householdId);
  home.debt = 12;
  assert.deepEqual(
    unsupportedDebtClaims(state, person, null, "I owe her twenty silver pennies."),
    [],
    "a real debtor was accused of inventing their debt"
  );
});

/* The grief scenario chose its dead at random from the living, so the priest
   consoled a man over a neighbour who was still walking about the village and
   who could knock at the church door himself a week later. */
test("nobody is mourned who is still alive", () => {
  let mourned = 0;
  let living = 0;
  for (let seed = 0; seed < 12; seed += 1) {
    const state = villageWithHistory(`grief-${seed}`, 240);
    for (let visitIndex = 0; visitIndex < 8; visitIndex += 1) {
      let visit = null;
      try {
        visit = beginVisit(state);
      } catch {
        break;
      }
      if (!visit) break;
      if (String(visit.issue.scenarioId || "").includes("faith_after_death")) {
        mourned += 1;
        const named = String(visit.issue.opening || "").match(/^(.+?) died after/);
        const person = named ? state.residents.find((entry) => entry.name === named[1]) : null;
        if (!person || person.alive) living += 1;
      }
      try {
        finishVisit(state);
      } catch {
        break;
      }
    }
  }
  assert.equal(living, 0, `${living} of ${mourned} grief scenarios mourned somebody still alive`);
});

/* The visitor confesses to hiding a fever and to having shared tools and meals,
   and the whole matter turns on whether it spreads - but the engine left them
   perfectly well, so they could not infect anyone, be treated, or worsen. */
test("a confessed fever is a real fever in the simulation", () => {
  let confessed = 0;
  let notActuallyIll = 0;
  for (let seed = 0; seed < 30; seed += 1) {
    const state = villageWithHistory(`fever-${seed}`, 45);
    for (let visitIndex = 0; visitIndex < 6; visitIndex += 1) {
      let visit = null;
      try {
        visit = beginVisit(state);
      } catch {
        break;
      }
      if (!visit) break;
      if (String(visit.issue.scenarioId || "").includes("hidden_illness")) {
        confessed += 1;
        const person = state.residents.find((entry) => entry.id === visit.personId);
        if (!person?.illness) notActuallyIll += 1;
      }
      try {
        finishVisit(state);
      } catch {
        break;
      }
    }
  }
  assert.ok(confessed > 0, "no concealed-fever scenario was generated, so nothing was proved");
  assert.equal(
    notActuallyIll,
    0,
    `${notActuallyIll} of ${confessed} visitors confessed a fever they did not have`
  );
});
