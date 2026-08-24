import {
  ACTION_TYPES,
  AI_ALLOWED_ACTIONS,
  BACKSTORY_PARTS,
  buildFirstNameBank,
  buildSurnameBank,
  EXTERNAL_ROLES,
  ISSUE_TEMPLATES,
  OCCUPATIONS,
  SERMON_THEMES,
  TOWN_CHARACTERS,
  TOWN_LANDSCAPES,
  TOWN_NAMES,
  TOWN_TENSIONS,
  TRAITS,
  WEEK_DAYS
} from "./data.js";
import {
  appendCommand,
  appendEvent,
  createDefaultPriest,
  createHouseholds,
  registerReplayVerifier,
  restoreReplayBase,
  sealState,
  STATE_SCHEMA_VERSION
} from "./state.js";
import { deterministicCompoundFallback, validateSermonResponse } from "./ai.js";
import {
  addStructuredMemory,
  canApplyImmediateReaction,
  classifyPriestSpeech,
  clarificationFacts,
  createInitialReactionState,
  createVisitIntent,
  detectConfidentialityBreach,
  ensureConversationContinuity,
  factIdsMentionedInText,
  previewConversationReaction,
  REACTIONS,
  recordPriestPosition,
  recordPromise,
  selectSafeConversationHelper
} from "./conversation.js";
import {
  ADULT_AGE,
  addKnowledge,
  adjustRelationship,
  advancePopulationDay,
  areProhibitedKin,
  createPopulationResident,
  createRumor,
  getRelationship,
  isAdultRelationshipEligible,
  upgradePopulationState
} from "./population.js";
import {
  attendanceReason,
  resolveCongregationReactions,
  resolveSermonImpact,
  upgradeParishState
} from "./parish.js";
import { buildGeneratedScenarioArchetypes } from "./scenario_catalog.js";
import {
  applyChurchAid,
  applyChurchDonation,
  churchDonationCapacity,
  collectSundayOffering,
  giftAddressesMatter,
  grantChurchResource,
  parseChurchDonationDetail,
  parseChurchTransferIntent,
  readSermonAppeal
} from "./church.js";
import {
  archiveCompletedVisit,
  finalizePeriodReports,
  upgradeReportingState
} from "./reporting.js";
import {
  calculateMarket,
  describeMarketGood,
  marketListings,
  PURCHASABLE_GOODS,
  TRADE_GOODS
} from "./market.js";
import {
  planWeeklySocialLife,
  recentSocialLog,
  scheduleSocialAnswer,
  resolveDueIntentions,
  scheduleIntention,
  upgradeSocialState
} from "./social.js";
import { PROMPT_TRACE_LIMIT } from "./dialogue_planner.js";
import { completeGeneratedText, completeStoredText, speakableText } from "./text.js";

function buildNeighboringParishes(seed, homeTown) {
  const rng = new SeededRng(`${seed}:neighboring-parishes`);
  const names = TOWN_NAMES.filter((name) => name !== homeTown);
  const priestNames = ["Father Elias Ward", "Father Martin Hale", "Father Thomas Reed", "Father Julian Grey", "Father Peter Bell"];
  const churchNames = ["Saint Anne's", "Saint Jude's", "Saint Martha's", "Saint Cuthbert's", "Saint Agnes's"];
  const selected = [];
  while (selected.length < 3 && names.length) {
    const index = rng.int(0, names.length - 1);
    const name = names.splice(index, 1)[0];
    selected.push({
      id: `neighbor-${String(selected.length + 1).padStart(2, "0")}`,
      name,
      churchName: churchNames[selected.length % churchNames.length],
      priestName: priestNames[selected.length % priestNames.length],
      stewardName: EXTERNAL_ROLES.steward.names[selected.length % EXTERNAL_ROLES.steward.names.length],
      lordName: EXTERNAL_ROLES.lord.names[selected.length % EXTERNAL_ROLES.lord.names.length],
      travelDays: rng.int(1, 4),
      pressures: {
        food: rng.int(52, 88),
        health: rng.int(35, 78),
        order: rng.int(30, 72)
      },
      trust: rng.int(20, 45),
      status: "uncontacted",
      lastEventId: null
    });
  }
  return selected;
}

function initializeNarrativeThreads(state) {
  const worldEventId = state.events[0]?.id || null;
  for (const parish of state.neighboringParishes) {
    state.narrativeThreads.push({
      id: `narrative-${String(state.nextNarrativeThreadSequence++).padStart(6, "0")}`,
      type: "external_relief_request",
      title: `${parish.name} parish relief`,
      stage: "seed",
      participantIds: [parish.id],
      causeEventIds: worldEventId ? [worldEventId] : [],
      unresolvedQuestions: [
        "Will need become severe enough to justify an appeal?",
        "Will this parish have enough capacity to help without harming its own households?"
      ],
      pressure: Math.max(parish.pressures.food, parish.pressures.health, parish.pressures.order),
      status: "dormant",
      neighborParishId: parish.id,
      lastMeaningfulEventId: worldEventId
    });
  }
}

