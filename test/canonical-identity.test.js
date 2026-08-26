import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  createGame,
  finishVisit,
  materializeResident
} from "../js/simulation.js";
import {
  contradictedKinship,
  identityLine,
  kinshipTo,
  nameablePeople,
  peopleThePriestNamed
} from "../js/ai.js";

/* Identity comes from the record, not from the model.
 *
 * A woman was asked what kin a neighbour was to her and answered "she is my
 * neighbour", when the record had that woman down as her own mother, in the
 * same household. The roster knew - but it labelled her "the person this
 * matter concerns" and the kinship was never mentioned, because the first
 * label won and nothing computed the relation.
 *
 * Kinship is not decoration: the priest decides whom to summon, whom to
 * believe and where a duty lies on the strength of it.
 */

function household(seed) {
  const state = createGame(seed);
  const withParents = state.residents.find((person) => (
    person.alive !== false && (person.parentIds || []).length > 0
  ));
  return { state, person: withParents };
}

test("a parent is a mother or a father, never a neighbour", () => {
  const { state, person } = household("kin-parent");
  assert.ok(person, "no villager with a recorded parent");
  const parent = state.residents.find((entry) => entry.id === person.parentIds[0]);
  const kin = kinshipTo(state, person, parent);
  assert.equal(kin, parent.sex === "female" ? "your mother" : "your father");
});

test("a child is a son or a daughter, not merely 'your child'", () => {
  const state = createGame("kin-child");
  const parent = state.residents.find((person) => (
    person.alive !== false && (person.childrenIds || []).some((id) => (
      state.residents.find((entry) => entry.id === id)?.alive !== false
    ))
  ));
  assert.ok(parent, "no villager with a living child");
  const child = state.residents.find((entry) => entry.id === parent.childrenIds[0]);
  assert.match(kinshipTo(state, parent, child), /^your (?:son|daughter)/);
});

/* Siblings were invisible: the old labelling had no notion of them at all, so
   a brother read as "of your household". The pair is found by walking the
   record rather than by re-implementing the rule, since a test that restates
   the implementation can only confirm the sex-to-word mapping. */
test("two people who share a parent are brother and sister", () => {
  let proved = 0;
  for (let seed = 0; seed < 12 && proved === 0; seed += 1) {
    const state = createGame(`kin-sibling-${seed}`);
    for (const parent of state.residents) {
      const children = (parent.childrenIds || [])
        .map((id) => state.residents.find((entry) => entry.id === id))
        .filter(Boolean);
      if (children.length < 2) continue;
      const [first, second] = children;
      assert.equal(
        kinshipTo(state, first, second),
        second.sex === "female" ? "your sister" : "your brother",
        `${first.name} and ${second.name} share the parent ${parent.name}`
      );
      /* And it must not be mistaken for the weaker household relation. */
      assert.notEqual(kinshipTo(state, first, second), "of your household");
      proved += 1;
      break;
    }
  }
  assert.ok(proved > 0, "no pair of siblings was found, so nothing was proved");
});

/* Both bugs the reviewer found live in links stored on the OTHER party: a
   buried parent keeps childrenIds while the surviving child's parentIds is
   never written, and a villager widowed in play has spouseId cleared. */
test("a buried parent is still a mother or a father to their living child", () => {
  let proved = 0;
  for (let seed = 0; seed < 15 && proved === 0; seed += 1) {
    const state = createGame(`kin-buried-parent-${seed}`);
    for (const grave of state.residents.filter((entry) => entry.alive === false)) {
      for (const childId of grave.childrenIds || []) {
        const child = state.residents.find((entry) => entry.id === childId);
        if (!child || child.alive === false) continue;
        assert.match(
          kinshipTo(state, child, grave),
          /your (?:mother|father)/,
          `${child.name} should know ${grave.name} for a parent, not a housemate`
        );
        proved += 1;
        break;
      }
      if (proved) break;
    }
  }
  assert.ok(proved > 0, "no buried parent with a living child, so nothing was proved");
});

test("a villager widowed during play can still name their own husband", () => {
  const state = createGame("kin-runtime-widow");
  const survivor = state.residents.find((entry) => entry.alive !== false && entry.spouseId);
  assert.ok(survivor, "nobody married in this parish");
  const spouse = state.residents.find((entry) => entry.id === survivor.spouseId);
  const wordBefore = kinshipTo(state, survivor, spouse);
  assert.match(wordBefore, /your (?:husband|wife)/);
  /* Exactly what the death handler in population.js does. */
  spouse.alive = false;
  spouse.active = false;
  spouse.causeOfDeath = "lung sickness";
  survivor.maritalStatus = "widowed";
  survivor.widowedFromId = spouse.id;
  survivor.spouseId = null;
  assert.match(
    kinshipTo(state, survivor, spouse),
    /your (?:late )?(?:husband|wife)/,
    "a widow lost the link to her own buried husband"
  );
  assert.deepEqual(
    contradictedKinship(state, survivor, `${spouse.firstName} is my ${spouse.sex === "female" ? "wife" : "husband"}.`),
    [],
    "a widow naming her own husband was accused of lying"
  );
});

