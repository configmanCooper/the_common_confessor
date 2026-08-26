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

/* A refusal to give, as opposed to any negation anywhere in the sentence.
 *
 * The parser used to look only for a giving verb near a first-person subject,
 * so "I do not think I may give alms today" opened the stores - a priest who
 * had just refused alms in as many words watched a dose of medicine leave them.
 * A player's stores are scarce and must never be spent by an act they declined
 * to make.
 *
 * The negation has to attach to the giving. Matching a bare "not" anywhere in
 * the clause is too blunt: "The bread is given freely, not owed" is a gift, and
 * the "not" there is about obligation. So this looks for a denial shortly
 * before the verb, or a nothing-at-all shortly after it.
 */
/* The things a church actually hands out. Binding a refusal's "no" to one of
   these is what separates "I will give you no medicine" from "no matter what
   the reeve says, I will give you grain" - the second is a gift, and blocking
   it would have the priest hand over bread that the parish never records. */
const REFUSABLE_GOODS = "(?:bread|loaf|loaves|grain|corn|flour|sacks?|medicine|physic|herbs?|"
  + "coin|money|pennies|penny|silver|alms|food|victuals|fish|cheese|onions|beans|"
  + "firewood|wood|fuel|help|aid|charity|relief|succour|assistance)";

export const REFUSES_TO_GIVE = new RegExp(
  "\\b(?:not|never|cannot|can\\s?not|can't|won't|shan't|mustn't|don't|doesn't|didn't|unable|unwilling|refuse[ds]?|deny|denied|withhold)\\b"
  + "[^.!?]{0,40}?\\b(?:give|giving|gives|provide|offer|lend|spare|send|hand|grant|share)\\b"
  /* "I will give you no medicine" - the determiner "no" is the commonest way
     to refuse in English and was missed entirely. It only counts against an
     actual good, so "no questions asked" and "no trouble" are left alone. */
  + `|\\b(?:give|giving|gives|provide|offer|lend|spare|send|hand|grant|share)\\b[^.!?]{0,15}?\\bno\\s+${REFUSABLE_GOODS}\\b`
  + "|\\b(?:give|giving|gives|provide|offer|lend|spare|send|hand|grant|share)\\b[^.!?]{0,15}?\\b(?:nothing|none)\\b"
  + "|\\b(?:nothing|none)\\b[^.!?]{0,20}?\\bto\\s+(?:give|offer|spare|share)\\b"
  + `|\\bno\\s+${REFUSABLE_GOODS}\\b[^.!?]{0,25}?\\b(?:to\\s+|can\\s+|could\\s+|will\\s+|shall\\s+|may\\s+)?(?:give|offer|spare|share)\\b`
  + "|\\bstores?\\s+(?:are|is)\\s+(?:empty|exhausted|bare)\\b"
  + "|\\bbeyond (?:my|our) means\\b",
  "i"
);
/* A hypothetical or conditional offer is a discussion of giving, not a gift.
   The marker must come before the giving verb: "take this bread, and if you
   need more come again" is a gift followed by an invitation, not a condition
   on the gift. */
export const MERELY_CONSIDERING = new RegExp(
  "\\b(?:if|whether|should\\s+i|shall\\s+i|might|perhaps|suppose|unless|provided\\s+that|in\\s+the\\s+event)\\b"
  + "[^.!?]{0,40}?\\b(?:give|giving|gives|provide|offer|lend|spare|send|hand|grant|share|take)\\b",
  "i"
);

/* Splitting an utterance into the separate things it says.
 *
 * One place, used by every gate, because two gates disagreeing about where a
 * sentence ends is how a refused resource gets handed over. The terminator is
 * kept with its sentence: the previous splitter consumed the question mark and
 * then tested for one, so its question guard could never fire and a priest
 * asking "shall the church give you bread?" was recorded as having offered.
 */
export function offerClauses(text) {
  return String(text || "")
    .toLowerCase()
    .split(/(?<=[.!?;:])/)
    /* A question is an enquiry, whatever else it contains. */
    .filter((sentence) => !sentence.includes("?"))
    /* Commas are left alone: "here, two loaves for your children" is one act,
       and splitting it would separate the giving from the thing given. The
       same is true of "and" inside an enumeration - "take two sacks of grain,
       four loaves, and a bundle of firewood" is one act of giving, and cutting
       it at the "and" orphans the firewood from the verb that hands it over.
       So "and" only starts a new clause where a new subject follows it, or
       where it introduces a fresh instruction - "tell me what you did at the
       mill, and take this bread home with you" is a question followed by a
       gift. Contrastive joins always split, since that is exactly where a
       priest changes his mind. */
    .flatMap((sentence) => sentence.split(
      /\bbut\b|\byet\b|\bwhile\b|\band\s+(?=(?:i|we|the\s+church|it)\b)|\band\s+(?=(?:take|here|carry|keep)\b)/
    ))
    .map((clause) => clause.replace(/[.!?;:]+\s*$/, "").trim())
    .filter(Boolean);
}