export function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < String(value).length; index += 1) {
    hash ^= String(value).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class SeededRng {
  constructor(seed) {
    this.state = hashString(seed) || 0x6d2b79f5;
  }

  next() {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 4294967296;
  }

  int(minimum, maximum) {
    return Math.floor(this.next() * (maximum - minimum + 1)) + minimum;
  }

  pick(values) {
    return values[this.int(0, values.length - 1)];
  }

  shuffle(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = this.int(0, index);
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function chooseDifferent(rng, values, first) {
  const choices = values.filter((value) => value !== first);
  return rng.pick(choices);
}

function makeTown(seed, rng) {
  const name = rng.pick(TOWN_NAMES);
  const landscape = rng.pick(TOWN_LANDSCAPES);
  const character = rng.pick(TOWN_CHARACTERS);
  const tension = rng.pick(TOWN_TENSIONS);
  return {
    name,
    description: `${name} lies in ${landscape}. ${character} ${tension}`,
    seed,
    metrics: {
      harmony: rng.int(42, 65),
      faith: rng.int(45, 70),
      prosperity: rng.int(38, 62),
      health: rng.int(48, 72),
      safety: rng.int(45, 68),
      mercy: rng.int(40, 65)
    }
  };
}

function createResidents(seed, rng) {
  const maleNames = rng.shuffle(buildFirstNameBank("male"));
  const femaleNames = rng.shuffle(buildFirstNameBank("female"));
  const surnames = rng.shuffle(buildSurnameBank());
  const residents = [];
  let maleIndex = 0;
  let femaleIndex = 0;
  let surnameIndex = 0;
  let residentIndex = 0;
  const usedFullNames = new Set();
  const sampleAge = (memberIndex) => {
    const roll = rng.next();
    if (memberIndex === 0) {
      if (roll < 0.18) return rng.int(18, 24);
      if (roll < 0.72) return rng.int(25, 44);
      if (roll < 0.93) return rng.int(45, 59);
      return rng.int(60, 69);
    }
    if (roll < 0.40) return rng.int(0, 13);
    if (roll < 0.56) return rng.int(14, 24);
    if (roll < 0.84) return rng.int(25, 44);
    if (roll < 0.95) return rng.int(45, 59);
    if (roll < 0.99) return rng.int(60, 69);
    return rng.int(70, 79);
  };
  const lightWork = [
    "teacher", "scribe", "clerk", "herbalist", "midwife", "tailor",
    "spinner", "candlemaker", "beekeeper", "innkeeper", "sexton", "sacristan"
  ];
  const occupationForAge = (age) => {
    if (age < 5) return "infant";
    if (age < 14) return "child laborer";
    if (age >= 70) return rng.next() < 0.9 ? "retired" : rng.pick(lightWork);
    if (age >= 60) return rng.next() < 0.65 ? "retired" : rng.pick(lightWork);
    return rng.pick(OCCUPATIONS.filter((occupation) => !["infant", "retired"].includes(occupation)));
  };
  while (residentIndex < 200) {
    const householdSize = Math.min(rng.int(1, 6), 200 - residentIndex);
    const surname = surnames[surnameIndex];
    const householdId = `household-${surnameIndex + 1}`;
    surnameIndex += 1;
    for (let member = 0; member < householdSize; member += 1) {
      const sex = rng.next() < 0.52 ? "female" : "male";
      const nameBank = sex === "female" ? femaleNames : maleNames;
      let nameIndex = sex === "female" ? femaleIndex : maleIndex;
      let firstName = nameBank[nameIndex++];
      while (usedFullNames.has(`${firstName} ${surname}`)) {
        firstName = nameBank[nameIndex++];
      }
      if (sex === "female") femaleIndex = nameIndex;
      else maleIndex = nameIndex;
      usedFullNames.add(`${firstName} ${surname}`);
      const age = sampleAge(member);
      const ageHealthPenalty = Math.max(0, age - 50) * 0.8;
      residents.push({
        id: `person-${String(residentIndex + 1).padStart(3, "0")}`,
        name: `${firstName} ${surname}`,
        firstName,
        surname,
        sex,
        age,
        householdId,
        occupation: occupationForAge(age),
        sprite: 1 + (residentIndex % 41),
        active: true,
        profileRevealed: false,
        materialized: false,
        visitCount: 0,
        lastVisitDay: -999,
        attendanceChance: rng.int(55, 96),
        trustPriest: rng.int(38, 62),
        faith: rng.int(35, 75),
        morale: rng.int(38, 70),
        prosperity: rng.int(30, 70),
        health: clamp(rng.int(58, 94) - ageHealthPenalty, 25, 95),
        stress: rng.int(25, 68),
        reputation: rng.int(40, 62),
        relationshipIds: [],
        memories: [],
        flags: []
      });
      residentIndex += 1;
    }
  }
  const requiredVillageRoles = [
    "tanner", "healer", "reeve", "bailiff",
    "watchman", "miller", "midwife", "carpenter"
  ];
  for (const occupation of requiredVillageRoles) {
    if (residents.some((resident) => resident.occupation === occupation)) continue;
    const candidate = residents.find((resident) => (
      resident.age >= ADULT_AGE
      && resident.age < 60
      && !requiredVillageRoles.includes(resident.occupation)
    ));
    if (candidate) candidate.occupation = occupation;
  }
  for (const resident of residents) {
    const household = residents.filter((other) => other.householdId === resident.householdId && other.id !== resident.id);
    const nearby = residents.filter((other) => other.id !== resident.id && Math.abs(Number(other.id.slice(-3)) - Number(resident.id.slice(-3))) < 12);
    resident.relationshipIds = rng.shuffle([...new Set([...household, ...nearby])]).slice(0, rng.int(3, 7)).map((person) => person.id);
  }
  addTheDeparted(residents, rng, surnames, { femaleNames, maleNames });
  return residents;
}

/* Every village has its graves.

   The two hundred living souls are the parish; these are the ones already
   buried, and they exist so that grief has somewhere to land. Without them a
   new game contains nobody who has ever died, so a parishioner could not mourn
   anyone real, and the scenario that turns on bereavement had to invent a
   corpse - for a while it simply named a living neighbour, and the priest
   consoled a man over someone still walking about the village.

   They are cheap. Marked dead and inactive, they are skipped by every daily
   pass, never visit, never eat and never work. They are kin and neighbours of
   the living, carried only as memory. */
const DEPARTED_CAUSES = [
  "a winter fever", "lung sickness", "a fall from the barn loft",
  "a wound that would not close", "the sweating sickness",
  "a hard harvest and a weak chest", "drowning in the mill stream"
];

/* A cause of death that fits the age of the body. An infant does not die of
   old age, and a man of eighty does not die in childbed. */
function departedCause(rng, age, sex, role) {
  if (age >= 62) return rng.next() < 0.62 ? "old age" : rng.pick(DEPARTED_CAUSES);
  if (age <= 5) {
    return rng.pick(["a winter fever", "the sweating sickness", "lung sickness", "a fever in the night"]);
  }
  if (sex === "female" && age >= 15 && age <= 44 && (role === "spouse" || rng.next() < 0.3)) {
    return rng.next() < 0.45 ? "childbed" : rng.pick(DEPARTED_CAUSES);
  }
  return rng.pick(DEPARTED_CAUSES);
}

function addTheDeparted(residents, rng, surnames, { femaleNames, maleNames }) {
  const living = residents.filter((resident) => resident.alive !== false);
  const count = rng.int(11, 16);
  for (let index = 0; index < count; index += 1) {
    /* Bury them out of a real household, so somebody alive remembers them. */
    const kin = rng.pick(living);
    const surname = kin?.surname || rng.pick(surnames);
    const housemates = living.filter((resident) => resident.householdId === kin?.householdId);

    /* Decide what they were to the living before choosing an age, so the age
       fits the role: a lost husband is of an age with his widow, a lost child
       is younger than the parents who buried them. */
    const widowCandidate = housemates.find((resident) => resident.age >= ADULT_AGE);
    const parentCandidates = housemates.filter((resident) => resident.age >= ADULT_AGE + 16);
    const roleRoll = rng.next();
    let role = "neighbour";
    if (widowCandidate && roleRoll < 0.35) role = "spouse";
    else if (parentCandidates.length && roleRoll < 0.6) role = "child";
    else if (housemates.length && roleRoll < 0.85) role = "parent";

    const youngestParentAge = parentCandidates.length
      ? Math.min(...parentCandidates.map((resident) => resident.age))
      : 40;
    const ageAtDeath = role === "spouse"
      ? clamp(widowCandidate.age + rng.int(-8, 8), ADULT_AGE, 88)
      : role === "child"
        ? rng.int(1, Math.max(2, youngestParentAge - 16))
        : role === "parent"
          ? rng.int(48, 88)
          : (rng.next() < 0.55 ? rng.int(52, 84) : rng.int(1, 51));

    const sex = role === "spouse"
      ? (widowCandidate.sex === "female" ? "male" : "female")
      : (rng.next() < 0.5 ? "female" : "male");
    const pool = sex === "female" ? femaleNames : maleNames;
    let firstName = rng.pick(pool);
    let guard = 0;
    while (residents.some((resident) => resident.name === `${firstName} ${surname}`) && guard < 40) {
      firstName = rng.pick(pool);
      guard += 1;
    }
    const buriedDay = -rng.int(20, 1400);
    const departed = {
      id: `person-${String(residents.length + 1).padStart(3, "0")}`,
      name: `${firstName} ${surname}`,
      firstName,
      surname,
      sex,
      age: ageAtDeath,
      householdId: kin?.householdId || null,
      occupation: ageAtDeath < 14 ? "child laborer" : ageAtDeath >= 60 ? "retired" : "laborer",
      sprite: 1,
      alive: false,
      active: false,
      deceased: true,
      causeOfDeath: departedCause(rng, ageAtDeath, sex, role),
      /* Buried before the game opens, so the days are negative. They lived in
         the village a good while before they left it. */
      departureDay: buriedDay,
      arrivalDay: buriedDay - 365,
      maritalStatus: "deceased",
      spouseId: null,
      parentIds: [],
      childrenIds: [],
      profileRevealed: false,
      materialized: false,
      visitCount: 0,
      lastVisitDay: -999,
      attendanceChance: 0,
      trustPriest: 50,
      faith: 50,
      morale: 50,
      prosperity: 50,
      health: 0,
      stress: 0,
      reputation: 50,
      relationshipIds: [],
      memories: [],
      flags: []
    };

    const bind = (mourner) => {
      if (!mourner) return;
      if (!mourner.relationshipIds.includes(departed.id)) mourner.relationshipIds.push(departed.id);
      if (!departed.relationshipIds.includes(mourner.id)) departed.relationshipIds.push(mourner.id);
    };

    departed.survivedByRole = role;
    if (role === "spouse") {
      /* Death ends the marriage, exactly as the engine's own death handler
         does: the departed keep no spouseId, or referential integrity breaks
         because the survivor does not point back at a grave. The bond is
         carried by the survivor instead. */
      widowCandidate.widowedFromId = departed.id;
      departed.survivingSpouseId = widowCandidate.id;
      bind(widowCandidate);
    } else if (role === "child") {
      for (const parent of parentCandidates.slice(0, 2)) {
        departed.parentIds.push(parent.id);
        parent.lostChildIds ||= [];
        if (!parent.lostChildIds.includes(departed.id)) parent.lostChildIds.push(departed.id);
        bind(parent);
      }
    } else if (role === "parent") {
      for (const grownChild of housemates.slice(0, 3)) {
        departed.childrenIds.push(grownChild.id);
        bind(grownChild);
      }
    }

    /* Whatever they were, a few neighbours remember them too. */
    for (const neighbour of rng.shuffle(living).slice(0, rng.int(1, 3))) bind(neighbour);
    residents.push(departed);
  }
}

export function createGame(seed = String(Date.now())) {
  const normalizedSeed = String(seed).trim() || String(Date.now());
  const rng = new SeededRng(normalizedSeed);
  const town = makeTown(normalizedSeed, rng);
  const residents = createResidents(normalizedSeed, rng);
  const state = {
    version: STATE_SCHEMA_VERSION,
    schemaVersion: STATE_SCHEMA_VERSION,
    seed: normalizedSeed,
    town,
    priest: createDefaultPriest(),
    residents,
    households: createHouseholds(residents),
    externalActors: [],
    eventQueue: [],
    outsideAttention: { church: 0, rome: 0, crown: 0, legal: 0 },
    authorityStages: {
      archdeaconCompleted: false,
      bishopCompleted: false,
      examinerCompleted: false,
      sheriffCompleted: false,
      papalLegateCompleted: false,
      royalCommissionerCompleted: false,
      nobleCompleted: false,
      kingRollAttempted: false,
      popeRollAttempted: false
    },
    nextExternalSequence: 1,
    nextQueueSequence: 1,
    calendar: { absoluteDay: 0, week: 1, dayIndex: 0, slot: 0 },
    currentVisit: null,
    chronicle: [],
    events: [],
    commandLog: [],
    aiProposals: [],
    nextEventSequence: 1,
    nextCommandSequence: 1,
    nextMemorySequence: 1,
    nextPositionSequence: 1,
    scenarioHistory: [],
    replayBase: null,
    sermons: [],
    conversationHistory: [],
    aiDiagnostics: { lastCompletedVisit: null },
    mode: { type: "IN_WORLD", returnVisitId: null },
    supersededTurns: [],
    commitments: [],
    nextCommitmentSequence: 1,
    /* What the village means to do, and what it has done to itself. Present
       from the parish's first day so nothing has to guess whether they exist. */
    intentions: [],
    nextIntentionSequence: 1,
    socialLog: [],
    narrativeThreads: [],
    nextNarrativeThreadSequence: 1,
    neighboringParishes: [],
    pacing: { lastMajorDay: -999, consecutiveHighIntensity: 0 },
    settings: { aiEnabled: true, aiProvider: "gemma", copilotModel: "auto" },
    statistics: {
      conversations: 0,
      confessions: 0,
      peopleRevealed: 0,
      cascades: 0,
      births: 0,
      arrivals: 0,
      departures: 0
    }
  };
  state.neighboringParishes = buildNeighboringParishes(seed, town.name);
  upgradePopulationState(state);
  upgradeParishState(state);
  state.priest.positions = [];
  state.priest.confidentialityBreaches = [];
  addChronicle(state, `A new cure begins in ${town.name}`, town.description, "neutral", {
    type: "world_started",
    parentId: null,
    facts: { population: 200, town: town.name }
  });
  addChronicle(state, "The parish register opens", "Exactly 200 living villagers are entered by name. Their inward lives remain unknown until events draw them into the parish story.", "faith");
  initializeNarrativeThreads(state);
  upgradeReportingState(state);
  return sealState(state);
}

function deriveResidentProfile(state, person) {
  const rng = new SeededRng(`${state.seed}:${person.id}:soul`);
  const firstTrait = rng.pick(TRAITS);
  const secondTrait = chooseDifferent(rng, TRAITS, firstTrait);
  const origin = rng.pick(BACKSTORY_PARTS.origins);
  const turn = rng.pick(BACKSTORY_PARTS.turns);
  const pressure = rng.pick(BACKSTORY_PARTS.pressures);
  const texture = rng.pick(BACKSTORY_PARTS.textures);
  return {
    personality: {
      traits: [firstTrait, secondTrait],
      candor: rng.int(20, 90),
      empathy: rng.int(20, 90),
      boldness: rng.int(20, 90),
      piety: rng.int(20, 90)
    },
    publicBackstory: `${person.firstName} ${origin}.`,
    backstory: `${person.firstName} ${origin}, ${turn}, and now ${pressure}. ${person.firstName} ${texture}.`,
    privatePressure: pressure
  };
}

export function materializeResident(state, personId, revealProfile = false) {
  const person = [...state.residents, ...state.externalActors].find((resident) => resident.id === personId);
  if (!person) {
    throw new Error(`Unknown resident: ${personId}`);
  }
  if (!person.materialized) {
    const profile = deriveResidentProfile(state, person);
    person.personality = profile.personality;
    person.publicBackstory = profile.publicBackstory;
    person.backstory = profile.backstory;
    person.privatePressure = profile.privatePressure;
    person.materialized = true;
  }
  if (revealProfile && !person.profileRevealed) {
    person.profileRevealed = true;
    state.statistics.peopleRevealed += 1;
  }
  return person;
}

function activeResidents(state) {
  return state.residents.filter((person) => person.active && person.alive);
}

function counselEligibleResidents(state) {
  return activeResidents(state).filter((person) => person.age >= ADULT_AGE);
}

function scenarioArchetypes(state, person, relation, victim, rng) {
  const relationName = relation?.name || "a neighboring householder";
  const relationFirst = relation?.firstName || "The neighbor";
  const victimName = victim?.name || "an older villager";
  const child = state.residents.find((candidate) => person.childrenIds.includes(candidate.id));
  const spouse = state.residents.find((candidate) => candidate.id === person.spouseId);
  const official = state.residents.find((candidate) => ["reeve", "bailiff", "clerk", "watchman"].includes(candidate.occupation)) || relation;
  const resource = rng.pick(["the east meadow", "the mill stream", "the market stall", "a timber allotment", "the manor grain contract"]);
  const sum = rng.int(3, 12);
  const archetypes = [
    {
      id: "trade_displacement",
      kinds: ["decision", "private counsel", "dispute"],
      opening: `${relationName} has offered me a profitable partnership, but it depends on taking ${resource} from ${victimName}. I could secure my household and ruin another in the same bargain.`,
      facts: [`The offer concerns ${resource}.`, `${relationFirst} expects the transfer within ${rng.int(2, 8)} days.`, `${victimName} would lose most of the household income.`, `A shared lease would reduce the profit but keep both households working.`]
    },
    {
      id: "stolen_food_false_accusation",
      kinds: ["confession", "decision"],
      opening: `I secretly took ${sum} measures of grain during the shortage. Yesterday ${victimName} accused an innocent apprentice, and the apprentice may be beaten for what I did.`,
      facts: [`The missing property is ${sum} measures of grain.`, `The grain is hidden in ${person.surname}'s loft.`, `${victimName}'s apprentice is blamed.`, `Returning it anonymously may save the apprentice but will not clear the accusation completely.`]
    },
    {
      id: "withheld_wages",
      kinds: ["dispute", "private counsel", "village concern"],
      opening: `${relationName} owes me ${sum} days of wages and says the poor harvest excuses the debt. My household needs the coin, but pressing the claim may close the workshop.`,
      facts: [`The unpaid work totals ${sum} days.`, `${relationName} has enough coin to pay half now.`, `Two other workers are also unpaid.`, `A staged repayment would keep the workshop open.`]
    },
    {
      id: "unsafe_apprentice",
      kinds: ["decision", "village concern", "private counsel"],
      opening: `An apprentice in ${relationName}'s care is being struck and sent into dangerous work. If I report it, the child may lose food and shelter as well as the apprenticeship.`,
      facts: [`The apprentice is ${rng.int(11, 16)} years old.`, `The dangerous task involves an unstable kiln and night work.`, `${relationName} has already injured the child once.`, `Another household could foster the apprentice temporarily.`]
    },
    {
      id: "marriage_coercion",
      kinds: ["family counsel", "decision", "confession"],
      opening: `${relationName} is pressing a marriage that would settle a household debt. The proposed spouse is respectable, but the person being promised does not consent.`,
      facts: [`The marriage would cancel ${sum} silver pennies of debt.`, `The unwilling person has privately asked ${person.firstName} for help.`, `Refusal may cost the household its lease.`, `A delayed betrothal could create time to repay the debt another way.`]
    },
    {
      id: "hidden_illness",
      kinds: ["confession", "faith", "private counsel"],
      opening: `I have concealed a fever because I fear losing work. I may already have exposed ${relationName}'s household, including a young child.`,
      facts: [`The fever began ${rng.int(3, 9)} days ago.`, `${person.firstName} has continued sharing tools and meals.`, `${relationName}'s child is now coughing.`, `Isolation and honest warning may prevent a wider sickness.`]
    },
    {
      id: "inheritance_document",
      kinds: ["confession", "dispute", "decision"],
      opening: `I found a document showing that ${victimName}, not ${relationName}, has the stronger inheritance claim. My household benefits if the paper stays hidden.`,
      facts: [`The document bears two recognizable witness marks.`, `It concerns a cottage and ${rng.int(2, 7)} acres.`, `${relationName} believes the document was destroyed.`, `Giving it to a neutral clerk would expose the truth without letting either claimant alter it.`]
    },
    {
      id: "poaching_hunger",
      kinds: ["confession", "decision", "village concern"],
      opening: `I poached a deer from the lord's wood to feed hungry households. The watch has arrested ${victimName}, who was nowhere near the forest.`,
      facts: [`The meat fed ${rng.int(2, 5)} households.`, `A broken arrow near the carcass can identify ${person.firstName}.`, `${victimName} may face imprisonment.`, `A confession paired with restitution could free the innocent prisoner.`]
    },
    {
      id: "corrupt_measure",
      kinds: ["confession", "dispute", "decision"],
      opening: `${relationName} asked me to use a false measure at market. It takes only a handful from each buyer, but the poorest households are paying the hidden cost.`,
      facts: [`The false measure is short by one part in ${rng.int(8, 14)}.`, `${relationName} splits the extra goods with two accomplices.`, `${victimName} has begun suspecting the fraud.`, `Using honest measures publicly would expose the scheme without naming every accomplice.`]
    },
    {
      id: "secret_pregnancy",
      kinds: ["confession", "family counsel", "faith"],
      opening: `A young woman has trusted me with a pregnancy that her household does not know about. She fears violence if the father or family is named.`,
      facts: [`The pregnancy is about ${rng.int(2, 6)} months advanced.`, `The father has offered coin but refuses public responsibility.`, `One aunt may provide safe shelter.`, `A private plan for shelter is needed before any public confession.`]
    },
    {
      id: "missing_relic",
      kinds: ["confession", "grave conscience", "faith"],
      opening: `I know who took a small church relic. The thief sold it to pay a healer, and exposing the theft may also expose a family's private illness.`,
      facts: [`The relic was sold to a traveling peddler.`, `The payment bought medicine for ${victimName}.`, `The peddler returns in ${rng.int(2, 9)} days.`, `The relic might be repurchased before deciding whether to name the thief.`]
    },
    {
      id: "violent_feud",
      kinds: ["village concern", "decision", "grave conscience"],
      opening: `Two households are preparing to fight over an insult at the tavern. ${relationName} has hidden clubs near ${resource}, and someone may be killed tonight.`,
      facts: [`The insult concerned an old accusation of theft.`, `At least ${rng.int(4, 9)} people intend to gather.`, `${victimName} wants peace but fears appearing cowardly.`, `Separate meetings and public restitution could prevent the fight.`]
    },
    {
      id: "faith_after_death",
      kinds: ["grief", "faith", "ordinary talk"],
      opening: `${victimName} died after weeks of prayer, and I no longer know whether I believe prayer changes anything. I am angry at God and ashamed of the anger.`,
      facts: [`The death followed a fever lasting ${rng.int(5, 18)} days.`, `${person.firstName} prayed publicly every evening.`, `The household now avoids worship out of grief.`, `The immediate need is permission to grieve without pretending certainty.`]
    },
    {
      id: "manor_order",
      kinds: ["decision", "village concern", "private counsel"],
      opening: `${official?.name || relationName} ordered me to reserve food for the manor while two village households are already hungry. The order may be lawful and still cause harm.`,
      facts: [`The order concerns ${sum} sacks of grain.`, `The manor claims the reserve is for winter emergency.`, `Two households have less than a week of food.`, `Written confirmation and a temporary church loan could delay harm without simply defying authority.`]
    },
    {
      id: "rumor_or_warning",
      kinds: ["ordinary talk", "village concern", "decision"],
      opening: `I heard that ${relationName} plans to leave the village with unpaid debts. Repeating it may warn creditors—or destroy an innocent reputation if it is false.`,
      facts: [`The rumor began with a cart seen after dark.`, `${relationName} has sold two tools but not the house.`, `${victimName} says the debt is real.`, `A private question to ${relationName} could test the rumor before it spreads.`]
    },
    {
      id: "church_relief_abuse",
      kinds: ["decision", "village concern", "private counsel"],
      opening: `One household is taking church food while hiding adequate grain. Refusing them may expose panic and shame; continuing may empty stores needed by the truly hungry.`,
      facts: [`The hidden grain is enough for about ${rng.int(3, 8)} weeks.`, `The household has already received two distributions.`, `A sick child in the same home still needs broth.`, `Aid could be limited to the child while requiring an honest inventory.`]
    }
  ];
  const creditor = rng.pick(state.residents.filter((candidate) => (
    candidate.id !== person.id
    && candidate.id !== relation?.id
    && candidate.id !== victim?.id
    && candidate.active
  )));
  const manorAccess = new Set(["reeve", "bailiff", "clerk", "scribe", "servant", "stablehand", "miller", "farmer", "merchant", "laborer"]);
  const marketAccess = new Set(["merchant", "peddler", "baker", "brewer", "butcher", "fishmonger", "weaver", "dyer", "tailor", "cobbler", "tanner", "potter", "cooper", "candlemaker", "farmer", "miller"]);
  const landAccess = new Set(["farmer", "shepherd", "goatherd", "beekeeper", "woodcutter", "forester", "hunter", "miller"]);
  const churchAccess = new Set(["sexton", "sacristan", "gravedigger", "clerk", "scribe", "teacher", "servant"]);
  const eligibleHandcrafted = archetypes.filter((archetype) => {
    if (["stolen_food_false_accusation", "manor_order"].includes(archetype.id)) {
      return manorAccess.has(person.occupation) || manorAccess.has(relation?.occupation);
    }
    if (archetype.id === "corrupt_measure" || archetype.id === "trade_displacement") {
      return marketAccess.has(person.occupation) || marketAccess.has(relation?.occupation);
    }
    if (archetype.id === "poaching_hunger") {
      return landAccess.has(person.occupation) || landAccess.has(relation?.occupation);
    }
    if (["missing_relic", "church_relief_abuse"].includes(archetype.id)) {
      return churchAccess.has(person.occupation) || churchAccess.has(relation?.occupation);
    }
    if (["marriage_coercion", "secret_pregnancy"].includes(archetype.id)) return person.age >= 16;
    if (archetype.id === "inheritance_document") {
      return manorAccess.has(person.occupation) || manorAccess.has(relation?.occupation) || person.age >= 18;
    }
    return true;
  });
  return eligibleHandcrafted.concat(buildGeneratedScenarioArchetypes({
    town: state.town.name,
    person: person.name,
    relation: relationName,
    victim: victimName,
    official: official?.name || relationName,
    resource,
    sum,
    creditor: creditor?.name || official?.name || relationName,
    debtSum: rng.int(6, 30),
    deadlineDays: rng.int(1, 12),
    occupation: person.occupation,
    age: person.age,
    relationOccupation: relation?.occupation || ""
  }));
}

function issueFromThread(thread, person) {
  return {
    kind: thread.kind,
    location: thread.location,
    gravity: Math.max(1, Math.min(5, Math.ceil(thread.pressure / 20))),
    opening: `Father, I have returned because this matter remains unresolved: ${thread.summary}`,
    detail: thread.summary,
    relatedPersonId: thread.relatedPersonId,
    relatedName: null,
    scenarioId: thread.scenarioId,
    scenarioFacts: JSON.parse(JSON.stringify(thread.facts)),
    openingDisclosesHidden: thread.kind !== "confession" || person.personality.candor >= 55,
    threadId: thread.id,
    returningIssue: true
  };
}

function scenarioAuthorityText(scenarioId) {
  const id = String(scenarioId || "");
  if (/tax|inheritance|debt|enclosure|boundary|market_monopoly/.test(id)) {
    return "Written records should be gathered first. The reeve or manor steward can examine the local claim, while a magistrate is the lawful next appeal if local authority refuses.";
  }
  if (/well|contagion|ale|healer|midwife|pregnancy/.test(id)) {
    return "A healer or midwife can assess illness and immediate safety. The reeve can restrict a public hazard, and the manor steward can organize labor or access to shared resources.";
  }
  if (/apprentice|children|violence|witchcraft|watch|fugitive|sanctuary|poaching|deserter/.test(id)) {
    return "Immediate safety belongs first to trustworthy adults and the watch or reeve. A magistrate or manor court decides punishment; the priest may offer sanctuary, witness, mediation, and advocacy but cannot invent a legal verdict.";
  }
  if (/marriage|courtship|orphan|elder|household|family/.test(id)) {
    return "The affected adults and households must be heard. The priest may mediate and protect vulnerable people; property or coercion disputes may require the reeve, steward, or magistrate.";
  }
  if (/grain|wage|weights|prices|charity|trade|workshop|bridge|watercourse|fire/.test(id)) {
    return "The people doing the work and those bearing the loss must be heard. The reeve can organize an inspection or temporary measure, while the steward controls manor labor, stores, or reimbursement.";
  }
  return "The priest can counsel, mediate, gather witnesses, and offer bounded church aid. Coercive judgment belongs to the reeve, steward, watch, magistrate, or church superior according to the matter.";
}

function scenarioEvidenceText(issue) {
  const id = String(issue.scenarioId || "");
  const witness = issue.openingContext?.witness || "No independent witness has yet given a complete account.";
  if (/tax|inheritance|debt|weights|wage|blackmail|grain/.test(id)) {
    return `The useful evidence is written terms, receipts, measures, letters, store records, and consistent witness accounts. ${witness}`;
  }
  if (/well|contagion|ale|healer|midwife|pregnancy/.test(id)) {
    return `The useful evidence is the pattern of symptoms, who used the suspected source, physical traces, and comparison with people who were not exposed. ${witness}`;
  }
  if (/bridge|boundary|enclosure|watercourse|fire|workshop|apprentice|children/.test(id)) {
    return `The useful evidence is the condition of the place, tools or damage, work schedules, injuries, and accounts from people who saw the work. ${witness}`;
  }
  if (/violence|watch|fugitive|sanctuary|poaching|deserter|witchcraft/.test(id)) {
    return `The useful evidence is injuries, the order of events, who first used force, physical traces, and separate witness accounts. ${witness}`;
  }
  return `What can presently be checked is my direct account, the physical or written evidence already described, and any independent witness who can be questioned. Beyond that, I have no proof yet. ${witness}`;
}

function relationshipToRelated(person, related) {
  if (!related) return "No second principal person is yet identified.";
  if (person.spouseId === related.id) return `${related.name} is the visitor's spouse.`;
  if (person.parentIds?.includes(related.id)) return `${related.name} is the visitor's parent.`;
  if (person.childrenIds?.includes(related.id)) return `${related.name} is the visitor's child.`;
  if (person.householdId === related.householdId) return `${related.name} belongs to the visitor's household.`;
  return `${related.name} is a known villager connected through work, travel, neighborhood, or established village ties.`;
}

function expandScenarioFactWeb(state, issue, person) {
  const existing = new Set((issue.scenarioFacts || []).map((fact) => fact.id));
  const related = state.residents.find((resident) => resident.id === issue.relatedPersonId);
  const household = state.households.find((entry) => entry.id === person.householdId);
  const properties = household?.properties?.length
    ? household.properties.map((property) => `${property.status} ${property.type}`).join(", ")
    : household?.dwelling || "no recorded property";
  const means = (household?.wealth || 0) < 25 ? "very little spare means"
    : (household?.wealth || 0) < 55 ? "modest means" : "comparatively secure means";
  const food = (household?.food || 0) < 25 ? "precarious food stores"
    : (household?.food || 0) < 55 ? "modest food stores" : "strong food stores";
  const health = person.health < 35 ? "poor health"
    : person.health < 65 ? "workable but limited health" : "good working health";
  const timing = issue.openingContext?.timing || "at a time that has not yet been independently established";
  const place = issue.openingContext?.place || "a place that has not yet been independently established";
  const witness = issue.openingContext?.witness || "No independent witness has yet given a complete account.";
  const deadlineDays = Number(issue.deadlineDays) || 7;
  const additions = [
    {
      id: "participants",
      category: "identity",
      speakable: true,
      text: `${person.name} is a ${person.age}-year-old ${person.occupation}. ${relationshipToRelated(person, related)}${related ? ` ${related.name} is a ${related.age}-year-old ${related.occupation}.` : ""}`
    },
    {
      id: "timeline",
      category: "mechanical_timing",
      speakable: false,
      text: issue.hasExplicitDeadline
        ? `The matter was noticed ${timing}. A formal answer is required within ${deadlineDays} days.`
        : `The matter was noticed ${timing}. No formal deadline is known, though delay may worsen the harm.`
    },
    {
      id: "place",
      category: "location",
      speakable: true,
      text: `The relevant place is ${place}.`
    },
    {
      id: "witnesses",
      category: "evidence",
      speakable: true,
      text: witness
    },
    {
      id: "evidence",
      category: "evidence",
      speakable: true,
      text: scenarioEvidenceText(issue)
    },
    {
      id: "authority",
      category: "mechanical_authority",
      speakable: false,
      text: scenarioAuthorityText(issue.scenarioId)
    },
    {
      id: "capacity",
      category: "mechanical_capacity",
      speakable: false,
      text: `${person.name}'s household has ${means}, ${food}, and ${properties}. As a ${person.occupation} in ${health}, ${person.firstName} can offer ${person.occupation} work and ordinary labor, but cannot promise authority, expertise, property, or resources the household does not possess.`
    },
    {
      id: "constraints",
      category: "mechanical_constraint",
      speakable: false,
      text: "Any plan must account for immediate safety, consent, lawful authority, actual household means, age and health, and the risk of retaliation or lost livelihood described in the stakes."
    },
    {
      id: "unknowns",
      category: "uncertainty",
      speakable: true,
      text: "I still do not know whether every accused person will admit the claim, whether independent witnesses agree, whether the responsible authority will cooperate, or which feared consequence will actually occur."
    },
    {
      id: "counterclaim",
      category: "mechanical_hypothesis",
      speakable: false,
      text: related
        ? `${related.name} might deny the allegation, dispute the evidence, claim necessity, mistake, lawful right, or self-defense, or give another account of the sequence. Those are possible defenses to test, not established facts.`
        : "No specific accused person is identified in this matter. The visitor should say that a request for an accused person's defense may not apply rather than inventing one."
    }
  ];
  if (String(issue.scenarioId || "").includes("contaminated_well") && !issue.threadId) {
    const affected = [];
    const usedHouseholds = new Set();
    for (const resident of state.residents
      .filter((candidate) => candidate.active && candidate.alive
        && candidate.id !== person.id && candidate.id !== issue.relatedPersonId)
      .sort((left, right) => left.id.localeCompare(right.id))) {
      if (usedHouseholds.has(resident.householdId)) continue;
      usedHouseholds.add(resident.householdId);
      affected.push(resident);
      resident.illness = "waterborne sickness";
      resident.illnessDays = Math.max(resident.illnessDays || 0, 4);
      resident.health = clamp(resident.health - 8);
      if (affected.length >= 3) break;
    }
    issue.affectedPersonIds = affected.map((resident) => resident.id);
    additions.push({
      id: "affected_people",
      category: "people_affected",
      speakable: true,
      text: affected.length
        ? `${affected.map((resident) => `${resident.name}'s household`).join(", ")} reported matching sickness after using the common well. The complete number of sick villagers is not yet known.`
        : "Several households reported sickness, but no complete named list has yet been established."
    });
  }
  /* A concealed fever must be a real fever. The visitor confesses to hiding a
     sickness and to having shared tools and meals, and the whole matter turns
     on whether it spreads - but until now the engine left them perfectly well,
     so they could not infect anyone, could not be treated, and could not
     worsen. The fiction said contagion while the simulation said nothing was
     wrong. */
  if (String(issue.scenarioId || "").includes("hidden_illness") && !issue.threadId) {
    const begun = Number(
      (issue.scenarioFacts || []).map((fact) => String(fact.text)).join(" ")
        .match(/fever began (\d+) days ago/i)?.[1]
    ) || 5;
    if (!person.illness) {
      person.illness = "fever";
      person.illnessDays = Math.max(person.illnessDays || 0, begun);
      person.health = clamp(person.health - 6);
    }
  }
  if (String(issue.scenarioId || "").includes("panic_rumor")) {
    additions.push({
      id: "threat_status",
      category: "uncertainty",
      speakable: true,
      text: `No war involving ${state.town.name} has been declared or verified. The rumor conflicts: some people say soldiers, others say sickness, and no reliable witness has yet identified a banner, commander, company, number, intention, or confirmed direction of approach.`
    });
  }
  for (const fact of additions) {
    if (existing.has(fact.id)) continue;
    issue.scenarioFacts.push({
      ...fact,
      anchors: (fact.text.toLowerCase().match(/[a-z]{5,}/g) || []).slice(0, 8)
    });
  }
  return issue;
}

function attachIssueThread(state, issue, person) {
  if (issue.threadId) return issue;
  expandScenarioFactWeb(state, issue, person);
  const subjectIds = new Set([person.id]);
  if (issue.relatedPersonId) subjectIds.add(issue.relatedPersonId);
  const factText = (issue.scenarioFacts || []).map((fact) => fact.text).join(" ").toLowerCase();
  for (const resident of state.residents) {
    if (factText.includes(resident.name.toLowerCase())) subjectIds.add(resident.id);
  }
  const threadId = `issue-${String(state.nextIssueThreadSequence++).padStart(6, "0")}`;
  const factVisibility = {
    scope: issue.location === "confessional"
      ? "private_confession"
      : issue.location === "office" ? "private_visit" : "public",
    authorizedPersonIds: [person.id, "priest"]
  };
  issue.scenarioFacts = (issue.scenarioFacts || []).map((fact) => ({
    ...fact,
    issueId: threadId,
    provenance: fact.provenance || "state",
    confidence: fact.confidence ?? 100,
    visibility: fact.visibility || factVisibility,
    allowedSpeakers: fact.allowedSpeakers || [person.id]
  }));
  const statedDeadlineDays = Number(issue.deadlineDays)
    || Number(issue.scenarioFacts
      .map((fact) => fact.text)
      .join(" ")
      .match(/\bwithin (\d+) days\b/i)?.[1]);
  const thread = {
    id: threadId,
    kind: issue.kind,
    scenarioId: issue.scenarioId || issue.kind.replaceAll(" ", "_"),
    summary: String(issue.scenarioFacts?.[0]?.text || issue.detail || issue.opening).slice(0, 220),
    originatorId: person.id,
    subjectIds: [...subjectIds].slice(0, 8),
    relatedPersonId: issue.relatedPersonId || null,
    location: issue.location,
    visibility: factVisibility,
    facts: JSON.parse(JSON.stringify(issue.scenarioFacts || [])),
    pressure: clamp(36 + issue.gravity * 7, 0, 100),
    publicAwareness: clamp(/whisper|public|market|households/i.test(issue.opening) ? 28 : 10, 0, 100),
    danger: clamp(issue.gravity * 9 + (/violence|injur|threat|punish|arrest/i.test(issue.opening) ? 18 : 0), 0, 100),
    momentum: clamp(20 + issue.gravity * 8, 0, 100),
    deadlineDay: state.calendar.absoluteDay + Math.max(2, statedDeadlineDays || 12),
    status: "open",
    authorityStage: 0,
    createdDay: state.calendar.absoluteDay,
    lastTouchedDay: state.calendar.absoluteDay,
    sourceVisitIds: [],
    rumorCreated: false,
    lastFollowupDay: -999,
    authorityRequestedRole: null
  };
  state.issueThreads.push(thread);
  issue.threadId = thread.id;
  return issue;
}

function issueForPerson(state, person) {
  const rng = new SeededRng(`${state.seed}:${state.calendar.absoluteDay}:${state.calendar.slot}:${person.id}`);
  const existingThread = state.issueThreads
    .filter((thread) => thread.status !== "resolved" && thread.originatorId === person.id)
    .sort((left, right) => right.pressure - left.pressure)[0];
  if (existingThread && (existingThread.pressure >= 60 || rng.next() < 0.45)) {
    existingThread.lastTouchedDay = state.calendar.absoluteDay;
    return issueFromThread(existingThread, person);
  }
  const issue = { ...rng.pick(ISSUE_TEMPLATES) };
  const knownRelations = person.relationshipIds
    .map((id) => state.residents.find((resident) => resident.id === id))
    .filter(Boolean);
  let relation = knownRelations.length ? rng.pick(knownRelations) : null;
  issue.relatedPersonId = relation?.id ?? null;
  issue.relatedName = relation?.name ?? "someone in the village";
  issue.detail = person.privatePressure;
  const tradeOccupations = new Set([
    "farmer", "shepherd", "miller", "baker", "brewer", "innkeeper", "blacksmith",
    "carpenter", "mason", "thatcher", "weaver", "dyer", "tailor", "cobbler",
    "tanner", "butcher", "fishmonger", "herbalist", "potter", "cooper",
    "candlemaker", "merchant", "peddler", "beekeeper", "woodcutter"
  ]);
  const trade = tradeOccupations.has(relation?.occupation)
    ? relation.occupation
    : rng.pick(["grain merchant", "wool trader", "carpenter", "brewer", "miller"]);
  let victim = knownRelations.find((candidate) => candidate.id !== relation?.id)
    || state.residents.find((candidate) => candidate.id !== person.id && candidate.id !== relation?.id);
  const victimName = victim?.name || "an older villager";
  state.scenarioHistory ||= [];
  let allArchetypes = scenarioArchetypes(state, person, relation, victim, rng);
  const availableArchetypes = allArchetypes.filter((archetype) => archetype.kinds.includes(issue.kind));
  const recent = new Set(state.scenarioHistory.slice(-10));
  const preferredPool = availableArchetypes.filter((archetype) => !recent.has(archetype.id));
  const broadPool = allArchetypes.filter((archetype) => !recent.has(archetype.id));
  let archetype = rng.pick(preferredPool.length ? preferredPool : broadPool.length ? broadPool : availableArchetypes);
  if (archetype) {
    /* Grief needs a real grave. This scenario had the visitor mourning a
       neighbour chosen at random from the living, so the priest consoled a man
       over someone who was still walking about the village and who could
       himself knock at the church door a week later. Mourn only the actually
       dead, and if nobody has died yet, this sorrow has not happened.

       This runs before the fixups below, because it may substitute an
       archetype that needs one of them applied to it. */
    if (archetype.id === "faith_after_death") {
      const dead = state.residents
        .filter((candidate) => !candidate.alive && candidate.id !== person.id)
        .sort((left, right) => left.id.localeCompare(right.id));
      const close = dead.filter((candidate) => (
        (person.relationshipIds || []).includes(candidate.id)
        || candidate.householdId === person.householdId
      ));
      const mourned = close.length ? rng.pick(close) : (dead.length ? rng.pick(dead) : null);
      if (mourned) {
        victim = mourned;
        allArchetypes = scenarioArchetypes(state, person, relation, victim, rng);
        archetype = allArchetypes.find((candidate) => candidate.id === archetype.id) || archetype;
      } else {
        /* Nobody has died yet, so this sorrow has not happened. Fall through
           the pools in turn: when the issue kind is grief this archetype is
           frequently the only candidate, and filtering a single-entry pool
           leaves nothing to choose from. A later step reconciles issue.kind
           with whatever archetype is chosen here. */
        let alternatives = [];
        for (const pool of [preferredPool, broadPool, availableArchetypes, allArchetypes]) {
          const usable = pool.filter((candidate) => candidate.id !== "faith_after_death");
          if (usable.length) {
            alternatives = usable;
            break;
          }
        }
        if (alternatives.length) archetype = rng.pick(alternatives);
      }
    }
    if (archetype.familyId === "contaminated_well" && relation?.occupation !== "tanner") {
      const compatibleRelations = state.residents
        .filter((resident) => resident.active && resident.alive
          && resident.id !== person.id && resident.occupation === "tanner")
        .sort((left, right) => left.id.localeCompare(right.id));
      if (compatibleRelations.length) {
        relation = rng.pick(compatibleRelations);
        issue.relatedPersonId = relation.id;
        issue.relatedName = relation.name;
        if (victim?.id === relation.id) {
          victim = state.residents.find((candidate) => (
            candidate.id !== person.id && candidate.id !== relation.id && candidate.active && candidate.alive
          ));
        }
        allArchetypes = scenarioArchetypes(state, person, relation, victim, rng);
        archetype = allArchetypes.find((candidate) => candidate.id === archetype.id) || archetype;
      }
    }
    state.scenarioHistory.push(archetype.id);
    state.scenarioHistory = state.scenarioHistory.slice(-30);
    issue.scenarioId = archetype.id;
    const embeddedDeadline = Number(
      (archetype.facts || []).join(" ").match(/\b(?:within|returns? in)\s+(\d+)\s+days?\b/i)?.[1]
    );
    issue.deadlineDays = Number(archetype.deadlineDays) || embeddedDeadline || 7;
    issue.hasExplicitDeadline = Boolean(archetype.hasExplicitDeadline || embeddedDeadline);
    if (!archetype.kinds.includes(issue.kind)) {
      issue.kind = archetype.kinds[0];
      issue.location = issue.kind === "confession"
        ? "confessional"
        : ["grief", "faith", "grave conscience"].includes(issue.kind)
          ? "shrine"
          : ["private counsel", "family counsel", "dispute"].includes(issue.kind)
            ? "office"
            : "nave";
    }
    const timing = rng.pick(["at dawn yesterday", "after market closed", "during the evening bell", "three nights ago", "before Sunday worship", "during the last rain"]);
    const placesByScenario = archetype.id.startsWith("manor_order")
      ? ["at the manor storehouse", "beside the mill road"]
      : archetype.id.includes("well")
        ? ["beside the common well", "near the drainage ditch"]
        : archetype.id.includes("bridge")
          ? ["at the bridge approach", "beside the flooded road"]
          : archetype.id.includes("marriage") || archetype.id.includes("pregnancy")
            ? ["inside the family cottage", "in the chapel garden"]
            : archetype.id.includes("trade") || archetype.id.includes("wage") || archetype.id.includes("apprentice")
              ? ["inside the workshop", "at the market stalls"]
              : ["beside the mill road", "behind the alehouse", "at the manor storehouse", "near the common well", "at the edge of the east field"];
    const place = rng.pick(placesByScenario);
    const witness = rng.pick(["No one else heard the whole exchange.", `${victimName} saw part of it.`, `A young apprentice may have overheard.`, `Two households are already whispering about it.`]);
    issue.opening = archetype.opening;
    issue.openingContext = { timing, place, witness };
    issue.blueprint = archetype.blueprint || null;
    issue.scenarioFacts = (archetype.factRecords || archetype.facts.map((text, index) => ({
      id: index === 0
        ? archetype.id === "trade_displacement" ? "trade" : "concrete_matter"
        : index === 1 ? "mechanism" : index === 2 ? "stakes" : "alternative",
      text,
      category: index === 3 ? "example_response" : "situation",
      speakable: index !== 3
    }))).map((fact) => ({
      ...fact,
      anchors: (fact.text.toLowerCase().match(/[a-z]{5,}/g) || []).slice(0, 8)
    }));
    issue.detail = issue.scenarioFacts.find((fact) => fact.id === "concrete_matter")?.text || archetype.facts[0];
    issue.openingDisclosesHidden = issue.kind !== "confession" || person.personality.candor >= 55;
    if (issue.kind === "confession" && !issue.openingDisclosesHidden) {
      issue.opening = `Forgive me, Father. Something I did ${timing}, ${place}, may cause another person to suffer. ${witness} I am not yet certain I can say every part aloud.`;
    }
    return attachIssueThread(state, issue, person);
  }
  const landTrade = ["farmer", "shepherd", "beekeeper", "woodcutter"].includes(trade);
  const workshopTrade = ["blacksmith", "carpenter", "mason", "weaver", "dyer", "tailor", "cobbler", "tanner", "potter", "cooper", "candlemaker"].includes(trade);
  const mechanisms = landTrade
    ? [
      `The work depends on using a disputed strip of common land that currently provides most of ${victimName}'s income.`,
      `${relation?.firstName || "The other party"} wants exclusive grazing and gathering rights that would drive ${victimName} from the same ground.`
    ]
    : workshopTrade
      ? [
        `The proposed partnership would buy raw materials from the manor at a discount only if ${victimName}'s smaller workshop is excluded from the same supply.`,
        `${relation?.firstName || "The other party"} plans to hire away ${victimName}'s only apprentice and take the workshop's largest customer.`
      ]
      : [
        `${relation?.firstName || "The other party"} wants to take over the market stall and supply contract now used by ${victimName}, which would leave ${victimName} without customers.`,
        `${relation?.firstName || "The other party"} plans to undercut ${victimName}'s prices until the older trade closes, then divide the village business with ${person.firstName}.`
      ];
  if (issue.kind === "decision" || issue.kind === "private counsel" || issue.kind === "dispute") {
    const mechanism = rng.pick(mechanisms);
    issue.scenarioFacts = [
      {
        id: "trade",
        text: `The trade is ${trade} work offered by ${relation?.name || "a local tradesperson"}.`,
        anchors: [trade.split(" ")[0]]
      },
      {
        id: "mechanism",
        text: mechanism,
        anchors: ["market", "contract", "workshop", "undercut", "common land"]
      },
      {
        id: "stakes",
        text: `${person.firstName} would earn steadier food and coin, but ${victimName} could lose the livelihood that supports the household.`,
        anchors: ["coin", "livelihood", "household"]
      },
      {
        id: "alternative",
        text: `A slower alternative is to ask for a smaller share that does not exclude ${victimName}, though ${relation?.firstName || "the offerer"} may withdraw the offer.`,
        anchors: ["smaller", victim?.firstName || "offer"]
      }
    ];
    issue.opening = `${relation?.name || "A local tradesperson"} has offered me a share in ${trade} work. ${mechanism} I would gain steadier food and coin, but ${victimName} may lose the livelihood that supports the household. I need to decide whether accepting is honest or merely profitable.`;
  } else {
    issue.scenarioFacts = [
      {
        id: "concrete_matter",
        text: `${person.firstName}'s immediate concern involves ${relation?.name || "the household"} and ${person.privatePressure}.`,
        anchors: [relation?.firstName || person.firstName]
      },
      {
        id: "consequence",
        text: `If nothing changes, the dispute is likely to cost food, trust, or standing within the next few days.`,
        anchors: ["food", "trust", "standing"]
      }
    ];
    if (issue.kind === "confession") {
      issue.opening = person.personality.candor >= 55
        ? `Forgive me, Father. I must speak plainly: ${person.privatePressure}. ${relation?.name || "Another villager"} may suffer if I keep silent, but telling the truth may cost my household dearly.`
        : `Forgive me, Father. I have done something wrong, and ${relation?.name || "another villager"} may suffer for it. I am not yet certain I can say every part aloud.`;
      issue.openingDisclosesHidden = person.personality.candor >= 55;
    } else if (issue.kind === "grief" || issue.kind === "faith") {
      issue.opening = `Father, I came because ${person.privatePressure}. I have tried prayer and ordinary counsel, but the matter has not eased.`;
    }
  }
  return attachIssueThread(state, issue, person);
}

function scheduleExternalVisit(
  state,
  role,
  reason,
  delayDays,
  sourcePersonId = null,
  sourceEventId = null,
  payload = {}
) {
  if (state.eventQueue.some((event) => event.type === "external_visit" && event.role === role)) return null;
  const event = {
    id: `queue-${String(state.nextQueueSequence++).padStart(6, "0")}`,
    type: "external_visit",
    role,
    reason: String(reason).slice(0, 220),
    dueDay: state.calendar.absoluteDay + delayDays,
    sourcePersonId,
    sourceEventId,
    actorId: null,
    targetId: "priest",
    payload: JSON.parse(JSON.stringify(payload))
  };
  state.eventQueue.push(event);
  return event;
}

function acceptedVisitRequests(state, day = state.calendar.absoluteDay) {
  return state.visitRequests.filter((request) => (
    request.requestedDay === day && ["accepted", "completed"].includes(request.status)
  ));
}

export function dailyAppointmentLimit(state) {
  return 4 + acceptedVisitRequests(state).length;
}

export function requestVisits(state, personIds, reason = "", { record = true } = {}) {
  if (state.calendar.absoluteDay < 1) throw new Error("Requested visits become available starting on the second day");
  if (state.calendar.dayIndex === 6) throw new Error("Individual requested visits cannot be scheduled during Sunday worship");
  const existing = state.visitRequests.filter((request) => request.requestedDay === state.calendar.absoluteDay);
  const uniqueIds = [...new Set(personIds)].filter((personId) => !existing.some((request) => request.personId === personId));
  if (!uniqueIds.length || existing.length + uniqueIds.length > 4) {
    throw new Error("You may request at most four different people per day");
  }
  const cleanReason = String(reason || "").trim().slice(0, 180);
  const results = uniqueIds.map((personId) => {
    const person = state.residents.find((resident) => resident.id === personId);
    if (!person?.active || !person.alive) throw new Error("Only living villagers may be requested");
    const rng = new SeededRng(`${state.seed}:requested-visit:${state.calendar.absoluteDay}:${person.id}`);
    const chance = clamp(
      35
      + person.trustPriest * 0.3
      + person.attendanceChance * 0.2
      - person.stress * 0.12
      - (person.illness ? 18 : 0)
      - (person.lastVisitDay === state.calendar.absoluteDay ? 25 : 0),
      10,
      92
    );
    const status = rng.next() * 100 < chance ? "accepted" : "declined";
    state.visitRequests.push({
      id: `request-${String(state.nextVisitRequestSequence++).padStart(5, "0")}`,
      personId,
      requestedDay: state.calendar.absoluteDay,
      status,
      reason: cleanReason
    });
    return { personId, status };
  });
  if (record) {
    appendCommand(state, "request_visits", {
      personIds: uniqueIds,
      reason: cleanReason,
      results
    });
  }
  return results;
}

function scheduleResidentFollowup(state, personId, reason, sourceEventId, type = "resident_followup") {
  const person = state.residents.find((resident) => resident.id === personId);
  if (!person?.active || !person.alive) return null;
  if (state.eventQueue.some((event) => (
    ["resident_followup", "priest_summons"].includes(event.type) && event.sourcePersonId === personId
  ))) return null;
  const event = {
    id: `queue-${String(state.nextQueueSequence++).padStart(6, "0")}`,
    type,
    role: null,
    reason: String(reason).slice(0, 220),
    dueDay: state.calendar.absoluteDay + 1,
    sourcePersonId: personId,
    sourceEventId,
    actorId: personId,
    targetId: "priest",
    payload: {}
  };
  state.eventQueue.push(event);
  return event;
}

function authorityRequestedByCounsel(visit) {
  const counsel = visit.counsel.join(" ").toLowerCase();
  if (/\b(?:bishop|diocese|archdeacon)\b/.test(counsel)) return "bishop";
  if (/\b(?:lord of the manor|summon the lord|bring this to the lord)\b/.test(counsel)) return "lord";
  if (/\b(?:magistrate|county court)\b/.test(counsel)) return "magistrate";
  if (/\b(?:steward|manor officer)\b/.test(counsel)) return "steward";
  return null;
}

function updateIssueThreadAfterVisit(state, visit, steps) {
  const thread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
  if (!thread) return null;
  const helpful = new Set([
    "apologize", "forgive", "reconcile", "return_stolen_goods", "report_crime",
    "make_peace", "testify", "protect", "heal", "shelter", "share_food",
    "secure_clean_water"
  ]);
  const harmful = new Set([
    "accuse", "gossip", "reveal_secret", "steal", "threaten", "assault",
    "begin_feud", "evict", "betray", "vandalize", "kill_person"
  ]);
  const publicDisclosure = steps.some((step) => (
    ["gossip", "report_crime", "testify", "confess_publicly", "secure_clean_water"].includes(step.actionType)
  ));
  if (publicDisclosure) {
    thread.visibility = {
      scope: "public",
      authorizedPersonIds: [...new Set([...thread.subjectIds, "priest"])]
    };
  }
  let pressureDelta = steps.some((step) => helpful.has(step.actionType)) ? -25 : 0;
  if (steps.some((step) => harmful.has(step.actionType))) pressureDelta += 20;
  if (steps.some((step) => step.actionType === "keep_silence")) pressureDelta += 4;
  if (steps.some((step) => ["visit", "write_letter", "pray_with", "advise"].includes(step.actionType))) pressureDelta -= 10;
  if (["leave", "call_for_help", "threaten_priest", "attack_priest"].includes(visit.reactionState?.lastReaction)) {
    pressureDelta += visit.reactionState.lastReaction === "attack_priest" ? 18 : 10;
    if (thread.visibility?.scope === "public") {
      thread.publicAwareness = clamp(thread.publicAwareness + 8);
    }
    thread.danger = clamp(thread.danger + (visit.reactionState.lastReaction === "attack_priest" ? 20 : 8));
  }
  thread.pressure = clamp(thread.pressure + pressureDelta);
  thread.momentum = clamp(thread.momentum + (pressureDelta > 0 ? 7 : -12));
  thread.publicAwareness = clamp(
    thread.publicAwareness
      + (steps.some((step) => ["gossip", "report_crime", "testify", "confess_publicly"].includes(step.actionType))
        ? 14
        : steps.some((step) => step.actionType === "secure_clean_water") ? 18 : -2)
  );
  thread.danger = clamp(
    thread.danger
      + (steps.some((step) => ["threaten", "assault", "begin_feud", "evict", "kill_person"].includes(step.actionType)) ? 18 : -4)
  );
  thread.lastTouchedDay = state.calendar.absoluteDay;
  if (!thread.sourceVisitIds.includes(visit.visitId)) thread.sourceVisitIds.push(visit.visitId);
  thread.sourceVisitIds = thread.sourceVisitIds.slice(-20);
  thread.authorityRequestedRole = authorityRequestedByCounsel(visit) || thread.authorityRequestedRole;
  thread.status = thread.pressure <= 18
    ? "resolved"
    : thread.pressure >= 82 ? "escalating"
      : state.calendar.absoluteDay > thread.deadlineDay ? "festering" : "open";
  return thread;
}

function maybeEscalateIssueAuthority(state, thread) {
  if (thread.visibility?.scope !== "public") return null;
  const requested = thread.authorityRequestedRole;
  let role = null;
  if (requested === "steward" && thread.pressure >= 52) role = "steward";
  else if (requested === "magistrate" && thread.pressure >= 68 && thread.publicAwareness >= 25) role = "magistrate";
  else if (requested === "bishop" && thread.pressure >= 78 && state.priest.moralAuthority >= 35) role = "bishop";
  else if (requested === "lord" && thread.pressure >= 90 && thread.publicAwareness >= 55 && state.calendar.week >= 2) role = "lord";
  else if (thread.authorityStage === 0 && thread.pressure >= 78 && thread.publicAwareness >= 40) role = "steward";
  else if (thread.authorityStage === 1 && thread.pressure >= 89 && thread.danger >= 45) role = "magistrate";
  else if (thread.authorityStage === 2 && thread.pressure >= 96 && thread.publicAwareness >= 72 && state.calendar.week >= 3) {
    const rng = new SeededRng(`${state.seed}:thread-lord:${thread.id}:${state.calendar.absoluteDay}`);
    if (rng.next() < 0.3) role = "lord";
  }
  if (!role) return null;
  const scheduled = scheduleExternalVisit(
    state,
    role,
    `The unresolved matter "${thread.summary}" reached ${role} authority.`,
    role === "steward" ? 1 : role === "magistrate" ? 2 : 3,
    thread.subjectIds[0] || null,
    null
  );
  if (scheduled) {
    thread.authorityStage = Math.max(thread.authorityStage + 1, role === "lord" ? 3 : role === "magistrate" ? 2 : 1);
    thread.authorityRequestedRole = null;
  }
  return scheduled;
}

function advanceIssueThreads(state, parentEventId) {
  for (const thread of state.issueThreads) {
    if (thread.status === "resolved") continue;
    const overdue = state.calendar.absoluteDay > thread.deadlineDay;
    const overduePressure = overdue
      ? Math.min(3, thread.danger / 40 + thread.publicAwareness / 55)
      : -3;
    const staleDecay = state.calendar.absoluteDay - thread.lastTouchedDay > 7 ? -2 : 0;
    thread.pressure = clamp(thread.pressure + thread.momentum * 0.018 + overduePressure + staleDecay);
    thread.momentum = clamp(thread.momentum - (overdue ? 3 : 5));
    if (thread.pressure >= 65 && thread.visibility?.scope === "public") {
      thread.publicAwareness = clamp(thread.publicAwareness + 2);
    }
    thread.status = thread.pressure <= 20
      || (state.calendar.absoluteDay - thread.lastTouchedDay > 14 && thread.pressure < 35)
      ? "resolved"
      : thread.pressure >= 82 ? "escalating" : overdue ? "festering" : "open";
    if (thread.status === "resolved") continue;
    const subjects = thread.subjectIds
      .map((personId) => state.residents.find((resident) => resident.id === personId))
      .filter((person) => person?.active && person.alive);
    for (const person of subjects) {
      person.stress = clamp(person.stress + Math.max(0, thread.pressure - 55) * 0.035);
      person.morale = clamp(person.morale - Math.max(0, thread.danger - 50) * 0.025);
    }
    if (!thread.rumorCreated
      && thread.kind !== "confession"
      && thread.visibility?.scope === "public"
      && thread.publicAwareness >= 48
      && subjects.length >= 2) {
      createRumor(state, {
        originatorId: subjects[0].id,
        subjectId: subjects[1].id,
        claim: thread.summary,
        truth: 70,
        intensity: Math.max(1, Math.min(5, Math.ceil(thread.pressure / 20))),
        sourceEventId: parentEventId
      });
      thread.rumorCreated = true;
    }
    if (thread.pressure >= 66
      && subjects.length
      && state.calendar.absoluteDay - thread.lastFollowupDay >= 4) {
      const next = [...subjects].sort((left, right) => left.lastVisitDay - right.lastVisitDay)[0];
      const scheduled = scheduleResidentFollowup(
        state,
        next.id,
        `The unresolved issue has grown more urgent: ${thread.summary}`,
        parentEventId
      );
      if (scheduled) thread.lastFollowupDay = state.calendar.absoluteDay;
    }
    maybeEscalateIssueAuthority(state, thread);
  }
}

function escalateAuthority(state, actionType, actor, sourceEventId) {
  const rng = new SeededRng(`${state.seed}:authority:${state.calendar.absoluteDay}:${actionType}:${actor.id}`);
  const nextChurchRole = () => (
    !state.authorityStages.archdeaconCompleted
      ? "archdeacon"
      : !state.authorityStages.bishopCompleted
        ? "bishop"
        : !state.authorityStages.examinerCompleted
          ? "inquisitor"
          : "papal_legate"
  );
  if (["report_priest_to_bishop", "petition_bishop"].includes(actionType)) {
    if (actionType === "report_priest_to_bishop") {
      const report = state.priestReports.find((entry) => (
        entry.reporterId === actor.id && entry.status === "private_complaint"
      ));
      if (!report) return;
      report.status = "submitted";
    }
    state.outsideAttention.church = clamp(state.outsideAttention.church + 18);
    const role = nextChurchRole();
    scheduleExternalVisit(
      state,
      role,
      `${actor.name} sent a complaint concerning the priest.`,
      rng.int(2, 6),
      actor.id,
      sourceEventId
    );
  }
  if (["attack_priest", "poison_priest", "kill_priest"].includes(actionType)) {
    state.outsideAttention.legal = clamp(state.outsideAttention.legal + 30);
    scheduleExternalVisit(state, "sheriff", `Violence was committed against the parish priest.`, 1, actor.id, sourceEventId);
    if (state.priest.alive) scheduleExternalVisit(state, "physician", `The priest was injured.`, 1, actor.id, sourceEventId);
  }
  if (actionType === "kill_person") {
    state.outsideAttention.legal = clamp(state.outsideAttention.legal + 35);
    scheduleExternalVisit(state, "sheriff", `A killing in ${state.town.name} requires investigation.`, 1, actor.id, sourceEventId);
  }
  if (["claim_miracle", "fake_miracle", "claim_prophecy"].includes(actionType)) {
    state.outsideAttention.church = clamp(state.outsideAttention.church + 15);
    state.outsideAttention.rome = clamp(state.outsideAttention.rome + (actionType === "fake_miracle" ? 12 : 6));
    scheduleExternalVisit(state, nextChurchRole(), `Extraordinary religious claims spread from ${state.town.name}.`, rng.int(4, 10), actor.id, sourceEventId);
  }
  if (actionType === "appeal_to_rome") {
    state.outsideAttention.rome = clamp(state.outsideAttention.rome + 25);
    if (state.authorityStages.examinerCompleted) {
      scheduleExternalVisit(state, "papal_legate", `${actor.name} appealed beyond the diocese.`, rng.int(14, 35), actor.id, sourceEventId);
    } else if (state.authorityStages.bishopCompleted) {
      scheduleExternalVisit(state, "inquisitor", `${actor.name}'s appeal requires formal examination.`, rng.int(7, 18), actor.id, sourceEventId);
    } else {
      scheduleExternalVisit(
        state,
        state.authorityStages.archdeaconCompleted ? "bishop" : "archdeacon",
        `${actor.name}'s appeal must first pass diocesan inquiry.`,
        rng.int(4, 12),
        actor.id,
        sourceEventId
      );
    }
  }
  if (actionType === "petition_crown") {
    state.outsideAttention.crown = clamp(state.outsideAttention.crown + 25);
    const role = !state.authorityStages.sheriffCompleted
      ? "sheriff"
      : !state.authorityStages.royalCommissionerCompleted
        ? "royal_commissioner"
        : "noble";
    scheduleExternalVisit(state, role, `${actor.name} petitioned the Crown.`, rng.int(7, 21), actor.id, sourceEventId);
  }
  if (state.outsideAttention.rome >= 95 && state.calendar.week >= 12
    && state.authorityStages.bishopCompleted
    && state.authorityStages.examinerCompleted
    && state.authorityStages.papalLegateCompleted
    && !state.authorityStages.popeRollAttempted) {
    state.authorityStages.popeRollAttempted = true;
    if (rng.next() < 0.002) scheduleExternalVisit(state, "pope", `Rome's attention has become extraordinary.`, rng.int(30, 90), actor.id, sourceEventId);
  }
  if (state.outsideAttention.crown >= 95 && state.calendar.week >= 8
    && state.authorityStages.sheriffCompleted
    && state.authorityStages.royalCommissionerCompleted
    && state.authorityStages.nobleCompleted
    && !state.authorityStages.kingRollAttempted) {
    state.authorityStages.kingRollAttempted = true;
    if (rng.next() < 0.002) scheduleExternalVisit(state, "king", `The Crown's attention has become extraordinary.`, rng.int(20, 70), actor.id, sourceEventId);
  }
}

function createExternalVisitor(state, queued) {
  const definition = EXTERNAL_ROLES[queued.role];
  if (!definition) throw new Error(`Unknown external role: ${queued.role}`);
  const rng = new SeededRng(`${state.seed}:external:${queued.id}:${queued.role}`);
  const chosenName = queued.payload?.priestName || rng.pick(definition.names);
  const person = {
    id: `external-${String(state.nextExternalSequence++).padStart(4, "0")}`,
    name: chosenName,
    firstName: chosenName.replace(/^(?:Father|Bishop|Steward|Magistrate|Lord|Lady|Sheriff|Doctor)\s+/i, "").split(" ")[0],
    surname: "Outside",
    role: queued.role,
    occupation: definition.title,
    age: rng.int(35, 72),
    sprite: definition.sprite,
    active: true,
    alive: true,
    materialized: true,
    profileRevealed: true,
    relationshipIds: queued.sourcePersonId ? [queued.sourcePersonId] : [],
    memories: [],
    personality: {
      traits: ["authoritative", queued.role.includes("papal") || queued.role === "pope" ? "devout" : "watchful"],
      candor: rng.int(45, 85),
      empathy: rng.int(25, 70),
      boldness: rng.int(65, 95),
      piety: rng.int(45, 95)
    },
    publicBackstory: queued.role === "neighbor_priest"
      ? `Parish priest of ${queued.payload.churchName} in ${queued.payload.parishName}.`
      : `${definition.title} visiting from beyond the parish.`,
    backstory: `${definition.title} visiting because ${queued.reason}.`,
    privatePressure: queued.reason,
    trustPriest: 50,
    stress: 25,
    faith: 65,
    morale: 60,
    prosperity: 70,
    health: 75,
    reputation: 75
  };
  state.externalActors.push(person);
  return { person, definition };
}

function initializeVisitObligations(visit) {
  ensureConversationContinuity(visit);
  if (visit.continuity.obligationStack.length) return visit;
  const alternative = visit.issue.kind === "confession" && !visit.hiddenConcernDisclosed
    ? "Decide whether to offer enough safety and trust for the visitor to speak more plainly."
    : (visit.scenarioFacts || []).find((fact) => fact.id === "alternative")?.text
      || visit.intent?.desiredOutcome
      || "Respond to the visitor's request.";
  visit.continuity.obligationStack.push({
    id: `obligation-${visit.visitId}-decision`,
    kind: "player_decision",
    prompt: String(alternative).slice(0, 300),
    priority: 80,
    resumable: true,
    status: "open",
    createdTurn: 0,
    resolvedTurn: null
  });
  if (!visit.continuity.semantic.sceneGoals.length) {
    visit.continuity.semantic.sceneGoals.push({
      id: `semantic-${visit.visitId}-scene-goal`,
      turn: 0,
      text: String(alternative).slice(0, 240),
      status: "open"
    });
  }
  return visit;
}

export function beginVisit(state, { record = true } = {}) {
  if (!state.priest.alive) throw new Error("The priest is dead; no further appointments can begin");
  if (state.calendar.dayIndex === 6) {
    throw new Error("Sunday is reserved for the parish service");
  }
  if (state.currentVisit) {
    return state.currentVisit;
  }
  if (state.calendar.slot >= 4) {
    const requested = acceptedVisitRequests(state)
      .sort((left, right) => left.id.localeCompare(right.id))[state.calendar.slot - 4];
    if (!requested || requested.status !== "accepted") throw new Error("No requested visitor remains for this appointment");
    const person = materializeResident(state, requested.personId, true);
    requested.status = "completed";
    person.visitCount += 1;
    person.lastVisitDay = state.calendar.absoluteDay;
    const issue = issueForPerson(state, person);
    issue.requestedByPriest = true;
    issue.requestReason = requested.reason;
    issue.opening = requested.reason
      ? `Father, your message asked me to come because ${requested.reason}. ${issue.opening}`
      : `Father, your message asked me to come. I was not sure why you wished to see me, though there is a matter already weighing on me. ${issue.opening}`;
    const originEvent = appendEvent(state, {
      type: "requested_visit_started",
      parentId: state.events.at(-1)?.id || null,
      actorId: person.id,
      targetId: "priest",
      facts: { requestId: requested.id, reason: requested.reason }
    });
    state.currentVisit = {
      visitId: `visit-${state.calendar.absoluteDay}-${state.calendar.slot}-${person.id}`,
      personId: person.id,
      issue,
      intent: createVisitIntent(state, person, issue),
      location: issue.location,
      turnsUsed: 0,
      maxTurns: 10,
      originEventId: originEvent.id,
      history: [{ speaker: "visitor", text: issue.opening }],
      counsel: [],
      mood: issue.gravity >= 4 ? "troubled" : "guarded",
      disclosure: 10,
      hiddenConcernDisclosed: Boolean(issue.openingDisclosesHidden),
      scenarioFacts: issue.scenarioFacts,
      revealedFactIds: [],
      stagnationCount: 0,
      lastVisitorReplies: [issue.opening],
      eventLicense: "ordinary",
      reactionState: createInitialReactionState(state, person, issue, "requested"),
      turnAudits: [],
      reactionStateMigrated: false,
      promptTraces: [],
      continuity: {
        unresolvedQuestions: [],
        agreements: [],
        retractions: [],
        mentionedFactIds: [],
        currentObligation: null,
        lastAnsweredQuestionTurnIds: [],
        proposals: [],
        visitorDecisions: [],
        obligationStack: []
      }
    };
    initializeVisitObligations(state.currentVisit);
    if (record) appendCommand(state, "begin_visit", { personId: person.id, visitId: state.currentVisit.visitId });
    return state.currentVisit;
  }
  state.eventQueue = state.eventQueue.filter((event) => {
    if (!["sermon_followup", "resident_followup", "priest_summons"].includes(event.type) || event.dueDay > state.calendar.absoluteDay) return true;
    const actor = state.residents.find((person) => person.id === event.sourcePersonId);
    return Boolean(actor?.active && actor.alive);
  });
  const hasDueExternalVisit = state.eventQueue.some((event) => (
    event.type === "external_visit" && event.dueDay <= state.calendar.absoluteDay
  ));
  const followupIndex = state.eventQueue.findIndex((event) => (
    !hasDueExternalVisit
    && ["sermon_followup", "resident_followup", "priest_summons"].includes(event.type)
    && event.dueDay <= state.calendar.absoluteDay
  ));
  if (followupIndex >= 0) {
    const queued = state.eventQueue.splice(followupIndex, 1)[0];
    const person = materializeResident(state, queued.sourcePersonId, true);
    person.visitCount += 1;
    person.lastVisitDay = state.calendar.absoluteDay;
    const sourceEvent = state.events.find((event) => event.id === queued.sourceEventId);
    const relatedPersonId = [sourceEvent?.actorId, sourceEvent?.targetId]
      .find((personId) => personId && personId !== "priest" && personId !== person.id) || null;
    const sourceThread = state.issueThreads
      .filter((thread) => thread.subjectIds.includes(person.id) || thread.subjectIds.includes(relatedPersonId))
      .sort((left, right) => right.lastTouchedDay - left.lastTouchedDay)[0];
    const issue = {
      kind: queued.type === "sermon_followup"
        ? "sermon follow-up"
        : queued.type === "priest_summons" ? "requested meeting" : "consequence follow-up",
      location: "nave",
      gravity: 3,
      opening: queued.type === "sermon_followup"
        ? `Father, I have come because of what happened after Sunday's sermon.`
        : queued.type === "priest_summons"
          ? `Father, I was told that you asked me to come and speak with you. ${queued.reason}`
        : `Father, I have come because of what happened in the village: ${queued.reason}`,
      detail: queued.reason,
      relatedPersonId,
      relatedName: state.residents.find((resident) => resident.id === relatedPersonId)?.name || null,
      scenarioId: sourceThread?.scenarioId || queued.type,
      threadId: sourceThread?.id || null,
      openingContext: {
        timing: `after the event recorded on day ${sourceEvent?.day ?? state.calendar.absoluteDay}`,
        place: "within the village",
        witness: sourceEvent?.facts?.title
          ? `The public record names the event as "${sourceEvent.facts.title}".`
          : "The people directly involved know part of what occurred."
      },
      scenarioFacts: [
        {
          id: "concrete_matter",
          text: queued.reason,
          anchors: (queued.reason.toLowerCase().match(/[a-z]{5,}/g) || []).slice(0, 8)
        },
        {
          id: "mechanism",
          text: sourceEvent?.facts?.title
            ? `This follow-up was caused by the earlier event "${sourceEvent.facts.title}".`
            : "This follow-up was caused by an earlier interaction in the village.",
          anchors: ["follow", "earlier", "event"]
        },
        {
          id: "stakes",
          text: "The visitor's reputation, relationships, safety, work, or household may change according to how the earlier event is answered.",
          anchors: ["reputation", "relationships", "safety", "household"]
        },
        {
          id: "alternative",
          text: "Clarify the disputed facts, identify immediate harm, and choose one proportionate next step with the people directly involved.",
          anchors: ["clarify", "facts", "harm", "proportionate"]
        }
      ]
    };
    expandScenarioFactWeb(state, issue, person);
    if (sourceThread) {
      const followupVisibility = sourceThread.visibility?.scope === "public"
        ? sourceThread.visibility
        : { scope: "private_visit", authorizedPersonIds: [person.id, "priest"] };
      issue.scenarioFacts = issue.scenarioFacts.map((fact) => ({
        ...fact,
        issueId: sourceThread.id,
        provenance: fact.provenance || "state",
        confidence: fact.confidence ?? 100,
        visibility: fact.visibility || followupVisibility,
        allowedSpeakers: fact.allowedSpeakers || [person.id]
      }));
    } else {
      attachIssueThread(state, issue, person);
    }
    const originEvent = appendEvent(state, {
      type: queued.type === "sermon_followup"
        ? "sermon_followup_started"
        : queued.type === "priest_summons" ? "requested_visit_started" : "resident_followup_started",
      parentId: queued.sourceEventId,
      actorId: person.id,
      targetId: "priest",
      facts: { queuedEventId: queued.id }
    });
    state.currentVisit = {
      visitId: `visit-${state.calendar.absoluteDay}-${state.calendar.slot}-${person.id}`,
      personId: person.id,
      issue,
      intent: createVisitIntent(state, person, issue),
      location: issue.location,
      turnsUsed: 0,
      maxTurns: 10,
      originEventId: originEvent.id,
      history: [{ speaker: "visitor", text: issue.opening }],
      counsel: [],
      mood: "guarded",
      disclosure: 20,
      hiddenConcernDisclosed: Boolean(issue.openingDisclosesHidden),
      scenarioFacts: issue.scenarioFacts,
      revealedFactIds: [],
      stagnationCount: 0,
      lastVisitorReplies: [issue.opening],
      eventLicense: "ordinary",
      reactionState: createInitialReactionState(
        state,
        person,
        issue,
        queued.type === "priest_summons" ? "summoned" : "followup"
      ),
      turnAudits: [],
      reactionStateMigrated: false,
      promptTraces: [],
      continuity: {
        unresolvedQuestions: [],
        agreements: [],
        retractions: [],
        mentionedFactIds: [],
        currentObligation: null,
        lastAnsweredQuestionTurnIds: [],
        proposals: [],
        visitorDecisions: [],
        obligationStack: []
      }
    };
    initializeVisitObligations(state.currentVisit);
    if (record) appendCommand(state, "begin_visit", { personId: person.id, visitId: state.currentVisit.visitId });
    return state.currentVisit;
  }
  const queuedIndex = state.eventQueue.findIndex((event) => (
    event.type === "external_visit" && event.dueDay <= state.calendar.absoluteDay
  ));
  if (queuedIndex >= 0) {
    const queued = state.eventQueue.splice(queuedIndex, 1)[0];
    const { person, definition } = createExternalVisitor(state, queued);
    const neighborPayload = queued.role === "neighbor_priest" ? queued.payload : null;
    const issue = {
      kind: neighborPayload ? "neighboring parish appeal" : "outside authority",
      location: definition.location,
      gravity: 5,
      opening: neighborPayload
        ? `Father, I serve ${neighborPayload.churchName} in ${neighborPayload.parishName}. Our stores are failing, and I have authority only to ask—not to bind your parish. The road between us takes ${neighborPayload.travelDays} days. Will you spare ${neighborPayload.amount} sacks of grain, send someone to inspect our need, refuse us, or propose different terms?`
        : definition.opening,
      detail: queued.reason,
      relatedPersonId: queued.sourcePersonId,
      relatedName: queued.sourcePersonId
        ? state.residents.find((resident) => resident.id === queued.sourcePersonId)?.name
        : null,
      scenarioId: neighborPayload ? "external_relief_request" : `external_${queued.role}`,
      neighborParishId: neighborPayload?.neighborParishId || null,
      narrativeThreadId: neighborPayload?.narrativeThreadId || null,
      requestedResource: neighborPayload?.resource || null,
      requestedAmount: neighborPayload?.amount || null,
      deadlineDays: neighborPayload?.travelDays || 7,
      hasExplicitDeadline: Boolean(neighborPayload),
      scenarioFacts: neighborPayload ? [
        {
          id: "concrete_matter",
          text: `${neighborPayload.churchName} in ${neighborPayload.parishName} has requested help because its local stores can no longer meet current need.`,
          anchors: ["church", "stores", "help", "need"]
        },
        {
          id: "authority",
          text: `${neighborPayload.priestName} may request and receive aid. ${neighborPayload.stewardName} administers local stores, while ${neighborPayload.lordName} holds manor authority. None of them can bind this parish without consent.`,
          anchors: ["priest", "steward", "lord", "authority"]
        },
        {
          id: "stakes",
          text: `The request is for ${neighborPayload.amount} sacks of grain. Giving it reduces this church's reserve; refusing leaves the neighboring shortage unresolved.`,
          anchors: ["grain", "reserve", "shortage"]
        },
        {
          id: "timeline",
          text: `Travel between the parishes takes ${neighborPayload.travelDays} days each way.`,
          anchors: ["travel", "days", "parishes"]
        },
        {
          id: "alternative",
          text: "Give the requested grain, send a delegate to verify the need, refuse, or negotiate smaller and conditional aid.",
          anchors: ["give", "delegate", "refuse", "negotiate"]
        }
      ] : []
    };
    if (neighborPayload) {
      const visibility = { scope: "public", authorizedPersonIds: [person.id, "priest"] };
      issue.scenarioFacts = issue.scenarioFacts.map((fact) => ({
        ...fact,
        issueId: issue.narrativeThreadId,
        provenance: "state",
        confidence: 100,
        visibility,
        allowedSpeakers: [person.id],
        anchors: fact.anchors || []
      }));
    }
    const originEvent = appendEvent(state, {
      type: "external_visit_started",
      parentId: queued.sourceEventId || state.events.at(-1)?.id || null,
      actorId: person.id,
      targetId: "priest",
      facts: { role: queued.role, reason: queued.reason }
    });
    state.currentVisit = {
      visitId: `visit-${state.calendar.absoluteDay}-${state.calendar.slot}-${person.id}`,
      personId: person.id,
      issue,
      intent: createVisitIntent(state, person, issue),
      location: issue.location,
      turnsUsed: 0,
      maxTurns: 10,
      originEventId: originEvent.id,
      history: [{ speaker: "visitor", text: issue.opening }],
      counsel: [],
      mood: "guarded",
      disclosure: 20,
      hiddenConcernDisclosed: Boolean(issue.openingDisclosesHidden),
      scenarioFacts: issue.scenarioFacts,
      revealedFactIds: [],
      stagnationCount: 0,
      lastVisitorReplies: [issue.opening],
      eventLicense: "ordinary",
      reactionState: createInitialReactionState(state, person, issue, "authority"),
      turnAudits: [],
      reactionStateMigrated: false,
      promptTraces: [],
      continuity: {
        unresolvedQuestions: [],
        agreements: [],
        retractions: [],
        mentionedFactIds: [],
        currentObligation: null,
        lastAnsweredQuestionTurnIds: [],
        proposals: [],
        visitorDecisions: [],
        obligationStack: []
      }
    };
    initializeVisitObligations(state.currentVisit);
    if (record) appendCommand(state, "begin_visit", { personId: person.id, visitId: state.currentVisit.visitId });
    return state.currentVisit;
  }
  const candidates = counselEligibleResidents(state)
    .filter((person) => person.lastVisitDay < state.calendar.absoluteDay - 4)
    .sort((a, b) => (a.visitCount - b.visitCount) || (a.lastVisitDay - b.lastVisitDay));
  const backfill = candidates.length
    ? candidates
    : counselEligibleResidents(state).sort((a, b) => (a.lastVisitDay - b.lastVisitDay) || (a.visitCount - b.visitCount));
  if (!backfill.length) {
    throw new Error("No active villagers remain to fill this appointment");
  }
  const pool = backfill.slice(0, Math.max(12, Math.ceil(backfill.length / 4)));
  const rng = new SeededRng(`${state.seed}:visitor:${state.calendar.absoluteDay}:${state.calendar.slot}`);
  const person = materializeResident(state, rng.pick(pool).id, true);
  const issue = issueForPerson(state, person);
  const eventRoll = rng.next();
  person.visitCount += 1;
  person.lastVisitDay = state.calendar.absoluteDay;
  const originEvent = appendEvent(state, {
    type: "visit_started",
    parentId: state.events.at(-1)?.id || null,
    actorId: person.id,
    facts: { issueKind: issue.kind, location: issue.location }
  });
  state.currentVisit = {
    visitId: `visit-${state.calendar.absoluteDay}-${state.calendar.slot}-${person.id}`,
    personId: person.id,
    issue,
    intent: createVisitIntent(state, person, issue),
    location: issue.location,
    turnsUsed: 0,
    maxTurns: 10,
    originEventId: originEvent.id,
    history: [{ speaker: "visitor", text: issue.opening }],
    counsel: [],
    mood: issue.gravity >= 4 ? "troubled" : "guarded",
    disclosure: 10,
    hiddenConcernDisclosed: Boolean(issue.openingDisclosesHidden),
    scenarioFacts: issue.scenarioFacts,
    revealedFactIds: [],
    stagnationCount: 0,
    lastVisitorReplies: [issue.opening],
    eventLicense: eventRoll < 0.01 ? "outrageous" : eventRoll < 0.08 ? "comic" : "ordinary",
    reactionState: createInitialReactionState(state, person, issue, "ordinary"),
    turnAudits: [],
    reactionStateMigrated: false,
    promptTraces: [],
    continuity: {
      unresolvedQuestions: [],
      agreements: [],
      retractions: [],
      mentionedFactIds: [],
      currentObligation: null,
      lastAnsweredQuestionTurnIds: [],
      proposals: [],
      visitorDecisions: [],
      obligationStack: []
    }
  };
  initializeVisitObligations(state.currentVisit);
  if (issue.kind === "confession") {
    state.statistics.confessions += 1;
  }
  if (issue.kind === "confession" && state.currentVisit.hiddenConcernDisclosed) {
    addStructuredMemory(state, person, {
      type: "disclosed_secret",
      summary: state.currentVisit.intent.hiddenConcern,
      emotion: "ashamed",
      confidence: 100,
      privateMemory: true,
      visibility: {
        scope: issue.location === "confessional" ? "private_confession" : "private_visit",
        authorizedPersonIds: [person.id, "priest"]
      },
      sourceEventId: originEvent.id
    });
  }
  if (record) {
    appendCommand(state, "begin_visit", { personId: person.id, visitId: state.currentVisit.visitId });
  }
  return state.currentVisit;
}

export function applyVisitOpening(state, opening, source = "ai") {
  const visit = state.currentVisit;
  const cleanOpening = String(opening || "").trim().slice(0, 800);
  if (!visit || visit.turnsUsed !== 0 || visit.history.length !== 1 || !cleanOpening) {
    throw new Error("A generated opening can only be applied before the conversation begins");
  }
  visit.issue.opening = cleanOpening;
  visit.history[0] = { speaker: "visitor", text: cleanOpening };
  visit.lastVisitorReplies = [cleanOpening];
  const command = [...state.commandLog].reverse().find((entry) => (
    entry.type === "begin_visit"
      && entry.payload.visitId === visit.visitId
      && entry.payload.personId === visit.personId
  ));
  if (!command) throw new Error("The active visit has no begin-visit command");
  command.payload.opening = cleanOpening;
  if (source === "ai" && command.source !== "ai") {
    command.source = "ai";
    state.aiProposals.push({
      id: `proposal-${String(state.aiProposals.length + 1).padStart(6, "0")}`,
      commandId: command.id
    });
  }
  return cleanOpening;
}

function requestedConversationLocation(text) {
  const speech = String(text || "").toLowerCase();
  if (/\b(?:confessional|confession box|hear (?:my|your) confession)\b/.test(speech)) return "confessional";
  if (/\b(?:parish office|your office|your study|private room|private chamber|somewhere private|speak in private|talk in private|discuss this in private)\b/.test(speech)) return "office";
  if (/\b(?:before the shrine|near the shrine|at the shrine|before the altar|near the altar|at the altar)\b/.test(speech)) return "shrine";
  if (/\b(?:main nave|the nave|among the pews|main auditorium)\b/.test(speech)) return "nave";
  return null;
}

function residentMentionedInText(state, text) {
  const speech = String(text || "").toLowerCase();
  const fullMatches = state.residents.filter((resident) => speech.includes(resident.name.toLowerCase()));
  if (fullMatches.length === 1) return fullMatches[0];
  const firstMatches = state.residents.filter((resident) => (
    resident.firstName.length >= 4
    && new RegExp(`\\b${resident.firstName.toLowerCase()}\\b`).test(speech)
  ));
  if (firstMatches.length === 1) return firstMatches[0];
  const titledSurnameMatches = state.residents.filter((resident) => (
    new RegExp(`\\b(?:master|mistress|lord|lady|steward|bailiff)\\s+${resident.surname.toLowerCase()}\\b`).test(speech)
  ));
  return titledSurnameMatches.length === 1 ? titledSurnameMatches[0] : null;
}

function summonedResident(state, visit, priestText) {
  if (!/\b(?:send (?:him|her)|tell .{0,35} to come|ask .{0,35} to come|have .{0,35} come|come (?:talk|speak) to me|come see me)\b/i.test(priestText)) {
    return null;
  }
  const titledSurname = String(priestText).toLowerCase()
    .match(/\b(?:master|mistress|lord|lady|steward|bailiff)\s+([a-z'-]+)\b/)?.[1];
  if (titledSurname && state.residents.filter((resident) => resident.surname.toLowerCase() === titledSurname).length !== 1) {
    return null;
  }
  const direct = residentMentionedInText(state, priestText);
  if (direct) return direct;
  for (const line of [...visit.history].reverse()) {
    const resident = residentMentionedInText(state, line.text);
    if (resident) return resident;
  }
  return null;
}

function conversationLocationChange(visit, priestText) {
  const previousVisitorLine = [...visit.history].reverse()
    .find((line) => line.speaker === "visitor")?.text || "";
  const requestedByPriest = requestedConversationLocation(priestText);
  const priestProposesMovement = /\b(?:let us|let's|we can|we shall|we will|we'll|come with me|go with me|move to|continue (?:this|our talk)|speak there|talk there)\b/i.test(priestText);
  if (requestedByPriest && priestProposesMovement) return requestedByPriest;
  const requestedByVisitor = requestedConversationLocation(previousVisitorLine);
  const priestAgrees = /^(?:ok|okay|yes|certainly|very well|of course)\b|\b(?:let us|let's|we can|we shall|we will|we'll|come with me)\b/i.test(priestText);
  return requestedByVisitor && priestAgrees ? requestedByVisitor : null;
}

function recordReportablePriestConduct(state, person, preview) {
  const reportable = preview.classification.credibleThreat
    || preview.classification.categories.some((category) => (
      ["sexual_or_inappropriate", "coercive", "cruel", "humiliating"].includes(category)
    ))
    || preview.classification.violatedBoundary;
  if (!reportable) return null;
  if (state.priestReports.some((report) => report.auditIds.includes(preview.auditId))) {
    return null;
  }
  const recent = state.priestReports.find((report) => (
    report.reporterId === person.id
    && state.calendar.absoluteDay - report.createdDay < 14
    && report.status === "private_complaint"
  ));
  if (recent) {
    recent.auditIds.push(preview.auditId);
    recent.allegation = `${recent.allegation}; repeated ${preview.requiredReaction}`;
    return recent;
  }
  const report = {
    id: `priest-report-${String(state.nextPriestReportSequence++).padStart(6, "0")}`,
    reporterId: person.id,
    auditIds: [preview.auditId],
    allegation: preview.classification.credibleThreat
      ? "credible threat by the priest"
      : `priest conduct classified as ${preview.classification.categories.join(", ")}`,
    createdDay: state.calendar.absoluteDay,
    status: "private_complaint",
    eligibleRecipients: ["archdeacon", "bishop"],
    visibility: {
      scope: "private_visit",
      authorizedPersonIds: [person.id]
    }
  };
  state.priestReports.push(report);
  return report;
}

function applyImmediateConversationReaction(state, person, visit, preview) {
  const reaction = preview.requiredReaction;
  if (reaction === "continue") return null;
  const event = appendEvent(state, {
    type: `conversation_reaction_${reaction}`,
    parentId: visit.originEventId,
    actorId: person.id,
    targetId: reaction === "call_for_help" ? null : "priest",
    facts: {
      auditId: preview.auditId,
      reaction,
      thresholdReasons: preview.thresholdReasons,
      visibility: preview.visibility
    }
  });
  addStructuredMemory(state, person, {
    type: ["set_boundary", "challenge"].includes(reaction)
      ? "boundary"
      : ["threaten_priest", "attack_priest"].includes(reaction) ? "threat" : "immediate_reaction",
    subjectId: "priest",
    summary: `During counsel, the visitor reacted by ${reaction.replaceAll("_", " ")} because ${preview.thresholdReasons.join(", ") || "the conversation had changed"}.`,
    emotion: preview.mood,
    confidence: 100,
    privateMemory: preview.visibility.scope !== "public",
    visibility: preview.visibility,
    sourceEventId: event.id
  });
  if (reaction === "call_for_help") {
    const helper = selectSafeConversationHelper(state, person, visit);
    if (helper) {
      appendEvent(state, {
        type: "conversation_helper_called",
        parentId: event.id,
        actorId: person.id,
        targetId: helper.id,
        facts: { auditId: preview.auditId, helperRole: helper.occupation }
      });
    }
  } else if (reaction === "threaten_priest") {
    state.priest.scandal = clamp(state.priest.scandal + 2);
    state.priest.localTrust = clamp(state.priest.localTrust - 1);
  } else if (reaction === "attack_priest") {
    if (!canApplyImmediateReaction(state, person, visit, reaction, preview.nextState, preview.classification)) {
      visit.reactionState.lastReaction = selectSafeConversationHelper(state, person, visit) ? "call_for_help" : "leave";
      visit.reactionState.endReason = visit.reactionState.lastReaction === "call_for_help" ? "called_for_help" : "danger";
      return event;
    }
    applyAction(state, {
      actorId: person.id,
      targetId: "priest",
      actionType: "attack_priest",
      intensity: 2,
      motive: "fearful",
      title: `${person.name} attacks Father Benedict`,
      description: `${person.name} attacks Father Benedict during the meeting.`,
      parentEventId: event.id
    });
  }
  return event;
}

function authoritativeReactionReply(person, reaction) {
  return {
    amused: `${person.firstName} gives a startled laugh. "That is strange, Father, but I understand you are trying to help."`,
    confused: `"I am losing the thread, Father. Please speak plainly about the matter before us."`,
    emotionally_affected: `${person.firstName}'s voice tightens. "That has struck more deeply than you may realize."`,
    challenge: `"No, Father. Explain why you have spoken to me that way."`,
    set_boundary: `"Stop, Father. I will continue only if you speak without mockery, threats, or humiliation."`,
    cry: `${person.firstName}'s voice breaks, and the visitor begins to cry.`,
    withdraw: `${person.firstName} looks away. "I do not wish to answer further while you speak this way."`,
    leave: `${person.firstName} rises. "This meeting is over, Father."`,
    call_for_help: `${person.firstName} moves toward the door and calls into the church for assistance.`,
    threaten_priest: `${person.firstName} stands abruptly. "Do not threaten me again, Father."`,
    attack_priest: `${person.firstName}'s anger breaks into sudden violence.`
  }[reaction] || `"I hear you, Father."`;
}

function recordNeighborParishDecision(state, person, visit, text) {
  if (person.role !== "neighbor_priest" || !visit.issue.neighborParishId) return null;
  const parish = state.neighboringParishes.find((entry) => entry.id === visit.issue.neighborParishId);
  const thread = state.narrativeThreads.find((entry) => entry.id === visit.issue.narrativeThreadId);
  if (!parish || !thread) return null;
  const speech = String(text).toLowerCase();
  if (/\b(?:we cannot help|i refuse|we refuse|send nothing|no aid|cannot spare)\b/.test(speech)) {
    for (const commitment of state.commitments.filter((entry) => (
      entry.targetId === parish.id && entry.status === "open"
    ))) {
      if (commitment.type === "neighbor_relief_resource") {
        state.churchResources[commitment.payload.resource] += commitment.payload.amount;
      }
      commitment.status = "cancelled";
      commitment.cancelReason = "The priest withdrew the pledge before dispatch.";
    }
    const event = appendEvent(state, {
      type: "neighbor_relief_declined",
      parentId: visit.originEventId,
      actorId: "priest",
      targetId: person.id,
      facts: { neighborParishId: parish.id, narrativeThreadId: thread.id }
    });
    parish.status = "aid_declined";
    parish.lastEventId = event.id;
    thread.stage = "resolved";
    thread.status = "declined";
    thread.lastMeaningfulEventId = event.id;
    thread.causeEventIds.push(event.id);
    return { type: "declined", eventId: event.id };
  }
  const transfer = parseChurchTransferIntent(text);
  const acceptsHelp = /\b(?:yes|we will help|i will help|we can help|send aid|send someone|inspect the need)\b/.test(speech);
  if (!transfer && !acceptsHelp) return null;
  const existingCommitment = state.commitments.find((entry) => (
    entry.targetId === parish.id && entry.status === "open"
  ));
  if (existingCommitment) return existingCommitment;
  let type = "neighbor_relief_assessment";
  let payload = { neighborParishId: parish.id };
  if (transfer?.direction === "outgoing") {
    const resource = transfer.resource;
    const amount = Math.min(transfer.amount, state.churchResources[resource] || 0);
    if (amount <= 0) return null;
    state.churchResources[resource] -= amount;
    type = "neighbor_relief_resource";
    payload = { neighborParishId: parish.id, resource, amount };
  } else if (acceptsHelp && visit.issue.requestedResource && visit.issue.requestedAmount) {
    const resource = visit.issue.requestedResource;
    const amount = Math.min(visit.issue.requestedAmount, state.churchResources[resource] || 0);
    if (amount > 0) {
      state.churchResources[resource] -= amount;
      type = "neighbor_relief_resource";
      payload = { neighborParishId: parish.id, resource, amount };
    }
  }
  const event = appendEvent(state, {
    type: "commitment_created",
    parentId: visit.originEventId,
    actorId: "priest",
    targetId: person.id,
    facts: { type, neighborParishId: parish.id, payload }
  });
  const commitment = {
    id: `commitment-${String(state.nextCommitmentSequence++).padStart(6, "0")}`,
    type,
    actorId: "priest",
    targetId: parish.id,
    dueDay: state.calendar.absoluteDay + parish.travelDays,
    status: "open",
    sourceEventId: event.id,
    payload
  };
  state.commitments.push(commitment);
  parish.status = "aid_promised";
  parish.lastEventId = event.id;
  thread.stage = "choice";
  thread.status = "committed";
  thread.lastMeaningfulEventId = event.id;
  thread.causeEventIds.push(event.id);
  return commitment;
}

function updateSemanticConversationState(state, person, visit, response, preview) {
  const semantic = visit.continuity.semantic;
  const turn = visit.turnsUsed;
  let sequence = 1;
  const item = (type, text, status = "open", extra = {}) => ({
    id: `semantic-${visit.visitId}-${String(turn).padStart(2, "0")}-${type}-${String(sequence++).padStart(2, "0")}`,
    turn,
    text: String(text || "").slice(0, 240),
    status,
    ...extra
  });
  for (const act of response.interpretation?.speechActs || []) {
    semantic.topics.push(item("topic", act.meaning, "active", {
      speechAct: act.type,
      confidence: act.confidence
    }));
  }
  for (const claim of response.claims || []) {
    const base = {
      claimId: claim.claimId,
      claimType: claim.type,
      subjectId: claim.subjectId,
      targetIds: claim.targetIds,
      confidence: claim.confidence,
      evidenceFactIds: claim.evidenceFactIds
    };
    if (claim.type === "fact") semantic.factsMentioned.push(item("fact", claim.text, "mentioned", base));
    if (claim.type === "suspicion") semantic.suspicions.push(item("suspicion", claim.text, "open", base));
    if (claim.type === "belief" || claim.type === "opinion" || claim.type === "prediction" || claim.type === "rumor") {
      semantic.uncertainties.push(item("uncertainty", claim.text, claim.type, base));
    }
    if (claim.type === "proposal") semantic.practicalNeeds.push(item("proposal", claim.text, "proposed", base));
    if (claim.type === "promise") {
      semantic.commitments.push(item("commitment", claim.text, "promised", base));
      const commitmentKey = `${visit.visitId}:${claim.claimId}`;
      if (!state.commitments.some((entry) => entry.payload?.commitmentKey === commitmentKey)) {
        state.commitments.push({
          id: `commitment-${String(state.nextCommitmentSequence++).padStart(6, "0")}`,
          type: "npc_intention",
          actorId: person.id,
          targetId: claim.targetIds[0] || person.id,
          dueDay: state.calendar.absoluteDay + 1,
          status: "open",
          sourceEventId: visit.originEventId,
          payload: {
            commitmentKey,
            claimId: claim.claimId,
            text: claim.text,
            confidence: claim.confidence,
            targetIds: claim.targetIds
          }
        });
      }
    }
  }
  for (const question of response.newQuestions || []) {
    semantic.questions.push(item("question", question, "open"));
  }
  for (const position of response.responsePlan?.proposalPositions || []) {
    const target = position.status === "accepted" ? semantic.agreements
      : position.status === "rejected" ? semantic.refusals
        : position.status === "modified" ? semantic.disagreements
          : semantic.uncertainties;
    target.push(item("proposal-position", position.reason, position.status, {
      proposalId: position.proposalId
    }));
  }
  for (const obligationId of response.answeredObligations || []) {
    const question = semantic.questions.find((entry) => entry.id === obligationId);
    if (question) question.status = "answered";
  }
  if (response.responsePlan?.unknowns?.length) {
    for (const unknown of response.responsePlan.unknowns) {
      semantic.uncertainties.push(item("unknown", unknown, "open"));
    }
  }
  if (response.responsePlan?.desiredMovement) {
    semantic.npcGoals.push(item("npc-goal", response.responsePlan.desiredMovement, "active"));
  }
  const emotionalDelta = Object.entries(preview.deltas)
    .filter(([, delta]) => Number(delta) !== 0)
    .map(([field, delta]) => `${field} ${delta > 0 ? "+" : ""}${delta}`)
    .join(", ");
  if (emotionalDelta) semantic.emotionalChanges.push(item("emotion", emotionalDelta, "recorded"));
  for (const key of Object.keys(semantic)) semantic[key] = semantic[key].slice(-24);
}

export function recordExchange(state, playerText, response, { record = true } = {}) {
  const visit = state.currentVisit;
  if (!visit) {
    throw new Error("There is no visitor in the church");
  }
  if (visit.turnsUsed >= visit.maxTurns) {
    throw new Error("The hour is already spent");
  }
  if (visit.reactionState?.endedEarly) {
    throw new Error("The visitor has ended the meeting");
  }
  ensureConversationContinuity(visit);
  initializeVisitObligations(visit);
  const person = materializeResident(state, visit.personId, true);
  const cleanText = String(playerText).trim().slice(0, 600);
  if (!cleanText) {
    throw new Error("Counsel cannot be empty");
  }
  let reply = speakableText(String(response.reply || response.say || "")).slice(0, 600);
  if (!reply) {
    throw new Error("The visitor gave no response");
  }
  const preview = previewConversationReaction(state, person, visit, cleanText);
  const expressedReaction = REACTIONS.includes(response.expressedReaction)
    ? response.expressedReaction
    : "continue";
  if (preview.requiredReaction !== "continue" && expressedReaction !== preview.requiredReaction) {
    reply = speakableText(authoritativeReactionReply(person, preview.requiredReaction));
    response.expressedReaction = preview.requiredReaction;
    response.groundedFallback = true;
  }
  const clarifiedFacts = clarificationFacts(visit, cleanText);
  const nextLocation = conversationLocationChange(visit, cleanText);
  const summonsTarget = summonedResident(state, visit, cleanText);
  const questionTurnId = `priest-${visit.history.length}`;
  const issueId = visit.issue.threadId || visit.issue.scenarioId || visit.issue.kind;
  if (cleanText.includes("?")) {
    visit.continuity.unresolvedQuestions.push({
      turnId: questionTurnId,
      text: cleanText,
      issueId,
      status: "open"
    });
  }
  for (const fact of clarifiedFacts) {
    if (!visit.revealedFactIds.includes(fact.id)) visit.revealedFactIds.push(fact.id);
  }
  visit.turnsUsed += 1;
  visit.history.push({ speaker: "priest", text: cleanText });
  visit.history.push({ speaker: "visitor", text: reply });
  visit.lastVisitorReplies.push(reply);
  visit.lastVisitorReplies = visit.lastVisitorReplies.slice(-8);
  visit.stagnationCount = Math.max(0, Number(response.stagnationCount) || 0);
  visit.counsel.push(cleanText);
  const priorReactionState = visit.reactionState;
  const reactionAudit = {
    auditId: preview.auditId,
    turn: visit.turnsUsed,
    classification: preview.classification,
    deltas: preview.deltas,
    stateAfter: JSON.parse(JSON.stringify(preview.nextState)),
    requiredReaction: preview.requiredReaction,
    thresholdReasons: preview.thresholdReasons,
    expressedReaction: response.expressedReaction || "continue",
    fallbackUsed: Boolean(response.groundedFallback),
    visibility: preview.visibility,
    conversationObligation: response.conversationObligation
      ? JSON.parse(JSON.stringify(response.conversationObligation))
      : null
  };
  visit.reactionState = JSON.parse(JSON.stringify(preview.nextState));
  visit.turnAudits.push(reactionAudit);
  updateSemanticConversationState(state, person, visit, response, preview);
  const answeredQuestionIds = new Set(
    (response.segments || []).flatMap((segment) => segment.answeredQuestionTurnIds || [])
  );
  if (!Array.isArray(response.segments) && cleanText.includes("?")) answeredQuestionIds.add(questionTurnId);
  for (const question of visit.continuity.unresolvedQuestions) {
    if (answeredQuestionIds.has(question.turnId)) question.status = "answered";
  }
  if (cleanText.includes("?") && clarifiedFacts.length) {
    visit.continuity.obligationStack.push({
      id: `obligation-${visit.visitId}-fact-${String(visit.turnsUsed).padStart(2, "0")}`,
      kind: "answer_player_question",
      prompt: cleanText.slice(0, 300),
      priority: 100,
      resumable: false,
      status: "resolved",
      createdTurn: visit.turnsUsed,
      resolvedTurn: visit.turnsUsed
    });
  }
  const mentionedFactIds = new Set([
    ...(visit.continuity.mentionedFactIds || []),
    ...factIdsMentionedInText(visit.scenarioFacts, visit.history[0]?.text || ""),
    ...(response.segments || []).flatMap((segment) => segment.referencedFactIds || []),
    ...factIdsMentionedInText(visit.scenarioFacts, reply)
  ]);
  visit.continuity.mentionedFactIds = [...mentionedFactIds];
  visit.continuity.currentObligation = response.conversationObligation
    ? JSON.parse(JSON.stringify(response.conversationObligation))
    : null;
  visit.continuity.lastAnsweredQuestionTurnIds = [...answeredQuestionIds];
  const resolvedDecision = !cleanText.includes("?")
    && (
      (response.conversationObligation?.proposals || []).length > 0
      || ["exact_decision", "instruction_acknowledgment", "compound_turn", "voluntary_commitment", "departure_commitment"].includes(
        response.conversationObligation?.kind
      )
    );
  if (resolvedDecision) {
    const pendingDecision = visit.continuity.obligationStack
      .find((obligation) => obligation.kind === "player_decision" && obligation.status === "open");
    if (pendingDecision) {
      pendingDecision.status = "resolved";
      pendingDecision.resolvedTurn = visit.turnsUsed;
    }
  }
  visit.continuity.obligationStack = visit.continuity.obligationStack.slice(-12);
  for (const proposal of response.conversationObligation?.proposals || []) {
    if (visit.continuity.proposals.some((entry) => entry.proposalId === proposal.proposalId)) continue;
    visit.continuity.proposals.push({
      proposalId: proposal.proposalId,
      turn: visit.turnsUsed,
      rawText: String(proposal.rawText || "").slice(0, 180),
      actionHint: String(proposal.actionHint || "custom").slice(0, 40),
      priority: clamp(proposal.priority || 50, 0, 100),
      status: "pending"
    });
  }
  for (const decision of response.decisions || []) {
    const stored = {
      proposalId: String(decision.proposalId || "").slice(0, 80),
      turn: visit.turnsUsed,
      status: ["accepted", "rejected", "modified", "deferred", "unknown"].includes(decision.status)
        ? decision.status
        : "unknown",
      reason: completeGeneratedText(decision.reason, 120)
    };
    visit.continuity.visitorDecisions = visit.continuity.visitorDecisions
      .filter((entry) => entry.proposalId !== stored.proposalId);
    visit.continuity.visitorDecisions.push(stored);
    const proposal = visit.continuity.proposals.find((entry) => entry.proposalId === stored.proposalId);
    if (proposal) proposal.status = stored.status;
  }
  visit.continuity.proposals = visit.continuity.proposals.slice(-18);
  visit.continuity.visitorDecisions = visit.continuity.visitorDecisions.slice(-18);
  if (response.promptTrace) {
    visit.promptTraces.push(JSON.parse(JSON.stringify(response.promptTrace)));
    visit.promptTraces = visit.promptTraces.slice(-PROMPT_TRACE_LIMIT);
  }
  if (/\b(?:i will|i shall|i agree|i can do that|i promise)\b/i.test(reply)) {
    visit.continuity.agreements.push({
      turn: visit.turnsUsed,
      text: reply.slice(0, 180)
    });
  }
  if (/\b(?:i will not|i won't|i changed my mind|i retract|i no longer)\b/i.test(reply)) {
    visit.continuity.retractions.push({
      turn: visit.turnsUsed,
      text: reply.slice(0, 180)
    });
  }
  if (preview.nextState.harmfulTurnCount > priorReactionState.harmfulTurnCount) {
    addStructuredMemory(state, person, {
      type: "offense",
      subjectId: "priest",
      summary: `The priest caused offense during counsel through ${preview.classification.categories.join(", ")}.`,
      emotion: preview.mood,
      confidence: 100,
      privateMemory: preview.visibility.scope !== "public",
      visibility: preview.visibility,
      sourceEventId: visit.originEventId
    });
  }
  if (preview.nextState.repairCount > priorReactionState.repairCount) {
    addStructuredMemory(state, person, {
      type: "repair",
      subjectId: "priest",
      summary: "The priest acknowledged a prior offense and then changed behavior long enough for some trust to recover.",
      emotion: "softened",
      confidence: 90,
      privateMemory: preview.visibility.scope !== "public",
      visibility: preview.visibility,
      sourceEventId: visit.originEventId
    });
  }
  recordReportablePriestConduct(state, person, preview);
  if (nextLocation && nextLocation !== visit.location) {
    visit.location = nextLocation;
    visit.issue.location = nextLocation;
  }
  visit.mood = preview.mood;
  visit.disclosure = preview.disclosure;
  if (summonsTarget
    && summonsTarget.id !== person.id
    && /\b(?:i will|i'll|yes|tell|ask|send)\b/i.test(reply)
    && !/\b(?:will not|won't|cannot|can't|do not|don't)\b/i.test(reply)) {
    scheduleResidentFollowup(
      state,
      summonsTarget.id,
      `${person.name} carried Father Benedict's request that ${summonsTarget.name} come to the church.`,
      visit.originEventId,
      "priest_summons"
    );
  }
  if (response.conversationObligation?.followupRequested
    && /\b(?:i will|i shall|yes)\b/i.test(reply)
    && !/\b(?:will not|cannot|can't|do not)\b/i.test(reply)) {
    scheduleResidentFollowup(
      state,
      person.id,
      `${person.name} promised to return after carrying out the priest's requested action.`,
      visit.originEventId
    );
  }
  const requestedGifts = Array.isArray(response.churchGifts)
    ? response.churchGifts
    : (response.churchGift ? [response.churchGift] : []);
  const churchAids = requestedGifts.length
    ? requestedGifts
      .map((gift) => grantChurchResource(state, person, gift.resource, gift.amount))
      .filter(Boolean)
    : [applyChurchAid(state, person, cleanText)].filter(Boolean);
  /* Remember what has actually been handed over during this visit, so a priest
     confirming aid he has already promised does not empty the stores twice. */
  if (churchAids.length) {
    visit.giftLedger ||= {};
    for (const churchAid of churchAids) {
      visit.giftLedger[churchAid.resource] = (visit.giftLedger[churchAid.resource] || 0) + churchAid.amount;
    }
  }
  for (const churchAid of churchAids) {
    const relevant = giftAddressesMatter(churchAid.resource, visit) || churchAid.addressedNeed;
    /* Charity that speaks to the matter actually eases it. Charity that does
       not is still a kindness, but it should not quietly settle a quarrel it
       has nothing to do with. */
    if (relevant) {
      const thread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
      if (thread) {
        thread.pressure = clamp(thread.pressure - Math.min(18, 4 + churchAid.amount * 2));
        if (churchAid.resource === "medicine") thread.danger = clamp(thread.danger - 8);
      }
      person.trustPriest = clamp(person.trustPriest + 3);
    }
    const aidEvent = appendEvent(state, {
      type: "church_aid_given",
      parentId: visit.originEventId,
      actorId: "priest",
      targetId: person.id,
      facts: {
        resource: churchAid.resource,
        amount: churchAid.amount
      }
    });
    /* Charity has to leave a trace. Compaction keeps only events something
       still points at, so an unreferenced gift was being deleted from the
       parish's own history the moment the visit ended. */
    (visit.mechanicalEventIds ||= []).push(aidEvent.id);
    addStructuredMemory(state, person, {
      summary: `Father Benedict gave my household ${churchAid.amount} ${churchAid.unit} of ${churchAid.label.toLowerCase()}.`,
      sourceEventId: aidEvent.id,
      emotion: "grateful",
      type: "interaction"
    });
    response.churchAidApplied = {
      resource: churchAid.resource,
      amount: churchAid.amount,
      label: churchAid.label,
      unit: churchAid.unit,
      remaining: churchAid.remaining
    };
    (response.churchAidsApplied ||= []).push(response.churchAidApplied);
  }
  /* A villager may also give to the church, out of their own household. */
  const donations = Array.isArray(response.visitorDonations) ? response.visitorDonations : [];
  for (const donation of donations.slice(0, 4)) {
    const applied = applyChurchDonation(state, person, donation.resource, donation.amount);
    if (!applied) continue;
    const donationEvent = appendEvent(state, {
      type: "church_donation_received",
      parentId: visit.originEventId,
      actorId: person.id,
      targetId: "priest",
      facts: { resource: applied.resource, amount: applied.amount }
    });
    (visit.mechanicalEventIds ||= []).push(donationEvent.id);
    addStructuredMemory(state, person, {
      summary: `I gave the church ${applied.amount} ${applied.unit} of ${applied.label.toLowerCase()}.`,
      sourceEventId: donationEvent.id,
      emotion: "resolved",
      type: "interaction"
    });
    (response.churchDonationsApplied ||= []).push({
      resource: applied.resource,
      amount: applied.amount,
      label: applied.label,
      unit: applied.unit
    });
  }
  recordNeighborParishDecision(state, person, visit, cleanText);
  /* Sending for the watch, or beyond the village to the manor, happens as part
     of the exchange so that it travels in the command log and a save replays
     exactly. Both are validated by the engine before anything moves. */
  for (const summons of (Array.isArray(response.officerSummons) ? response.officerSummons : []).slice(0, 2)) {
    const result = summonOfficer(state, {
      officerId: summons.officerId,
      subjectId: summons.subjectId,
      purpose: summons.purpose,
      reason: summons.reason
    }, { record: false });
    if (result) {
      (visit.mechanicalEventIds ||= []).push(result.eventId);
      (response.officerSummonsApplied ||= []).push({
        officerName: result.officer.name,
        subjectName: result.subject.name,
        purpose: result.purpose
      });
    }
  }
  for (const petition of (Array.isArray(response.authorityPetitions) ? response.authorityPetitions : []).slice(0, 2)) {
    const result = petitionAuthority(state, {
      role: petition.role,
      subjectId: person.id,
      matter: petition.matter
    }, { record: false });
    if (result?.eventId) {
      (visit.mechanicalEventIds ||= []).push(result.eventId);
      (response.authorityPetitionsApplied ||= []).push({ role: result.role, title: result.title });
    }
  }
  if (preview.disclosed) {
    const disclosedVisibility = {
      scope: visit.location === "confessional" ? "private_confession" : "private_visit",
      authorizedPersonIds: [person.id, "priest"]
    };
    visit.hiddenConcernDisclosed = true;
    const thread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
    if (thread) {
      thread.visibility = disclosedVisibility;
      thread.publicAwareness = 0;
    }
    visit.history.push({ speaker: "visitor", text: `There is more: ${visit.intent.hiddenConcern}.` });
    addStructuredMemory(state, person, {
      type: "disclosed_secret",
      summary: visit.intent.hiddenConcern,
      emotion: "ashamed",
      confidence: 100,
      privateMemory: true,
      visibility: disclosedVisibility,
      sourceEventId: visit.originEventId
    });
  }
  person.trustPriest = clamp(person.trustPriest + preview.persistentTrustDelta, 0, 100);
  person.stress = clamp(person.stress + preview.persistentStressDelta, 0, 100);
  const exchangeVisibility = preview.disclosed
    ? {
      scope: visit.location === "confessional" ? "private_confession" : "private_visit",
      authorizedPersonIds: [person.id, "priest"]
    }
    : preview.visibility;
  addStructuredMemory(state, person, {
    summary: response.memory || `The priest said: ${cleanText.slice(0, 130)}`,
    emotion: preview.mood,
    confidence: 75,
    privateMemory: ["confessional", "office"].includes(visit.location)
      || visit.hiddenConcernDisclosed
      || preview.disclosed,
    visibility: exchangeVisibility,
    sourceEventId: visit.originEventId
  });
  if (preview.intents.includes("promise")) recordPromise(state, person.id, cleanText);
  recordPriestPosition(state, person.id, preview.intents, cleanText);
  applyImmediateConversationReaction(state, person, visit, preview);
  const breachSubject = detectConfidentialityBreach(state, person.id, cleanText);
  if (breachSubject) {
    state.priest.confidentialityBreaches.push({
      id: `breach-${String(state.priest.confidentialityBreaches.length + 1).padStart(5, "0")}`,
      subjectId: breachSubject.id,
      listenerId: person.id,
      day: state.calendar.absoluteDay
    });
    state.priest.scandal = clamp(state.priest.scandal + 4);
    person.trustPriest = clamp(person.trustPriest - 4);
  }
  state.statistics.conversations += 1;
  if (record) {
    appendCommand(state, "conversation_exchange", {
      playerText: cleanText,
      response: {
        reply,
        mood: preview.mood,
        trustDelta: preview.persistentTrustDelta,
        stressDelta: preview.persistentStressDelta,
        memory: String(response.memory || "").slice(0, 180),
        intents: preview.intents,
        disclosure: preview.disclosure,
        contradictionId: preview.contradictionId,
        groundedFallback: Boolean(response.groundedFallback),
        churchGifts: requestedGifts.map((gift) => ({
          resource: String(gift.resource),
          amount: Math.max(0, Math.floor(Number(gift.amount) || 0))
        })),
        visitorDonations: donations.map((gift) => ({
          resource: String(gift.resource),
          amount: Math.max(0, Math.floor(Number(gift.amount) || 0))
        })),
        /* The watch and the manor were sent for inside this exchange, so they
           have to travel inside its command. Without these two lines the
           summons happened once, live, and never again on replay, and the
           reloaded parish disagreed with its own save. */
        officerSummons: (response.officerSummons || []).slice(0, 2).map((summons) => ({
          officerId: String(summons.officerId || ""),
          subjectId: String(summons.subjectId || ""),
          purpose: String(summons.purpose || "protect"),
          reason: String(summons.reason || "").slice(0, 240)
        })),
        authorityPetitions: (response.authorityPetitions || []).slice(0, 2).map((petition) => ({
          role: String(petition.role || "steward"),
          matter: String(petition.matter || "").slice(0, 240)
        })),
        structuredFallback: Boolean(response.structuredFallback),
        stagnationCount: Math.max(0, Number(response.stagnationCount) || 0),
        interpretation: response.interpretation
          ? JSON.parse(JSON.stringify(response.interpretation))
          : null,
        responsePlan: response.responsePlan
          ? JSON.parse(JSON.stringify(response.responsePlan))
          : null,
        claims: Array.isArray(response.claims)
          ? JSON.parse(JSON.stringify(response.claims.slice(0, 12)))
          : [],
        answeredObligations: Array.isArray(response.answeredObligations)
          ? response.answeredObligations.slice(0, 12)
          : [],
        newQuestions: Array.isArray(response.newQuestions)
          ? response.newQuestions.slice(0, 6)
          : [],
        structuredProvided: Boolean(response.structuredProvided),
        referencedTurnIndexes: Array.isArray(response.referencedTurnIndexes)
          ? response.referencedTurnIndexes.slice(0, 6)
          : [],
        expressedReaction: response.expressedReaction || "continue",
        boundaryProposal: response.boundaryProposal || null,
        segments: Array.isArray(response.segments) ? response.segments.slice(0, 6) : [],
        conversationObligation: response.conversationObligation
          ? JSON.parse(JSON.stringify(response.conversationObligation))
          : null,
        promptTrace: response.promptTrace
          ? JSON.parse(JSON.stringify(response.promptTrace))
          : null,
        decisions: Array.isArray(response.decisions)
          ? JSON.parse(JSON.stringify(response.decisions.slice(0, 6)))
          : [],
        reactionAudit
      }
    }, response.source || "simulation");
  }
  return visit;
}

export function fallbackConversation(state, playerText) {
  const visit = state.currentVisit;
  const person = materializeResident(state, visit.personId, true);
  const compoundFallback = deterministicCompoundFallback(state, person, playerText);
  if (compoundFallback) return compoundFallback;
  if (String(playerText).trim() === "[silence]") {
    return {
      reply: visit.issue.gravity >= 4
        ? `"Father? This silence frightens me more than an answer would. Have you nothing to say?"`
        : `"I can wait a moment, Father, though I do not know what your silence means."`,
      mood: visit.issue.gravity >= 4 ? "troubled" : "uncertain",
      trustDelta: 0,
      stressDelta: visit.issue.gravity >= 4 ? 1 : 0,
      memory: "The priest answered with silence."
    };
  }
  const groundedFacts = clarificationFacts(visit, playerText);
  if (groundedFacts.length) {
    return {
      reply: groundedFacts.map((fact) => fact.text).join(" ").slice(0, 600),
      mood: "resolved",
      trustDelta: 0,
      stressDelta: 0,
      memory: "The visitor answered a request for concrete details.",
      groundedFallback: true
    };
  }
  const offer = String(playerText).toLowerCase().match(/\b(?:would you like|do you want|may i offer|can i offer)\b.*\b(cheese|bread|food|ale|water|coin)\b/);
  if (offer) {
    return {
      reply: `Yes, Father, thank you. I would gladly accept a little ${offer[1]}.`,
      mood: "grateful",
      trustDelta: 0,
      stressDelta: 0,
      memory: `The priest offered ${offer[1]}.`,
      groundedFallback: true
    };
  }
  if (/\b(?:start|open|build|run)\s+(?:your\s+)?own\s+(?:trade|business|shop|workshop)\b/.test(String(playerText).toLowerCase())) {
    const alternative = visit.scenarioFacts.find((fact) => fact.id === "alternative")?.text;
    return {
      reply: `My own trade could avoid the harm, but I would need tools, coin, and customers. ${alternative || ""}`.trim(),
      mood: "contemplative",
      trustDelta: 0,
      stressDelta: 0,
      memory: "The priest advised an independent trade.",
      groundedFallback: true
    };
  }
  const intents = classifyPriestSpeech(playerText);
  let reply;
  let mood = "uncertain";
  let trustDelta = 0;
  let stressDelta = 0;
  if (intents.includes("forgiveness")) {
    reply = `"Mercy is easier to ask for than to give. Yet I think I understand what you are asking of me, Father."`;
    mood = "softened";
    trustDelta = 2;
    stressDelta = -2;
  } else if (intents.includes("truth")) {
    reply = `"Then I must tell the truth, though it may cost me. I hoped you would offer an easier road."`;
    mood = "resolved";
    trustDelta = 2;
    stressDelta = 1;
  } else if (intents.includes("prayer")) {
    reply = person.personality.piety > 55
      ? `"I will pray on it. The words feel less empty when another person believes I may still be heard."`
      : `"I will try, Father, though prayer has not answered me as plainly as people claim."`;
    mood = "contemplative";
    trustDelta = 1;
    stressDelta = -1;
  } else if (intents.includes("departure")) {
    reply = `"To leave would end one trouble and begin five more. Still, perhaps I have been too afraid to count that path."`;
    mood = "wary";
    stressDelta = 1;
  } else if (intents.includes("comfort")) {
    reply = `"Thank you for hearing me without rushing to judgment. That alone is more kindness than I expected."`;
    mood = "relieved";
    trustDelta = 3;
    stressDelta = -3;
  } else {
    const trait = person.personality.traits[0];
    reply = `"I must think on that. You speak as though the choice is mine, but a ${trait} soul may still choose badly."`;
  }
  return {
    reply,
    mood,
    trustDelta,
    stressDelta,
    memory: `Father counseled: ${playerText.slice(0, 120)}`
  };
}

function addChronicle(state, title, text, tone = "neutral", event = {}) {
  const storedEvent = appendEvent(state, {
    type: event.type || "chronicle_event",
    parentId: event.parentId === undefined ? (state.events.at(-1)?.id || null) : event.parentId,
    actorId: event.actorId ?? null,
    targetId: event.targetId ?? null,
    facts: { title: String(title).slice(0, 120), tone, ...(event.facts || {}) }
  });
  state.chronicle.unshift({
    eventId: storedEvent.id,
    day: state.calendar.absoluteDay,
    title: String(title).slice(0, 120),
    text: completeGeneratedText(text, 700),
    tone
  });
  state.chronicle = state.chronicle.slice(0, 250);
}

export function executeDueCommitments(state, parentEventId) {
  for (const commitment of state.commitments
    .filter((entry) => entry.status === "open" && entry.dueDay <= state.calendar.absoluteDay)
    .sort((left, right) => left.dueDay - right.dueDay || left.id.localeCompare(right.id))) {
    if (commitment.type === "npc_intention") {
      const actor = state.residents.find((resident) => resident.id === commitment.actorId);
      if (!actor?.active || !actor.alive) {
        commitment.status = "failed";
        continue;
      }
      const rng = new SeededRng(`${state.seed}:commitment:${commitment.id}:${state.calendar.absoluteDay}`);
      const chance = clamp(
        35
          + (commitment.payload.confidence || 0.5) * 35
          + actor.morale * 0.15
          - actor.stress * 0.2,
        10,
        92
      );
      const fulfilled = rng.next() * 100 < chance;
      commitment.status = fulfilled ? "fulfilled" : "failed";
      addChronicle(
        state,
        fulfilled ? `${actor.name} follows through` : `${actor.name} fails to keep a promise`,
        fulfilled
          ? `${actor.name} acts on the earlier intention: ${commitment.payload.text}`
          : `${actor.name} does not complete the earlier intention: ${commitment.payload.text}`,
        fulfilled ? "change" : "danger",
        {
          type: fulfilled ? "npc_commitment_fulfilled" : "npc_commitment_failed",
          parentId: commitment.sourceEventId || parentEventId,
          actorId: actor.id,
          targetId: commitment.targetId,
          facts: { commitmentId: commitment.id }
        }
      );
      commitment.fulfilledEventId = state.chronicle[0].eventId;
      scheduleResidentFollowup(
        state,
        actor.id,
        fulfilled
          ? `${actor.name} returns to report what happened after keeping the promise.`
          : `${actor.name} returns to explain why the promise was not kept.`,
        commitment.fulfilledEventId
      );
      continue;
    }
    const parish = state.neighboringParishes.find((entry) => entry.id === commitment.targetId);
    if (!parish) {
      commitment.status = "failed";
      continue;
    }
    if (commitment.type === "neighbor_relief_resource") {
      const amount = Number(commitment.payload.amount) || 0;
      parish.pressures.food = clamp(parish.pressures.food - amount * 4);
      parish.trust = clamp(parish.trust + Math.min(18, amount * 3));
      parish.status = "aided";
      commitment.status = "fulfilled";
      addChronicle(
        state,
        `Aid reaches ${parish.name}`,
        `${amount} ${commitment.payload.resource} from ${state.town.name}'s church reaches ${parish.churchName} after ${parish.travelDays} days. ${parish.priestName} sends thanks and reports that the immediate shortage has eased.`,
        "faith",
        {
          type: "neighbor_relief_delivered",
          parentId: commitment.sourceEventId || parentEventId,
          actorId: "priest",
          facts: { commitmentId: commitment.id, neighborParishId: parish.id, amount }
        }
      );
      commitment.fulfilledEventId = state.chronicle[0].eventId;
    } else {
      parish.trust = clamp(parish.trust + 5);
      parish.status = "contacted";
      commitment.status = "fulfilled";
      addChronicle(
        state,
        `A delegation reaches ${parish.name}`,
        `A church delegate completes the ${parish.travelDays}-day journey, compares stores and witnesses, and returns with a clearer account of what ${parish.churchName} needs.`,
        "change",
        {
          type: "neighbor_assessment_completed",
          parentId: commitment.sourceEventId || parentEventId,
          actorId: "priest",
          facts: { commitmentId: commitment.id, neighborParishId: parish.id }
        }
      );
      commitment.fulfilledEventId = state.chronicle[0].eventId;
    }
    const thread = state.narrativeThreads.find((entry) => entry.neighborParishId === parish.id);
    if (thread) {
      thread.stage = "consequence";
      thread.status = "active";
      thread.pressure = Math.max(parish.pressures.food, parish.pressures.health, parish.pressures.order);
      thread.lastMeaningfulEventId = commitment.fulfilledEventId;
      thread.causeEventIds = [...new Set([...thread.causeEventIds, commitment.fulfilledEventId])].slice(-20);
    }
  }
}

/* =========================================================================
   The Sunday market
   -------------------------------------------------------------------------
   The board is not stored so much as settled: it is a pure reading of the
   parish as it stands, so the same parish always yields the same prices and a
   replayed game reaches the same market without the numbers having to travel
   in the log. What does travel is what the priest bought, because that spends
   coin and fills shelves.
   ========================================================================= */

/** The market as it stands. Settled at the Sunday sermon and not before. */
export function marketBoard(state, { refresh = false } = {}) {
  /* The board is deliberately *not* re-settled just because the day rolled
     over. A sermon ends the Sunday, so the priest does his shopping on what is
     already an old date, and anything bought has to stay bought. Only the
     sermon settles a new week's market. */
  if (refresh || !state.market) {
    state.market = { ...calculateMarket(state), settledDay: state.calendar.absoluteDay, purchases: [] };
  }
  return state.market;
}

/** Everything the priest could buy right now, with prices and reasons. */
export function marketOffer(state) {
  const board = marketBoard(state);
  return {
    season: board.season,
    weather: board.weather,
    coin: state.churchResources.coin,
    listings: marketListings(board)
  };
}

/**
 * Are the stalls still up?
 *
 * Derived rather than stored. A flag saying "the priest has finished shopping"
 * would have to travel in the command log to survive a replay, and it does not
 * need to: the market opens when the sermon settles the board and closes the
 * moment the priest turns to the week's first visitor, both of which are
 * already in the log.
 */
export function marketIsOpen(state) {
  if (!state.market || !state.lastSermonAftermath) return false;
  if (state.currentVisit) return false;
  return state.calendar.absoluteDay - state.market.settledDay <= 1;
}

/**
 * Spend church coin at the Sunday market. Each purchase is checked against the
 * board and against the purse before anything moves, so a request that asks for
 * more than the village has, or more than the church can pay for, is trimmed
 * rather than refused outright — a priest at a stall buys what he can.
 */
export function buyAtMarket(state, requested, { record = true } = {}) {
  const board = marketBoard(state);
  const wanted = Array.isArray(requested) ? requested : [];
  const bought = [];
  let spent = 0;

  for (const request of wanted.slice(0, PURCHASABLE_GOODS.length)) {
    const key = String(request?.good || request?.resource || "");
    if (!PURCHASABLE_GOODS.includes(key)) continue;
    const good = board.goods[key];
    if (!good || good.stock <= 0) continue;
    const asked = Math.max(0, Math.floor(Number(request?.quantity ?? request?.amount ?? 0)));
    if (asked <= 0) continue;
    const affordable = Math.floor((state.churchResources.coin - spent) / good.price);
    const amount = Math.min(asked, good.stock, Math.max(0, affordable));
    if (amount <= 0) continue;
    const cost = amount * good.price;
    good.stock -= amount;
    spent += cost;
    bought.push({ good: key, label: good.label, unit: good.unit, amount, price: good.price, cost, stores: good.stores });
  }

  if (!bought.length) return { bought: [], spent: 0 };

  state.churchResources.coin = clamp(state.churchResources.coin - spent, 0, 9999);
  for (const purchase of bought) {
    state.churchResources[purchase.stores] = clamp(
      (state.churchResources[purchase.stores] || 0) + purchase.amount, 0, 9999
    );
  }
  board.purchases.push(...bought);

  /* Money spent in the village is money the village has. Buying from your own
     parish is itself a small act of charity, and it shows in their purses. */
  const sellers = new Set();
  for (const purchase of bought) {
    for (const producer of board.goods[purchase.good].producers) sellers.add(producer.id);
  }
  const perSeller = sellers.size ? spent / sellers.size : 0;
  for (const sellerId of sellers) {
    const person = state.residents.find((entry) => entry.id === sellerId);
    const household = person && state.households.find((entry) => entry.id === person.householdId);
    if (household) household.wealth = clamp(household.wealth + perSeller * 0.6, 0, 1000);
    if (person) person.morale = clamp(person.morale + Math.min(3, perSeller * 0.4));
  }

  const summary = bought.map((purchase) => `${purchase.amount} ${purchase.unit} of ${purchase.label.toLowerCase()}`).join(", ");
  const marketEvent = appendEvent(state, {
    type: "market_purchase",
    actorId: "priest",
    targetId: null,
    facts: { spent, items: bought.map(({ good, amount, price }) => ({ good, amount, price })) }
  });
  addChronicle(
    state,
    "The church buys at market",
    `${summary} for ${spent} ${spent === 1 ? "penny" : "pennies"}.`,
    "change",
    { type: "market_purchase_noted", parentId: marketEvent.id, facts: { spent } }
  );

  if (record) {
    appendCommand(state, "buy_at_market", {
      purchases: bought.map(({ good, amount }) => ({ good, quantity: amount }))
    });
  }
  return { bought, spent };
}

export function advanceNarrativeDirector(state, parentEventId) {

  const day = state.calendar.absoluteDay;
  for (const parish of state.neighboringParishes) {
    const rng = new SeededRng(`${state.seed}:neighbor-pressure:${parish.id}:${day}`);
    parish.pressures.food = clamp(parish.pressures.food + rng.int(-1, 2));
    parish.pressures.health = clamp(parish.pressures.health + rng.int(-1, 1));
    parish.pressures.order = clamp(parish.pressures.order + rng.int(-1, 1));
    const thread = state.narrativeThreads.find((entry) => entry.neighborParishId === parish.id);
    if (!thread || ["resolved", "retired"].includes(thread.stage)) continue;
    thread.pressure = Math.max(parish.pressures.food, parish.pressures.health, parish.pressures.order);
    const lastEvent = state.events.find((event) => event.id === thread.lastMeaningfulEventId);
    if (thread.stage === "consequence"
      && lastEvent
      && day - lastEvent.day >= 5) {
      addChronicle(
        state,
        `${parish.name} remembers the aid`,
        `${parish.priestName} reports that households in ${parish.name} now speak differently of ${state.town.name}. The help eased one danger, though local work remains.`,
        "faith",
        {
          type: "neighbor_relief_echo",
          parentId: thread.lastMeaningfulEventId,
          facts: { narrativeThreadId: thread.id, neighborParishId: parish.id }
        }
      );
      thread.stage = "echo";
      thread.lastMeaningfulEventId = state.chronicle[0].eventId;
      thread.causeEventIds.push(state.chronicle[0].eventId);
    } else if (thread.stage === "echo"
      && lastEvent
      && day - lastEvent.day >= 10
      && thread.pressure < 72) {
      thread.stage = "resolved";
      thread.status = "resolved";
    }
    if (thread.stage === "seed" && day >= 3 && thread.pressure >= 70) {
      const event = appendEvent(state, {
        type: "narrative_pressure",
        parentId: parentEventId,
        actorId: null,
        targetId: null,
        facts: {
          narrativeThreadId: thread.id,
          neighborParishId: parish.id,
          pressure: thread.pressure
        }
      });
      addChronicle(
        state,
        `Uneasy news arrives from ${parish.name}`,
        `Travelers report that ${parish.churchName} is struggling with ${parish.pressures.food >= parish.pressures.health ? "food shortage" : "illness"}. No request has yet been made, but the strain is becoming visible.`,
        "neutral",
        {
          type: "narrative_foreshadow",
          parentId: event.id,
          facts: { narrativeThreadId: thread.id, neighborParishId: parish.id }
        }
      );
      thread.stage = "pressure";
      thread.status = "active";
      thread.lastMeaningfulEventId = state.chronicle[0].eventId;
      thread.causeEventIds.push(event.id, state.chronicle[0].eventId);
      parish.lastEventId = state.chronicle[0].eventId;
    }
  }
  const activeChoice = state.narrativeThreads.some((thread) => thread.stage === "choice");
  if (activeChoice || day < 7 || day - state.pacing.lastMajorDay < 3) return;
  const eligible = state.narrativeThreads
    .filter((thread) => thread.stage === "pressure" && thread.pressure >= 75)
    .map((thread) => ({
      thread,
      parish: state.neighboringParishes.find((entry) => entry.id === thread.neighborParishId)
    }))
    .filter(({ parish }) => parish
      && state.material.foodSecurity >= 40
      && state.churchResources.grain >= 10
      && state.priest.localTrust >= 42)
    .sort((left, right) => right.thread.pressure - left.thread.pressure || left.thread.id.localeCompare(right.thread.id));
  const selected = eligible[0];
  if (!selected) return;
  const development = appendEvent(state, {
    type: "narrative_development",
    parentId: selected.thread.lastMeaningfulEventId || parentEventId,
    actorId: null,
    targetId: "priest",
    facts: {
      narrativeThreadId: selected.thread.id,
      neighborParishId: selected.parish.id,
      seed: "external_relief_request",
      pressure: selected.thread.pressure
    }
  });
  const requestAmount = Math.min(6, Math.max(3, Math.ceil((selected.parish.pressures.food - 60) / 5)));
  scheduleExternalVisit(
    state,
    "neighbor_priest",
    `${selected.parish.priestName} seeks help for ${selected.parish.churchName} in ${selected.parish.name}.`,
    1,
    null,
    development.id,
    {
      neighborParishId: selected.parish.id,
      narrativeThreadId: selected.thread.id,
      priestName: selected.parish.priestName,
      churchName: selected.parish.churchName,
      parishName: selected.parish.name,
      stewardName: selected.parish.stewardName,
      lordName: selected.parish.lordName,
      travelDays: selected.parish.travelDays,
      resource: "grain",
      amount: requestAmount
    }
  );
  selected.thread.stage = "choice";
  selected.thread.status = "awaiting_player";
  selected.thread.lastMeaningfulEventId = development.id;
  selected.thread.causeEventIds.push(development.id);
  selected.parish.status = "requesting_help";
  selected.parish.lastEventId = development.id;
  state.pacing.lastMajorDay = day;
  state.pacing.consecutiveHighIntensity += 1;
}

/* What the parish and the wider church have actually seen this priest do.
 *
 * Recognition has to be earned by weight of real acts, not by a counter that
 * ticks up on its own, and the more prestigious the figure the more must have
 * happened before they trouble themselves. An archdeacon will ride out for a
 * parish that is visibly working; a bishop wants a great deal more; and the
 * same ladder runs downward, so heresy or cruelty brings the same men for the
 * opposite reason.
 */
function measurePriestRenown(state) {
  const aid = state.events.filter((event) => event.type === "church_aid_given");
  const householdsHelped = new Set(aid.map((event) => event.targetId));
  const protections = state.events.filter((event) => (
    event.type === "officer_summoned" && event.facts?.purpose !== "investigate"
  ));
  const donations = state.events.filter((event) => event.type === "church_donation_received");
  const resolved = state.issueThreads.filter((thread) => thread.status === "resolved");
  const relief = state.events.filter((event) => event.type === "neighbor_relief_delivered");
  const notables = state.residents.filter((person) => (
    person.active && person.alive
    && ["reeve", "bailiff", "watchman", "clerk"].includes(person.occupation)
    && person.trustPriest >= 70
  ));
  const merit = householdsHelped.size * 6
    + Math.min(aid.length, 40) * 2
    + protections.length * 5
    + donations.length * 4
    + resolved.length * 7
    + relief.length * 15
    + notables.length * 8
    + state.sermons.length * 2
    + Math.max(0, state.priest.moralAuthority - 50)
    + Math.max(0, state.priest.localTrust - 50);
  return {
    merit,
    householdsHelped: householdsHelped.size,
    protections: protections.length,
    resolved: resolved.length,
    relief: relief.length,
    notables: notables.length,
    disgrace: state.outsideAttention.church + state.outsideAttention.rome + state.priest.scandal
  };
}

/* Whether the manor has come to rely on this priest. Both the steward and the
   lord must have been drawn in and left content before either would think of
   asking him to carry something outside the village. */
function manorDependence(state) {
  const petitions = state.events.filter((event) => event.type === "authority_petitioned");
  return {
    steward: petitions.filter((event) => event.facts?.role === "steward").length,
    lord: petitions.filter((event) => event.facts?.role === "lord").length,
    favour: state.priest.bishopFavor
  };
}

/* Who in the village has the ear of someone outside it.
 *
 * Derived from standing rather than stored, so it needs no save change: the
 * reeve and the clerks deal with the steward constantly, the sexton with the
 * archdeacon, and the wealthiest household in the parish is the one the lord
 * actually knows by name. These people carry word. A priest who wins or loses
 * one of them is heard about far sooner than one who does not. */
export function patronConnections(state) {
  const living = state.residents.filter((person) => person.active && person.alive);
  const rows = [];
  for (const person of living) {
    if (["reeve", "bailiff", "clerk"].includes(person.occupation)) {
      rows.push({ personId: person.id, name: person.name, role: "steward" });
    }
    if (["sexton", "sacristan"].includes(person.occupation)) {
      rows.push({ personId: person.id, name: person.name, role: "archdeacon" });
    }
  }
  const richest = [...living]
    .map((person) => ({
      person,
      wealth: state.households.find((house) => house.id === person.householdId)?.wealth || 0
    }))
    .sort((left, right) => right.wealth - left.wealth || left.person.id.localeCompare(right.person.id))[0];
  if (richest?.person) {
    rows.push({ personId: richest.person.id, name: richest.person.name, role: "lord" });
  }
  return rows;
}

/* Word carried outside the village by someone who is listened to there. */
function carryWordToPatron(state, parentEventId) {
  state.authorityStages.patronWord ||= {};
  const spoken = state.authorityStages.patronWord;
  for (const link of patronConnections(state)) {
    if (spoken[link.personId] != null) continue;
    const person = state.residents.find((entry) => entry.id === link.personId);
    if (!person) continue;
    const warm = person.trustPriest >= 82;
    const cold = person.trustPriest <= 10;
    if (!warm && !cold) continue;
    spoken[link.personId] = state.calendar.absoluteDay;
    const title = EXTERNAL_ROLES[link.role]?.title || link.role;
    scheduleExternalVisit(
      state,
      link.role,
      warm
        ? `${person.name} has spoken warmly of the priest to the ${title}, who wishes to see the parish for himself.`
        : `${person.name} has complained of the priest to the ${title}, who has come to judge the matter.`,
      warm ? 2 : 2,
      person.id,
      parentEventId
    );
    addChronicle(
      state,
      warm ? "A good word carried outside the village" : "A complaint carried outside the village",
      warm
        ? `${person.name}, who deals often with the ${title}, has spoken well of Father Benedict where it counts.`
        : `${person.name}, who has the ear of the ${title}, has carried a complaint against Father Benedict out of the parish.`,
      warm ? "change" : "danger",
      {
        type: warm ? "patron_word_favourable" : "patron_word_hostile",
        parentId: parentEventId,
        actorId: person.id,
        facts: { role: link.role, trust: person.trustPriest }
      }
    );
    return { role: link.role, personId: person.id, warm };
  }
  return null;
}

export function advancePriestStanding(state, parentEventId) {
  state.authorityStages.recognition ||= {};
  const stages = state.authorityStages.recognition;
  const renown = measurePriestRenown(state);
  const manor = manorDependence(state);
  state.priest.renown = renown.merit;

  /* Someone with standing outside the village may carry word either way, and
     that reaches the manor or the diocese long before ordinary report would.
     It does not replace the slower ladder below; it runs alongside it. */
  const carried = carryWordToPatron(state, parentEventId);

  /* A parish under a cloud is not commended, whatever else it has done. */
  if (renown.disgrace >= 45) {
    return advancePriestJudgement(state, parentEventId, renown)
      || (carried ? { kind: "patron_word", ...carried } : null);
  }

  const commend = (role, threshold, key, reason) => {
    /* The stage records the day it happened, and day zero is falsy: this must
       be an explicit test or nothing is ever commended on the first day. */
    if (stages[key] != null || renown.merit < threshold) return null;
    stages[key] = state.calendar.absoluteDay;
    scheduleExternalVisit(state, role, reason, role === "bishop" ? 5 : 3, null, parentEventId);
    addChronicle(
      state,
      "Word travels beyond the parish",
      reason,
      "change",
      { type: "priest_commended", parentId: parentEventId, facts: { role, merit: renown.merit } }
    );
    return role;
  };

  /* The archdeacon comes first, and only once the parish has plainly been
     worked: several households relieved and matters actually settled. */
  if (renown.householdsHelped >= 4 && renown.resolved >= 2) {
    const called = commend(
      "archdeacon",
      70,
      "archdeaconCommendation",
      `Report has reached the archdeacon that ${state.town.name} is well kept: ${renown.householdsHelped} households relieved from the church stores and ${renown.resolved} quarrels settled without the law.`
    );
    if (called) return { kind: "commendation", role: called, renown };
  }

  /* The bishop wants far more, and wants the manor to say it too. */
  if (stages.archdeaconCommendation != null
    && renown.householdsHelped >= 10
    && renown.resolved >= 5
    && (manor.steward + manor.lord) >= 1) {
    const called = commend(
      "bishop",
      190,
      "bishopCommendation",
      `The bishop has heard this parish named with approval: ${renown.householdsHelped} households relieved, ${renown.resolved} matters settled, and the manor itself content with its priest.`
    );
    if (called) return { kind: "commendation", role: called, renown };
  }

  /* Being asked to carry the work elsewhere, or to rise. Neither happens until
     the parish is beyond question and the manor has come to lean on him. */
  if (stages.bishopCommendation != null && stages.calledOnward == null
    && renown.merit >= 260 && renown.relief >= 1 && manor.lord >= 1) {
    stages.calledOnward = state.calendar.absoluteDay;
    scheduleExternalVisit(
      state,
      "bishop",
      `The bishop comes to ask whether this priest will take charge of a neighbouring parish that has none, or be raised within the diocese.`,
      6,
      null,
      parentEventId
    );
    addChronicle(
      state,
      "A larger charge is spoken of",
      `${state.town.name} is spoken of as a parish that could spare its priest, and the diocese has begun to wonder what else he might be given.`,
      "change",
      { type: "priest_advancement_offered", parentId: parentEventId, facts: { merit: renown.merit } }
    );
    return { kind: "advancement", role: "bishop", renown };
  }
  return advancePriestJudgement(state, parentEventId, renown)
    || (carried ? { kind: "patron_word", ...carried } : null);
}

/* The other end of the same ladder. Disgrace brings the same men out, and if a
   priest is bad enough for long enough the diocese takes the parish from him.
   Nothing here is quick: each step needs more against him than the last, which
   is what keeps the dramatic endings rare without ever making them impossible. */
function advancePriestJudgement(state, parentEventId, renown) {
  state.authorityStages.judgement ||= {};
  const stages = state.authorityStages.judgement;
  const wronged = state.residents.filter((person) => (
    person.active && person.alive && person.trustPriest <= 12
  ));
  const complaints = state.priestReports.filter((report) => report.status !== "private_complaint");
  const weight = state.priest.scandal
    + state.outsideAttention.church
    + state.outsideAttention.rome
    + wronged.length * 3
    + complaints.length * 12;

  if (stages.summoned == null && weight >= 90 && complaints.length >= 1) {
    stages.summoned = state.calendar.absoluteDay;
    scheduleExternalVisit(
      state,
      "archdeacon",
      `The archdeacon has come to put the complaints against this priest to his face.`,
      3,
      null,
      parentEventId
    );
    addChronicle(
      state,
      "The archdeacon asks questions",
      `Enough has been said against the priest of ${state.town.name} that the archdeacon has come to hear it himself.`,
      "danger",
      { type: "priest_summoned", parentId: parentEventId, facts: { weight } }
    );
    return { kind: "judgement", role: "archdeacon", weight };
  }

  if (stages.summoned != null && stages.tribunal == null && weight >= 160 && complaints.length >= 2) {
    stages.tribunal = state.calendar.absoluteDay;
    scheduleExternalVisit(
      state,
      "bishop",
      `The bishop himself has come, and it is understood that the parish may be taken from its priest.`,
      4,
      null,
      parentEventId
    );
    addChronicle(
      state,
      "The bishop comes in judgement",
      `The complaints from ${state.town.name} have reached the bishop, who does not travel for small matters.`,
      "danger",
      { type: "priest_tribunal", parentId: parentEventId, facts: { weight } }
    );
    return { kind: "judgement", role: "bishop", weight };
  }

  /* Deprivation. The parish is taken away, and the game with it. */
  if (stages.tribunal != null && stages.deprived == null
    && weight >= 240 && complaints.length >= 3 && state.priest.scandal >= 80) {
    stages.deprived = state.calendar.absoluteDay;
    state.priest.deprived = true;
    appendEvent(state, {
      type: "priest_deprived",
      parentId: parentEventId,
      actorId: "bishop",
      targetId: "priest",
      facts: { weight, complaints: complaints.length, scandal: state.priest.scandal }
    });
    addChronicle(
      state,
      "The parish is taken away",
      `The bishop has deprived Father Benedict of ${state.town.name}. Another priest will be sent, and he must go.`,
      "danger",
      { type: "priest_deprived", parentId: parentEventId, facts: { weight } }
    );
    return { kind: "deprived", role: "bishop", weight };
  }

  /* A villager driven far enough past fear may come in the night. This needs a
     person who has genuinely been ruined or terrified by him, not merely one
     who disagrees. */
  if (stages.attempt == null && state.priest.alive) {
    const desperate = state.residents.find((person) => (
      person.active && person.alive && person.age >= 18
      && person.trustPriest <= 5 && person.stress >= 85
      && state.relationships.some((entry) => (
        entry.actorId === person.id && entry.targetId === "priest" && (entry.affection ?? 50) <= 5
      ))
    ));
    if (desperate && state.priest.scandal >= 55) {
      stages.attempt = state.calendar.absoluteDay;
      const survived = state.priest.health > 35;
      state.priest.health = clamp(state.priest.health - (survived ? 25 : 60));
      if (state.priest.health <= 0) state.priest.alive = false;
      appendEvent(state, {
        type: "priest_attacked_in_the_night",
        parentId: parentEventId,
        actorId: desperate.id,
        targetId: "priest",
        facts: { survived: state.priest.alive }
      });
      addChronicle(
        state,
        "Someone came in the night",
        state.priest.alive
          ? `${desperate.name} was driven far enough to come for the priest in the dark. He lived, but the parish will not forget it.`
          : `${desperate.name} came for the priest in the dark, and Father Benedict did not see the morning.`,
        "danger",
        { type: "priest_attacked_in_the_night", parentId: parentEventId, facts: {} }
      );
      scheduleExternalVisit(state, "sheriff", `Violence was done to the priest in the night.`, 1, desperate.id, parentEventId);
      return { kind: "attempt", actorId: desperate.id, survived: state.priest.alive };
    }
  }
  return null;
}

function resolvePopulationDay(state) {
  const tick = appendEvent(state, {
    type: "population_day",
    parentId: null,
    facts: { day: state.calendar.absoluteDay }
  });
  for (const event of advancePopulationDay(state)) {
    addChronicle(state, event.title, event.text, event.tone, {
      type: event.type,
      parentId: tick.id,
      actorId: event.actorId ?? null,
      targetId: event.targetId ?? null,
      facts: { populationEvent: true }
    });
  }
  /* Everything the village decided to do earlier and meant to do today. Each
     one may provoke an answer a day or two further out, which is how a word in
     the church reaches people the priest has never met. */
  for (const done of resolveDueIntentions(state, applyAction)) {
    addChronicle(
      state,
      `${done.actorName} ${done.actionType.replace(/_/g, " ")}${done.targetName ? ` — ${done.targetName}` : ""}`,
      done.causeSummary ? `Following ${done.causeSummary}.` : "",
      ["assault", "steal", "threaten", "betray", "kill_person", "vandalize", "evict"].includes(done.actionType)
        ? "danger"
        : "change",
      { type: "deliberate_action", parentId: tick.id, actorId: done.actorId, targetId: done.targetId, facts: { actionType: done.actionType, depth: done.depth } }
    );
  }
  advanceIssueThreads(state, tick.id);
  executeDueCommitments(state, tick.id);
  advancePriestStanding(state, tick.id);
  advanceNarrativeDirector(state, tick.id);
}

function maximumIntensityForLicense(license) {
  return license === "outrageous" ? 5 : license === "comic" ? 4 : 3;
}

function metricDeltaForAction(actionType) {
  const positive = {
    comfort: { harmony: 1, mercy: 1 }, advise: { harmony: 1 }, apologize: { harmony: 2 },
    forgive: { harmony: 3, mercy: 2 }, reconcile: { harmony: 4, mercy: 1 }, pray_with: { faith: 2 },
    share_food: { health: 1, mercy: 2 }, lend_money: { prosperity: 1, mercy: 1 }, donate: { mercy: 2 },
    shelter: { health: 1, mercy: 2 }, teach: { prosperity: 1 }, heal: { health: 3 },
    nurse: { health: 2, mercy: 1 }, work_harder: { prosperity: 2 }, hire: { prosperity: 2 },
    lower_prices: { prosperity: 1, harmony: 1 }, repair: { prosperity: 1, safety: 2 },
    build: { prosperity: 2, safety: 1 }, marry: { harmony: 1 }, adopt_child: { mercy: 2 },
    invite_migrant: { prosperity: 1 }, make_peace: { harmony: 4, safety: 2 }, repent: { faith: 2, mercy: 1 },
    testify: { safety: 1 }, organize_aid: { health: 1, mercy: 3 }, attend_church: { faith: 1 },
    seek_absolution: { faith: 2 }, confess_publicly: { faith: 1 }, protect: { safety: 2, mercy: 1 },
    offer_work: { prosperity: 2 }, secure_clean_water: { health: 2, safety: 1 },
    verify_route: { safety: 1, harmony: 1 },
    prepare_evacuation: { safety: 1, harmony: -1, prosperity: -1 },
    organize_defense: { safety: 2, harmony: -1 },
    buy_property: { prosperity: 1 },
    sell_property: { prosperity: 1 },
    lease_property: { prosperity: 1 }
  };
  const negative = {
    shirk_work: { prosperity: -2 }, quit_job: { prosperity: -1 }, raise_prices: { prosperity: -1, harmony: -1 },
    neglect: { health: -1, safety: -1 }, divorce: { harmony: -2 }, leave_village: { prosperity: -1 },
    expel: { harmony: -2, mercy: -2 }, accuse: { harmony: -2 }, gossip: { harmony: -2 },
    reveal_secret: { harmony: -2 }, steal: { safety: -3, harmony: -1 }, vandalize: { safety: -3 },
    threaten: { safety: -2, harmony: -1 }, assault: { safety: -4, health: -2 }, begin_feud: { harmony: -4, safety: -3 }, kill_person: { safety: -8, harmony: -5, health: -3 },
    drink: { health: -1 }, gamble: { prosperity: -1 }, relapse: { faith: -1 }, evict: { mercy: -2 },
    protest: { harmony: -1 }, avoid_church: { faith: -1 }, betray: { harmony: -4 }
  };
  return positive[actionType] || negative[actionType] || {};
}

const CUSTOM_EFFECT_KEYS = Object.freeze({
  town: new Set(["harmony", "faith", "prosperity", "health", "safety", "mercy"]),
  material: new Set(["foodSecurity", "grainPrice", "diseasePressure", "crime", "infrastructure"]),
  issue: new Set(["pressure", "publicAwareness", "danger", "momentum"]),
  actor: new Set(["stress", "morale", "trustPriest"]),
  target: new Set(["stress", "morale", "trustPriest"])
});

function normalizeCustomEffects(rawEffects, hasTarget) {
  if (rawEffects == null) return [];
  if (!Array.isArray(rawEffects) || rawEffects.length > 3) return null;
  const seen = new Set();
  const effects = [];
  for (const raw of rawEffects) {
    const scope = String(raw?.scope || "");
    const key = String(raw?.key || "");
    const delta = Number(raw?.delta);
    const identity = `${scope}:${key}`;
    if (!CUSTOM_EFFECT_KEYS[scope]?.has(key)
      || !Number.isInteger(delta) || delta < -3 || delta > 3
      || !String(raw?.reason || "").trim()
      || (scope === "target" && !hasTarget)
      || seen.has(identity)) return null;
    seen.add(identity);
    effects.push({
      scope,
      key,
      delta,
      reason: completeGeneratedText(raw.reason, 80)
    });
  }
  return effects;
}

function salvageCustomEffects(rawEffects, hasTarget) {
  if (!Array.isArray(rawEffects)) return [];
  const effects = [];
  const seen = new Set();
  for (const raw of rawEffects.slice(0, 3)) {
    const normalized = normalizeCustomEffects([raw], hasTarget);
    if (!normalized?.length) continue;
    const effect = normalized[0];
    const identity = `${effect.scope}:${effect.key}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    effects.push(effect);
  }
  return effects;
}

function applyCustomEffects(state, actor, target, effects) {
  const thread = state.issueThreads.find((entry) => entry.id === state.currentVisit?.issue.threadId);
  for (const effect of effects || []) {
    if (effect.scope === "town") {
      state.town.metrics[effect.key] = clamp(state.town.metrics[effect.key] + effect.delta);
    } else if (effect.scope === "material") {
      state.material.modifiers[effect.key] = clamp(
        state.material.modifiers[effect.key] + effect.delta * 2,
        -20,
        20
      );
    } else if (effect.scope === "issue" && thread) {
      thread[effect.key] = clamp(thread[effect.key] + effect.delta * 3);
    } else {
      const person = effect.scope === "actor" ? actor : target;
      if (person && effect.key in person) person[effect.key] = clamp(person[effect.key] + effect.delta * 2);
    }
  }
}

export function applyAction(state, step) {
  if (!ACTION_TYPES.includes(step.actionType)) {
    return null;
  }
  const actor = materializeResident(state, step.actorId, false);
  const target = step.targetId === "priest"
    ? state.priest
    : step.targetId
      ? materializeResident(state, step.targetId, false)
      : null;
  const targetIsPriest = target?.id === "priest";
  const intensity = clamp(step.intensity || 2, 1, 5);
  let createdResident = null;
  let createdResidentType = null;
  const damagePriest = (amount) => {
    state.priest.health = clamp(state.priest.health - amount);
    if (state.priest.health <= 0) {
      state.priest.health = 0;
      state.priest.alive = false;
    }
  };
  const occupiedHouseholds = state.households.filter((household) => household.memberIds.some((id) => {
    const person = state.residents.find((resident) => resident.id === id);
    return person?.active && person.alive;
  }));
  const sourceHousehold = state.households.find((household) => household.id === actor.householdId);
  const targetHousehold = target && !targetIsPriest
    ? state.households.find((household) => household.id === target.householdId)
    : null;
  if (["repair", "build"].includes(step.actionType)
    && (!sourceHousehold || sourceHousehold.wealth < intensity * 2 || sourceHousehold.food < intensity)) return null;
  if (step.actionType === "share_food"
    && (!sourceHousehold || !targetHousehold || !occupiedHouseholds.includes(targetHousehold)
      || sourceHousehold.id === targetHousehold.id || sourceHousehold.food < intensity * 2)) return null;
  if (step.actionType === "lend_money"
    && (!sourceHousehold || !targetHousehold || !occupiedHouseholds.includes(targetHousehold)
      || sourceHousehold.id === targetHousehold.id || sourceHousehold.wealth < intensity * 2)) return null;
  if (step.actionType === "donate") {
    if (targetIsPriest) {
      const donation = parseChurchDonationDetail(step.detail, intensity * 2);
      const available = churchDonationCapacity(state, actor, donation.resource);
      if (!sourceHousehold || available < donation.amount) return null;
    } else if (!sourceHousehold || sourceHousehold.wealth < intensity * 2
      || (targetHousehold && (!occupiedHouseholds.includes(targetHousehold) || targetHousehold.id === sourceHousehold.id))
      || !(targetHousehold || occupiedHouseholds.some((household) => household.id !== sourceHousehold.id))) return null;
  }
  if (step.actionType === "lower_prices" && (!sourceHousehold || sourceHousehold.wealth < intensity)) return null;
  if (step.actionType === "organize_aid"
    && (!sourceHousehold || (sourceHousehold.food < intensity * 2 && sourceHousehold.wealth < intensity)
      || !occupiedHouseholds.some((household) => household.id !== sourceHousehold.id))) return null;
  const deltas = metricDeltaForAction(step.actionType);
  if (step.actionType === "improvise") {
    const motive = step.motive || "practical";
    const improvised = {
      benevolent: { harmony: 1, mercy: 1 },
      faithful: { faith: 1, harmony: 0.5 },
      practical: { prosperity: 0.5, harmony: 0.5 },
      selfish: { prosperity: 0.5, harmony: -1 },
      political: { harmony: -0.5, safety: 0.5 },
      power_seeking: { harmony: -1, safety: 0.5 },
      cruel: { harmony: -1.5, mercy: -1 },
      absurd: { harmony: 0.5 },
      fearful: { harmony: -0.5 }
    }[motive] || {};
    Object.assign(deltas, improvised);
    if (target && !targetIsPriest) {
      target.stress = clamp(target.stress + (["cruel", "power_seeking"].includes(motive) ? intensity * 2 : 0));
    }
  }
  for (const [metric, delta] of Object.entries(deltas)) {
    state.town.metrics[metric] = clamp(state.town.metrics[metric] + delta * (intensity / 2));
  }
  actor.morale = clamp(actor.morale + (deltas.harmony || deltas.mercy || 0));
  actor.stress = clamp(actor.stress - (deltas.mercy || 0) + Math.max(0, -(deltas.harmony || 0)));
  if (step.actionType === "secure_clean_water") {
    state.material.modifiers.diseasePressure = clamp(
      state.material.modifiers.diseasePressure - intensity * 4,
      -20,
      20
    );
    state.town.metrics.health = clamp(state.town.metrics.health + intensity);
  }
  if (step.actionType === "verify_route") {
    actor.flags = [...new Set([...(actor.flags || []), `scouting_route_until_day_${state.calendar.absoluteDay + 1}`])];
    const thread = state.issueThreads.find((entry) => entry.id === state.currentVisit?.issue.threadId);
    if (thread) {
      thread.publicAwareness = clamp(thread.publicAwareness + 8);
      thread.pressure = clamp(thread.pressure - 8);
      thread.momentum = clamp(thread.momentum + 8);
    }
    scheduleResidentFollowup(
      state,
      actor.id,
      `${actor.name} returns with a report after checking the roads and approaches.`,
      step.parentEventId || state.currentVisit?.originEventId
    );
  }
  if (step.actionType === "prepare_evacuation") {
    if (sourceHousehold) {
      sourceHousehold.wealth = clamp(sourceHousehold.wealth - intensity);
      sourceHousehold.food = clamp(sourceHousehold.food - intensity);
      for (const memberId of sourceHousehold.memberIds.slice(0, 8)) {
        const member = state.residents.find((resident) => resident.id === memberId);
        if (member?.active && member.alive) {
          member.flags = [...new Set([...(member.flags || []), `evacuation_ready_until_day_${state.calendar.absoluteDay + 3}`])];
        }
      }
    }
  }
  if (step.actionType === "organize_defense") {
    if (sourceHousehold) {
      sourceHousehold.wealth = clamp(sourceHousehold.wealth - intensity * 2);
      sourceHousehold.food = clamp(sourceHousehold.food - intensity);
    }
    const suitable = state.residents
      .filter((resident) => resident.active && resident.alive && resident.age >= ADULT_AGE
        && ["reeve", "bailiff", "watchman", "soldier", "hunter", "forester"].includes(resident.occupation))
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, 5);
    for (const defender of suitable) {
      defender.flags = [...new Set([...(defender.flags || []), `defense_ready_until_day_${state.calendar.absoluteDay + 3}`])];
    }
  }
  if (step.actionType === "improvise") {
    applyCustomEffects(state, actor, targetIsPriest ? null : target, step.effects);
  }
  if (target && !targetIsPriest) {
    target.morale = clamp(target.morale + (deltas.mercy || deltas.harmony || 0));
    if (!actor.relationshipIds.includes(target.id)) actor.relationshipIds.push(target.id);
    if (!target.relationshipIds.includes(actor.id)) target.relationshipIds.push(actor.id);
    const positive = Math.max(0, (deltas.harmony || 0) + (deltas.mercy || 0));
    const negative = Math.max(0, -(deltas.harmony || 0));
    adjustRelationship(state, actor.id, target.id, {
      familiarity: 2,
      trust: positive - negative,
      affection: positive,
      resentment: negative * 2
    });
    adjustRelationship(state, target.id, actor.id, {
      familiarity: 2,
      trust: positive - negative,
      affection: positive,
      resentment: negative * 2
    });
  }

  if (step.actionType === "attend_church") actor.attendanceChance = clamp(actor.attendanceChance + 12);
  if (step.actionType === "avoid_church") actor.attendanceChance = clamp(actor.attendanceChance - 18);
  if (step.actionType === "work_harder") actor.prosperity = clamp(actor.prosperity + 5);
  if (step.actionType === "shirk_work" || step.actionType === "gamble") actor.prosperity = clamp(actor.prosperity - 5);
  if (step.actionType === "quit_job") actor.occupation = "unemployed";
  if (step.actionType === "change_job") {
    actor.occupation = step.detail?.slice(0, 40) || "laborer";
  }
  if (step.actionType === "offer_work" && target) {
    target.occupation = step.detail?.slice(0, 40) || "laborer";
    target.prosperity = clamp(target.prosperity + 4);
  }
  if (step.actionType === "repair" || step.actionType === "build") {
    const household = state.households.find((entry) => entry.id === actor.householdId);
    const wealthCost = intensity * 2;
    const foodCost = intensity;
    if (household && household.wealth >= wealthCost && household.food >= foodCost) {
      household.wealth = clamp(household.wealth - wealthCost);
      household.food = clamp(household.food - foodCost);
      state.material.infrastructure = clamp(state.material.infrastructure + intensity * 3);
    }
  }
  if (["buy_property", "sell_property", "lease_property"].includes(step.actionType)) {
    const household = state.households.find((entry) => entry.id === actor.householdId);
    if (household) {
      if (step.actionType === "buy_property") {
        const cost = intensity * 5;
        if (household.wealth >= cost) {
          household.wealth = clamp(household.wealth - cost);
          household.properties.push({
            id: `property-new-${String(state.nextPropertySequence++).padStart(6, "0")}`,
            type: step.detail || "cottage",
            location: state.town.name,
            value: cost,
            status: "owned"
          });
        }
      } else if (step.actionType === "sell_property") {
        const index = household.properties.findIndex((property) => property.status === "owned");
        if (index >= 0) {
          const [property] = household.properties.splice(index, 1);
          household.wealth = clamp(household.wealth + Math.max(1, property.value * 0.8));
          if (property.type === household.dwelling) household.dwelling = "lodging";
        }
      } else {
        const cost = intensity * 2;
        if (household.wealth >= cost) {
          household.wealth = clamp(household.wealth - cost);
          household.properties.push({
            id: `property-new-${String(state.nextPropertySequence++).padStart(6, "0")}`,
            type: step.detail || "room",
            location: state.town.name,
            value: cost,
            status: "leased"
          });
        }
      }
    }
  }
  if (step.actionType === "report_crime" || step.actionType === "testify") {
    state.material.crime = clamp(state.material.crime - intensity * 3);
    state.town.metrics.safety = clamp(state.town.metrics.safety + intensity * 2);
  }
  if (step.actionType === "assault" && target && !targetIsPriest) {
    target.health = clamp(target.health - intensity * 7);
    target.stress = clamp(target.stress + intensity * 8);
    if (target.health <= 0) {
      target.health = 1;
      target.flags.push("critically_injured");
    }
  }
  if (step.actionType === "kill_person" && target && !targetIsPriest) {
    target.health = 0;
    target.alive = false;
    target.causeOfDeath = `Killed by ${actor.name}`;
    target.flags.push("killed");
  }
  if (step.actionType === "steal" && target && !targetIsPriest) {
    const stolenFrom = targetHousehold;
    const amount = Math.min(stolenFrom?.wealth || 0, intensity * 2);
    if (sourceHousehold && stolenFrom && amount > 0) {
      stolenFrom.wealth = clamp(stolenFrom.wealth - amount);
      sourceHousehold.wealth = clamp(sourceHousehold.wealth + amount);
    }
  }
  if (step.actionType === "vandalize" && target && !targetIsPriest) {
    if (targetHousehold) {
      targetHousehold.wealth = clamp(targetHousehold.wealth - intensity * 2);
      targetHousehold.reputation = clamp(targetHousehold.reputation - intensity);
    }
  }
  if (step.actionType === "evict" && target && !targetIsPriest) {
    if (targetHousehold) targetHousehold.dwelling = "temporary lodging";
    target.flags.push("evicted");
  }
  if (step.actionType === "divorce" && target && !targetIsPriest) {
    actor.maritalStatus = "divorced";
    target.maritalStatus = "divorced";
    actor.spouseId = null;
    target.spouseId = null;
    actor.marriageDay = null;
    target.marriageDay = null;
  }
  if (step.actionType === "move_household") {
    if (sourceHousehold) {
      sourceHousehold.dwelling = step.detail || step.composition?.objectType || "new lodging";
    }
  }
  if (step.actionType === "share_food" && target) {
    if (sourceHousehold && targetHousehold) {
      const amount = Math.min(sourceHousehold.food, intensity * 2);
      sourceHousehold.food = clamp(sourceHousehold.food - amount);
      targetHousehold.food = clamp(targetHousehold.food + amount);
    }
  }
  if (step.actionType === "lend_money" && target) {
      const source = sourceHousehold;
      const destination = targetHousehold;
      const amount = Math.min(source?.wealth || 0, intensity * 2);
      if (source && destination && amount > 0) {
        source.wealth = clamp(source.wealth - amount);
        destination.wealth = clamp(destination.wealth + amount);
        destination.debt += amount;
      }
  }
    if (step.actionType === "donate") {
      const source = sourceHousehold;
      if (targetIsPriest) {
        const donation = parseChurchDonationDetail(step.detail, intensity * 2);
        applyChurchDonation(state, actor, donation.resource, donation.amount);
      } else {
      const destination = target
        ? targetHousehold
        : occupiedHouseholds.filter((household) => household.id !== actor.householdId).sort((a, b) => a.wealth - b.wealth)[0];
      const amount = Math.min(source?.wealth || 0, intensity * 2);
      if (source && destination && amount > 0) {
        source.wealth = clamp(source.wealth - amount);
        destination.wealth = clamp(destination.wealth + amount);
      }
      }
  }
    if (step.actionType === "lower_prices") {
      const source = sourceHousehold;
      if (source?.wealth >= intensity) {
        source.wealth = clamp(source.wealth - intensity);
        state.material.grainPrice = clamp(state.material.grainPrice - intensity * 3);
      }
  }
    if (step.actionType === "organize_aid") {
      const source = sourceHousehold;
      const destination = occupiedHouseholds.filter((household) => household.id !== actor.householdId).sort((a, b) => a.food - b.food)[0];
      const food = Math.min(source?.food || 0, intensity * 2);
      const wealth = Math.min(source?.wealth || 0, intensity);
      if (source && destination && (food > 0 || wealth > 0)) {
        source.food = clamp(source.food - food);
        source.wealth = clamp(source.wealth - wealth);
        destination.food = clamp(destination.food + food);
        destination.wealth = clamp(destination.wealth + wealth);
      }
  }
  if (step.actionType === "flirt_with_priest") {
    state.priest.scandal = clamp(state.priest.scandal + 1);
    actor.trustPriest = clamp(actor.trustPriest + 1);
  }
  if (step.actionType === "proposition_priest" || step.actionType === "attempt_seduction") {
    state.priest.scandal = clamp(state.priest.scandal + (step.actionType === "attempt_seduction" ? 6 : 3));
    state.priest.moralAuthority = clamp(state.priest.moralAuthority - 2);
  }
  if (step.actionType === "blackmail_priest") {
    state.priest.scandal = clamp(state.priest.scandal + 5);
    state.priest.safety = clamp(state.priest.safety - 8);
  }
  if (step.actionType === "report_priest_to_bishop") {
    state.priest.bishopFavor = clamp(state.priest.bishopFavor - intensity * 3);
    state.priest.scandal = clamp(state.priest.scandal + intensity);
  }
  if (step.actionType === "praise_priest_to_bishop") {
    state.priest.bishopFavor = clamp(state.priest.bishopFavor + intensity * 3);
  }
  if (step.actionType === "attack_priest") {
    damagePriest(intensity * 8);
    state.priest.safety = clamp(state.priest.safety - intensity * 5);
  }
  if (step.actionType === "poison_priest") {
    damagePriest(intensity * 12);
    state.priest.safety = clamp(state.priest.safety - intensity * 3);
  }
  if (step.actionType === "kill_priest") {
    state.priest.health = 0;
    state.priest.alive = false;
  }
  if (step.actionType === "defend_priest") state.priest.safety = clamp(state.priest.safety + intensity * 5);
  if (step.actionType === "challenge_priest") state.priest.moralAuthority = clamp(state.priest.moralAuthority - intensity * 2);
  if (step.actionType === "play_prank") state.town.metrics.harmony = clamp(state.town.metrics.harmony + 1);
  if (step.actionType === "release_livestock_in_church") {
    state.town.metrics.harmony = clamp(state.town.metrics.harmony - 2);
    state.priest.scandal = clamp(state.priest.scandal + 1);
  }
  if (step.actionType === "ring_bells_at_midnight") state.town.metrics.harmony = clamp(state.town.metrics.harmony - 1);
  if (step.actionType === "steal_church_relic") {
    state.priest.relicStolenById = actor.id;
    state.town.metrics.faith = clamp(state.town.metrics.faith - 3);
    state.town.metrics.safety = clamp(state.town.metrics.safety - 2);
  }
  if (step.actionType === "return_church_relic") {
    state.priest.relicStolenById = null;
    state.town.metrics.faith = clamp(state.town.metrics.faith + 2);
    state.town.metrics.mercy = clamp(state.town.metrics.mercy + 2);
  }
  if (["claim_miracle", "fake_miracle", "claim_prophecy"].includes(step.actionType)) {
    state.town.metrics.faith = clamp(state.town.metrics.faith + (step.actionType === "fake_miracle" ? -2 : 2));
    state.priest.scandal = clamp(state.priest.scandal + (step.actionType === "fake_miracle" ? 4 : 1));
  }
  if (step.actionType === "heal" && target) {
    target.health = clamp(target.health + intensity * 6);
    target.illnessDays = Math.max(0, target.illnessDays - intensity * 2);
    if (target.health >= 55 && target.illnessDays <= 2) target.illness = null;
  }
  if (step.actionType === "nurse" && target) {
    target.health = clamp(target.health + intensity * 3);
    target.stress = clamp(target.stress - intensity * 2);
    target.illnessDays = Math.max(0, target.illnessDays - intensity);
  }
  if (step.actionType === "court" && target) {
    adjustRelationship(state, actor.id, target.id, { attraction: 8, affection: 4, familiarity: 3 });
  }
  if (step.actionType === "marry" && target) {
    actor.maritalStatus = "married";
    target.maritalStatus = "married";
    actor.spouseId = target.id;
    target.spouseId = actor.id;
    actor.marriageDay = state.calendar.absoluteDay;
    target.marriageDay = state.calendar.absoluteDay;
  }
  if (step.actionType === "separate" && target) {
    actor.maritalStatus = "separated";
    target.maritalStatus = "separated";
    actor.spouseId = null;
    target.spouseId = null;
    actor.marriageDay = null;
    target.marriageDay = null;
  }
  if (step.actionType === "conceive_child" && target) {
    const mother = actor.sex === "female" ? actor : target.sex === "female" ? target : null;
    const coParent = mother?.id === actor.id ? target : actor;
    if (mother && coParent?.sex === "male") {
      mother.pregnantDueDay = state.calendar.absoluteDay + 280;
      mother.pregnancyCoParentId = coParent.id;
    }
  }
  if (step.actionType === "adopt_child" && target) {
    const rng = new SeededRng(`${state.seed}:adoption:${state.calendar.absoluteDay}:${actor.id}:${target.id}`);
    const child = createPopulationResident(state, {
      sex: rng.next() < 0.5 ? "female" : "male",
      age: rng.int(1, 8),
      surname: actor.surname,
      householdId: actor.householdId,
      occupation: "child laborer",
      parentIds: [actor.id, target.id],
      reason: "adoption"
    });
    createdResident = child;
    createdResidentType = "adoption";
    const household = state.households.find((entry) => entry.id === actor.householdId);
    if (household) household.lastAdoptionDay = state.calendar.absoluteDay;
    step.detail = `${child.name} enters the household by adoption.`;
  }
  if (step.actionType === "invite_migrant") {
    const rng = new SeededRng(`${state.seed}:invited-migrant:${state.calendar.absoluteDay}:${actor.id}`);
    const surname = rng.pick(buildSurnameBank());
    const migrant = createPopulationResident(state, {
      sex: rng.next() < 0.5 ? "female" : "male",
      age: rng.int(18, 50),
      surname,
      householdId: `household-new-${state.populationSequence}`,
      occupation: rng.pick(OCCUPATIONS.filter((occupation) => occupation !== "infant")),
      reason: "arrival"
    });
    createdResident = migrant;
    createdResidentType = "immigration";
    state.lastInvitedMigrationDay = state.calendar.absoluteDay;
    state.statistics.arrivals += 1;
    step.detail = `${step.detail || ""} ${migrant.name} arrives in ${state.town.name}.`.trim();
  }
  if (step.actionType === "leave_village" || step.actionType === "expel") {
    const spouse = state.residents.find((person) => person.id === actor.spouseId);
    if (spouse) {
      spouse.maritalStatus = "deserted";
      spouse.spouseId = null;
      spouse.marriageDay = null;
      actor.maritalStatus = "deserted";
      actor.spouseId = null;
      actor.marriageDay = null;
    }
    actor.active = false;
    actor.departureDay = state.calendar.absoluteDay;
    state.statistics.departures += 1;
  }

  const description = step.description
    || `${actor.name} chose to ${step.actionType.replaceAll("_", " ")}${target ? ` with ${target.name}` : ""}.`;
  addChronicle(
    state,
    step.title || step.actionType.replaceAll("_", " "),
    description,
    Object.values(deltas).some((value) => value < 0) ? "danger" : "change",
    {
      type: "person_action",
      parentId: step.parentEventId ?? state.currentVisit?.originEventId ?? state.events.at(-1)?.id ?? null,
      actorId: actor.id,
      targetId: target?.id ?? null,
      facts: {
        actionType: step.actionType,
        intensity,
        effects: step.actionType === "improvise" ? step.effects || [] : []
      }
    }
  );
  const eventId = state.chronicle[0].eventId;
  escalateAuthority(state, step.actionType, actor, eventId);
  let consequenceEventId = eventId;
  if (createdResident) {
    addChronicle(
      state,
      createdResidentType === "adoption"
        ? `${createdResident.name} is adopted`
        : `${createdResident.name} settles in ${state.town.name}`,
      createdResidentType === "adoption"
        ? `${createdResident.name} enters the ${actor.surname} household by adoption.`
        : `${createdResident.name}, a ${createdResident.occupation}, enters the parish after ${actor.name}'s invitation.`,
      "change",
      {
        type: createdResidentType,
        parentId: eventId,
        actorId: actor.id,
        targetId: createdResident.id,
        facts: { createdResidentId: createdResident.id }
      }
    );
    consequenceEventId = state.chronicle[0].eventId;
  }
  if (["gossip", "reveal_secret", "accuse"].includes(step.actionType) && target) {
    createRumor(state, {
      originatorId: actor.id,
      subjectId: target.id,
      claim: `${actor.name} says that ${target.name} is involved in a troubling matter.`,
      truth: step.actionType === "reveal_secret" ? 70 : step.actionType === "accuse" ? 45 : 35,
      intensity,
      sourceEventId: eventId
    });
  }
  if (target && !targetIsPriest) {
    addKnowledge(state, {
      holderId: actor.id,
      subjectId: target.id,
      topic: step.actionType,
      belief: description,
      confidence: 65,
      sourceEventId: eventId,
      isTrue: true,
      privateKnowledge: step.actionType === "reveal_secret"
    });
    addStructuredMemory(state, target, {
      type: "interaction",
      subjectId: actor.id,
      summary: description,
      emotion: ["comfort", "forgive", "reconcile", "share_food", "protect"].includes(step.actionType)
        ? "grateful"
        : ["accuse", "threaten", "assault", "betray"].includes(step.actionType) ? "troubled" : "watchful",
      confidence: 90,
      privateMemory: ["reveal_secret", "conceal_secret"].includes(step.actionType),
      sourceEventId: eventId
    });
  }
  if (step.actionType !== "keep_silence") {
    addStructuredMemory(state, actor, {
      type: target ? "interaction" : "action",
      subjectId: target?.id || actor.id,
      summary: description,
      emotion: ["comfort", "forgive", "reconcile", "share_food", "protect"].includes(step.actionType)
        ? "resolved"
        : ["accuse", "threaten", "assault", "betray"].includes(step.actionType) ? "angry" : "determined",
      confidence: 95,
      privateMemory: ["reveal_secret", "conceal_secret"].includes(step.actionType),
      sourceEventId: eventId
    });
  }
  return {
    actor,
    target,
    description,
    eventId: consequenceEventId,
    createdResidentId: createdResident?.id || null
  };
}

function acceptedProposalRootSteps(state, visit, person) {
  const decisionsById = new Map(
    (visit.continuity?.visitorDecisions || []).map((decision) => [decision.proposalId, decision])
  );
  const acceptedProposals = (visit.continuity?.proposals || [])
    .filter((proposal) => decisionsById.get(proposal.proposalId)?.status === "accepted")
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 3);
  if (acceptedProposals.length < 2) return [];
  const relatedId = visit.issue.relatedPersonId;
  const actionMap = {
    verify_route: "verify_route",
    prepare_evacuation: "prepare_evacuation",
    organize_defense: "organize_defense",
    contact_person: "visit",
    delay_or_ignore: "keep_silence",
    pray: "repent",
    leave: "leave_village"
  };
  return acceptedProposals.map((proposal) => {
    const mappedAction = actionMap[proposal.actionHint] || "improvise";
    const actionType = mappedAction === "visit" && !relatedId ? "improvise" : mappedAction;
    return {
      depth: 1,
      parentStepIndex: null,
      actorId: person.id,
      targetId: actionType === "visit" ? relatedId : null,
      actionType,
      /* Improvising is deliberately capped lower than named acts, because it
         is the vaguest thing a person can resolve on. Asking for more than the
         cap allows had every improvised step rejected on submission, wasting
         one of the visitor's three resolutions every time. */
      intensity: Math.min(
        actionType === "improvise" ? 2 : 3,
        maximumIntensityForLicense(visit.eventLicense)
      ),
      title: proposal.rawText.slice(0, 100),
      description: `${person.name} acts on this accepted proposal: ${proposal.rawText}`,
      detail: actionType === "improvise" ? proposal.rawText.slice(0, 120) : ""
    };
  });
}

/* Law officers a parish priest can actually send for. The village has a watch,
   a bailiff and a reeve; it has no constable, though a priest may well call one
   that by habit. Ranked by who would really come out to a disturbance. */
const OFFICER_OCCUPATIONS = Object.freeze(["watchman", "bailiff", "reeve"]);

export function availableOfficers(state) {
  return state.residents
    .filter((resident) => (
      resident.active && resident.alive && resident.age >= 18
      && OFFICER_OCCUPATIONS.includes(resident.occupation)
    ))
    .sort((left, right) => (
      OFFICER_OCCUPATIONS.indexOf(left.occupation) - OFFICER_OCCUPATIONS.indexOf(right.occupation)
      || left.id.localeCompare(right.id)
    ));
}

/* Send the watch to someone. This is a real act with real weight: an officer
   who comes out deters a gathering crowd, and being seen to call the law costs
   the priest something with anyone who thinks it heavy-handed. */
export function summonOfficer(state, {
  officerId = null,
  subjectId,
  purpose = "protect",
  reason = "",
  sourceEventId = null
} = {}, { record = true } = {}) {
  const officers = availableOfficers(state);
  if (!officers.length) return null;
  const officer = officers.find((entry) => entry.id === officerId) || officers[0];
  const subject = state.residents.find((entry) => entry.id === subjectId);
  if (!subject || subject.id === officer.id) return null;
  if (!["protect", "investigate", "keep_the_peace"].includes(purpose)) return null;
  /* Sending the same man on the same errand twice does not double the watch.
     He is already going, so a repeated request is simply the priest saying it
     again, and it must not stack up events, commitments and obligations. */
  const alreadyGoing = (state.commitments || []).some((commitment) => (
    commitment.type === "officer_duty"
      && commitment.status === "open"
      && commitment.actorId === officer.id
      && commitment.targetId === subject.id
      && commitment.payload?.purpose === purpose
  ));
  if (alreadyGoing) return null;

  const event = appendEvent(state, {
    type: "officer_summoned",
    parentId: sourceEventId || state.currentVisit?.originEventId || null,
    actorId: "priest",
    targetId: officer.id,
    facts: {
      subjectId: subject.id,
      subjectName: subject.name,
      officerName: officer.name,
      officerOccupation: officer.occupation,
      purpose,
      reason: String(reason || "").slice(0, 240)
    }
  });

  const commitment = {
    id: `commitment-${String(state.nextCommitmentSequence++).padStart(6, "0")}`,
    type: "officer_duty",
    actorId: officer.id,
    targetId: subject.id,
    dueDay: state.calendar.absoluteDay + 1,
    status: "open",
    sourceEventId: event.id,
    payload: { purpose, reason: String(reason || "").slice(0, 240) }
  };
  state.commitments.push(commitment);

  if (purpose === "protect" || purpose === "keep_the_peace") {
    subject.stress = clamp(subject.stress - 10);
    const thread = state.issueThreads.find((entry) => (
      entry.status === "open" && (entry.subjectIds || []).includes(subject.id)
    ));
    if (thread) thread.danger = clamp(thread.danger - 20);
    state.town.metrics.safety = clamp(state.town.metrics.safety + 2);
  }
  if (purpose === "investigate") {
    const thread = state.issueThreads.find((entry) => (
      entry.status === "open" && (entry.subjectIds || []).includes(subject.id)
    ));
    if (thread) thread.pressure = clamp(thread.pressure - 10);
  }
  officer.stress = clamp(officer.stress + 4);
  addStructuredMemory(state, officer, {
    summary: `Father Benedict sent me to ${purpose === "investigate" ? "look into a matter concerning" : "keep the peace around"} ${subject.name}.`,
    sourceEventId: event.id,
    emotion: "resolved",
    type: "interaction"
  });
  addStructuredMemory(state, subject, {
    summary: `${officer.name} came at the priest's asking${purpose === "investigate" ? " to ask questions about me" : " to see that no harm came to me"}.`,
    sourceEventId: event.id,
    emotion: purpose === "investigate" ? "anxious" : "grateful",
    type: "interaction"
  });
  /* When this is called on its own - from a button, or by the watching model -
     it has to carry itself in the command log or a reloaded parish will not
     have sent the watch at all. When it is called from inside an exchange the
     conversation command already carries it, and recording here as well would
     send the officer twice on replay. */
  if (record) {
    appendCommand(state, "summon_officer", {
      officerId: officer.id,
      subjectId: subject.id,
      purpose,
      reason: String(reason || "").slice(0, 240)
    });
  }
  return { officer, subject, purpose, eventId: event.id, commitmentId: commitment.id };
}

/* Sending word beyond the village. The steward runs the manor's land and
   labour; the lord holds this village and four others from his castle half a
   day east, and is not lightly troubled. A priest may send to either, but the
   lord answers slowly and remembers who wastes his time. */
export function petitionAuthority(state, {
  role = "steward",
  subjectId = null,
  matter = "",
  sourceEventId = null
} = {}, { record = true } = {}) {
  if (!["steward", "lord"].includes(role)) return null;
  const definition = EXTERNAL_ROLES[role];
  if (!definition) return null;
  if (state.eventQueue.some((event) => event.type === "external_visit" && event.role === role)) {
    return { alreadySent: true, role, title: definition.title };
  }
  const travelDays = role === "lord" ? 3 : 1;
  const event = appendEvent(state, {
    type: "authority_petitioned",
    parentId: sourceEventId || state.currentVisit?.originEventId || null,
    actorId: "priest",
    targetId: subjectId,
    facts: { role, title: definition.title, matter: String(matter || "").slice(0, 240), travelDays }
  });
  state.eventQueue.push({
    id: `queued-${String(state.nextQueueSequence++).padStart(6, "0")}`,
    type: "external_visit",
    role,
    dueDay: state.calendar.absoluteDay + travelDays,
    sourceEventId: event.id,
    sourcePersonId: subjectId,
    actorId: null,
    payload: { role, matter: String(matter || "").slice(0, 240) },
    reason: String(matter || "").slice(0, 240)
  });
  state.commitments.push({
    id: `commitment-${String(state.nextCommitmentSequence++).padStart(6, "0")}`,
    type: "authority_petition",
    actorId: "priest",
    targetId: subjectId || "priest",
    dueDay: state.calendar.absoluteDay + travelDays,
    status: "open",
    sourceEventId: event.id,
    payload: { role, matter: String(matter || "").slice(0, 240) }
  });
  /* Calling on the manor is never neutral. The steward's involvement steadies
     a dispute; troubling the lord raises the stakes for everyone. */
  if (role === "steward") state.priest.moralAuthority = clamp(state.priest.moralAuthority + 1);
  else state.outsideAttention.crown = clamp(state.outsideAttention.crown + 8);
  if (record) {
    appendCommand(state, "petition_authority", {
      role,
      subjectId: subjectId || null,
      matter: String(matter || "").slice(0, 240)
    });
  }
  return { role, title: definition.title, travelDays, eventId: event.id };
}

/* =========================================================================
   Letters
   -------------------------------------------------------------------------
   The priest does not leave his church, which leaves him one way of reaching
   somebody who will not come: he writes to them. A letter is slower than
   speech and colder than it, but it travels where he cannot, and it can be
   addressed to a villager or to a man of standing outside the parish.

   What a letter is *about* is the priest's own words, so the model reads it and
   says what it amounts to. What a letter *does* is the engine's business, as
   always: the reading is bounded, checked against who the recipient actually
   is, and applied here.
   ========================================================================= */

/** Who a letter may be addressed to, given who the priest knows and what he has done. */
export function letterRecipients(state) {
  const villagers = state.residents
    .filter((person) => (
      person.active && person.alive && person.age >= 14
      && (person.materialized || person.profileRevealed)
    ))
    .map((person) => ({
      kind: "villager",
      id: person.id,
      name: person.name,
      detail: `${person.occupation}, aged ${person.age}`
    }));

  /* Writing to the manor or the diocese is not a thing a village priest does
     lightly, and he cannot write to someone he has never had dealings with.
     The steward and the lord hold this village, so they are always reachable;
     anyone further has to have taken notice of him first. */
  const outside = [{ kind: "external", id: "steward", name: EXTERNAL_ROLES.steward.title, detail: "holds the manor's land and labour" },
    { kind: "external", id: "lord", name: EXTERNAL_ROLES.lord.title, detail: "holds this village and four others" }];
  for (const role of ["archdeacon", "bishop", "magistrate", "sheriff"]) {
    const known = state.authorityStages?.recognition?.[`${role}Commendation`] != null
      || state.authorityStages?.judgement?.summoned != null
      || (state.events || []).some((event) => event.facts?.role === role);
    if (known && EXTERNAL_ROLES[role]) {
      outside.push({ kind: "external", id: role, name: EXTERNAL_ROLES[role].title, detail: "has had dealings with this parish" });
    }
  }
  return { villagers, outside };
}

/**
 * Send a letter. `reading` is the model's account of what the priest wrote;
 * every part of it is optional and every part is bounded here.
 */
export function sendLetter(state, { recipientKind, recipientId, text, reading = null } = {}, { record = true } = {}) {
  const clean = String(text || "").trim().slice(0, 1200);
  if (!clean) return null;
  if (!["villager", "external"].includes(recipientKind)) return null;

  const person = recipientKind === "villager"
    ? state.residents.find((entry) => entry.id === recipientId && entry.active && entry.alive)
    : null;
  const role = recipientKind === "external" ? EXTERNAL_ROLES[recipientId] : null;
  if (!person && !role) return null;

  const tone = ["kind", "plain", "commanding", "threatening", "pleading"].includes(reading?.tone)
    ? reading.tone
    : "plain";
  const asks = ["visit", "act", "explain", "nothing"].includes(reading?.asks) ? reading.asks : "nothing";
  const summary = String(reading?.summary || "").slice(0, 240);

  const letterEvent = appendEvent(state, {
    type: "letter_sent",
    actorId: "priest",
    targetId: person ? person.id : null,
    facts: {
      recipientKind,
      recipientId,
      recipientName: person ? person.name : role.title,
      tone,
      asks,
      summary,
      text: clean.slice(0, 400)
    }
  });

  const outcome = { recipientName: person ? person.name : role.title, tone, asks, eventId: letterEvent.id };

  if (person) {
    /* A letter from the priest is an event in an ordinary villager's life. How
       it lands depends on what it says and on what they already think of him. */
    const warmth = { kind: 7, pleading: 4, plain: 2, commanding: -3, threatening: -9 }[tone];
    const receptive = 0.5 + (person.trustPriest - 50) / 140 + (person.faith - 50) / 220;
    person.trustPriest = clamp(person.trustPriest + warmth * Math.max(0.3, receptive));
    person.stress = clamp(person.stress + (tone === "threatening" ? 12 : tone === "commanding" ? 5 : -4));
    if (tone === "threatening") person.morale = clamp(person.morale - 6);
    addStructuredMemory(state, person, {
      type: "letter_received",
      summary: summary || `The priest wrote to me.`,
      emotion: tone === "threatening" ? "afraid" : tone === "kind" ? "grateful" : "contemplative",
      confidence: 85,
      sourceEventId: letterEvent.id
    });

    /* Being asked to come is a request like any other, and may be refused. */
    if (asks === "visit" && state.calendar.absoluteDay >= 1 && state.calendar.dayIndex !== 6) {
      const alreadyAsked = state.visitRequests.some((request) => (
        request.personId === person.id && request.status === "pending"
      ));
      const todaysRequests = state.visitRequests.filter((request) => (
        request.requestedDay === state.calendar.absoluteDay
      ));
      if (!alreadyAsked && todaysRequests.length < 4) {
        const results = requestVisits(state, [person.id], summary || "asked by letter", { record: false });
        outcome.visitRequested = results?.[0]?.status ?? null;
      }
    }
    outcome.trustPriest = Math.round(person.trustPriest);
  } else {
    /* Writing to the manor or the diocese draws attention, which is exactly
       what it is for and exactly what makes it dangerous. */
    const travelDays = { steward: 1, lord: 3, archdeacon: 4, bishop: 5, magistrate: 4, sheriff: 4 }[recipientId] ?? 4;
    if (!state.eventQueue.some((event) => event.type === "external_visit" && event.role === recipientId)) {
      scheduleExternalVisit(
        state,
        recipientId,
        summary || `The priest has written to the ${role.title.toLowerCase()}.`,
        travelDays,
        person?.id ?? null,
        letterEvent.id,
        { viaLetter: true, tone }
      );
      outcome.comingInDays = travelDays;
    } else {
      outcome.alreadyExpected = true;
    }
    if (recipientId === "steward") {
      state.priest.moralAuthority = clamp(state.priest.moralAuthority + 1);
    } else {
      state.outsideAttention.church = clamp((state.outsideAttention.church || 0) + (recipientId === "bishop" ? 10 : 5));
      state.outsideAttention.crown = clamp((state.outsideAttention.crown || 0) + (recipientId === "sheriff" ? 8 : 3));
    }
    if (tone === "threatening") state.priest.scandal = clamp(state.priest.scandal + 6);
  }

  addChronicle(
    state,
    `A letter to ${outcome.recipientName}`,
    summary || clean.slice(0, 160),
    tone === "threatening" ? "danger" : "change",
    { type: "letter_noted", parentId: letterEvent.id, facts: { tone, asks } }
  );

  if (record) {
    appendCommand(state, "send_letter", {
      recipientKind,
      recipientId,
      text: clean,
      reading: { tone, asks, summary }
    });
  }
  return outcome;
}

export function fallbackDeparturePlan(state) {
  const visit = state.currentVisit;
  const person = materializeResident(state, visit.personId, true);
  const acceptedRoots = acceptedProposalRootSteps(state, visit, person);
  if (acceptedRoots.length >= 2) {
    return {
      summary: `${person.name} acts on several parts of the counsel given during the hour.`,
      steps: acceptedRoots
    };
  }
  const commitment = currentVisitorCommitment(state, visit, person);
  const latestIntent = (intent, pattern) => {
    const latest = [...visit.counsel].reverse().find((entry) => pattern.test(entry.toLowerCase()));
    return Boolean(latest && classifyPriestSpeech(latest).includes(intent));
  };
  let actionType = "keep_silence";
  const donationCounsel = [...visit.counsel].reverse().find((entry) => (
    parseChurchTransferIntent(entry)?.direction === "incoming"
  ));
  const donationIntent = donationCounsel ? parseChurchTransferIntent(donationCounsel) : null;
  const visitorAcceptedDonation = [...visit.history].reverse()
    .find((entry) => entry.speaker === "visitor")?.text
    .match(/\b(?:yes|i will|i can|gladly|bring|give|donate|contribute)\b/i);
  const latestCounsel = visit.counsel.at(-1)?.toLowerCase() || "";
  if (commitment) actionType = commitment.actionType;
  else if (donationIntent && visitorAcceptedDonation) actionType = "donate";
  else if (latestIntent("apology", /\b(?:apologize|make amends|say sorry)\b/)) actionType = "apologize";
  else if (latestIntent("forgiveness", /\b(?:forgiv\w*|pardon|mercy|make amends)\b/)) actionType = "forgive";
  else if (latestIntent("truth", /\b(?:truth|confess|admit|honest)\b/)) actionType = "seek_absolution";
  else if (latestIntent("work", /\b(?:work|job|trade|labor|duty)\b/)) actionType = "work_harder";
  else if (latestIntent("prayer", /\b(?:pray\w*|faith|scripture|grace)\b/)) actionType = "pray_with";
  else if (latestIntent("report", /\b(?:report|reeve|justice)\b/)) actionType = "report_crime";
  else if (latestIntent("charity", /\b(?:help|charity|give|share|food|alms)\b/)) actionType = "share_food";
  else if (/\b(?:threaten|frighten|intimidate|make .* afraid)\b/.test(latestCounsel)) actionType = "threaten";
  else if (/\b(?:punish|shame|denounce|blame)\b/.test(latestCounsel)) actionType = "accuse";
  else if (/\b(?:spread|start)\b.*\b(?:rumor|gossip)\b|\btell everyone\b/.test(latestCounsel)) actionType = "gossip";
  else if (/\b(?:steal|take .* for yourself|keep the money|keep the goods)\b/.test(latestCounsel)) actionType = "steal";
  const relationIds = person.relationshipIds.filter((id) => state.residents.some((resident) => resident.id === id && resident.active));
  const issueThread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
  const materialTargetId = [...new Set([...(issueThread?.subjectIds || []), ...relationIds])]
    .find((id) => {
    const target = state.residents.find((resident) => resident.id === id);
      return target?.active && target.id !== person.id && target.householdId !== person.householdId;
    }) || null;
  const latestVisitorReply = [...visit.history].reverse().find((line) => line.speaker === "visitor")?.text.toLowerCase() || "";
  const deliberateRestraint = /\b(?:keep silent|say nothing|tell no one|keep this secret|do not|don't|never)\b/.test(latestCounsel)
    || /\b(?:i will not|i won't|i cannot|i can't|i changed my mind|i no longer intend)\b/.test(latestVisitorReply);
  if (actionType === "keep_silence" && !deliberateRestraint) {
    actionType = relationIds.length
      ? "visit"
      : ["confession", "faith", "grave conscience"].includes(visit.issue.kind) ? "repent" : "attend_church";
  }
  const targetId = commitment?.targetId
    ?? (actionType === "donate" && donationIntent
      ? "priest"
      : ["share_food", "lend_money"].includes(actionType)
        ? materialTargetId
        : TARGET_REQUIRED_ACTIONS.has(actionType) ? (relationIds[0] || null) : null);
  const steps = [{
    depth: 1,
    actorId: person.id,
    targetId,
    actionType,
    intensity: Math.min(visit.issue.gravity, maximumIntensityForLicense(visit.eventLicense)),
    title: `${person.name} acts on the priest's counsel`,
    description: actionType === "donate" && targetId === "priest"
      ? `${person.name} brings a donation to the church.`
      : `${person.name} leaves the church and chooses to ${actionType.replaceAll("_", " ")}${targetId ? ` in dealing with ${state.residents.find((resident) => resident.id === targetId).name}` : ""}.`,
    detail: commitment?.detail || (actionType === "donate" && donationIntent
      ? `${donationIntent.resource}:${donationIntent.amount}`
      : "")
  }];
  if (targetId && ["forgive", "apologize", "share_food", "report_crime"].includes(actionType)) {
    const target = state.residents.find((resident) => resident.id === targetId);
    const thirdId = target.relationshipIds.find((id) => id !== person.id) || null;
    steps.push({
      depth: 2,
      actorId: target.id,
      targetId: thirdId,
      actionType: actionType === "report_crime" ? "testify" : "visit",
      intensity: 2,
      title: `${target.name} answers in turn`,
      description: `${target.name} is moved by ${person.name}'s choice and carries its consequence onward.`
    });
  }
  return {
    summary: `${person.name}'s next choice grows from the counsel given during this hour.`,
    steps
  };
}

function visitorCommitmentAction(state, visit, person) {
  const indexedHistory = visit.history.map((line, index) => ({ ...line, index }));
  const lastRetractionIndex = indexedHistory
    .filter((line) => line.speaker === "visitor"
      && /\b(?:i will not|i won't|i cannot|i can't|i shall not|i changed my mind|i no longer intend)\b/i.test(line.text))
    .at(-1)?.index ?? -1;
  const committedLine = [...indexedHistory].reverse().find((line) => (
    line.speaker === "visitor"
    && line.index > 0
    && line.index > lastRetractionIndex
    && /\b(?:i will|i'll|i shall|i intend|i am going to|i can)\b/i.test(line.text)
    && !/\b(?:i will not|i won't|i cannot|i can't|i shall not)\b/i.test(line.text)
  ));
  if (!committedLine) return null;
  const text = committedLine.text.toLowerCase();
  const related = state.residents.find((resident) => resident.id === visit.issue.relatedPersonId);
  const mentioned = residentMentionedInText(state, committedLine.text);
  const summons = state.eventQueue.find((event) => (
    event.type === "priest_summons" && event.dueDay > state.calendar.absoluteDay
  ));
  const validTarget = [mentioned, related]
    .find((target) => target && person.relationshipIds.includes(target.id));
  const targetId = validTarget?.id || person.relationshipIds.find((id) => (
    state.residents.some((resident) => resident.id === id && resident.active && resident.alive)
  )) || null;
  if (/\b(?:tell|ask|send)\b.*\bcome\b/.test(text) && summons) {
    return { actionType: "visit", targetId: summons.sourcePersonId, detail: "", historyIndex: committedLine.index };
  }
  if (/\b(?:gather|collect)\b.*\b(?:receipt|evidence|witness)|\b(?:appeal|report|magistrate|reeve|testify)\b/.test(text)) {
    return { actionType: "report_crime", targetId, detail: "", historyIndex: committedLine.index };
  }
  if (/\breturn\b.*\b(?:grain|flour|goods|money|coin|stolen)\b/.test(text)) {
    return { actionType: "return_stolen_goods", targetId, detail: "", historyIndex: committedLine.index };
  }
  if (/\b(?:speak|talk|confront|meet|ask)\b/.test(text) && targetId) {
    return { actionType: "visit", targetId, detail: "", historyIndex: committedLine.index };
  }
  if (/\b(?:apologize|say sorry|make amends)\b/.test(text)) {
    return { actionType: "apologize", targetId, detail: "", historyIndex: committedLine.index };
  }
  if (/\bforgive\b/.test(text)) return { actionType: "forgive", targetId, detail: "", historyIndex: committedLine.index };
  if (/\b(?:share|give|bring)\b.*\b(?:food|bread|grain|cheese)\b/.test(text)) {
    return { actionType: "share_food", targetId, detail: "", historyIndex: committedLine.index };
  }
  if (String(visit.issue.scenarioId || "").includes("contaminated_well")
    && /\b(?:carry|carried|secure|arrange|transport|organize)\w*\b.*\b(?:water|spring|well)\b/.test(text)) {
    return {
      actionType: "secure_clean_water",
      targetId: null,
      detail: completeStoredText(committedLine.text, 120),
      historyIndex: committedLine.index
    };
  }
  if (/\bpray\b/.test(text) && targetId) return { actionType: "pray_with", targetId, detail: "", historyIndex: committedLine.index };
  if (/\b(?:protect|shelter|keep .* safe)\b/.test(text)) return { actionType: "protect", targetId, detail: "", historyIndex: committedLine.index };
  if (/\b(?:refuse|decline|reject)\b.*\b(?:work|offer|trade)\b/.test(text)) {
    return { actionType: "refuse_work", targetId, detail: "", historyIndex: committedLine.index };
  }
  if (/\b(?:work harder|return to work|do the work)\b/.test(text)) {
    return { actionType: "work_harder", targetId: null, detail: "", historyIndex: committedLine.index };
  }
  if (/\b(?:leave|depart|flee)\b/.test(text)) return { actionType: "leave_village", targetId: null, detail: "", historyIndex: committedLine.index };
  return null;
}

function currentVisitorCommitment(state, visit, person) {
  const commitment = visitorCommitmentAction(state, visit, person);
  if (!commitment) return null;
  const counselBeforeCommitment = visit.history
    .slice(0, commitment.historyIndex)
    .filter((line) => line.speaker === "priest").length;
  const actionableIntents = new Set([
    "apology", "forgiveness", "truth", "work", "prayer", "report", "charity", "departure"
  ]);
  const superseded = visit.counsel.slice(counselBeforeCommitment).some((line) => (
    classifyPriestSpeech(line).some((intent) => actionableIntents.has(intent))
  ));
  return superseded ? null : commitment;
}

export function departureCandidates(state) {
  const person = materializeResident(state, state.currentVisit.personId, true);
  const people = [...state.residents, ...state.externalActors];
  const first = person.relationshipIds.map((id) => people.find((resident) => resident.id === id)).filter((resident) => resident?.active);
  const second = first.flatMap((resident) => resident.relationshipIds)
    .map((id) => people.find((resident) => resident.id === id))
    .filter((resident) => resident?.active);
  const thread = state.issueThreads.find((entry) => entry.id === state.currentVisit.issue.threadId);
  const threadPeople = (thread?.subjectIds || [])
    .map((id) => people.find((resident) => resident.id === id))
    .filter((resident) => resident?.active);
  const mentionedPeople = state.residents.filter((resident) => (
    state.currentVisit.history.some((line) => line.text.toLowerCase().includes(resident.name.toLowerCase()))
  ));
  return [...new Map(
    [person, ...threadPeople, ...mentionedPeople, ...first, ...second].map((resident) => [resident.id, resident])
  ).values()].slice(0, 24);
}

const TARGET_REQUIRED_ACTIONS = new Set([
  "comfort", "advise", "apologize", "forgive", "reconcile", "pray_with", "share_food",
  "lend_money", "shelter", "teach", "heal", "nurse", "hire", "accuse", "gossip",
  "reveal_secret", "return_stolen_goods", "report_crime", "make_peace", "testify",
  "visit", "write_letter", "protect", "offer_work", "refuse_work", "court", "marry",
  "separate", "conceive_child", "adopt_child", "flirt_with_priest", "proposition_priest",
  "attempt_seduction", "blackmail_priest", "report_priest_to_bishop", "praise_priest_to_bishop",
  "attack_priest", "poison_priest", "kill_priest", "defend_priest", "challenge_priest",
  "threaten", "assault", "betray", "evict", "begin_feud", "expel", "divorce", "kill_person"
]);

const HEALING_OCCUPATIONS = new Set(["healer", "herbalist", "midwife"]);
const BUILDING_OCCUPATIONS = new Set(["blacksmith", "carpenter", "mason", "thatcher", "laborer"]);
const HIRING_OCCUPATIONS = new Set(["reeve", "bailiff", "merchant", "innkeeper", "miller", "farmer"]);
const PRIEST_TARGET_ACTIONS = new Set([
  "donate",
  "flirt_with_priest", "proposition_priest", "attempt_seduction", "blackmail_priest",
  "report_priest_to_bishop", "praise_priest_to_bishop", "attack_priest", "poison_priest",
  "kill_priest", "defend_priest", "challenge_priest"
]);

function hasPhaseZeroCapability(actor, actionType) {
  if (actionType === "heal") return HEALING_OCCUPATIONS.has(actor.occupation);
  if (actionType === "build" || actionType === "repair") return BUILDING_OCCUPATIONS.has(actor.occupation);
  if (actionType === "hire" || actionType === "offer_work") return HIRING_OCCUPATIONS.has(actor.occupation);
  if (actionType === "verify_route") return actor.age >= 14 && actor.health >= 35;
  if (actionType === "prepare_evacuation") return actor.age >= 14 && actor.health >= 25;
  if (actionType === "organize_defense") return actor.age >= ADULT_AGE && actor.health >= 35;
  return true;
}

function hasLifeCourseEligibility(state, visit, actor, target, actionType, detail) {
  const counsel = visit.counsel.join(". ").toLowerCase();
  const household = state.households.find((entry) => entry.id === actor.householdId);
  if (actionType === "organize_defense") {
    return state.residents.some((resident) => (
      resident.active && resident.alive
      && ["reeve", "bailiff", "watchman", "soldier"].includes(resident.occupation)
    ));
  }
  const authorityPatterns = {
    petition_bishop: /^(?:please\s+)?(?:petition|write to|report to|contact)\s+(?:the\s+)?bishop[.!]?$/,
    appeal_to_rome: /^(?:please\s+)?(?:appeal|write|send word)\s+(?:to\s+)?(?:rome|the pope|papal authority)[.!]?$/,
    petition_crown: /^(?:please\s+)?(?:petition|write to|appeal to)\s+(?:the\s+)?(?:crown|king|royal court)[.!]?$/,
    report_priest_to_bishop: /^(?:please\s+)?report\s+(?:the\s+)?priest\s+to\s+(?:the\s+)?bishop[.!]?$/,
    claim_miracle: /^(?:please\s+)?(?:claim|declare)\s+(?:this\s+)?(?:a\s+)?miracle[.!]?$/,
    fake_miracle: /^(?:please\s+)?(?:stage|fake)\s+(?:a\s+)?(?:false\s+)?miracle[.!]?$/,
    claim_prophecy: /^(?:please\s+)?(?:claim|declare)\s+(?:a\s+)?prophecy[.!]?$/
  };
  if (authorityPatterns[actionType]) {
    if (actor.age < ADULT_AGE) return false;
    if (["claim_miracle", "fake_miracle", "claim_prophecy"].includes(actionType)
      && visit.eventLicense !== "outrageous") return false;
    const counsel = visit.counsel.map((entry) => entry.trim().toLowerCase());
    const commandIndex = counsel.findIndex((entry) => authorityPatterns[actionType].test(entry));
    if (commandIndex < 0) return false;
    if (actionType === "report_priest_to_bishop"
      && !state.priestReports.some((report) => (
        report.reporterId === actor.id
        && report.status === "private_complaint"
        && report.auditIds.length > 0
        && report.eligibleRecipients.some((recipient) => ["archdeacon", "bishop"].includes(recipient))
      ))) return false;
    return !counsel.slice(commandIndex + 1).some((entry) => /\b(?:retract|take that back|do not|don't|not|never)\b/.test(entry));
  }
  const comicActions = new Set(["play_prank", "ring_bells_at_midnight"]);
  const outrageousActions = new Set([
    "release_livestock_in_church", "fake_miracle", "claim_prophecy", "claim_miracle",
    "ring_bells_at_midnight",
    "attack_priest", "poison_priest", "kill_priest", "kill_person", "attempt_seduction", "steal_church_relic"
  ]);
  if (comicActions.has(actionType) && visit.eventLicense === "ordinary") return false;
  if (outrageousActions.has(actionType) && visit.eventLicense !== "outrageous") return false;
  if (PRIEST_TARGET_ACTIONS.has(actionType)) {
    if (target?.id !== "priest" || !state.priest.alive || actor.age < ADULT_AGE) return false;
    const personality = actor.personality || deriveResidentProfile(state, actor).personality;
    if (["flirt_with_priest", "proposition_priest", "attempt_seduction"].includes(actionType)) {
      return actor.trustPriest >= 35 && personality.boldness >= 45;
    }
    if (actionType === "report_priest_to_bishop") return actor.trustPriest <= 45 || state.priest.scandal >= 35;
    if (actionType === "praise_priest_to_bishop") return actor.trustPriest >= 65;
    if (actionType === "blackmail_priest") return state.priest.scandal >= 20 && personality.boldness >= 55;
    if (["attack_priest", "poison_priest", "kill_priest"].includes(actionType)) {
      if (visit.eventLicense !== "outrageous") return false;
      return actor.trustPriest <= 15 && actor.stress >= 65 && personality.boldness >= 60;
    }
    return true;
  }
  if (actionType === "steal_church_relic") return state.priest.relicStolenById == null && actor.age >= ADULT_AGE;
  if (actionType === "return_church_relic") return state.priest.relicStolenById === actor.id;
  const isNegated = (keywords) => {
    const keywordPattern = new RegExp(`\\b(?:${keywords})\\b`);
    const latestRelevant = [...visit.counsel].reverse().find((entry) => keywordPattern.test(entry.toLowerCase()));
    return Boolean(latestRelevant && new RegExp(
      `\\b(?:do not|don't|must not|never|should not|shouldn't|avoid|refuse to|retract|not)\\b.*\\b(?:${keywords})\\b`
    ).test(latestRelevant.toLowerCase()));
  };
  const negationKeywords = {
    change_job: "work|job|trade|craft|employment|labor|change",
    offer_work: "offer|hire|work|employment",
    hire: "hire|employ",
    court: "court\\w*|lov\\w*|romanc\\w*",
    marry: "marr\\w*|wedd\\w*|spouse",
    separate: "separat\\w*|annul\\w*|leave my spouse",
    conceive_child: "child|baby|pregnan\\w*|conceiv\\w*",
    adopt_child: "adopt\\w*|orphan|take in a child|raise a child",
    invite_migrant: "invit\\w*|newcomer|refugee|settl\\w*|bring"
  };
  if (negationKeywords[actionType] && isNegated(negationKeywords[actionType])) return false;
  if (["heal", "nurse"].includes(actionType)) {
    const conversationSupport = /\bheal|ill|sick|fever|care|nurse|physician|herb\b/.test(counsel);
    const independentPressure = actor.occupation === "healer" && Boolean(target?.illness) && target.health < 45;
    return Boolean(target && (target.illness || target.health < 90) && (conversationSupport || independentPressure));
  }

  if (["work_harder", "shirk_work", "quit_job"].includes(actionType) && actor.age < ADULT_AGE) return false;
  if (["hire", "offer_work"].includes(actionType) && actor.age < ADULT_AGE) return false;
  if (actionType === "hire" && (!target || target.age < ADULT_AGE)) return false;
  if (actionType === "change_job" || actionType === "offer_work") {
    const conversationSupport = /\bwork|job|trade|craft|employment|hire|labor|duty\b/.test(counsel)
      && !isNegated("work|job|trade|craft|employment|hire|labor|change");
    const independentPressure = actor.occupation === "unemployed" || (household?.wealth || 50) < 20;
    const worker = actionType === "offer_work" ? target : actor;
    return Boolean(worker && worker.age >= ADULT_AGE && OCCUPATIONS.includes(detail) && (conversationSupport || independentPressure));
  }
  if (["court", "marry", "separate", "conceive_child", "adopt_child"].includes(actionType)) {
    if (!target || !isAdultRelationshipEligible(actor) || !isAdultRelationshipEligible(target)) return false;
  }
  if (actionType === "court") {
    const relationship = getRelationship(state, actor.id, target.id, false);
    const conversationSupport = /\blove|court|affection|marry|romance\b/.test(counsel)
      && !isNegated("court|love|marry|romance");
    const independentPressure = (relationship?.affection || 0) > 85 && (relationship?.attraction || 0) > 70;
    return actor.maritalStatus === "single"
      && target.maritalStatus === "single"
      && actor.sex !== target.sex
      && !areProhibitedKin(state, actor.id, target.id)
      && (conversationSupport || independentPressure);
  }
  if (actionType === "marry") {
    const forward = getRelationship(state, actor.id, target.id, false);
    const reverse = getRelationship(state, target.id, actor.id, false);
    return actor.maritalStatus === "single"
      && target.maritalStatus === "single"
      && actor.sex !== target.sex
      && !areProhibitedKin(state, actor.id, target.id)
      && ((/\blove|marry|spouse|wedding|family\b/.test(counsel) && !isNegated("marry|wedding|spouse|family"))
        || ((forward?.affection || 0) > 85 && (reverse?.affection || 0) > 85))
      && (forward?.affection || 0) >= 45
      && (reverse?.affection || 0) >= 45
      && (forward?.resentment || 0) < 50
      && (reverse?.resentment || 0) < 50;
  }
  if (actionType === "separate") {
    const relationship = getRelationship(state, actor.id, target.id, false);
    return actor.spouseId === target.id
      && target.spouseId === actor.id
      && ((/\bseparate|leave my spouse|abuse|unsafe marriage|annul\b/.test(counsel)
        && !isNegated("separate|leave my spouse|annul"))
        || (relationship?.resentment || 0) > 80);
  }
  if (actionType === "conceive_child") {
    const mother = actor.sex === "female" ? actor : target.sex === "female" ? target : null;
    const father = actor.sex === "male" ? actor : target.sex === "male" ? target : null;
    return actor.spouseId === target.id
      && target.spouseId === actor.id
      && mother != null
      && father != null
      && mother.age <= 42
      && mother.pregnantDueDay == null
      && ((/\bchild|baby|family|pregnan|conceive\b/.test(counsel)
        && !isNegated("child|baby|pregnan|conceive"))
        || ((getRelationship(state, actor.id, target.id, false)?.affection || 0) > 78
          && (household?.food || 0) > 50
          && (household?.wealth || 0) > 45));
  }
  if (actionType === "adopt_child") {
    const householdChildren = state.residents.filter((person) => (
      person.householdId === actor.householdId && person.active && person.alive && person.age < 18
    )).length;
    return actor.spouseId === target.id
      && target.spouseId === actor.id
      && householdChildren < 6
      && state.calendar.absoluteDay - (household?.lastAdoptionDay ?? -999) >= 365
      && ((/\badopt|orphan|take in a child|raise a child\b/.test(counsel)
        && !isNegated("adopt|orphan|take in a child|raise a child"))
        || (actor.childrenIds.length === 0 && (household?.food || 0) > 65 && (household?.wealth || 0) > 60));
  }
  if (actionType === "invite_migrant") {
    const activePopulation = activeResidents(state).length;
    const official = ["reeve", "bailiff", "merchant", "innkeeper"].includes(actor.occupation);
    return actor.age >= 18
      && official
      && activePopulation < 250
      && state.calendar.absoluteDay - state.lastInvitedMigrationDay >= 30
      && state.town.metrics.prosperity >= 35
      && (
      (/\binvite|newcomer|refugee|settle|bring .* village\b/.test(counsel)
        && !isNegated("invite|newcomer|refugee|settle|bring"))
      || (official && activePopulation < 160 && state.town.metrics.prosperity > 55)
    );
  }
  if (["buy_property", "sell_property", "lease_property"].includes(actionType)) {
    if (actor.age < ADULT_AGE || !household) return false;
    const support = /\b(?:buy|sell|lease|rent|property|cottage|house|room|stall|field|land)\b/.test(counsel);
    if (!support) return false;
    if (actionType === "buy_property") return household.wealth >= 10 && household.properties.length < 6;
    if (actionType === "sell_property") return household.properties.some((property) => property.status === "owned");
    return household.wealth >= 4 && household.properties.length < 6;
  }
  if (actionType === "leave_village") {
    if (actor.age < 18) return false;
    if (!visit.counsel.length) return actor.stress >= 75 && actor.morale <= 25;
    const normalizedCounsel = visit.counsel.join(". ").toLowerCase()
      .replace(/\s*,?\s*\b(?:but|however)\b\s*,?\s*/g, ". ");
    const counselClauses = normalizedCounsel.match(/[^.!?;—]+[.!?;—]?/g) || [];
    const counsel = [...counselClauses].reverse()
      .find((entry) => (
        /\b(?:leave|flee|depart|stay|remain|retract)\b/.test(entry)
        || /^\s*(?:not|no|do not go|don't go)\b/.test(entry)
      ))
      ?.trim() || "";
    if (!counsel || !classifyPriestSpeech(counsel).includes("departure")) return false;
    if (/\b(?:stay|remain)\b/.test(counsel)
      && !/\b(?:do not|don't|not|never)\b.*\b(?:stay|remain)\b/.test(counsel)) {
      return false;
    }
    return /\b(?:village|town|parish|settlement)\b/.test(counsel);
  }
  if (actionType === "keep_silence") {
    const visitorWords = visit.history
      .slice(1)
      .filter((line) => line.speaker === "visitor")
      .map((line) => line.text)
      .join(" ")
      .toLowerCase();
    return /\b(?:keep silent|say nothing|tell no one|not ready|cannot decide|can't decide|refuse|will not|won't|need more time)\b/.test(
      `${counsel} ${visitorWords}`
    );
  }
  if (["threaten", "assault", "begin_feud", "evict", "betray", "expel", "divorce", "kill_person"].includes(actionType)) {
    if (!target || actor.age < ADULT_AGE) return false;
    const relationship = getRelationship(state, actor.id, target.id, false);
    const personality = actor.personality || deriveResidentProfile(state, actor).personality;
    const directSupport = {
      threaten: /\bthreaten|frighten|intimidate|make .* afraid\b/,
      assault: /\battack|strike|beat|hurt|assault\b/,
      begin_feud: /\bfeud|revenge|retaliate\b/,
      evict: /\bevict|remove .* home|drive .* out\b/,
      betray: /\bbetray|deceive|turn against\b/,
      expel: /\bexpel|banish|drive .* village\b/,
      divorce: /\bdivorce|end .* marriage\b/,
      kill_person: /\bkill|murder\b/
    }[actionType]?.test(counsel);
    if (actionType === "divorce") return actor.spouseId === target.id && Boolean(directSupport);
    if (actionType === "kill_person") {
      const personality = actor.personality || deriveResidentProfile(state, actor).personality;
      return visit.eventLicense === "outrageous"
        && actor.stress >= 90
        && personality.boldness >= 70
        && (getRelationship(state, actor.id, target.id, false)?.resentment || 0) >= 80
        && Boolean(directSupport);
    }
    if (actionType === "expel") {
      return ["reeve", "bailiff"].includes(actor.occupation) && Boolean(directSupport);
    }
    const independentPressure = actor.stress >= 72
      && personality.boldness >= 58
      && ((relationship?.resentment || 0) >= 65 || (relationship?.fear || 0) >= 70);
    return Boolean(directSupport || independentPressure);
  }
  if (["steal", "vandalize", "drink", "gamble", "relapse", "move_household"].includes(actionType)) {
    if (actor.age < ADULT_AGE && actionType === "move_household") return false;
    const support = {
      steal: /\bsteal|take .* for yourself|keep the money|keep the goods\b/,
      vandalize: /\bvandalize|damage|break|burn\b/,
      drink: /\bdrink|ale|wine\b/,
      gamble: /\bgamble|dice|cards|wager\b/,
      relapse: /\brelapse|return to .* vice\b/,
      move_household: /\bmove|new home|new room|relocate\b/
    }[actionType]?.test(counsel);
    return Boolean(support || (actor.stress >= 78 && actor.morale <= 25));
  }
  return true;
}

function counselContradictsAction(visit, actionType) {
  const intentByAction = {
    apologize: "apology",
    forgive: "forgiveness",
    reconcile: "forgiveness",
    pray_with: "prayer",
    seek_absolution: "truth",
    confess_publicly: "truth",
    work_harder: "work",
    change_job: "work",
    share_food: "charity",
    leave_village: "departure",
    report_crime: "report"
  };
  const keywords = {
    forgiveness: /\bforgiv\w*|pardon|mercy\b/,
    prayer: /\bpray\w*|faith|scripture\b/,
    truth: /\btruth|confess|admit|honest\b/,
    work: /\bwork|job|trade|labor|duty\b/,
    departure: /\bleave|flee|depart\b/,
    apology: /\bapologize|make amends|say sorry\b/,
    report: /\breport|reeve|justice\b/,
    charity: /\bhelp|charity|give|share|food|alms\b/
  };
  const intent = intentByAction[actionType];
  if (!intent) return false;
  const latestRelevant = [...visit.counsel].reverse().find((entry) => keywords[intent].test(entry.toLowerCase()));
  if (!latestRelevant) return false;
  const speech = latestRelevant.toLowerCase();
  return new RegExp(
    `\\b(?:do not|don't|must not|should not|cannot|can't|never|refuse to)\\b.{0,80}(?:${keywords[intent].source})`
  ).test(speech);
}

function decisionScore(state, visit, actor, target, actionType) {
  const counsel = visit.counsel.join(". ").toLowerCase();
  const household = state.households.find((entry) => entry.id === actor.householdId);
  const personality = actor.personality || deriveResidentProfile(state, actor).personality;
  let score = 35;
  score += (actor.trustPriest - 50) * 0.22;
  score += (state.priest.moralAuthority - 50) * 0.18;
  score += (state.priest.localTrust - 50) * 0.1;
  score -= state.priest.scandal * 0.16;
  score += visit.issue.gravity * 3;
  score += Math.min(8, visit.counsel.join(". ").split(/\s+/).filter(Boolean).length / 10);
  const commitment = currentVisitorCommitment(state, visit, actor);
  if (commitment?.actionType === actionType
    && (!commitment.targetId || commitment.targetId === target?.id)) {
    score += 30;
  }
  if (household?.food < 20 || household?.wealth < 20) {
    if (["change_job", "leave_village", "invite_migrant", "work_harder"].includes(actionType)) score += 10;
    if (["marry", "conceive_child", "adopt_child"].includes(actionType)) score -= 8;
  }
  if (["change_job", "quit_job", "work_harder", "offer_work"].includes(actionType) && /\bwork|job|trade|duty|labor\b/.test(counsel)) score += 16;
  if (["court", "marry", "conceive_child", "adopt_child", "separate"].includes(actionType)
    && /\blove|marry|spouse|family|child|separate|household\b/.test(counsel)) score += 16;
  if (actionType === "leave_village" && /\bleave|flee|depart\b/.test(counsel)) score += 20;
  if (actionType === "leave_village" && actor.stress >= 75 && actor.morale <= 25) score += 22;
  if (["court", "marry", "conceive_child", "adopt_child"].includes(actionType) && target) {
    const relationship = getRelationship(state, actor.id, target.id, false);
    score += ((relationship?.affection || 50) - 50) * 0.35;
    score += ((relationship?.attraction || 35) - 35) * 0.2;
    score -= (relationship?.resentment || 0) * 0.25;
  }
  if (actionType === "separate" && target) {
    const relationship = getRelationship(state, actor.id, target.id, false);
    score += (relationship?.resentment || 0) * 0.4;
    score -= (relationship?.affection || 0) * 0.2;
  }
  if (["leave_village", "change_job", "court"].includes(actionType)) score += (personality.boldness - 50) * 0.15;
  if (["forgive", "comfort", "share_food", "adopt_child"].includes(actionType)) score += (personality.empathy - 50) * 0.15;
  if (["pray_with", "seek_absolution", "confess_publicly"].includes(actionType)) score += (personality.piety - 50) * 0.15;
  if (actionType === "report_priest_to_bishop"
    && state.priestReports.some((report) => (
      report.reporterId === actor.id
      && report.status === "private_complaint"
      && report.auditIds.length > 0
      && report.eligibleRecipients.some((recipient) => ["archdeacon", "bishop"].includes(recipient))
    ))) score += 24;
  if (["heal", "nurse"].includes(actionType) && target) {
    score += Math.max(0, 70 - target.health) * 0.25;
    if (target.illness) score += 8;
    score += (personality.empathy - 50) * 0.18;
  }
  if (["attack_priest", "poison_priest", "kill_priest", "blackmail_priest"].includes(actionType)) {
    score += (50 - actor.trustPriest) * 0.45;
    score += Math.max(0, actor.stress - 50) * 0.35;
    score += (personality.boldness - 50) * 0.25;
  }
  if (actionType === "praise_priest_to_bishop") score += (actor.trustPriest - 50) * 0.4;
  if (actionType === "report_priest_to_bishop") {
    score += (50 - actor.trustPriest) * 0.35;
    score += state.priest.scandal * 0.2;
  }
  if (["flirt_with_priest", "proposition_priest", "attempt_seduction"].includes(actionType)) {
    score += (personality.boldness - 50) * 0.3;
    score += (actor.trustPriest - 50) * 0.15;
  }
  if (["steal", "vandalize", "threaten", "assault", "begin_feud", "evict", "betray", "expel", "kill_person"].includes(actionType)) {
    score += (personality.boldness - 50) * 0.25;
    score += Math.max(0, actor.stress - 50) * 0.22;
    const relationship = target ? getRelationship(state, actor.id, target.id, false) : null;
    score += (relationship?.resentment || 0) * 0.18;
    if (/\b(?:steal|take .* yourself|threaten|frighten|attack|hurt|revenge|evict|betray|expel|punish)\b/.test(counsel)) {
      score += 24;
    }
  }
  const relevantRumors = state.rumors.filter((rumor) => (
    rumor.active && rumor.heardByIds.includes(actor.id) && (!target || rumor.subjectId === target.id)
  ));
  if (relevantRumors.length) {
    const rumorPressure = Math.max(...relevantRumors.map((rumor) => rumor.intensity));
    if (["accuse", "gossip", "report_crime", "leave_village"].includes(actionType)) score += rumorPressure * 3;
    if (["forgive", "make_peace"].includes(actionType)) score -= rumorPressure;
  }
  return Math.round(clamp(score, 0, 100));
}

function requiredDecisionScore(actionType) {
  if (["kill_priest", "poison_priest", "kill_person"].includes(actionType)) return 85;
  if (["attack_priest", "blackmail_priest", "attempt_seduction"].includes(actionType)) return 70;
  if (["report_priest_to_bishop", "proposition_priest"].includes(actionType)) return 55;
  if (["assault", "begin_feud", "evict", "betray", "expel"].includes(actionType)) return 60;
  if (["steal", "vandalize"].includes(actionType)) return 48;
  if (actionType === "threaten") return 35;
  if (["marry", "conceive_child", "adopt_child", "leave_village"].includes(actionType)) return 55;
  if (["court", "separate", "change_job", "invite_migrant"].includes(actionType)) return 45;
  return 25;
}

function resolveExternalJudgment(state, person, parentEventId) {
  const role = person.role;
  let title = `${person.name} concludes the visit`;
  let text = `${person.name} leaves after recording the parish's condition.`;
  if (role === "neighbor_priest") {
    const parish = state.neighboringParishes.find((entry) => entry.id === state.currentVisit?.issue.neighborParishId);
    const commitment = state.commitments.find((entry) => (
      entry.targetId === parish?.id && entry.status === "open"
    ));
    title = commitment ? `${person.name} leaves with a pledged answer` : `${person.name} returns without a pledge`;
    text = commitment
      ? `${person.name} accepts that aid or an inspection will arrive only after the recorded ${parish.travelDays}-day journey.`
      : `${person.name} leaves knowing that no resource or journey has yet been promised.`;
  } else if (["archdeacon", "bishop", "inquisitor"].includes(role)) {
    const favorable = state.priest.scandal < 35 && state.priest.moralAuthority >= 45;
    state.priest.bishopFavor = clamp(state.priest.bishopFavor + (favorable ? 8 : -12));
    state.priest.moralAuthority = clamp(state.priest.moralAuthority + (favorable ? 4 : -6));
    if (role === "archdeacon") state.authorityStages.archdeaconCompleted = true;
    if (role === "bishop") state.authorityStages.bishopCompleted = true;
    if (role === "inquisitor") state.authorityStages.examinerCompleted = true;
    title = favorable ? "The church inquiry favors the priest" : "The church inquiry censures the priest";
    text = favorable
      ? `${person.name} finds no cause for severe sanction.`
      : `${person.name} issues a formal warning and damages the priest's standing.`;
  } else if (role === "papal_legate") {
    state.authorityStages.papalLegateCompleted = true;
    state.priest.bishopFavor = clamp(state.priest.bishopFavor + (state.priest.scandal < 45 ? 10 : -15));
    title = "The papal legate issues a ruling";
    text = state.priest.scandal < 45 ? "Rome leaves the parish under ordinary oversight." : "Rome places the parish under strict examination.";
  } else if (role === "steward") {
    state.town.metrics.harmony = clamp(state.town.metrics.harmony + (state.priest.localTrust >= 55 ? 3 : -2));
    state.priest.localTrust = clamp(state.priest.localTrust + (state.priest.scandal < 40 ? 2 : -3));
    title = "The manor steward sets terms for cooperation";
    text = state.priest.scandal < 40
      ? "The steward agrees to compare written evidence with the church before enforcing disputed demands."
      : "The steward warns that further unsupported promises from the church will be treated as interference.";
  } else if (role === "magistrate") {
    state.town.metrics.safety = clamp(state.town.metrics.safety + 4);
    state.material.crime = clamp(state.material.crime - 4);
    title = "The magistrate opens a formal inquiry";
    text = "Witnesses, receipts, injuries, and property claims will be examined under county authority.";
  } else if (role === "lord") {
    state.priest.royalNotice = clamp(state.priest.royalNotice + 5);
    state.priest.localTrust = clamp(state.priest.localTrust + (state.priest.moralAuthority >= 55 ? 4 : -4));
    title = "The lord of the manor defines the boundary of counsel";
    text = state.priest.moralAuthority >= 55
      ? "The lord permits the priest to advocate and accompany villagers while reserving compulsory judgment to lawful authority."
      : "The lord restricts the church from making promises that bind manor officers or property.";
  } else if (role === "sheriff") {
    state.authorityStages.sheriffCompleted = true;
    state.town.metrics.safety = clamp(state.town.metrics.safety + 6);
    const accused = state.residents.find((resident) => person.relationshipIds.includes(resident.id));
    if (accused) accused.flags.push("under_arrest");
    title = "The sheriff concludes an investigation";
    text = accused ? `${accused.name} is taken into custody for questioning.` : "The sheriff orders a stronger watch around the church.";
  } else if (role === "physician") {
    state.priest.health = clamp(state.priest.health + 25);
    title = "The physician treats Father Benedict";
    text = "The priest receives skilled treatment for his injuries.";
  } else if (["royal_commissioner", "noble", "king"].includes(role)) {
    if (role === "royal_commissioner") state.authorityStages.royalCommissionerCompleted = true;
    if (role === "noble") state.authorityStages.nobleCompleted = true;
    state.priest.royalNotice = clamp(state.priest.royalNotice + (state.priest.scandal < 40 ? 8 : -5));
    title = "Royal authority issues a judgment";
    text = state.priest.scandal < 40 ? "The Crown finds the parish broadly orderly." : "The Crown warns the parish against further disorder.";
  } else if (role === "pope") {
    title = "The Holy Father pronounces on the parish";
    text = state.priest.scandal < 35 ? "The parish receives a rare blessing." : "The priest receives a grave personal rebuke.";
  }
  addChronicle(state, title, text, "change", {
    type: "authority_judgment",
    parentId: parentEventId,
    actorId: person.id,
    targetId: "priest",
    facts: { role }
  });
  return state.chronicle[0].eventId;
}

export function validateDeparturePlan(state, plan, candidates = departureCandidates(state)) {
  const visit = state.currentVisit;
  if (!visit) return { summary: "", steps: [] };
  const candidateMap = new Map(candidates.filter((person) => person?.active).map((person) => [person.id, person]));
  candidateMap.set("priest", state.priest);
  const rawSteps = Array.isArray(plan?.steps) ? plan.steps : [];
  if (rawSteps.length < 1 || rawSteps.length > 3) {
    return {
      summary: completeGeneratedText(
        plan?.summary || `${candidateMap.get(visit.personId)?.name || "The visitor"} acted after the hour's counsel.`,
        400
      ),
      steps: [],
      complete: false,
      fullyAccepted: false,
      rejection: {
        stepIndex: 0,
        gate: "chain_length",
        detail: "A departure chain must contain one to three steps."
      }
    };
  }
  const steps = [];
  let rejection = null;
  const reject = (index, raw, gate, detail) => {
    rejection = {
      stepIndex: index,
      actionType: typeof raw?.actionType === "string" ? raw.actionType : null,
      actorId: typeof raw?.actorId === "string" ? raw.actorId : null,
      targetId: typeof raw?.targetId === "string" ? raw.targetId : null,
      gate,
      detail
    };
  };
  let rootCount = 0;
  const maximumIntensity = maximumIntensityForLicense(visit.eventLicense);
  const reservedRelationshipParticipants = new Set();
  const resourceReservations = new Map();
  const reservationFor = (householdId) => {
    if (!resourceReservations.has(householdId)) {
      resourceReservations.set(householdId, { wealth: 0, food: 0, church: {} });
    }
    return resourceReservations.get(householdId);
  };
  const relationshipChangingActions = new Set(["court", "marry", "separate", "conceive_child", "adopt_child"]);
  for (let index = 0; index < rawSteps.length; index += 1) {
    const raw = rawSteps[index] || {};
    const actor = candidateMap.get(raw.actorId);
    const target = raw.targetId == null ? null : candidateMap.get(raw.targetId);
    const requestedIntensity = Number(raw.intensity);
    const actorHousehold = state.households.find((entry) => entry.id === actor?.householdId);
    const reservedResources = reservationFor(actor?.householdId || `none-${index}`);
    const availableWealth = (actorHousehold?.wealth || 0) - reservedResources.wealth;
    const availableFood = (actorHousehold?.food || 0) - reservedResources.food;
    const parentStepIndex = raw.parentStepIndex === undefined
      ? (index === 0 ? null : index - 1)
      : raw.parentStepIndex;
    if (parentStepIndex != null
      && (!Number.isInteger(parentStepIndex) || parentStepIndex < 0 || parentStepIndex >= index)) {
      reject(index, raw, "graph_parent", "A response step must reference a prior step.");
      break;
    }
    const expectedActorId = parentStepIndex == null
      ? visit.personId
      : steps[parentStepIndex]?.targetId;
    if (!actor || !expectedActorId || actor.id !== expectedActorId) {
      reject(index, raw, "causal_actor", `Expected actor ${expectedActorId || "from a valid prior target"}.`);
      break;
    }
    if (parentStepIndex == null) {
      rootCount += 1;
      if (rootCount > 3) {
        reject(index, raw, "graph_roots", "A departure graph may contain at most three visitor roots.");
        break;
      }
    }
    if (relationshipChangingActions.has(raw.actionType)
      && (reservedRelationshipParticipants.has(actor.id) || (target && reservedRelationshipParticipants.has(target.id)))) {
      reject(index, raw, "relationship_conflict", "A participant was already used by an incompatible relationship-changing step.");
      break;
    }
    if (!AI_ALLOWED_ACTIONS.includes(raw.actionType)) {
      reject(index, raw, "action_enum", "The action type is not allowed.");
      break;
    }
    const customEffects = normalizeCustomEffects(raw.effects, Boolean(target && target.id !== "priest"));
    if (customEffects == null || (raw.actionType !== "improvise" && customEffects.length)) {
      reject(index, raw, "custom_effects", "Custom effects must be bounded, unique, and attached only to an improvised action.");
      break;
    }
    if (raw.actionType === "secure_clean_water") {
      const waterContext = `${raw.title || ""} ${raw.description || ""} ${raw.detail || ""}`.toLowerCase();
      if (!String(visit.issue.scenarioId || "").includes("contaminated_well")
        || !/\b(?:water|well|spring)\b/.test(waterContext)
        || !/\b(?:carry|carried|secure|arrange|transport|organize|warn)\w*\b/.test(waterContext)) {
        reject(index, raw, "water_context", "Securing clean water requires a contaminated-well issue and a concrete water action.");
        break;
      }
    }
    if (raw.composition != null) {
      const composition = raw.composition;
      if (!composition || typeof composition !== "object"
        || !Array.isArray(composition.targetIds) || composition.targetIds.length > 2
        || !Array.isArray(composition.evidenceTurnIds) || composition.evidenceTurnIds.length > 5
        || String(composition.domain || "").length > 40
        || String(composition.verb || "").length > 40
        || String(composition.objectType || "").length > 60
        || String(composition.method || "").length > 80
        || String(composition.condition || "").length > 120) {
        reject(index, raw, "composition_bounds", "The compositional action exceeds its hard component limits.");
        break;
      }
    }
    if (target?.id === "priest" && !PRIEST_TARGET_ACTIONS.has(raw.actionType)) {
      reject(index, raw, "priest_target", "This action cannot target the priest.");
      break;
    }
    if (target?.id !== "priest" && PRIEST_TARGET_ACTIONS.has(raw.actionType) && raw.actionType !== "donate") {
      reject(index, raw, "priest_target", "This action requires the priest as its target.");
      break;
    }
    if (raw.targetId != null && (!target || target.id === actor.id)) {
      reject(index, raw, "target_identity", "The target is missing or is the actor.");
      break;
    }
    const carriesPriestSummons = raw.actionType === "visit" && state.eventQueue.some((event) => (
      event.type === "priest_summons"
      && event.sourcePersonId === target?.id
      && event.dueDay > state.calendar.absoluteDay
    ));
    const thread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
    const storyRelevantTarget = target && (
      thread?.subjectIds.includes(target.id)
      || visit.history.some((line) => line.text.toLowerCase().includes(target.name.toLowerCase()))
    );
    if (target && target.id !== "priest" && !actor.relationshipIds.includes(target.id)
      && !carriesPriestSummons && !storyRelevantTarget) {
      reject(index, raw, "target_graph", "The actor has no established path to the target.");
      break;
    }
    if (TARGET_REQUIRED_ACTIONS.has(raw.actionType) && !target) {
      reject(index, raw, "target_required", "This action requires a target.");
      break;
    }
    if (!TARGET_REQUIRED_ACTIONS.has(raw.actionType) && target
      && !["donate", "improvise", "steal", "vandalize"].includes(raw.actionType)) {
      reject(index, raw, "target_forbidden", "This action must not have a target.");
      break;
    }
    if (!hasPhaseZeroCapability(actor, raw.actionType)) {
      reject(index, raw, "capability", "The actor lacks the required occupation or capability.");
      break;
    }
    const detail = String(
      raw.detail || (["change_job", "offer_work"].includes(raw.actionType) ? "laborer" : "")
    ).trim().slice(0, 120);
    if (raw.actionType === "improvise" && detail.length < 3) {
      reject(index, raw, "detail_required", "An improvised action requires a concrete detail.");
      break;
    }
    if (raw.actionType === "improvise"
      && /\b(?:electricity|pistol|rifle|telephone|radio|engine|automobile|airplane|pope|king)\b/i.test(
        `${detail} ${raw.title || ""} ${raw.description || ""}`
      )) {
      reject(index, raw, "historical_plausibility", "The improvised action contains impossible technology or unsupported supreme authority.");
      break;
    }
    if (!hasLifeCourseEligibility(state, visit, actor, target, raw.actionType, detail)) {
      reject(index, raw, "eligibility", "The action violates a life-course, consent, authority, or event-license rule.");
      break;
    }
    if (counselContradictsAction(visit, raw.actionType)) {
      reject(index, raw, "contradiction", "The latest relevant counsel contradicts this action.");
      break;
    }
    const resolvedDecisionScore = decisionScore(state, visit, actor, target, raw.actionType);
    if (resolvedDecisionScore < requiredDecisionScore(raw.actionType)) {
      reject(index, raw, "decision_score", `Decision score ${resolvedDecisionScore} is below ${requiredDecisionScore(raw.actionType)}.`);
      break;
    }
    const maximumStepIntensity = raw.actionType === "improvise" ? Math.min(2, maximumIntensity) : maximumIntensity;
    if (!Number.isInteger(requestedIntensity) || requestedIntensity < 1 || requestedIntensity > maximumStepIntensity) {
      reject(index, raw, "intensity", `Intensity must be between 1 and ${maximumStepIntensity}.`);
      break;
    }
    if (["repair", "build"].includes(raw.actionType)) {
      if (!actorHousehold || availableWealth < requestedIntensity * 2 || availableFood < requestedIntensity) {
        reject(index, raw, "affordability", "The household cannot afford the building action.");
        break;
      }
    }
    if (raw.actionType === "prepare_evacuation"
      && (!actorHousehold || availableWealth < requestedIntensity || availableFood < requestedIntensity)) {
      reject(index, raw, "affordability", "The household lacks the means to prepare supplies for rapid departure.");
      break;
    }
    if (raw.actionType === "organize_defense"
      && (!actorHousehold || availableWealth < requestedIntensity * 2 || availableFood < requestedIntensity)) {
      reject(index, raw, "affordability", "The household cannot support even a limited defensive watch.");
      break;
    }
    if (["buy_property", "sell_property", "lease_property"].includes(raw.actionType)) {
      const household = state.households.find((entry) => entry.id === actor.householdId);
      if (!household) {
        reject(index, raw, "property", "The actor has no household for a property transaction.");
        break;
      }
      if (raw.actionType === "buy_property" && availableWealth < requestedIntensity * 5) {
        reject(index, raw, "affordability", "The household cannot afford the property purchase.");
        break;
      }
      if (raw.actionType === "sell_property" && !household.properties.some((property) => property.status === "owned")) {
        reject(index, raw, "property", "The household owns no property that can be sold.");
        break;
      }
      if (raw.actionType === "lease_property" && availableWealth < requestedIntensity * 2) {
        reject(index, raw, "affordability", "The household cannot afford the lease.");
        break;
      }
    }
    if (["share_food", "lend_money", "donate", "lower_prices", "organize_aid"].includes(raw.actionType)) {
      const occupied = state.households.filter((household) => household.memberIds.some((id) => {
        const person = state.residents.find((resident) => resident.id === id);
        return person?.active && person.alive;
      }));
      const source = actorHousehold;
      const destination = target && target.id !== "priest"
        ? state.households.find((household) => household.id === target.householdId)
        : null;
      if (raw.actionType === "share_food"
        && (!source || !destination || !occupied.includes(destination)
          || source.id === destination.id || availableFood < requestedIntensity * 2)) {
        reject(index, raw, "affordability", "The food transfer is impossible or unfunded.");
        break;
      }
      if (raw.actionType === "lend_money"
        && (!source || !destination || !occupied.includes(destination)
          || source.id === destination.id || availableWealth < requestedIntensity * 2)) {
        reject(index, raw, "affordability", "The loan is impossible or unfunded.");
        break;
      }
      if (raw.actionType === "donate"
        && target?.id === "priest") {
        const donation = parseChurchDonationDetail(detail, requestedIntensity * 2);
        const available = churchDonationCapacity(state, actor, donation.resource)
          - (reservedResources.church[donation.resource] || 0);
        if (!source || available < donation.amount) {
          reject(index, raw, "affordability", "The church donation exceeds available household resources.");
          break;
        }
      } else if (raw.actionType === "donate"
        && (!source || availableWealth < requestedIntensity * 2
          || (destination && (!occupied.includes(destination) || destination.id === source.id))
          || !(destination || occupied.some((household) => household.id !== source.id)))) {
        reject(index, raw, "affordability", "The donation is impossible or unfunded.");
        break;
      }
      if (raw.actionType === "lower_prices" && (!source || availableWealth < requestedIntensity)) {
        reject(index, raw, "affordability", "The actor cannot afford to subsidize lower prices.");
        break;
      }
      if (raw.actionType === "organize_aid"
        && (!source || (availableFood < requestedIntensity * 2 && availableWealth < requestedIntensity)
          || !occupied.some((household) => household.id !== source.id))) {
        reject(index, raw, "affordability", "The aid effort lacks resources or recipients.");
        break;
      }
    }
    if (["repair", "build"].includes(raw.actionType)) {
      reservedResources.wealth += requestedIntensity * 2;
      reservedResources.food += requestedIntensity;
    } else if (raw.actionType === "buy_property") {
      reservedResources.wealth += requestedIntensity * 5;
    } else if (raw.actionType === "lease_property") {
      reservedResources.wealth += requestedIntensity * 2;
    } else if (raw.actionType === "share_food") {
      reservedResources.food += requestedIntensity * 2;
    } else if (["lend_money", "lower_prices"].includes(raw.actionType)) {
      reservedResources.wealth += raw.actionType === "lend_money" ? requestedIntensity * 2 : requestedIntensity;
    } else if (raw.actionType === "donate" && target?.id === "priest") {
      const donation = parseChurchDonationDetail(detail, requestedIntensity * 2);
      reservedResources.church[donation.resource] = (reservedResources.church[donation.resource] || 0) + donation.amount;
    } else if (raw.actionType === "donate") {
      reservedResources.wealth += requestedIntensity * 2;
    } else if (raw.actionType === "organize_aid") {
      reservedResources.food += requestedIntensity * 2;
      reservedResources.wealth += requestedIntensity;
    } else if (raw.actionType === "prepare_evacuation") {
      reservedResources.wealth += requestedIntensity;
      reservedResources.food += requestedIntensity;
    } else if (raw.actionType === "organize_defense") {
      reservedResources.wealth += requestedIntensity * 2;
      reservedResources.food += requestedIntensity;
    }
    steps.push({
      depth: parentStepIndex == null ? 1 : (steps[parentStepIndex]?.depth || 0) + 1,
      parentStepIndex,
      actorId: actor.id,
      targetId: target?.id ?? null,
      actionType: raw.actionType,
      intensity: requestedIntensity,
      title: completeGeneratedText(
        ["improvise", "secure_clean_water", "verify_route", "prepare_evacuation", "organize_defense"].includes(raw.actionType) && raw.title
          ? raw.title
          : raw.actionType.replaceAll("_", " "),
        100
      ),
      description: completeGeneratedText(
        ["improvise", "secure_clean_water", "verify_route", "prepare_evacuation", "organize_defense"].includes(raw.actionType) && raw.description
          ? raw.description
          : `${actor.name} chose to ${raw.actionType.replaceAll("_", " ")}${target ? ` in dealing with ${target.name}` : ""}.`,
        400
      ),
      detail: ["change_job", "offer_work", "donate", "improvise", "secure_clean_water", "buy_property", "sell_property", "lease_property"].includes(raw.actionType) ? detail : "",
      composition: raw.composition ? JSON.parse(JSON.stringify(raw.composition)) : null,
      effects: customEffects,
      motive: typeof raw.motive === "string" ? raw.motive.slice(0, 30) : "practical",
      evidence: typeof raw.evidence === "string" ? raw.evidence.slice(0, 180) : "",
      decisionScore: resolvedDecisionScore,
      expectedCreatedResidentId: typeof raw.createdResidentId === "string" ? raw.createdResidentId : null
    });
    if (relationshipChangingActions.has(raw.actionType)) {
      reservedRelationshipParticipants.add(actor.id);
      if (target) reservedRelationshipParticipants.add(target.id);
    }
  }
  const fullyAccepted = steps.length === rawSteps.length;
  return {
    summary: `${candidateMap.get(visit.personId)?.name || "The visitor"} acted after the hour's counsel.`,
    steps,
    complete: steps.length > 0,
    fullyAccepted,
    rejection
  };
}

export function actionFromComposition(raw) {
  const composition = raw?.composition;
  if (!composition || typeof composition !== "object") return { ...raw };
  const step = { ...raw, composition: JSON.parse(JSON.stringify(composition)) };
  const domain = String(composition.domain || "").toLowerCase();
  const verb = String(composition.verb || "").toLowerCase();
  const objectType = String(composition.objectType || "").toLowerCase();
  const targetId = Array.isArray(composition.targetIds) ? composition.targetIds[0] || step.targetId : step.targetId;
  const map = {
    "work:quit": "quit_job",
    "work:change": "change_job",
    "work:start": "change_job",
    "work:join": "change_job",
    "work:help": "offer_work",
    "property:buy": "buy_property",
    "property:sell": "sell_property",
    "property:lease": "lease_property",
    "resource:donate": "donate",
    "resource:share": "share_food",
    "building:repair": "repair",
    "family:marry": "marry",
    "family:separate": "separate",
    "law:appeal": "report_crime",
    "law:testify": "testify",
    "communication:summon": "visit",
    "communication:visit": "visit",
    "migration:leave": "leave_village",
    "migration:move": "move_household",
    "migration:prepare": "prepare_evacuation",
    "travel:scout": "verify_route",
    "travel:verify": "verify_route",
    "defense:organize": "organize_defense",
    "defense:prepare": "organize_defense",
    "violence:threaten": "threaten",
    "violence:attack": "assault",
    "violence:kill": "kill_person",
    "crime:steal": "steal",
    "crime:vandalize": "vandalize",
    "faith:pray": "pray_with",
    "faith:attend": "attend_church"
  };
  const mapped = map[`${domain}:${verb}`];
  if (mapped) step.actionType = mapped;
  if (targetId) step.targetId = targetId;
  if (["change_job", "offer_work"].includes(step.actionType) && objectType) step.detail = objectType;
  if (["buy_property", "sell_property", "lease_property"].includes(step.actionType)) {
    step.detail = objectType || "cottage";
  }
  if (step.actionType === "donate" && composition.resourceType) {
    step.detail = `${composition.resourceType}:${composition.quantity || 1}`;
  }
  return step;
}

function normalizeAiDeparturePlan(state, plan) {
  const visit = state.currentVisit;
  const actor = state.residents.find((resident) => resident.id === visit?.personId);
  const thread = state.issueThreads.find((entry) => entry.id === visit?.issue.threadId);
  const safeAutoTargetActions = new Set([
    "comfort", "advise", "apologize", "forgive", "reconcile", "pray_with", "share_food",
    "lend_money", "shelter", "teach", "heal", "nurse", "hire", "accuse", "gossip",
    "reveal_secret", "return_stolen_goods", "report_crime", "make_peace", "testify",
    "visit", "write_letter", "protect", "offer_work", "refuse_work"
  ]);
  const candidateIds = [
    visit?.issue.relatedPersonId,
    ...(thread?.subjectIds || []),
    ...(actor?.relationshipIds || [])
  ].filter((personId, index, values) => (
    personId && personId !== actor?.id && values.indexOf(personId) === index
      && state.residents.some((resident) => resident.id === personId && resident.active && resident.alive)
  ));
  const normalizations = [];
  const maximumIntensity = maximumIntensityForLicense(visit?.eventLicense);
  const steps = (Array.isArray(plan?.steps) ? plan.steps : []).map((raw, index) => {
    const step = actionFromComposition(raw);
    const actionText = `${step.title || ""} ${step.description || ""} ${step.detail || ""}`.toLowerCase();
    if (step.actionType === "offer_work"
      && /\b(?:offer|give|provide|volunteer)\w*\b.*\b(?:my|her|his|their|own)?\s*(?:labor|labour|work|service|skills|assistance|help)\b/.test(actionText)) {
      normalizations.push({
        stepIndex: index,
        field: "actionType",
        from: "offer_work",
        to: "improvise",
        reason: "own_labor_not_job_offer"
      });
      step.actionType = "improvise";
      step.targetId = null;
      step.detail = step.detail || step.description || "offer personal labor";
    }
    if (step.actionType === "offer_work"
      && !/\b(?:job|employment|hire|wage|paid work|position)\b/.test(actionText)
      && /\b(?:seek|speak|ask|audit|investigate|assist|oversee|gather)\w*\b/.test(actionText)) {
      normalizations.push({
        stepIndex: index,
        field: "actionType",
        from: "offer_work",
        to: "improvise",
        reason: "assistance_not_job_offer"
      });
      step.actionType = "improvise";
      step.detail = step.detail || step.description || "offer practical assistance";
    }
    if (step.actionType === "seek_absolution"
      && !["confession", "grave conscience"].includes(visit?.issue.kind)
      && /\b(?:guidance|counsel|advice|assistance)\b/.test(actionText)) {
      normalizations.push({
        stepIndex: index,
        field: "actionType",
        from: "seek_absolution",
        to: "improvise",
        reason: "guidance_not_absolution"
      });
      step.actionType = "improvise";
      step.targetId = null;
      step.detail = step.detail || "reflect on the priest's guidance";
    }
    if (step.actionType === "pray_with"
      && /\b(?:priest|father benedict)\b/.test(actionText)) {
      normalizations.push({
        stepIndex: index,
        field: "actionType",
        from: "pray_with",
        to: "improvise",
        reason: "prayer_already_shared_with_priest"
      });
      step.actionType = "improvise";
      step.targetId = null;
      step.motive = "faithful";
      step.detail = step.detail || "leave strengthened by shared prayer";
    }
    if (step.actionType === "share_food"
      && step.targetId === "priest"
      && !/\b(?:food|bread|grain|beans|onions|fish|cheese)\b/.test(actionText)) {
      normalizations.push({
        stepIndex: index,
        field: "actionType",
        from: "share_food",
        to: "improvise",
        reason: "nonfood_offering"
      });
      step.actionType = "improvise";
      step.targetId = null;
      step.detail = step.detail || step.description || "offer a modest nonfood gift";
    }
    if (step.actionType === "leave_village"
      && /\b(?:leave|depart|return)\w*\b.*\b(?:church|priest(?:'s)? house|meeting|cottage|home)\b/.test(actionText)
      && !/\b(?:leave|depart|move away from)\w*\b.*\b(?:village|town|parish)\b/.test(actionText)) {
      normalizations.push({
        stepIndex: index,
        field: "actionType",
        from: "leave_village",
        to: "improvise",
        reason: "leave_meeting_not_village"
      });
      step.actionType = "improvise";
      step.targetId = null;
      step.detail = step.detail || "return home after counsel";
    }
    const improvisedText = `${step.title || ""} ${step.description || ""} ${step.detail || ""}`.toLowerCase();
    if (step.actionType === "improvise"
      && String(visit?.issue.scenarioId || "").includes("contaminated_well")
      && /\b(?:water|well|spring)\b/.test(improvisedText)
      && /\b(?:carry|carried|secure|arrange|transport|organize|warn)\w*\b/.test(improvisedText)) {
      normalizations.push({
        stepIndex: index,
        field: "actionType",
        from: "improvise",
        to: "secure_clean_water",
        reason: "scenario_grounded_water_action"
      });
      step.actionType = "secure_clean_water";
      if (Array.isArray(step.effects) && step.effects.length) {
        normalizations.push({
          stepIndex: index,
          field: "effects",
          from: step.effects,
          to: [],
          reason: "canonical_water_effects"
        });
        step.effects = [];
      }
    }
    if (step.actionType === "improvise"
      && /\b(?:scout|verify|check|inspect)\w*\b.*\b(?:road|route|approach)\b/.test(improvisedText)) {
      normalizations.push({
        stepIndex: index,
        field: "actionType",
        from: "improvise",
        to: "verify_route",
        reason: "canonical_route_verification"
      });
      step.actionType = "verify_route";
      step.effects = [];
    } else if (step.actionType === "improvise"
      && /\b(?:prepare|ready|pack)\w*\b.*\b(?:leave|flee|evacuat|depart)\w*\b/.test(improvisedText)) {
      normalizations.push({
        stepIndex: index,
        field: "actionType",
        from: "improvise",
        to: "prepare_evacuation",
        reason: "canonical_evacuation_preparation"
      });
      step.actionType = "prepare_evacuation";
      step.effects = [];
    } else if (step.actionType === "improvise"
      && /\b(?:prepare|organize|ready|arm)\w*\b.*\b(?:defend|defense|guard|armed|men)\b/.test(improvisedText)) {
      normalizations.push({
        stepIndex: index,
        field: "actionType",
        from: "improvise",
        to: "organize_defense",
        reason: "canonical_defense_preparation"
      });
      step.actionType = "organize_defense";
      step.effects = [];
    }
    if (step.actionType !== "improvise" && Array.isArray(step.effects) && step.effects.length) {
      normalizations.push({
        stepIndex: index,
        field: "effects",
        from: step.effects,
        to: [],
        reason: "canonical_action_effects"
      });
      step.effects = [];
    }
    if (Number.isInteger(step.intensity)) {
      const normalizedIntensity = clamp(step.intensity, 1, maximumIntensity);
      if (normalizedIntensity !== step.intensity) {
        normalizations.push({
          stepIndex: index,
          field: "intensity",
          from: step.intensity,
          to: normalizedIntensity,
          reason: "event_license"
        });
        step.intensity = normalizedIntensity;
      }
    }
    const maximumStepIntensity = step.actionType === "improvise" ? Math.min(2, maximumIntensity) : maximumIntensity;
    if (Number.isInteger(step.intensity) && step.intensity > maximumStepIntensity) {
      normalizations.push({
        stepIndex: index,
        field: "intensity",
        from: step.intensity,
        to: maximumStepIntensity,
        reason: "bounded_improvisation"
      });
      step.intensity = maximumStepIntensity;
    }
    if (!TARGET_REQUIRED_ACTIONS.has(step.actionType)
      && !["donate", "improvise", "steal", "vandalize"].includes(step.actionType)
      && step.targetId != null) {
      normalizations.push({
        stepIndex: index,
        field: "targetId",
        from: step.targetId,
        to: null,
        reason: "targetless_action"
      });
      step.targetId = null;
    } else if (TARGET_REQUIRED_ACTIONS.has(step.actionType)
      && safeAutoTargetActions.has(step.actionType)
      && (step.targetId == null || step.targetId === "priest")
      && candidateIds[0]) {
      normalizations.push({
        stepIndex: index,
        field: "targetId",
        from: step.targetId ?? null,
        to: candidateIds[0],
        reason: "story_relevant_target"
      });
      step.targetId = candidateIds[0];
    }
    if (step.actionType === "improvise") {
      if (!String(step.detail || "").trim()) {
        const derivedDetail = String(step.description || step.title || "attempt a bounded social response")
          .trim()
          .slice(0, 120);
        normalizations.push({
          stepIndex: index,
          field: "detail",
          from: "",
          to: derivedDetail,
          reason: "derive_improvised_detail"
        });
        step.detail = derivedDetail;
      }
      if (step.targetId === "priest" || step.targetId === step.actorId) {
        const normalizedTarget = candidateIds[0] || null;
        normalizations.push({
          stepIndex: index,
          field: "targetId",
          from: step.targetId,
          to: normalizedTarget,
          reason: "bounded_improvised_target"
        });
        step.targetId = normalizedTarget;
      } else if (step.targetId && !candidateIds.includes(step.targetId) && candidateIds[0]) {
        normalizations.push({
          stepIndex: index,
          field: "targetId",
          from: step.targetId,
          to: candidateIds[0],
          reason: "story_relevant_improvised_target"
        });
        step.targetId = candidateIds[0];
      }
      if (step.effects != null) {
        const salvagedEffects = salvageCustomEffects(
          step.effects,
          Boolean(step.targetId && step.targetId !== "priest")
        );
        if (JSON.stringify(salvagedEffects) !== JSON.stringify(step.effects)) {
          normalizations.push({
            stepIndex: index,
            field: "effects",
            from: step.effects,
            to: salvagedEffects,
            reason: "bounded_custom_effects"
          });
          step.effects = salvagedEffects;
        }
      }
    }
    if (safeAutoTargetActions.has(step.actionType)
      && step.targetId
      && step.targetId !== "priest"
      && !candidateIds.includes(step.targetId)
      && candidateIds[0]) {
      normalizations.push({
        stepIndex: index,
        field: "targetId",
        from: step.targetId,
        to: candidateIds[0],
        reason: "story_relevant_target"
      });
      step.targetId = candidateIds[0];
    }
    return step;
  });
  for (let index = 1; index < steps.length; index += 1) {
    if (steps[index].parentStepIndex === undefined
      && steps[index].actorId === visit?.personId
      && steps[index - 1].targetId !== visit?.personId) {
      normalizations.push({
        stepIndex: index,
        field: "parentStepIndex",
        from: "legacy_linear",
        to: null,
        reason: "parallel_visitor_root"
      });
      steps[index].parentStepIndex = null;
    }
  }
  return {
    plan: {
      summary: String(plan?.summary || "").slice(0, 400),
      steps
    },
    normalizations
  };
}

export function finishVisit(state, plan, { record = true } = {}) {
  const visit = state.currentVisit;
  if (!visit) throw new Error("There is no visit to finish");
  const person = materializeResident(state, visit.personId, true);
  const resultingEventStart = state.events.length;
  if (visit.reactionState && visit.reactionState.endReason == null) {
    visit.reactionState.endReason = "completed";
  }
  const submittedByAi = plan?.source === "ai";
  const submittedPlan = {
    summary: String(plan?.summary || "").slice(0, 400),
    steps: Array.isArray(plan?.steps) ? plan.steps.slice(0, 10) : []
  };
  const normalizedSubmission = submittedByAi
    ? normalizeAiDeparturePlan(state, submittedPlan)
    : { plan: submittedPlan, normalizations: [] };
  const acceptedRoots = acceptedProposalRootSteps(state, visit, person);
  if (submittedByAi && acceptedRoots.length >= 2) {
    const normalizedActions = normalizedSubmission.plan.steps.map((step) => step.actionType);
    const acceptedActions = acceptedRoots.map((step) => step.actionType);
    if (JSON.stringify(normalizedActions) !== JSON.stringify(acceptedActions)
      || normalizedSubmission.plan.steps.some((step) => step.parentStepIndex != null)) {
      normalizedSubmission.normalizations.push({
        stepIndex: -1,
        field: "steps",
        from: normalizedActions,
        to: acceptedActions,
        reason: "accepted_proposal_roots"
      });
      normalizedSubmission.plan.steps = acceptedRoots;
    }
  }
  const submittedValidation = validateDeparturePlan(state, normalizedSubmission.plan);
  let validated = submittedValidation;
  const acceptedAiProposal = submittedByAi && submittedValidation.complete;
  const fullyAcceptedAiProposal = acceptedAiProposal && submittedValidation.fullyAccepted;
  const rejectedProposal = submittedByAi && !submittedValidation.fullyAccepted
    ? {
      summary: submittedPlan.summary,
      submittedStepCount: submittedPlan.steps.length,
      acceptedPrefixLength: submittedValidation.steps.length,
      rejection: submittedValidation.rejection,
      steps: submittedPlan.steps
    }
    : null;
  if (!validated.complete) validated = validateDeparturePlan(state, fallbackDeparturePlan(state));
  if (!validated.complete) {
    validated = {
      summary: `${person.name} acted after the hour's counsel.`,
      complete: true,
      steps: [{
        depth: 1,
        actorId: person.id,
        targetId: null,
        actionType: "keep_silence",
        intensity: 1,
        title: "keep silence",
        description: `${person.name} chose to keep silence.`,
        detail: "",
        decisionScore: 100
      }]
    };
  }
  const resolution = fullyAcceptedAiProposal
    ? "accepted_ai"
    : acceptedAiProposal ? "accepted_ai_prefix"
      : rejectedProposal ? "fallback_after_rejection" : "fallback";
  const evaluation = {
    submittedSource: submittedByAi ? "ai" : (plan?.source || "simulation"),
    submittedStepCount: submittedPlan.steps.length,
    acceptedSubmittedStepCount: submittedValidation.steps.length,
    submittedFullyAccepted: Boolean(submittedValidation.fullyAccepted),
    submittedRejection: submittedValidation.rejection,
    normalizations: normalizedSubmission.normalizations,
    finalStepCount: validated.steps.length,
    graph: validated.steps.map((step) => ({
      parentStepIndex: step.parentStepIndex ?? null,
      actorId: step.actorId,
      targetId: step.targetId
    })),
    resolution
  };
  if (plan?.expectedEvaluation && JSON.stringify(plan.expectedEvaluation) !== JSON.stringify(evaluation)) {
    throw new Error("Replay departure evaluation mismatch");
  }
  let parentEventId = visit.originEventId;
  if (record || plan?.expectedEvaluation) {
    const evaluationEvent = appendEvent(state, {
      type: "departure_evaluation",
      parentId: visit.originEventId,
      actorId: person.id,
      targetId: null,
      facts: evaluation
    });
    parentEventId = evaluationEvent.id;
  }
  const graphRootEventId = parentEventId;
  const stepEventIds = [];
  const followupCandidates = [];
  for (let stepIndex = 0; stepIndex < validated.steps.length; stepIndex += 1) {
    const step = validated.steps[stepIndex];
    const stepParentEventId = step.parentStepIndex == null
      ? graphRootEventId
      : stepEventIds[step.parentStepIndex] || graphRootEventId;
    const result = applyAction(state, { ...step, parentEventId: stepParentEventId });
    if (result) {
      stepEventIds[stepIndex] = result.eventId;
      parentEventId = result.eventId;
      /* What one person does, another answers - a few days later, once word
         has reached them and they have had time to feel about it. This is what
         carries a conversation in the church out into households the priest
         never sees. */
      if (result.target && result.target.id !== "priest") {
        scheduleSocialAnswer(state, {
          actorId: result.target.id,
          subjectId: step.actorId,
          actionType: step.actionType,
          causeEventId: result.eventId,
          causeSummary: `what ${result.actor?.name || "someone"} did after speaking with the priest`
        });
      }
      if (result.target
        && result.target.id !== "priest"
        && !["visit", "keep_silence", "pray_with"].includes(step.actionType)) {
        followupCandidates.push({
          personId: result.target.id,
          reason: result.description,
          sourceEventId: result.eventId,
          actionType: step.actionType
        });
      }
      if (step.expectedCreatedResidentId && step.expectedCreatedResidentId !== result.createdResidentId) {
        throw new Error("Replay created resident mismatch");
      }
      if (result.createdResidentId) step.createdResidentId = result.createdResidentId;
      delete step.expectedCreatedResidentId;
      state.statistics.cascades += 1;
    }
  }
  const distinctFollowups = [...new Map(
    followupCandidates.map((candidate) => [candidate.personId, candidate])
  ).values()].slice(0, 3);
  for (const followupCandidate of distinctFollowups) {
    const rng = new SeededRng(`${state.seed}:resident-followup:${followupCandidate.sourceEventId}`);
    const urgent = ["accuse", "threaten", "assault", "kill_person", "evict", "report_crime", "reveal_secret"].includes(followupCandidate.actionType);
    if (rng.next() < (urgent ? 0.8 : 0.42)) {
      scheduleResidentFollowup(
        state,
        followupCandidate.personId,
        followupCandidate.reason,
        followupCandidate.sourceEventId
      );
    }
  }
  updateIssueThreadAfterVisit(state, visit, validated.steps);
  if (person.id.startsWith("external-")) {
    parentEventId = resolveExternalJudgment(state, person, parentEventId);
  }
  addStructuredMemory(state, person, {
    type: "outcome",
    summary: `On ${calendarLabel(state)}, ${String(validated.summary || "the hour left its mark").slice(0, 170)}`,
    emotion: visit.mood,
    confidence: 85,
    privateMemory: ["confessional", "office"].includes(visit.location) || visit.hiddenConcernDisclosed,
    sourceEventId: parentEventId
  });
  const farewellPattern = /\b(?:goodbye|farewell|go with god|god be with you|peace be with you|that will be all)\b/i;
  const agreementTurn = visit.continuity.agreements.at(-1)?.turn;
  const counselBeforeAgreement = Number.isInteger(agreementTurn)
    ? visit.history[(agreementTurn * 2) - 1]?.text
    : null;
  const importantCounsel = counselBeforeAgreement && !farewellPattern.test(counselBeforeAgreement)
    ? counselBeforeAgreement
    : [...visit.counsel]
      .map((line, index) => {
        const intents = classifyPriestSpeech(line);
        const actionable = intents.filter((intent) => !["question", "neutral"].includes(intent)).length;
        const directive = /\b(?:should|must|need to|ought to|please|go|speak|tell|ask|arrange|secure|help|report|collect|appeal|work|pray)\b/i.test(line);
        return {
          line,
          index,
          score: farewellPattern.test(line) ? -100 : actionable * 4 + (directive ? 3 : 0) + (line.endsWith("?") ? -2 : 0)
        };
      })
      .sort((left, right) => right.score - left.score || right.index - left.index)
      .find((entry) => entry.score > 0)?.line
      || "The priest listened and considered the matter.";
  const finalActions = validated.steps.map((step) => step.actionType.replaceAll("_", " ")).join(", ");
  addStructuredMemory(state, person, {
    type: "visit_summary",
    subjectId: "priest",
    summary: completeStoredText(
      `Father Benedict counseled: ${importantCounsel} Agreed next action: ${finalActions || "none"}.`,
      220
    ),
    emotion: visit.mood,
    confidence: 95,
    privateMemory: ["confessional", "office"].includes(visit.location) || visit.hiddenConcernDisclosed,
    sourceEventId: parentEventId
  });
  if (record) {
    appendCommand(state, "finish_visit", {
      plan: { summary: validated.summary, steps: validated.steps },
      submittedPlan,
      evaluation,
      rejectedProposal,
      resolution
    }, acceptedAiProposal ? "ai" : (plan?.source || "simulation") === "ai" ? "fallback" : (plan?.source || "simulation"));
  }
  const issueThread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
  archiveCompletedVisit(state, visit, {
    personName: person.name,
    visibility: issueThread?.visibility || {
      scope: ["confessional", "office"].includes(visit.location) ? "private_visit" : "public",
      authorizedPersonIds: [person.id, "priest"]
    },
    issueSummary: issueThread?.summary || visit.issue.detail,
    submittedPlan,
    acceptedPlan: { summary: validated.summary, steps: validated.steps },
    evaluation,
    resolution,
    eventIds: [
      visit.originEventId,
      ...state.events.slice(resultingEventStart).map((event) => event.id)
    ]
  });
  state.aiDiagnostics.lastCompletedVisit = {
    visitId: visit.visitId,
    day: state.calendar.absoluteDay,
    personId: person.id,
    personName: person.name,
    promptTraces: JSON.parse(JSON.stringify(visit.promptTraces.slice(-PROMPT_TRACE_LIMIT)))
  };
  if (person.id.startsWith("external-")) person.active = false;
  state.currentVisit = null;
  state.conversationHistory = [];
  state.calendar.slot += 1;
  if (state.calendar.slot >= dailyAppointmentLimit(state)) {
    const endingDay = state.calendar.absoluteDay;
    const endingWeek = state.calendar.week;
    state.calendar.slot = 0;
    state.calendar.absoluteDay += 1;
    state.calendar.dayIndex = state.calendar.absoluteDay % 7;
    state.calendar.week = Math.floor(state.calendar.absoluteDay / 7) + 1;
    addChronicle(state, `${WEEK_DAYS[state.calendar.dayIndex]} begins`, state.calendar.dayIndex === 6
      ? "The bells call the whole village toward Sunday worship."
      : "Four ordinary hours of counsel await, along with any requested or consequence-driven visits.", "neutral");
    resolvePopulationDay(state);
    finalizePeriodReports(state, { endingDay, endingWeek });
  }
  return state;
}

export function sundayAttendance(state) {
  return sundayAttendanceReport(state).filter((entry) => entry.attending).map((entry) => entry.person);
}

export function sundayAttendanceReport(state) {
  const rng = new SeededRng(`${state.seed}:attendance:${state.calendar.absoluteDay}`);
  return activeResidents(state).map((person) => {
    const reason = attendanceReason(state, person, rng.int(1, 100));
    return { person, attending: reason === "attending", reason };
  });
}

function sermonThemeDeltas(theme) {
  const map = {
    Mercy: { mercy: 4, harmony: 2 }, Repentance: { faith: 4, safety: 1 },
    Charity: { mercy: 4, health: 1, prosperity: -1 }, Duty: { prosperity: 3, safety: 1 },
    Family: { harmony: 3 }, Justice: { safety: 3, harmony: -1 }, Humility: { harmony: 2, faith: 2 },
    Hope: { health: 1, harmony: 2, faith: 1 }, Community: { harmony: 4, prosperity: 1 },
    Temperance: { health: 3, safety: 1 }, Forgiveness: { harmony: 4, mercy: 3 },
    Courage: { safety: 2, harmony: 1 }
  };
  return map[theme] || { faith: 1 };
}

export function fallbackSermonOutcome(state, theme, text) {
  const base = sermonThemeDeltas(theme);
  const conviction = Math.min(1.5, Math.max(0.55, text.trim().split(/\s+/).length / 60));
  const townDeltas = Object.fromEntries(Object.entries(base).map(([key, value]) => [key, Math.round(value * conviction)]));
  const responseTags = [theme.toLowerCase(), "reflection"];
  if (theme === "Repentance") responseTags.push("confession");
  if (theme === "Community") responseTags.push("procession");
  if (theme === "Justice" && state.priest.scandal >= 45) responseTags.push("protest");
  return {
    summary: `The sermon on ${theme.toLowerCase()} settles unevenly over the parish: some hear comfort, others a demand.`,
    townDeltas,
    responseTags,
    notableEffects: sundayAttendance(state).slice(0, 8).map((person, index) => ({
      personId: person.id,
      faithDelta: index % 3 === 0 ? 3 : 1,
      moraleDelta: theme === "Hope" || theme === "Mercy" ? 2 : 0,
      attendanceDelta: 1,
      memory: `Heard the priest preach on ${theme.toLowerCase()}.`
    }))
  };
}

export function applySermon(state, theme, text, outcome, { record = true } = {}) {
  if (state.calendar.dayIndex !== 6) throw new Error("Sermons are delivered on Sunday");
  if (!SERMON_THEMES.includes(theme)) throw new Error("Unknown sermon theme");
  const wordCount = String(text).trim().split(/\s+/).filter(Boolean).length;
  if (!wordCount || wordCount > 100) throw new Error("The sermon must contain 1 to 100 words");
  const attendees = sundayAttendance(state);
  const attendeeIds = new Set(attendees.map((person) => person.id));
  const deltas = Object.fromEntries(Object.keys(state.town.metrics).map((metric) => [
    metric,
    Math.round(clamp(outcome?.townDeltas?.[metric], -8, 8))
  ]));
  for (const metric of Object.keys(state.town.metrics)) {
    state.town.metrics[metric] = clamp(state.town.metrics[metric] + clamp(deltas[metric], -8, 8));
  }
  const themeDeltas = sermonThemeDeltas(theme);
  const attendanceIds = new Set(attendees.map((person) => person.id));
  for (const person of activeResidents(state)) {
    const heard = attendanceIds.has(person.id);
    const sensitivity = (person.materialized ? person.personality.piety : person.faith) / 100;
    if (heard) {
      person.faith = clamp(person.faith + Math.max(0, (themeDeltas.faith || 1) * sensitivity));
      person.morale = clamp(person.morale + (themeDeltas.harmony || themeDeltas.mercy || 0) * 0.25);
      addStructuredMemory(state, person, {
        type: "sermon",
        summary: `Sunday sermon: ${theme} — ${String(text).slice(0, 100)}`,
        emotion: theme === "Hope" || theme === "Mercy" ? "hopeful" : "contemplative",
        confidence: 70,
        sourceEventId: null
      });
    }
  }
  for (const effect of Array.isArray(outcome?.notableEffects) ? outcome.notableEffects : []) {
    const person = state.residents.find((resident) => resident.id === effect.personId);
    if (!person || !attendeeIds.has(person.id)) continue;
    person.faith = clamp(person.faith + clamp(effect.faithDelta, -6, 6));
    person.morale = clamp(person.morale + clamp(effect.moraleDelta, -6, 6));
    person.attendanceChance = clamp(person.attendanceChance + clamp(effect.attendanceDelta, -10, 10));
    if (effect.memory) {
      addStructuredMemory(state, person, {
        type: "sermon_reaction",
        summary: effect.memory,
        emotion: "contemplative",
        confidence: 70
      });
    }
  }
  const mechanicalSummary = `The sermon on ${theme.toLowerCase()} changed ${Object.entries(deltas)
    .filter(([, delta]) => Number(delta) !== 0)
    .map(([metric, delta]) => `${metric} ${Number(delta) > 0 ? "+" : ""}${Number(delta)}`)
    .join(", ") || "no town metric"}.`;
  state.sermons.push({
    day: state.calendar.absoluteDay,
    theme,
    text,
    attendance: attendees.length,
    summary: mechanicalSummary
  });
  /* The collection. What the parish puts in the box depends on how the priest
     asked, if he asked at all, and on what each household can genuinely bear.
     Some give on a Sunday whether or not anyone asked them to. */
  const appeal = readSermonAppeal(text);
  const offering = collectSundayOffering(state, attendees, appeal);
  if (offering.coin > 0 || offering.grain > 0) {
    const offeringEvent = appendEvent(state, {
      type: "sunday_offering",
      actorId: null,
      targetId: "priest",
      facts: {
        asked: offering.asked,
        manner: offering.manner,
        coin: offering.coin,
        grain: offering.grain,
        givers: offering.givers.length
      }
    });
    const gathered = [
      offering.coin > 0 ? `${offering.coin} ${offering.coin === 1 ? "penny" : "pennies"}` : "",
      offering.grain > 0 ? `${offering.grain} ${offering.grain === 1 ? "sack" : "sacks"} of grain` : ""
    ].filter(Boolean).join(" and ");
    const households = `${offering.givers.length} ${offering.givers.length === 1 ? "household" : "households"}`;
    addChronicle(
      state,
      offering.asked ? "The collection is taken" : "Offerings are left without asking",
      offering.asked
        ? `${households} gave after the sermon: ${gathered}.`
        : `${households} left something for the church without being asked: ${gathered}.`,
      offering.manner === "threatening" ? "danger" : "faith",
      { type: "collection_noted", parentId: offeringEvent.id, facts: { manner: offering.manner } }
    );
    if (offering.manner === "threatening") {
      state.priest.moralAuthority = clamp(state.priest.moralAuthority - 3);
      state.town.metrics.harmony = clamp(state.town.metrics.harmony - 2);
    } else if (offering.asked) {
      state.priest.localTrust = clamp(state.priest.localTrust + 1);
    }
  }
  addChronicle(state, `A sermon on ${theme}`, `${attendees.length} villagers attended. ${mechanicalSummary}`, "faith", {
    type: "sermon_delivered",
    facts: { theme, attendance: attendees.length, townDeltas: deltas }
  });
  /* The stalls go up once the parish is out of church, and what they have to
     sell is whatever the village managed to make this week. Settling it here
     means the priest sees prices that already account for everything the week
     did to the people who make things. */
  marketBoard(state, { refresh: true });
  /* And the week's ordinary social life is set going: who will call on whom,
     who will court, who will finally make peace, and who will not. */
  planWeeklySocialLife(state);
  const congregation = resolveCongregationReactions(state, theme, text, attendees, outcome);
  /* Who it actually moved, and why. This is the part of a sermon the priest
     most needs to see, so it is kept whole rather than reduced to a number. */
  const impact = resolveSermonImpact(state, theme, text, attendees, congregation.consistency, congregation.reactions);
  const aftermath = {
    day: state.calendar.absoluteDay,
    week: state.calendar.week,
    theme,
    text,
    attendance: attendees.length,
    consistency: congregation.consistency,
    force: impact.force,
    novelty: impact.novelty,
    appeal: { asked: appeal.asked, manner: appeal.manner },
    offering: {
      coin: offering.coin,
      grain: offering.grain,
      givers: offering.givers.map((giver) => ({ ...giver }))
    },
    affected: impact.affected
  };
  state.lastSermonAftermath = aftermath;
  if (impact.affected.length) {
    const moved = impact.affected.filter((entry) => entry.direction === "moved").length;
    const hardened = impact.affected.length - moved;
    appendEvent(state, {
      type: "sermon_impact",
      actorId: "priest",
      targetId: null,
      facts: {
        theme,
        moved,
        hardened,
        strongest: impact.affected.slice(0, 5).map((entry) => ({ personId: entry.personId, impact: entry.impact }))
      }
    });
  }
  const publicIntent = {
    Mercy: "forgiveness",
    Forgiveness: "forgiveness",
    Justice: "judgment",
    Duty: "work",
    Family: "family",
    Repentance: "truth"
  }[theme];
  if (publicIntent && attendees[0]) {
    for (const position of recordPriestPosition(state, null, [publicIntent], text)) {
      position.publicPosition = true;
    }
  }
  for (const event of congregation.events) {
    addChronicle(state, event.title, event.text, event.type === "sermon_protest" ? "danger" : "faith", {
      type: event.type,
      actorId: event.actorId,
      parentId: state.chronicle[0].eventId,
      facts: { sermonTheme: theme, consistency: congregation.consistency }
    });
    state.eventQueue.push({
      id: `queue-${String(state.nextQueueSequence++).padStart(6, "0")}`,
      type: "sermon_followup",
      role: null,
      reason: event.text,
      dueDay: state.calendar.absoluteDay + 1,
      sourcePersonId: event.actorId,
      sourceEventId: state.chronicle[0].eventId,
      actorId: event.actorId,
      targetId: "priest",
      payload: { eventType: event.type }
    });
  }
  if (record) {
    appendCommand(state, "deliver_sermon", {
      theme,
      text,
      outcome: {
        townDeltas: { ...deltas },
        responseTags: [...(outcome?.responseTags || [])],
        notableEffects: [...(outcome?.notableEffects || [])]
      }
    }, outcome?.source || "simulation");
  }
  const endingDay = state.calendar.absoluteDay;
  const endingWeek = state.calendar.week;
  state.calendar.absoluteDay += 1;
  state.calendar.dayIndex = state.calendar.absoluteDay % 7;
  state.calendar.week = Math.floor(state.calendar.absoluteDay / 7) + 1;
  state.calendar.slot = 0;
  resolvePopulationDay(state);
  finalizePeriodReports(state, { endingDay, endingWeek, includeWeek: true });
  return attendees.length;
}

export function calendarLabel(state) {
  const session = state.calendar.dayIndex === 6
    ? "Sunday service"
    : `Hour ${state.calendar.slot + 1} of ${dailyAppointmentLimit(state)}`;
  return `${WEEK_DAYS[state.calendar.dayIndex]}, Week ${state.calendar.week} — ${session}`;
}

export function populationCount(state) {
  return activeResidents(state).length;
}

export function knownResidents(state) {
  return state.residents.filter((person) => person.profileRevealed);
}

export function setGameMode(state, type, { record = true } = {}) {
  if (!["IN_WORLD", "META_PAUSED", "PLAYER_AUTHORING", "REWIND_PENDING"].includes(type)) {
    throw new Error("Unknown game mode");
  }
  state.mode = {
    type,
    returnVisitId: type === "IN_WORLD" ? null : state.currentVisit?.visitId || state.mode?.returnVisitId || null
  };
  if (record) appendCommand(state, "set_mode", { mode: JSON.parse(JSON.stringify(state.mode)) });
  return state.mode;
}

export function rewindLastConversationTurn(state, reason = "Player corrected the last turn") {
  if (!state.currentVisit) throw new Error("Only an active appointment can rewind a conversation turn");
  const lastCommand = state.commandLog.at(-1);
  if (lastCommand?.type !== "conversation_exchange") {
    throw new Error("There is no uncompacted conversation turn to rewind");
  }
  const remaining = state.commandLog.slice(0, -1);
  const restored = replayGame(state.seed, remaining, state.replayBase);
  const superseded = {
    commandId: lastCommand.id,
    day: lastCommand.day,
    slot: lastCommand.slot,
    playerText: lastCommand.payload.playerText,
    visitorReply: lastCommand.payload.response.reply,
    reason: String(reason).slice(0, 180)
  };
  restored.supersededTurns.push(superseded);
  restored.supersededTurns = restored.supersededTurns.slice(-20);
  appendCommand(restored, "rewind_turn", { superseded });
  return restored;
}

export function replayGame(seed, commands, replayBase = null) {
  const state = replayBase ? restoreReplayBase(replayBase) : createGame(seed);
  for (const command of commands) {
    if (command.day !== state.calendar.absoluteDay || command.slot !== state.calendar.slot) {
      throw new Error(`Replay metadata mismatch at command ${command.id}`);
    }
    if (command.type === "begin_visit") {
      const visit = beginVisit(state, { record: false });
      if (visit.personId !== command.payload.personId || visit.visitId !== command.payload.visitId) {
        throw new Error(`Replay visitor mismatch at command ${command.id}`);
      }
      if (command.payload.opening) {
        visit.issue.opening = command.payload.opening;
        visit.history[0] = { speaker: "visitor", text: command.payload.opening };
        visit.lastVisitorReplies = [command.payload.opening];
      }
    } else if (command.type === "request_visits") {
      const results = requestVisits(state, command.payload.personIds, command.payload.reason, { record: false });
      if (JSON.stringify(results) !== JSON.stringify(command.payload.results)) {
        throw new Error(`Replay requested-visit mismatch at command ${command.id}`);
      }
    } else if (command.type === "conversation_exchange") {
      const person = [...state.residents, ...state.externalActors]
        .find((resident) => resident.id === state.currentVisit?.personId);
      const preview = previewConversationReaction(state, person, state.currentVisit, command.payload.playerText);
      const expectedAudit = command.payload.response.reactionAudit;
      const deterministicAudit = {
        auditId: preview.auditId,
        turn: state.currentVisit.turnsUsed + 1,
        classification: preview.classification,
        deltas: preview.deltas,
        stateAfter: preview.nextState,
        requiredReaction: preview.requiredReaction,
        thresholdReasons: preview.thresholdReasons,
        visibility: preview.visibility
      };
      const recordedDeterministicAudit = expectedAudit ? {
        auditId: expectedAudit.auditId,
        turn: expectedAudit.turn,
        classification: expectedAudit.classification,
        deltas: expectedAudit.deltas,
        stateAfter: expectedAudit.stateAfter,
        requiredReaction: expectedAudit.requiredReaction,
        thresholdReasons: expectedAudit.thresholdReasons,
        visibility: expectedAudit.visibility
      } : null;
      if ((expectedAudit && JSON.stringify(recordedDeterministicAudit) !== JSON.stringify(deterministicAudit))
        || command.payload.response.trustDelta !== preview.persistentTrustDelta
        || command.payload.response.stressDelta !== preview.persistentStressDelta
        || command.payload.response.disclosure !== preview.disclosure
        || command.payload.response.contradictionId !== preview.contradictionId
        || command.payload.response.mood !== preview.mood
        || JSON.stringify(command.payload.response.intents) !== JSON.stringify(preview.intents)) {
        throw new Error(`Replay conversation audit mismatch at command ${command.id}`);
      }
      recordExchange(state, command.payload.playerText, {
        ...command.payload.response,
        source: command.source
      }, { record: false });
    } else if (command.type === "finish_visit") {
      finishVisit(state, {
        ...(command.payload.submittedPlan || command.payload.plan),
        source: command.payload.evaluation?.submittedSource || command.source,
        expectedEvaluation: command.payload.evaluation || null
      }, { record: false });
    } else if (command.type === "deliver_sermon") {
      const attendees = sundayAttendance(state);
      const validatedOutcome = validateSermonResponse(
        command.payload.outcome,
        attendees.map((person) => person.id)
      );
      applySermon(state, command.payload.theme, command.payload.text, {
        ...validatedOutcome,
        source: command.source
      }, { record: false });
    } else if (command.type === "send_letter") {
      sendLetter(state, command.payload, { record: false });
    } else if (command.type === "summon_officer") {
      summonOfficer(state, command.payload, { record: false });
    } else if (command.type === "petition_authority") {
      petitionAuthority(state, command.payload, { record: false });
    } else if (command.type === "buy_at_market") {
      buyAtMarket(state, command.payload.purchases, { record: false });
    } else if (command.type === "set_mode") {
      setGameMode(state, command.payload.mode.type, { record: false });
      state.mode.returnVisitId = command.payload.mode.returnVisitId;
    } else if (command.type === "rewind_turn") {
      state.supersededTurns.push(JSON.parse(JSON.stringify(command.payload.superseded)));
      state.supersededTurns = state.supersededTurns.slice(-20);
    } else {
      throw new Error(`Unknown replay command: ${command.type}`);
    }
  }
  state.commandLog = JSON.parse(JSON.stringify(commands));
  state.nextCommandSequence = commands.length + 1;
  state.aiProposals = commands
    .filter((command) => command.source === "ai")
    .map((command, index) => ({
      id: `proposal-${String(index + 1).padStart(6, "0")}`,
      commandId: command.id
    }));
  state.replayBase = replayBase ? JSON.parse(JSON.stringify(replayBase)) : null;
  return state;
}

registerReplayVerifier(replayGame);