/* A grave keeps the household it was buried out of, which is not a household
   it belongs to: a departed neighbour must not read as kin. */
test("a buried neighbour is not a member of the household", () => {
  for (let seed = 0; seed < 15; seed += 1) {
    const state = createGame(`kin-buried-neighbour-${seed}`);
    for (const grave of state.residents.filter((entry) => (
      entry.alive === false && entry.survivedByRole === "neighbour"
    ))) {
      const housemate = state.residents.find((entry) => (
        entry.alive !== false && entry.householdId === grave.householdId
      ));
      if (!housemate) continue;
      assert.notEqual(
        kinshipTo(state, housemate, grave),
        "of your household",
        `${grave.name} was buried out of that house, not living in it`
      );
      return;
    }
  }
});

/* First names are not unique, so a claim is only wrong when nobody of that
   name fits it. */
test("a shared first name does not make a true kinship a lie", () => {
  for (let seed = 0; seed < 25; seed += 1) {
    const state = createGame(`kin-dupe-${seed}`);
    for (const person of state.residents) {
      for (const sibling of state.residents) {
        if (sibling.id === person.id) continue;
        const kin = kinshipTo(state, person, sibling);
        if (kin !== "your brother" && kin !== "your sister") continue;
        const twin = state.residents.find((entry) => (
          entry.id !== sibling.id && entry.firstName === sibling.firstName
        ));
        if (!twin) continue;
        const word = sibling.sex === "female" ? "sister" : "brother";
        assert.deepEqual(
          contradictedKinship(state, person, `${sibling.firstName} is my ${word}.`),
          [],
          `${person.name} was accused of lying about ${sibling.name} because ${twin.name} shares the name`
        );
        return;
      }
    }
  }
});

/* In-law relations are expressed with a genitive and the record cannot state
   them, so reading one as a claim about the first relative would have the
   priest interrogate a truthful villager. */
test("genitives, reported speech and denials are not kinship claims", () => {
  const state = createGame("kin-precision");
  const person = state.residents.find((entry) => entry.alive !== false && (entry.parentIds || []).length);
  const other = state.residents.find((entry) => (
    entry.alive !== false && (person.relationshipIds || []).includes(entry.id)
  ));
  if (!person || !other) return;
  for (const line of [
    `${other.firstName} is my mother's sister.`,
    `${other.firstName} is my brother's wife.`,
    `He said ${other.firstName} is my sister, but it is not so.`,
    `If ${other.firstName} is my sister, I am the Pope.`,
    `${other.firstName} is not my neighbour.`
  ]) {
    assert.deepEqual(
      contradictedKinship(state, person, line),
      [],
      `a truthful or hypothetical line was flagged: ${line}`
    );
  }
});

/* The challenge and the retry note both quote this back, and quoting the
   opposite of what a villager said is no way to get them to correct it. */
test("a kinship finding states what was said, not its negation", () => {
  const { state, person } = household("kin-wording");
  assert.ok(person);
  const parent = state.residents.find((entry) => entry.id === person.parentIds[0]);
  const found = contradictedKinship(state, person, `${parent.firstName} is my neighbour.`);
  assert.ok(found.length > 0);
  assert.match(found[0], /is your neighbour/, `the finding negated the villager's own words: ${found[0]}`);
  assert.doesNotMatch(found[0], /is not your neighbour/);
});

test("a villager is nothing to themselves, and a stranger is named as one", () => {
  const state = createGame("kin-edges");
  const person = state.residents.find((entry) => entry.alive !== false);
  assert.equal(kinshipTo(state, person, person), null);
  const stranger = state.residents.find((entry) => (
    entry.alive !== false
    && entry.id !== person.id
    && entry.householdId !== person.householdId
    && !(person.relationshipIds || []).includes(entry.id)
  ));
  assert.equal(kinshipTo(state, person, stranger), "not known to you personally");
});

/* The failure that prompted all of this: the matter-role used to replace the
   kinship rather than sit beside it. */
