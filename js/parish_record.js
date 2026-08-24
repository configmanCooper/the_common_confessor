/* The parish record, and a way to check dialogue against it.
 *
 * The engine owns who these people are: their age, their sex, their trade,
 * whether they are alive, what their household actually holds. A conversation
 * is free to be evasive, mistaken or self-serving - that is what people are -
 * but it must never quietly rewrite the record. A playthrough turned up a
 * newborn girl described as the grown man a woman loved, a woman with a clear
 * ledger announcing a debt of twenty silver pennies, and a man discussed at
 * length who lived nowhere in the village.
 *
 * Everything here is read-only and deterministic. It is the instrument the
 * playtesting priest uses to catch the world contradicting itself, and it is
 * also the guard the ordinary game runs before a line is allowed to stand.
 */

import {
  contradictedIdentities,
  misappliedTitles,
  unknownPersonNames,
  unsupportedDebtClaims
} from "./ai.js";

/* What the parish knows about somebody, by any name they might be called. */
export function lookUpPerson(state, name) {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return null;
  const matches = (state.residents || []).filter((person) => {
    const full = String(person.name || "").toLowerCase();
    return full === wanted
      || String(person.firstName || "").toLowerCase() === wanted
      || String(person.surname || "").toLowerCase() === wanted;
  });
  if (!matches.length) return null;
  const living = matches.filter((person) => person.alive !== false);
  const person = living[0] || matches[0];
  const household = (state.households || []).find((entry) => entry.id === person.householdId);
  return {
    id: person.id,
    name: person.name,
    age: person.age,
    sex: person.sex,
    occupation: person.occupation,
    alive: person.alive !== false,
    causeOfDeath: person.causeOfDeath || null,
    maritalStatus: person.maritalStatus || "single",
    spouseId: person.spouseId || null,
    illness: person.illness || null,
    injured: Boolean(person.injury && !person.injury.healed),
    household: household
      ? {
        id: household.id,
        debt: Math.round(household.debt || 0),
        wealth: Math.round(household.wealth || 0),
        food: Math.round(household.food || 0),
        dwelling: household.dwelling
      }
      : null,
    sharesName: matches.length > 1
      ? matches.map((entry) => `${entry.name}, ${entry.occupation}, aged ${entry.age}`)
      : null
  };
}

/* Claims a villager can make that the record can settle outright. Each finding
   says what was claimed and what is actually true, in words a priest could
   repeat back to the person who said it. */
export function verifyAgainstRecord(state, text, { person = null, visit = null } = {}) {
  const speech = String(text || "");
  if (!speech.trim()) return [];
  const findings = [];
  const add = (kind, claim, truth) => findings.push({ kind, claim, truth });

  for (const name of unknownPersonNames(state, speech)) {
    add("invented_person", `spoke of ${name}`, `no one called ${name} lives in this parish`);
  }
  for (const entry of misappliedTitles(state, speech)) {
    add("wrong_office", entry, "the office belongs to someone else");
  }
  for (const entry of contradictedIdentities(state, speech)) {
    /* These arrive as "Baldanne is not 7 (Baldanne is 1)". Split the claim
       from the truth so the priest can put it plainly rather than reciting a
       double negative. */
    const parts = String(entry).match(/^(.*?)\s*\((.*)\)$/);
    add("identity", parts ? parts[1] : entry, parts ? parts[2] : "the parish record says otherwise");
  }
  if (person) {
    for (const entry of unsupportedDebtClaims(state, person, visit, speech)) {
      const household = (state.households || []).find((home) => home.id === person.householdId);
      const owed = Math.round(household?.debt || 0);
      add(
        "invented_debt",
        `said you owe ${entry}`,
        owed > 0 ? `your household owes ${owed}` : "your household owes nothing to anybody"
      );
    }
  }

  /* Someone spoken of as dead who is not, or as living who is buried. */
  const deathPattern = /\b([A-Z][a-z]{2,})\s+(?:has\s+)?(?:died|is dead|was buried|passed away)\b/g;
  let match = deathPattern.exec(speech);
  while (match !== null) {
    const record = lookUpPerson(state, match[1]);
    if (record && record.alive) {
      add("false_death", `said ${record.name} is dead`, `${record.name} is alive, aged ${record.age}`);
    }
    match = deathPattern.exec(speech);
  }

  /* Someone spoken of as sick who is well. Only first-person and named claims
     are checked; talk of "the babe" or "her boy" is about people the record
     may not track. */
  const illPattern = /\b([A-Z][a-z]{2,})\s+(?:is|has been|lies)\s+(?:ill|sick|abed|fevered|dying)\b/g;
  match = illPattern.exec(speech);
  while (match !== null) {
    const record = lookUpPerson(state, match[1]);
    if (record && record.alive && !record.illness && !record.injured) {
      add("false_illness", `said ${record.name} is ill`, `${record.name} is in health`);
    }
    match = illPattern.exec(speech);
  }

  return findings;
}

/* A short, quotable summary a priest can use to press someone on a
   discrepancy without breaking the fiction. */
export function challengeFor(finding) {
  switch (finding.kind) {
    case "invented_person":
      return `You ${finding.claim}. I know every soul in this parish and there is no such person. Who do you actually mean?`;
    case "wrong_office":
      return `You said ${finding.claim}. That is not his office. Name the man you actually mean.`;
    case "identity":
      return `You spoke as though ${finding.claim}. That is not so — ${finding.truth}. Tell me again, plainly.`;
    case "invented_debt":
      return `You ${finding.claim}, yet ${finding.truth}. Explain that to me.`;
    case "false_death":
      return `You ${finding.claim}. I buried no such person. ${finding.truth}. What do you mean by it?`;
    case "false_illness":
      return `You ${finding.claim}, but ${finding.truth}. Why do you say so?`;
    default:
      return `You said ${finding.claim}, and ${finding.truth}.`;
  }
}
