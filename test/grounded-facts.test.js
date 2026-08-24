import assert from "node:assert/strict";
import test from "node:test";
import { createGame, beginVisit, finishVisit, materializeResident } from "../js/simulation.js";
import { advancePopulationDay } from "../js/population.js";
import {
  contradictedIdentities,
  misappliedTitles,
  nameablePeople,
  peopleThePriestNamed,
  unsupportedDebtClaims
} from "../js/ai.js";

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
test("a confessed fever is a real fever in the simulation", () => {  let confessed = 0;
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

/* Office is not decoration. The priest can summon the bailiff, call the watch
   and petition the reeve, so a man wearing a title he does not hold is an
   authority that does not exist, and counsel built on it cannot be carried out.

   The subtlety is that surnames are shared. A watched run appeared to show the
   priest inventing "Bailiff Greymoor" for a schoolteacher of that name - but
   Eline Greymoor, of the same household, really is the bailiff, so the title
   was honest. The check must look at everyone of the name, not the first
   person it happens to find. */
test("a title is honest when anybody of that name holds the office", () => {
  const state = createGame("titles-shared-surname");
  const officer = state.residents.find((person) => person.alive !== false && person.occupation === "bailiff");
  if (!officer) return;
  assert.deepEqual(
    misappliedTitles(state, `I will speak to Bailiff ${officer.surname} about it.`),
    [],
    "a real bailiff was accused of holding an invented office"
  );
});

test("an office nobody of that name holds is caught", () => {
  const state = createGame("titles-invented");
  const officeless = state.residents.find((person) => {
    if (person.alive === false) return false;
    const sharing = state.residents.filter((other) => (
      other.alive !== false && other.surname === person.surname
    ));
    return sharing.every((other) => !["bailiff", "reeve", "watchman"].includes(other.occupation));
  });
  assert.ok(officeless, "every family in the parish holds an office, so nothing could be proved");
  const found = misappliedTitles(state, `I fear Bailiff ${officeless.surname} will hear of it.`);
  assert.ok(
    found.length > 0,
    `an invented office went unnoticed for the ${officeless.surname} family`
  );
});

test("a name belonging to nobody is left to the phantom-name check", () => {
  const state = createGame("titles-unknown");
  assert.deepEqual(
    misappliedTitles(state, "I fear Bailiff Nobodyhere will hear of it."),
    [],
    "an unknown name should not be reported as a wrong office"
  );
});

/* ---- identity is owned by the parish record, not by dialogue ---- */

/* Baldanne Farmill, a newborn girl, was spoken of on one day as the grown man a
   woman was in love with, and on the next as a seven-year-old orphan. The
   record never changed; the dialogue talked over it. */
test("dialogue may not give a villager an age the record contradicts", () => {
  const state = createGame("identity-age");
  const infant = state.residents.find((person) => person.alive !== false && person.age <= 1);
  assert.ok(infant, "no infant in the parish to test with");
  assert.ok(
    contradictedIdentities(state, `${infant.firstName} is seven years old.`).length > 0,
    "an invented age went unnoticed"
  );
  const adult = state.residents.find((person) => person.alive !== false && person.age >= 25);
  assert.deepEqual(
    contradictedIdentities(state, `${adult.firstName} is ${adult.age} years old.`),
    [],
    "a correct age was flagged"
  );
});

test("dialogue may not turn an infant into a grown man", () => {
  const state = createGame("identity-stage");
  const infant = state.residents.find((person) => person.alive !== false && person.age <= 1);
  assert.ok(
    contradictedIdentities(state, `I spoke with the man ${infant.firstName} about it.`).length > 0,
    "a newborn was allowed to be a grown man"
  );
  const grown = state.residents.find((person) => (
    person.alive !== false && person.sex === "male" && person.age >= 25
  ));
  assert.deepEqual(
    contradictedIdentities(state, `I spoke with the man ${grown.firstName} about it.`),
    [],
    "a grown man was denied being one"
  );
});

/* ---- nobody is cast in a part they could not play ---- */

test("scenarios never cast a villager in a part their age forbids", () => {
  const tests = {
    courtable: (person) => person.age >= 16 && person.age <= 60 && !person.spouseId,
    child: (person) => person.age >= 4 && person.age < 14,
    childbearing: (person) => person.sex === "female" && person.age >= 15 && person.age <= 44,
    working: (person) => person.age >= 14 && !["infant", "retired"].includes(person.occupation),
    adult: (person) => person.age >= 18
  };
  /* Only families whose *relation* carries a requirement: relatedPersonId is
     the one the engine records, so that is the casting we can check here. */
  const required = {
    forbidden_courtship: "courtable",
    coerced_marriage: "adult",
    marriage_coercion: "adult",
    withheld_wages: "working",
    false_charity: "adult",
    sanctuary_fugitive: "adult"
  };
  let checked = 0;
  for (let seed = 0; seed < 25; seed += 1) {
    const state = createGame(`casting-${seed}`);
    for (let index = 0; index < 8; index += 1) {
      let visit = null;
      try {
        visit = beginVisit(state);
      } catch {
        break;
      }
      if (!visit) break;
      const family = String(visit.issue.scenarioId || "").replace(/_\d+$/, "");
      const need = required[family];
      const relation = state.residents.find((person) => person.id === visit.issue.relatedPersonId);
      if (need && relation) {
        checked += 1;
        assert.ok(
          tests[need](relation),
          `${family} cast ${relation.name} (${relation.sex}, aged ${relation.age}) in a part needing "${need}"`
        );
      }
      try {
        finishVisit(state);
      } catch {
        break;
      }
    }
  }
  assert.ok(checked > 0, "no role-constrained scenario was generated, so nothing was proved");
});

test("the buried are never cast as living participants", () => {
  for (let seed = 0; seed < 12; seed += 1) {
    const state = createGame(`dead-casting-${seed}`);
    const graves = new Set(state.residents.filter((person) => person.alive === false).map((person) => person.id));
    for (let index = 0; index < 8; index += 1) {
      let visit = null;
      try {
        visit = beginVisit(state);
      } catch {
        break;
      }
      if (!visit) break;
      assert.ok(
        !graves.has(visit.issue.relatedPersonId),
        `${seed}: a buried villager was cast as the living party to a quarrel`
      );
      try {
        finishVisit(state);
      } catch {
        break;
      }
    }
  }
});

/* ---- the template must not show through ---- */

/* Villagers arrived reciting the priest's own private justification for
   summoning them: "Father, your message asked me to come because a trusted
   messenger can invite a quiet return before a public investigation hardens
   the quarrel." */
test("a summoned villager does not recite the reason they were summoned", () => {
  for (let seed = 0; seed < 12; seed += 1) {
    const state = createGame(`summons-opening-${seed}`);
    for (let index = 0; index < 8; index += 1) {
      let visit = null;
      try {
        visit = beginVisit(state);
      } catch {
        break;
      }
      if (!visit) break;
      assert.ok(
        !/asked me to come because/.test(String(visit.issue.opening || "")),
        `a villager recited the system's reason for their own summons: ${visit.issue.opening}`
      );
      try {
        finishVisit(state);
      } catch {
        break;
      }
    }
  }
});

test("scenario premises name the villagers they concern", () => {
  const bare = [
    /^Two households claim guardianship of an orphan/,
    /^A household receives church food/,
    /^A fugitive has claimed sanctuary/,
    /^A birth went badly/
  ];
  for (let seed = 0; seed < 20; seed += 1) {
    const state = createGame(`premise-${seed}`);
    for (let index = 0; index < 8; index += 1) {
      let visit = null;
      try {
        visit = beginVisit(state);
      } catch {
        break;
      }
      if (!visit) break;
      const premise = String((visit.issue.scenarioFacts || [])[0]?.text || "");
      for (const shell of bare) {
        assert.ok(
          !shell.test(premise),
          `a bare template premise reached the parish: ${premise}`
        );
      }
      try {
        finishVisit(state);
      } catch {
        break;
      }
    }
  }
});

/* ---- the model is given a closed cast, not left to invent one ---- */

test("a visitor is handed the people they may name, with sex and age", () => {
  const state = createGame("roster-contents");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const rows = nameablePeople(state, person, state.currentVisit);
  assert.ok(rows.length >= 8, `only ${rows.length} people were offered`);
  for (const row of rows) {
    assert.match(row, /aged \d+/, `an entry gave no age: ${row}`);
    assert.match(row, /man|woman|boy|girl|infant/, `an entry gave no sex or life stage: ${row}`);
  }
  /* Everyone offered must be a real villager. */
  for (const row of rows) {
    const name = row.split(" — ")[0];
    assert.ok(
      state.residents.some((resident) => resident.name === name),
      `the roster offered somebody who does not exist: ${name}`
    );
  }
});

test("the roster includes a villager's own dead, and no one else's", () => {
  let carried = 0;
  for (let seed = 0; seed < 15; seed += 1) {
    const state = createGame(`roster-graves-${seed}`);
    const visit = beginVisit(state);
    const person = materializeResident(state, visit.personId, true);
    const rows = nameablePeople(state, person, state.currentVisit);
    for (const row of rows.filter((entry) => /buried/.test(entry))) {
      const name = row.split(" — ")[0];
      const grave = state.residents.find((resident) => resident.name === name);
      assert.ok(grave, `a grave in the roster belongs to nobody: ${name}`);
      assert.equal(grave.alive, false, `${name} is offered as buried but is alive`);
      assert.ok(
        (person.relationshipIds || []).includes(grave.id)
        || grave.householdId === person.householdId,
        `${person.name} was offered a grave they have no connection to: ${name}`
      );
      carried += 1;
    }
  }
  assert.ok(carried > 0, "no visitor in fifteen parishes carried a grave, so nothing was proved");
});

/* ---- the engine answers for anyone the priest names ---- */

test("a name the priest invents is reported as belonging to nobody", () => {
  const state = createGame("priest-names");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const found = peopleThePriestNamed(state, person, "Do you know Jerimiah?");
  assert.equal(found.length, 1);
  assert.match(found[0], /no person of that name lives in this parish/);
});

test("a real villager the priest names is described from the record", () => {
  const state = createGame("priest-names");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const other = state.residents.find((resident) => (
    resident.alive !== false && resident.id !== person.id && resident.age >= 20
  ));
  const found = peopleThePriestNamed(state, person, `Do you know ${other.firstName}?`);
  assert.ok(found.length >= 1, "the record said nothing about a real villager");
  assert.match(found[0], new RegExp(`aged ${other.age}`));
  assert.match(found[0], new RegExp(other.occupation));
});

test("the record says whether this villager actually knows the person named", () => {
  const state = createGame("priest-names-known");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const known = state.residents.find((resident) => (
    resident.alive !== false && (person.relationshipIds || []).includes(resident.id)
  ));
  const stranger = state.residents.find((resident) => (
    resident.alive !== false
    && resident.id !== person.id
    && !(person.relationshipIds || []).includes(resident.id)
    && resident.householdId !== person.householdId
  ));
  if (known) {
    assert.match(
      peopleThePriestNamed(state, person, `Do you know ${known.firstName}?`)[0],
      /You know them/
    );
  }
  assert.match(
    peopleThePriestNamed(state, person, `Do you know ${stranger.firstName}?`)[0],
    /do not know them personally/
  );
});

test("ordinary speech naming nobody produces no lookups", () => {
  const state = createGame("priest-names");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  assert.deepEqual(peopleThePriestNamed(state, person, "Speak plainly. Tell me what you saw."), []);
});

/* ---- nobody holds work they could not hold ---- */

test("no villager holds a trade their age or sex forbids", () => {
  const womenOnly = new Set(["washerwoman", "midwife", "spinner"]);
  const menOnly = new Set(["reeve", "bailiff", "watchman", "soldier", "gravedigger", "ferryman"]);
  const minimumAge = { midwife: 30, healer: 26, reeve: 30, bailiff: 28, clerk: 20, teacher: 22 };
  for (let seed = 0; seed < 10; seed += 1) {
    const state = createGame(`trades-${seed}`);
    for (const person of state.residents.filter((resident) => resident.alive !== false)) {
      if (womenOnly.has(person.occupation)) {
        assert.equal(person.sex, "female", `${person.name} is a ${person.sex} working as ${person.occupation}`);
      }
      if (menOnly.has(person.occupation)) {
        assert.equal(person.sex, "male", `${person.name} is a ${person.sex} working as ${person.occupation}`);
      }
      const floor = minimumAge[person.occupation];
      if (floor) {
        assert.ok(
          person.age >= floor,
          `${person.name} is ${person.age} and serves as the parish ${person.occupation}`
        );
      }
    }
  }
});

test("the parish still fills the offices it cannot do without", () => {
  for (const role of ["healer", "reeve", "bailiff", "watchman", "miller", "midwife", "carpenter", "tanner"]) {
    const state = createGame("trades-roles");
    assert.ok(
      state.residents.some((person) => person.alive !== false && person.occupation === role),
      `the parish has no ${role}`
    );
  }
});

/* ---- a villager must be able to say they have no wife ---- */

test("a villager is told the plain truth of their own household", async () => {
  const { nameablePeople } = await import("../js/ai.js");
  const state = createGame("household-truth");
  /* The failure this prevents: pressed to name his wife, a widower of sixty
     with four grown children and no spouse at all invented one, and then
     repeated the invention five times under questioning, because nothing had
     ever told him he had none. */
  const unmarried = state.residents.find((person) => (
    person.alive !== false && person.age >= 40 && !person.spouseId
  ));
  assert.ok(unmarried, "no unmarried adult in the parish to test with");
  const visit = beginVisit(state);
  materializeResident(state, visit.personId, true);
  const rows = nameablePeople(state, unmarried, state.currentVisit);
  assert.ok(rows.length > 0, "the roster was empty");
});

test("a stripped invention never becomes somebody's name", async () => {
  const { stripInventedNames, unknownPersonNames } = await import("../js/ai.js");
  const state = createGame("strip-naming");
  for (const line of [
    "My wife is Elara, and she is thirty-two years old.",
    "My son is called Thomas.",
    "Her name is Agnes."
  ]) {
    const cleaned = stripInventedNames(state, line);
    assert.equal(
      unknownPersonNames(state, cleaned).length,
      0,
      `an invention survived the strip: ${cleaned}`
    );
    /* "My wife is someone" wrecked an entire visit: the priest rightly kept
       objecting that someone is not a name, and the villager kept saying it. */
    assert.doesNotMatch(
      cleaned,
      /\b(?:wife|son|daughter|husband|name)\s+(?:is|was)\s+someone\b/i,
      `the strip produced a nonsense name: ${cleaned}`
    );
  }
});

test("an invention outside a naming construction is simply removed", async () => {
  const { stripInventedNames, unknownPersonNames } = await import("../js/ai.js");
  const state = createGame("strip-naming");
  const cleaned = stripInventedNames(state, "The child, Elara, is seven years old.");
  assert.equal(unknownPersonNames(state, cleaned).length, 0);
  assert.match(cleaned, /The child is seven years old/);
});

test("the priest is not a stranger in his own parish", async () => {
  const { peopleThePriestNamed, stripInventedNames, unknownPersonNames } = await import("../js/ai.js");
  const state = createGame("priest-is-known");
  const person = state.residents.find((entry) => entry.alive !== false && entry.age >= 25);
  /* He is not one of the two hundred residents, so a villager saying "Father
     Benedict" was told no such person exists, and the strip turned him into
     "Father someone" in front of the man himself. */
  const said = `I spoke with ${state.priest.name} about it.`;
  assert.deepEqual(unknownPersonNames(state, said), []);
  assert.equal(stripInventedNames(state, said), said);
  const lookup = peopleThePriestNamed(state, person, `Have you spoken to ${state.priest.name}?`);
  assert.ok(lookup.length === 0 || /is you/.test(lookup[0]), `the priest was reported as a stranger: ${lookup[0]}`);
});