test("being the subject of the matter never hides what someone is to you", () => {
  const { state, person } = household("kin-not-hidden");
  assert.ok(person);
  const parent = state.residents.find((entry) => entry.id === person.parentIds[0]);
  const line = identityLine(state, person, parent, "the person this matter concerns");
  assert.match(line, /your (?:mother|father)/, `the kinship was lost: ${line}`);
  assert.match(line, /the person this matter concerns/, `the matter-role was lost: ${line}`);
});

test("the roster states kinship for everyone it lists", () => {
  const { state, person } = household("kin-roster");
  assert.ok(person);
  const rows = nameablePeople(state, person, { issue: { relatedPersonId: person.parentIds[0] } });
  const parent = state.residents.find((entry) => entry.id === person.parentIds[0]);
  const row = rows.find((entry) => entry.startsWith(parent.name));
  assert.ok(row, "the parent was left out of the roster");
  assert.match(row, /your (?:mother|father)/);
});

test("the engine answers what kin somebody is when the priest asks", () => {
  const { state, person } = household("kin-lookup");
  assert.ok(person);
  const parent = state.residents.find((entry) => entry.id === person.parentIds[0]);
  const answer = peopleThePriestNamed(state, person, `What kin is ${parent.firstName} to you?`);
  assert.ok(answer.length, "the record said nothing about a real relative");
  assert.match(answer[0], /They are your (?:mother|father)/);
});

test("a kinship the record denies is caught", () => {
  const { state, person } = household("kin-detector");
  assert.ok(person);
  const parent = state.residents.find((entry) => entry.id === person.parentIds[0]);
  const wrong = parent.sex === "female" ? "mother" : "father";
  assert.deepEqual(
    contradictedKinship(state, person, `${parent.firstName} is my ${wrong}.`),
    [],
    "a true kinship was reported as a contradiction"
  );
  const found = contradictedKinship(state, person, `${parent.firstName} is my neighbour.`);
  assert.ok(found.length > 0, "calling a parent a neighbour went unnoticed");
  assert.match(found[0], new RegExp(`is your ${wrong}`));
});

test("ordinary speech naming no kinship is left alone", () => {
  const { state, person } = household("kin-quiet");
  assert.ok(person);
  assert.deepEqual(
    contradictedKinship(state, person, "It happened near the mill, Father, after dusk."),
    []
  );
});

/* The record is incomplete, and silence is not denial. Two brothers in one
   house may have no recorded parent between them, because the parish only
   records a parent where the ages allow it, so "Belger is my brother" is
   unproven rather than false. Both of these are verbatim from a live run. */
test("a kinship the record cannot settle is left alone", () => {
  for (let seed = 0; seed < 20; seed += 1) {
    const state = createGame(`kin-unsettled-${seed}`);
    /* Two people of one household with no recorded tie of any kind between
       them: not spouses, not parent and child, no parent in common. The record
       simply does not say whether they are siblings. */
    const untied = (person, other) => (
      other.id !== person.id
      && other.alive !== false
      && other.householdId === person.householdId
      && person.spouseId !== other.id && other.spouseId !== person.id
      && person.widowedFromId !== other.id && other.widowedFromId !== person.id
      && !(person.childrenIds || []).includes(other.id)
      && !(other.childrenIds || []).includes(person.id)
      && !(person.parentIds || []).includes(other.id)
      && !(other.parentIds || []).includes(person.id)
      && !(person.parentIds || []).some((id) => (other.parentIds || []).includes(id))
    );
    const pair = state.residents.find((person) => (
      person.alive !== false && state.residents.some((other) => untied(person, other))
    ));
    if (!pair) continue;
    const other = state.residents.find((entry) => untied(pair, entry));
    const word = other.sex === "female" ? "sister" : "brother";
    assert.deepEqual(
      contradictedKinship(state, pair, `${other.firstName} is my ${word}.`),
      [],
      `the record does not know whether ${other.name} is a sibling, so it must not call it a lie`
    );
    return;
  }
});

/* Living under the speaker's own roof is recorded, and does settle it: a man
   does not call the boy in his own house a neighbour. */
test("calling a member of your own household a neighbour is still caught", () => {
  for (let seed = 0; seed < 20; seed += 1) {
    const state = createGame(`kin-housemate-${seed}`);
    const person = state.residents.find((entry) => (
      entry.alive !== false
      && state.residents.some((other) => (
        other.id !== entry.id && other.alive !== false && other.householdId === entry.householdId
      ))
    ));
    if (!person) continue;
    const housemate = state.residents.find((entry) => (
      entry.id !== person.id && entry.alive !== false && entry.householdId === person.householdId
    ));
    const found = contradictedKinship(state, person, `I will send word to my neighbour, ${housemate.firstName}.`);
    assert.ok(found.length > 0, `${housemate.name} shares a roof and was called a neighbour`);
    return;
  }
});
