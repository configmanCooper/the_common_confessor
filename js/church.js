import { CHURCH_RESOURCE_DEFINITIONS } from "./data.js";

const NUMBER_WORDS = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  a: 1,
  an: 1
});

const RESOURCE_ALIASES = Object.freeze({
  coin: ["silver pennies", "silver penny", "pennies", "penny", "coins", "coin", "silver"],
  grain: ["sacks of grain", "sack of grain", "grain", "flour"],
  bread: ["loaves of bread", "loaf of bread", "loaves", "loaf", "bread", "food"],
  beans: ["dried beans", "beans"],
  onions: ["onions", "onion"],
  saltedFish: ["salted fish", "fish"],
  cheese: ["wheels of cheese", "wheel of cheese", "cheese"],
  firewood: ["bundles of firewood", "bundle of firewood", "firewood", "wood"],
  medicine: ["medicinal herbs", "medicine", "herbs", "remedy"]
});

function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

export function createChurchResources() {
  return Object.fromEntries(Object.entries(CHURCH_RESOURCE_DEFINITIONS).map(([key, definition]) => [
    key,
    definition.initial
  ]));
}

export function upgradeChurchResources(state) {
  state.churchResources ||= {};
  for (const [key, definition] of Object.entries(CHURCH_RESOURCE_DEFINITIONS)) {
    state.churchResources[key] ??= definition.initial;
  }
  return state.churchResources;
}

export function churchResourceRows(resources) {
  return Object.entries(CHURCH_RESOURCE_DEFINITIONS).map(([key, definition]) => ({
    key,
    label: definition.label,
    unit: definition.unit,
    amount: Math.max(0, Math.floor(Number(resources?.[key]) || 0))
  }));
}

export function parseChurchTransferIntent(text) {
  const speech = String(text || "").toLowerCase();
  const outgoing = /\b(?:church|we|i)\b.{0,35}\b(?:will|shall|can|may)\b.{0,20}\b(?:give|provide|offer|lend|spare)\b|\b(?:take|receive)\b.{0,30}\bfrom the church\b/.test(speech);
  const incoming = /\b(?:donate|give|bring|contribute|offer)\b.{0,35}\b(?:to|for)\s+(?:the\s+)?church\b|\bchurch\b.{0,30}\b(?:accept|receive)\b/.test(speech);
  if (!outgoing && !incoming) return null;
  let matched = null;
  for (const [resource, aliases] of Object.entries(RESOURCE_ALIASES)) {
    for (const alias of aliases) {
      const index = speech.indexOf(alias);
      if (index >= 0 && (!matched || alias.length > matched.alias.length)) {
        matched = { resource, alias, index };
      }
    }
  }
  if (!matched) matched = { resource: incoming ? "coin" : "bread", alias: incoming ? "coin" : "bread", index: speech.length };
  const nearby = speech.slice(Math.max(0, matched.index - 24), matched.index);
  const numeric = nearby.match(/(\d{1,3})\D*$/);
  const word = nearby.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|a|an)\W*$/);
  const amount = clamp(numeric ? Number(numeric[1]) : NUMBER_WORDS[word?.[1]] || 1, 1, 100);
  return {
    direction: incoming && !outgoing ? "incoming" : "outgoing",
    resource: matched.resource,
    amount
  };
}

export function parseChurchDonationDetail(detail, fallbackAmount = 1) {
  const text = String(detail || "").trim().toLowerCase();
  const match = /^([a-z_ ]+?)(?::|\s+)?(\d{1,3})?$/.exec(text);
  const requested = match?.[1]?.replaceAll(" ", "") || "coin";
  const resource = Object.keys(CHURCH_RESOURCE_DEFINITIONS)
    .find((key) => key.toLowerCase() === requested)
    || Object.entries(RESOURCE_ALIASES).find(([, aliases]) => aliases.includes(match?.[1]?.trim()))?.[0]
    || "coin";
  return {
    resource,
    amount: clamp(match?.[2] ? Number(match[2]) : fallbackAmount, 1, 100)
  };
}

export function applyChurchAid(state, person, text) {
  const intent = parseChurchTransferIntent(text);
  if (!intent || intent.direction !== "outgoing") return null;
  return grantChurchResource(state, person, intent.resource, intent.amount);
}

/* Move a validated amount of a church resource to a person's household.
    Callers may reach this either from a parsed phrase or from a semantically
    interpreted gift; the transfer rules are identical and live only here.

    What is given matters. Medicine given to somebody who is actually ill
    treats the illness rather than merely cheering them up; food given to a
    household that is genuinely short does far more than the same food given to
    one that is comfortable; firewood matters most to the sick and the frail.
    A gift that answers no real need is still a kindness, but it should not
    quietly solve a problem it has nothing to do with. */