/* The clauses that actually hand something over, and nothing else. */
export function outgoingOfferClauses(text) {
  const outgoingPattern = /\b(?:church|we|i)\b.{0,35}\b(?:will|shall|can|may)\b.{0,20}\b(?:give|provide|offer|lend|spare)\b|\b(?:take|receive)\b.{0,30}\bfrom the church\b/;
  return offerClauses(text).filter((clause) => (
    outgoingPattern.test(clause)
    && !REFUSES_TO_GIVE.test(clause)
    && !MERELY_CONSIDERING.test(clause)
  ));
}

export function parseChurchTransferIntent(text) {
  const clauses = offerClauses(text);
  const outgoingPattern = /\b(?:church|we|i)\b.{0,35}\b(?:will|shall|can|may)\b.{0,20}\b(?:give|provide|offer|lend|spare)\b|\b(?:take|receive)\b.{0,30}\bfrom the church\b/;
  const incomingPattern = /\b(?:donate|give|bring|contribute|offer)\b.{0,35}\b(?:to|for)\s+(?:the\s+)?church\b|\bchurch\b.{0,30}\b(?:accept|receive)\b/;
  const plain = (clause) => !REFUSES_TO_GIVE.test(clause) && !MERELY_CONSIDERING.test(clause);
  /* The resource must be named in the clause that offers it. Scanning the whole
     utterance let "I shall give you bread, but not medicine" hand over the
     medicine, because the longest alias won regardless of which clause it sat
     in. */
  const outgoingClause = clauses.find((clause) => outgoingPattern.test(clause) && plain(clause));
  const incomingClause = clauses.find((clause) => incomingPattern.test(clause) && plain(clause));
  if (!outgoingClause && !incomingClause) return null;
  const incoming = Boolean(incomingClause) && !outgoingClause;
  const speech = incoming ? incomingClause : outgoingClause;
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
    direction: incoming ? "incoming" : "outgoing",
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
    /* Coin goes where it is actually needed. A household in debt is being bled
       a little every day by it, so silver clears the debt first and only what
       is left over becomes money in hand - which is what the household would
       do with it anyway, and what makes the gift felt for longer than a week. */
    const owed = household.debt || 0;
    const towardsDebt = Math.min(owed, amount);
    household.debt = Math.max(0, owed - towardsDebt);
    household.wealth = clamp(household.wealth + (amount - towardsDebt));
    addressedNeed = owed > 0 || household.wealth < 25;
  } else if (resource === "medicine") {
    const ill = Boolean(person.illness);
    const hurt = Boolean(person.injury);
    addressedNeed = ill || hurt || person.health < 55;
    person.health = clamp(person.health + amount * (ill || hurt ? 9 : 4));
    person.stress = clamp(person.stress - amount * 2);
    if (ill) {
      person.illnessDays = Math.max(0, (person.illnessDays || 0) - amount * 2);
      if (person.illnessDays <= 0 || person.health >= 70) {
        person.illness = null;
        person.illnessDays = 0;
      }
    }
    if (hurt) {
      /* A dressed wound closes; an undressed one festers, so this is the
         difference between a bad month and a death. */
      person.injury.treated = true;
      person.injury.severity = clamp(person.injury.severity - amount * 10, 0, 100);
      if (person.injury.severity <= 4) person.injury = null;
    }
    if (ill || hurt) {
      /* The church is nursing them now, and that carries for a while. */
      const until = (state.calendar?.absoluteDay ?? 0) + Math.min(14, 3 + amount * 3);
      person.flags = [
        ...(person.flags || []).filter((flag) => !flag.startsWith("tended_by_church")),
        `tended_by_church_until_day_${until}`
      ];
    }
  } else if (resource === "firewood") {
    /* Fuel answers cold. A household already stacked to the roof is neither
       warmer nor richer for another bundle - it simply has more wood - so what
       this measures is how short of it they were. A thin woodpile, a sick body
       that needs the fire kept in, or a house too poor to buy any. */
    const woodpile = household.fuel ?? 0;
    const cold = woodpile < 10;
    addressedNeed = cold || Boolean(person.illness) || person.health < 60 || (household.food ?? 100) < 45;
    const warmth = cold ? Math.max(0.25, Math.min(1, (10 - woodpile) / 10)) : 0.1;
    person.health = clamp(person.health + amount * (addressedNeed ? 3 : 1) * warmth);
    person.stress = clamp(person.stress - amount * 2 * warmth);
    /* Into the woodpile, where it is burned instead of bought. */
    household.fuel = clamp(woodpile + amount * 1.5, 0, 100);
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

/* Does this sentence name one particular thing the church keeps? Used to check
   that a priest handing something over has actually said so. */
export function namesChurchResource(text, key) {
  const speech = String(text || "").toLowerCase();
  return (RESOURCE_ALIASES[key] || []).some((alias) => speech.includes(alias));
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

/* ------------------------------------------------ asking a single person ---
   A sermon appeal is spoken to the whole parish. In a private visit the priest
   is asking one person to their face, which is a different sentence entirely:
   it has to be a request aimed at them, not an offer aimed at them. "I will
   give you bread" and "can you give the church some bread" share a verb and
   mean opposite things, so the object of the asking is what decides it. */
const REQUEST_OF_VISITOR = /\b(?:can you|could you|would you|will you|are you able to|if you (?:can|could)|i (?:must |would |should )?ask (?:you|that you)|i am asking you|the church (?:needs|has need of|is in need)|we (?:need|have need of)|the (?:poor )?box is empty|the stores are (?:low|empty|bare)|anything you can spare|whatever you can spare|spare (?:anything|something|a little)|help the church|help this church|give to the church)\b/i;
const OFFER_TO_VISITOR = /\b(?:i (?:will|shall|can|would) give you|i give you|take (?:this|these|it)|here is|here are|you may have|let me give you)\b/i;

/** Is the priest asking this visitor, personally, to give to the church? */
export function readDonationRequest(text) {
  const speech = String(text || "");
  if (!REQUEST_OF_VISITOR.test(speech)) return { asked: false, manner: "none" };
  /* If the only giving language in the line is him handing something over,
     he is being generous, not asking. */
  if (OFFER_TO_VISITOR.test(speech) && !/\b(?:the church|this church|the box|the stores|the parish|for the poor)\b/i.test(speech)) {
    return { asked: false, manner: "none" };
  }
  const appeal = readSermonAppeal(speech);
  return { asked: true, manner: appeal.asked ? appeal.manner : "plain" };
}

/* ------------------------------------------------------- the collection ----
   What a parish actually puts in the box.

   A priest may ask, and how he asks matters as much as whether he asks. An
   appeal grounded in faith or plain goodwill opens hands; one that leans on
   fear opens them too, but it costs him afterwards. Some people give on a
   Sunday whether or not anyone asked, because that is who they are and they
   can spare it.

   Nobody gives what they do not have. Everything below is bounded by the
   household's real means. */

const APPEAL_PATTERNS = Object.freeze([
  {
    manner: "threatening",
    weight: 0.85,
    trustDelta: -6,
    pattern: /\b(?:damn|damnation|hellfire|perish|curse|wrath|punish|withhold absolution|denied burial|no place in heaven|god will strike|judgement upon those who)\b/i
  },
  {
    manner: "faithful",
    weight: 0.7,
    trustDelta: 2,
    pattern: /\b(?:christ|our lord|the gospel|scripture|charity|alms|blessed|mercy|grace|treasure in heaven|widow's mite)\b/i
  },
  {
    manner: "practical",
    weight: 0.6,
    trustDelta: 1,
    pattern: /\b(?:the stores are|we have nothing left|the box is empty|winter|the poor of this parish|those who have nothing|hungry households|whatever you can spare)\b/i
  }
]);

const ASK_PATTERN = /\b(?:give|gives|giving|donate|donation|offering|alms|collection|the box|spare|contribute|bring what|share what|open your (?:purses|hands|hearts))\b/i;

/** Did the priest ask for anything, and in what manner? */
export function readSermonAppeal(text) {
  const speech = String(text || "");
  if (!ASK_PATTERN.test(speech)) return { asked: false, manner: "none", weight: 0, trustDelta: 0 };
  const matched = APPEAL_PATTERNS.find((entry) => entry.pattern.test(speech));
  return matched
    ? { asked: true, manner: matched.manner, weight: matched.weight, trustDelta: matched.trustDelta }
    : { asked: true, manner: "plain", weight: 0.45, trustDelta: 0 };
}

/** How willing one person is to give this Sunday, from 0 to roughly 1. */
/* Villagers the priest has never met carry no personality and identical
   means until they are materialised, so without this the whole parish would
   decide identically and either all give or none would. A stable hash of the
   person and the day spreads them out while keeping a replay exact. */
function personVariation(seed, personId, day) {
  let hash = 2166136261;
  for (const character of `${seed}:${personId}:${day}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash % 1000) / 1000;
}

export function givingWillingness(state, person, household, appeal) {
  const traits = person.personality?.traits || [];
  /* The appeal opens the question; it does not answer it. What decides whether
     this household gives is who they are, what they have, and what they think
     of the priest, so the personal terms must outweigh the manner of asking or
     a single good sermon empties the whole parish. */
  let willingness = appeal.weight * 0.5;
  // Who they are.
  if (traits.includes("generous")) willingness += 0.34;
  if (traits.includes("devout")) willingness += 0.26;
  if (traits.includes("proud")) willingness += 0.12;
  if (traits.includes("greedy") || traits.includes("secretive")) willingness -= 0.3;
  if (traits.includes("fearful")) willingness += appeal.manner === "threatening" ? 0.25 : -0.05;
  if (traits.includes("resentful") || traits.includes("stubborn")) willingness -= 0.15;
  // What they think of him, and what the parish thinks of him.
  willingness += (person.trustPriest - 50) / 130;
  willingness += (person.faith - 50) / 150;
  willingness += (state.priest.localTrust - 50) / 420;
  willingness += (state.priest.moralAuthority - 50) / 420;
  willingness -= state.priest.scandal / 180;
  /* A parish that has seen the church open its stores gives back more readily
     than one that has watched it hoard. Mercy shown becomes mercy returned. */
  willingness += ((state.town?.metrics?.mercy ?? 50) - 50) / 260;
  // What they can bear. Hunger closes a hand faster than anything else.
  if ((household?.food ?? 60) < 40) willingness -= 0.4;
  if ((household?.wealth ?? 0) < 22) willingness -= 0.35;
  if ((household?.debt ?? 0) > 0) willingness -= 0.12;
  if ((household?.wealth ?? 0) > 55) willingness += 0.18;
  /* Ordinary difference between one household and the next. */
  willingness += (personVariation(state.seed, person.id, state.calendar.absoluteDay) - 0.5) * 0.8;
  return willingness;
}

/**
 * Take the Sunday collection. Called after a sermon; also called on a Sunday
 * where nothing was asked, because some people give anyway.
 */
export function collectSundayOffering(state, attendees, appeal) {
  const resources = upgradeChurchResources(state);
  const givers = [];
  let coin = 0;
  let food = 0;
  for (const person of attendees) {
    const household = state.households.find((entry) => entry.id === person.householdId);
    if (!household) continue;
    const willingness = givingWillingness(state, person, household, appeal);
    /* Most of a parish gives nothing on a given Sunday: they have little, and
       a penny is real money. Only those genuinely moved and genuinely able put
       something in, and without being asked it is fewer still. */
    if (willingness < (appeal.asked ? 0.66 : 0.5)) continue;
    /* A village household gives coppers, not its savings. What is offered is a
       small share of what is genuinely spare, and never the last of it. */
    const spareCoin = Math.max(0, Math.min(3, Math.floor((household.wealth - 20) / 12)));
    const spareFood = Math.max(0, Math.floor(((household.food ?? 0) - 62) / 20));
    const generosity = Math.min(1, Math.max(0.25, willingness - 0.4));
    const coinGiven = Math.min(3, Math.round(spareCoin * generosity));
    const foodGiven = Math.min(2, Math.round(spareFood * generosity));
    if (coinGiven <= 0 && foodGiven <= 0) continue;
    household.wealth = clamp(household.wealth - coinGiven, 0, 1000);
    household.food = clamp((household.food ?? 0) - foodGiven * 4);
    coin += coinGiven;
    food += foodGiven;
    givers.push({ personId: person.id, name: person.name, coin: coinGiven, grain: foodGiven });
    if (appeal.trustDelta) person.trustPriest = clamp(person.trustPriest + appeal.trustDelta);
  }
  resources.coin = clamp(resources.coin + coin, 0, 9999);
  resources.grain = clamp(resources.grain + food, 0, 9999);
  return { manner: appeal.manner, asked: appeal.asked, coin, grain: food, givers };
}