export function grantChurchResource(state, person, resource, requestedAmount) {
  const definition = CHURCH_RESOURCE_DEFINITIONS[resource];
  if (!definition) return null;
  const resources = upgradeChurchResources(state);
  const amount = Math.floor(Number(requestedAmount) || 0);
  if (amount <= 0 || resources[resource] < amount) return null;
  const household = state.households.find((entry) => entry.id === person.householdId);
  if (!household) return null;
  resources[resource] -= amount;

  let addressedNeed = false;
  if (resource === "coin") {
    household.wealth = clamp(household.wealth + amount);
    addressedNeed = (household.debt || 0) > 0 || household.wealth < 25;
  } else if (resource === "medicine") {
    const ill = Boolean(person.illness);
    addressedNeed = ill || person.health < 55;
    person.health = clamp(person.health + amount * (ill ? 9 : 4));
    person.stress = clamp(person.stress - amount * 2);
    if (ill) {
      person.illnessDays = Math.max(0, (person.illnessDays || 0) - amount * 2);
      if (person.illnessDays <= 0 || person.health >= 70) {
        person.illness = null;
        person.illnessDays = 0;
      }
    }
  } else if (resource === "firewood") {
    addressedNeed = person.health < 60 || Boolean(person.illness) || (household.food ?? 100) < 45;
    person.health = clamp(person.health + amount * (addressedNeed ? 3 : 1));
    person.stress = clamp(person.stress - amount * 2);
  } else {
    const hungry = (household.food ?? 100) < 55;
    addressedNeed = hungry;
    household.food = clamp(household.food + amount * definition.householdValue * (hungry ? 2 : 1));
  }
  return {
    direction: "outgoing",
    resource,
    amount,
    label: definition.label,
    unit: definition.unit,
    addressedNeed,
    remaining: resources[resource]
  };
}

/* Whether this kind of help speaks to the matter the visitor actually brought.
   Used to decide whether charity eases the situation itself or is simply a
   kindness alongside it. */
export function giftAddressesMatter(resource, visit) {
  const text = [
    visit?.issue?.kind,
    visit?.intent?.primaryMatter,
    ...(visit?.scenarioFacts || []).map((fact) => fact.text)
  ].join(" ").toLowerCase();
  if (resource === "medicine") return /\b(?:ill|illness|sick|sickness|fever|cough|injur|wound|dying|midwife|babe|childbed|plague|pestilence)\b/.test(text);
  if (resource === "coin") return /\b(?:debt|owed|owes|rent|fine|restitution|repay|creditor|coin|money|poverty|poor)\b/.test(text);
  if (resource === "firewood") return /\b(?:cold|winter|fuel|firewood|freez|ill|sick|fever)\b/.test(text);
  return /\b(?:hunger|hungry|starv|food|bread|grain|famine|poverty|poor|feed|eat|winter)\b/.test(text);
}

export function applyChurchDonation(state, person, resource, requestedAmount) {
  const resources = upgradeChurchResources(state);
  const definition = CHURCH_RESOURCE_DEFINITIONS[resource] || CHURCH_RESOURCE_DEFINITIONS.coin;
  const key = CHURCH_RESOURCE_DEFINITIONS[resource] ? resource : "coin";
  const household = state.households.find((entry) => entry.id === person.householdId);
  if (!household) return null;
  let amount = clamp(requestedAmount, 1, 100);
  if (key === "coin") {
    amount = Math.min(amount, Math.floor(household.wealth));
    household.wealth = clamp(household.wealth - amount);
  } else {
    const cost = Math.max(1, definition.householdValue);
    amount = Math.min(amount, Math.floor(household.food / cost));
    household.food = clamp(household.food - amount * cost);
  }

  if (amount <= 0) return null;
  resources[key] += amount;
  return { direction: "incoming", resource: key, amount, label: definition.label, unit: definition.unit };
}

export function churchDonationCapacity(state, person, resource) {
  const definition = CHURCH_RESOURCE_DEFINITIONS[resource] || CHURCH_RESOURCE_DEFINITIONS.coin;
  const key = CHURCH_RESOURCE_DEFINITIONS[resource] ? resource : "coin";
  const household = state.households.find((entry) => entry.id === person.householdId);
  if (!household) return 0;
  return key === "coin"
    ? Math.floor(household.wealth)
    : Math.floor(household.food / Math.max(1, definition.householdValue));
}

/* Does this sentence actually name something the church keeps? Used to tell a
   real offer from ordinary speech: "take" and "have" are far too common on
   their own to mean that the stores are being opened. */
export function mentionsChurchResource(text) {
  const speech = String(text || "").toLowerCase();
  for (const aliases of Object.values(RESOURCE_ALIASES)) {
    for (const alias of aliases) {
      if (speech.includes(alias)) return true;
    }
  }
  return /\b(?:alms|provisions?|supplies|stores?|storehouse|poor box|food)\b/.test(speech);
}
