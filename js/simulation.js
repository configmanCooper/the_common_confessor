import {
  ACTION_TYPES,
  AI_ALLOWED_ACTIONS,
  BACKSTORY_PARTS,
  buildFirstNameBank,
  buildSurnameBank,
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
import { validateSermonResponse } from "./ai.js";
import {
  addStructuredMemory,
  classifyPriestSpeech,
  createVisitIntent,
  detectConfidentialityBreach,
  recordPriestPosition,
  recordPromise,
  resolvePriestSpeech
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
      const age = rng.int(14, 82);
      residents.push({
        id: `person-${String(residentIndex + 1).padStart(3, "0")}`,
        name: `${firstName} ${surname}`,
        firstName,
        surname,
        sex,
        age,
        householdId,
        occupation: age < 16 ? "child laborer" : rng.pick(OCCUPATIONS),
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
        health: rng.int(50, 90),
        stress: rng.int(25, 68),
        reputation: rng.int(40, 62),
        relationshipIds: [],
        memories: [],
        flags: []
      });
      residentIndex += 1;
    }
  }

  for (const resident of residents) {
    const household = residents.filter((other) => other.householdId === resident.householdId && other.id !== resident.id);
    const nearby = residents.filter((other) => other.id !== resident.id && Math.abs(Number(other.id.slice(-3)) - Number(resident.id.slice(-3))) < 12);
    resident.relationshipIds = rng.shuffle([...new Set([...household, ...nearby])]).slice(0, rng.int(3, 7)).map((person) => person.id);
  }
  return residents;
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
    replayBase: null,
    sermons: [],
    conversationHistory: [],
    settings: { aiEnabled: true },
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
  upgradePopulationState(state);
  state.priest.positions = [];
  state.priest.confidentialityBreaches = [];
  addChronicle(state, `A new cure begins in ${town.name}`, town.description, "neutral", {
    type: "world_started",
    parentId: null,
    facts: { population: 200, town: town.name }
  });
  addChronicle(state, "The parish register opens", "Exactly 200 living villagers are entered by name. Their inward lives remain unknown until events draw them into the parish story.", "faith");
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
  const person = state.residents.find((resident) => resident.id === personId);
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
  return activeResidents(state).filter((person) => person.age >= 12);
}

function issueForPerson(state, person) {
  const rng = new SeededRng(`${state.seed}:${state.calendar.absoluteDay}:${state.calendar.slot}:${person.id}`);
  const issue = { ...rng.pick(ISSUE_TEMPLATES) };
  const knownRelations = person.relationshipIds
    .map((id) => state.residents.find((resident) => resident.id === id))
    .filter(Boolean);
  const relation = knownRelations.length ? rng.pick(knownRelations) : null;
  issue.relatedPersonId = relation?.id ?? null;
  issue.relatedName = relation?.name ?? "someone in the village";
  issue.detail = person.privatePressure;
  return issue;
}

export function beginVisit(state, { record = true } = {}) {
  if (state.calendar.dayIndex === 6) {
    throw new Error("Sunday is reserved for the parish service");
  }
  if (state.currentVisit) {
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
    hiddenConcernDisclosed: false,
    eventLicense: eventRoll < 0.01 ? "outrageous" : eventRoll < 0.08 ? "comic" : "ordinary"
  };
  if (issue.kind === "confession") {
    state.statistics.confessions += 1;
  }
  if (record) {
    appendCommand(state, "begin_visit", { personId: person.id, visitId: state.currentVisit.visitId });
  }
  return state.currentVisit;
}

export function recordExchange(state, playerText, response, { record = true } = {}) {
  const visit = state.currentVisit;
  if (!visit) {
    throw new Error("There is no visitor in the church");
  }
  if (visit.turnsUsed >= visit.maxTurns) {
    throw new Error("The hour is already spent");
  }
  const person = materializeResident(state, visit.personId, true);
  const cleanText = String(playerText).trim().slice(0, 600);
  if (!cleanText) {
    throw new Error("Counsel cannot be empty");
  }
  const reply = String(response.reply || response.say || "").trim().slice(0, 600);
  if (!reply) {
    throw new Error("The visitor gave no response");
  }
  const resolution = resolvePriestSpeech(state, person, visit, cleanText);
  visit.turnsUsed += 1;
  visit.history.push({ speaker: "priest", text: cleanText });
  visit.history.push({ speaker: "visitor", text: reply });
  visit.counsel.push(cleanText);
  visit.mood = resolution.mood;
  visit.disclosure = resolution.disclosure;
  if (resolution.disclosed) {
    visit.hiddenConcernDisclosed = true;
    visit.history.push({ speaker: "visitor", text: `There is more: ${visit.intent.hiddenConcern}.` });
    addStructuredMemory(state, person, {
      type: "disclosed_secret",
      summary: visit.intent.hiddenConcern,
      emotion: "ashamed",
      confidence: 100,
      privateMemory: true,
      sourceEventId: visit.originEventId
    });
  }
  person.trustPriest = clamp(person.trustPriest + resolution.trustDelta, 0, 100);
  person.stress = clamp(person.stress + resolution.stressDelta, 0, 100);
  addStructuredMemory(state, person, {
    summary: response.memory || `The priest said: ${cleanText.slice(0, 130)}`,
    emotion: resolution.mood,
    confidence: 75,
    privateMemory: ["confessional", "office"].includes(visit.location)
      || visit.hiddenConcernDisclosed
      || resolution.disclosed,
    sourceEventId: visit.originEventId
  });
  if (resolution.intents.includes("promise")) recordPromise(state, person.id, cleanText);
  recordPriestPosition(state, person.id, resolution.intents, cleanText);
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
        mood: resolution.mood,
        trustDelta: resolution.trustDelta,
        stressDelta: resolution.stressDelta,
        memory: String(response.memory || "").slice(0, 180),
        intents: resolution.intents,
        disclosure: resolution.disclosure,
        contradictionId: resolution.contradictionId
      }
    }, response.source || "simulation");
  }
  return visit;
}

export function fallbackConversation(state, playerText) {
  const visit = state.currentVisit;
  const person = materializeResident(state, visit.personId, true);
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
    text: String(text).slice(0, 700),
    tone
  });
  state.chronicle = state.chronicle.slice(0, 250);
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
    offer_work: { prosperity: 2 }
  };
  const negative = {
    shirk_work: { prosperity: -2 }, quit_job: { prosperity: -1 }, raise_prices: { prosperity: -1, harmony: -1 },
    neglect: { health: -1, safety: -1 }, divorce: { harmony: -2 }, leave_village: { prosperity: -1 },
    expel: { harmony: -2, mercy: -2 }, accuse: { harmony: -2 }, gossip: { harmony: -2 },
    reveal_secret: { harmony: -2 }, steal: { safety: -3, harmony: -1 }, vandalize: { safety: -3 },
    threaten: { safety: -2, harmony: -1 }, assault: { safety: -4, health: -2 }, begin_feud: { harmony: -4, safety: -3 },
    drink: { health: -1 }, gamble: { prosperity: -1 }, relapse: { faith: -1 }, evict: { mercy: -2 },
    protest: { harmony: -1 }, avoid_church: { faith: -1 }, betray: { harmony: -4 }
  };
  return positive[actionType] || negative[actionType] || {};
}

export function applyAction(state, step) {
  if (!ACTION_TYPES.includes(step.actionType)) {
    return null;
  }
  const actor = materializeResident(state, step.actorId, false);
  const target = step.targetId ? materializeResident(state, step.targetId, false) : null;
  const intensity = clamp(step.intensity || 2, 1, 5);
  let createdResident = null;
  let createdResidentType = null;
  const deltas = metricDeltaForAction(step.actionType);
  for (const [metric, delta] of Object.entries(deltas)) {
    state.town.metrics[metric] = clamp(state.town.metrics[metric] + delta * (intensity / 2));
  }
  actor.morale = clamp(actor.morale + (deltas.harmony || deltas.mercy || 0));
  actor.stress = clamp(actor.stress - (deltas.mercy || 0) + Math.max(0, -(deltas.harmony || 0)));
  if (target) {
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
      facts: { actionType: step.actionType, intensity }
    }
  );
  const eventId = state.chronicle[0].eventId;
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
  if (target) {
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
  }
  return {
    actor,
    target,
    description,
    eventId: consequenceEventId,
    createdResidentId: createdResident?.id || null
  };
}

export function fallbackDeparturePlan(state) {
  const visit = state.currentVisit;
  const person = materializeResident(state, visit.personId, true);
  const combined = visit.counsel.join(". ").toLowerCase();
  const latestIntent = (intent, pattern) => {
    const latest = [...visit.counsel].reverse().find((entry) => pattern.test(entry.toLowerCase()));
    return Boolean(latest && classifyPriestSpeech(latest).includes(intent));
  };
  let actionType = "keep_silence";
  if (latestIntent("apology", /\b(?:apologize|make amends|say sorry)\b/)) actionType = "apologize";
  else if (latestIntent("forgiveness", /\b(?:forgiv\w*|pardon|mercy|make amends)\b/)) actionType = "forgive";
  else if (latestIntent("truth", /\b(?:truth|confess|admit|honest)\b/)) actionType = "seek_absolution";
  else if (latestIntent("work", /\b(?:work|job|trade|labor|duty)\b/)) actionType = "work_harder";
  else if (latestIntent("prayer", /\b(?:pray\w*|faith|scripture|grace)\b/)) actionType = "pray_with";
  else if (latestIntent("report", /\b(?:report|reeve|justice)\b/)) actionType = "report_crime";
  else if (latestIntent("charity", /\b(?:help|charity|give|share|food|alms)\b/)) actionType = "share_food";
  const relationIds = person.relationshipIds.filter((id) => state.residents.some((resident) => resident.id === id && resident.active));
  const targetId = TARGET_REQUIRED_ACTIONS.has(actionType) ? (relationIds[0] || null) : null;
  const steps = [{
    depth: 1,
    actorId: person.id,
    targetId,
    actionType,
    intensity: Math.min(visit.issue.gravity, maximumIntensityForLicense(visit.eventLicense)),
    title: `${person.name} acts on the priest's counsel`,
    description: `${person.name} leaves the church and chooses to ${actionType.replaceAll("_", " ")}${targetId ? ` in dealing with ${state.residents.find((resident) => resident.id === targetId).name}` : ""}.`
  }];
  if (targetId && ["forgive", "apologize", "share_food", "report_crime"].includes(actionType)) {
    const target = materializeResident(state, targetId, false);
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

export function departureCandidates(state) {
  const person = materializeResident(state, state.currentVisit.personId, true);
  const first = person.relationshipIds.map((id) => state.residents.find((resident) => resident.id === id)).filter((resident) => resident?.active);
  const second = first.flatMap((resident) => resident.relationshipIds)
    .map((id) => state.residents.find((resident) => resident.id === id))
    .filter((resident) => resident?.active);
  return [...new Map([person, ...first, ...second].map((resident) => [resident.id, resident])).values()].slice(0, 18);
}

const TARGET_REQUIRED_ACTIONS = new Set([
  "comfort", "advise", "apologize", "forgive", "reconcile", "pray_with", "share_food",
  "lend_money", "shelter", "teach", "heal", "nurse", "hire", "accuse", "gossip",
  "reveal_secret", "return_stolen_goods", "report_crime", "make_peace", "testify",
  "visit", "write_letter", "protect", "offer_work", "refuse_work", "court", "marry",
  "separate", "conceive_child", "adopt_child"
]);

const HEALING_OCCUPATIONS = new Set(["healer", "herbalist", "midwife"]);
const BUILDING_OCCUPATIONS = new Set(["blacksmith", "carpenter", "mason", "thatcher", "laborer"]);
const HIRING_OCCUPATIONS = new Set(["reeve", "bailiff", "merchant", "innkeeper", "miller", "farmer"]);

function hasPhaseZeroCapability(actor, actionType) {
  if (actionType === "heal") return HEALING_OCCUPATIONS.has(actor.occupation);
  if (actionType === "build" || actionType === "repair") return BUILDING_OCCUPATIONS.has(actor.occupation);
  if (actionType === "hire" || actionType === "offer_work") return HIRING_OCCUPATIONS.has(actor.occupation);
  return true;
}

function hasLifeCourseEligibility(state, visit, actor, target, actionType, detail) {
  const counsel = visit.counsel.join(". ").toLowerCase();
  const household = state.households.find((entry) => entry.id === actor.householdId);
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
  return !classifyPriestSpeech(latestRelevant).includes(intent);
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
  if (["heal", "nurse"].includes(actionType) && target) {
    score += Math.max(0, 70 - target.health) * 0.25;
    if (target.illness) score += 8;
    score += (personality.empathy - 50) * 0.18;
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
  if (["marry", "conceive_child", "adopt_child", "leave_village"].includes(actionType)) return 55;
  if (["court", "separate", "change_job", "invite_migrant"].includes(actionType)) return 45;
  return 25;
}

export function validateDeparturePlan(state, plan, candidates = departureCandidates(state)) {
  const visit = state.currentVisit;
  if (!visit) return { summary: "", steps: [] };
  const candidateMap = new Map(candidates.filter((person) => person?.active).map((person) => [person.id, person]));
  const rawSteps = Array.isArray(plan?.steps) ? plan.steps : [];
  if (rawSteps.length < 1 || rawSteps.length > 3) {
    return {
      summary: `${candidateMap.get(visit.personId)?.name || "The visitor"} acted after the hour's counsel.`,
      steps: [],
      complete: false
    };
  }
  const steps = [];
  let expectedActorId = visit.personId;
  const maximumIntensity = maximumIntensityForLicense(visit.eventLicense);
  const reservedRelationshipParticipants = new Set();
  const relationshipChangingActions = new Set(["court", "marry", "separate", "conceive_child", "adopt_child"]);
  for (let index = 0; index < rawSteps.length; index += 1) {
    const raw = rawSteps[index] || {};
    const actor = candidateMap.get(raw.actorId);
    const target = raw.targetId == null ? null : candidateMap.get(raw.targetId);
    const requestedIntensity = Number(raw.intensity);
    if (!actor || actor.id !== expectedActorId) break;
    if (relationshipChangingActions.has(raw.actionType)
      && (reservedRelationshipParticipants.has(actor.id) || (target && reservedRelationshipParticipants.has(target.id)))) {
      break;
    }
    if (!AI_ALLOWED_ACTIONS.includes(raw.actionType)) break;
    if (raw.targetId != null && (!target || target.id === actor.id)) break;
    if (target && !actor.relationshipIds.includes(target.id)) break;
    if (TARGET_REQUIRED_ACTIONS.has(raw.actionType) && !target) break;
    if (!TARGET_REQUIRED_ACTIONS.has(raw.actionType) && target) break;
    if (!hasPhaseZeroCapability(actor, raw.actionType)) break;
    const detail = String(
      raw.detail || (["change_job", "offer_work"].includes(raw.actionType) ? "laborer" : "")
    ).trim().slice(0, 40);
    if (!hasLifeCourseEligibility(state, visit, actor, target, raw.actionType, detail)) break;
    if (counselContradictsAction(visit, raw.actionType)) break;
    const resolvedDecisionScore = decisionScore(state, visit, actor, target, raw.actionType);
    if (resolvedDecisionScore < requiredDecisionScore(raw.actionType)) break;
    if (!Number.isInteger(requestedIntensity) || requestedIntensity < 1 || requestedIntensity > maximumIntensity) break;
    steps.push({
      depth: index + 1,
      actorId: actor.id,
      targetId: target?.id ?? null,
      actionType: raw.actionType,
      intensity: requestedIntensity,
      title: raw.actionType.replaceAll("_", " "),
      description: `${actor.name} chose to ${raw.actionType.replaceAll("_", " ")}${target ? ` in dealing with ${target.name}` : ""}.`,
      detail: ["change_job", "offer_work"].includes(raw.actionType) ? detail : "",
      decisionScore: resolvedDecisionScore,
      expectedCreatedResidentId: typeof raw.createdResidentId === "string" ? raw.createdResidentId : null
    });
    if (relationshipChangingActions.has(raw.actionType)) {
      reservedRelationshipParticipants.add(actor.id);
      if (target) reservedRelationshipParticipants.add(target.id);
    }
    if (!target) break;
    expectedActorId = target.id;
  }
  return {
    summary: `${candidateMap.get(visit.personId)?.name || "The visitor"} acted after the hour's counsel.`,
    steps,
    complete: rawSteps.length > 0 && steps.length === rawSteps.length
  };
}

export function finishVisit(state, plan, { record = true } = {}) {
  const visit = state.currentVisit;
  if (!visit) throw new Error("There is no visit to finish");
  const person = materializeResident(state, visit.personId, true);
  const submittedByAi = plan?.source === "ai";
  let validated = validateDeparturePlan(state, plan);
  const acceptedAiProposal = submittedByAi && validated.complete;
  const rejectedProposal = submittedByAi && !acceptedAiProposal
    ? {
      summary: String(plan?.summary || "").slice(0, 400),
      submittedStepCount: Array.isArray(plan?.steps) ? plan.steps.length : 0,
      steps: Array.isArray(plan?.steps) ? plan.steps.slice(0, 10) : []
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
  let parentEventId = visit.originEventId;
  for (const step of validated.steps) {
    const result = applyAction(state, { ...step, parentEventId });
    if (result) {
      parentEventId = result.eventId;
      if (step.expectedCreatedResidentId && step.expectedCreatedResidentId !== result.createdResidentId) {
        throw new Error("Replay created resident mismatch");
      }
      if (result.createdResidentId) step.createdResidentId = result.createdResidentId;
      delete step.expectedCreatedResidentId;
      state.statistics.cascades += 1;
    }
  }
  addStructuredMemory(state, person, {
    type: "outcome",
    summary: `On ${calendarLabel(state)}, ${String(validated.summary || "the hour left its mark").slice(0, 170)}`,
    emotion: visit.mood,
    confidence: 85,
    privateMemory: ["confessional", "office"].includes(visit.location) || visit.hiddenConcernDisclosed,
    sourceEventId: parentEventId
  });
  if (record) {
    appendCommand(state, "finish_visit", {
      plan: { summary: validated.summary, steps: validated.steps },
      rejectedProposal,
      resolution: acceptedAiProposal ? "accepted_ai" : rejectedProposal ? "fallback_after_rejection" : "fallback"
    }, acceptedAiProposal ? "ai" : (plan?.source || "simulation") === "ai" ? "fallback" : (plan?.source || "simulation"));
  }
  state.currentVisit = null;
  state.conversationHistory = [];
  state.calendar.slot += 1;
  if (state.calendar.slot >= 4) {
    state.calendar.slot = 0;
    state.calendar.absoluteDay += 1;
    state.calendar.dayIndex = state.calendar.absoluteDay % 7;
    state.calendar.week = Math.floor(state.calendar.absoluteDay / 7) + 1;
    addChronicle(state, `${WEEK_DAYS[state.calendar.dayIndex]} begins`, state.calendar.dayIndex === 6
      ? "The bells call the whole village toward Sunday worship."
      : "Four new hours of counsel await within the church.", "neutral");
    resolvePopulationDay(state);
  }
  return state;
}

export function sundayAttendance(state) {
  const rng = new SeededRng(`${state.seed}:attendance:${state.calendar.absoluteDay}`);
  return activeResidents(state).filter((person) => rng.int(1, 100) <= person.attendanceChance);
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
  return {
    summary: `The sermon on ${theme.toLowerCase()} settles unevenly over the parish: some hear comfort, others a demand.`,
    townDeltas,
    responseTags: [theme.toLowerCase(), "reflection"],
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
    } else {
      person.attendanceChance = clamp(person.attendanceChance - 1);
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
  addChronicle(state, `A sermon on ${theme}`, `${attendees.length} villagers attended. ${mechanicalSummary}`, "faith", {
    type: "sermon_delivered",
    facts: { theme, attendance: attendees.length, townDeltas: deltas }
  });
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
  state.calendar.absoluteDay += 1;
  state.calendar.dayIndex = state.calendar.absoluteDay % 7;
  state.calendar.week = Math.floor(state.calendar.absoluteDay / 7) + 1;
  state.calendar.slot = 0;
  resolvePopulationDay(state);
  return attendees.length;
}

export function calendarLabel(state) {
  const session = state.calendar.dayIndex === 6 ? "Sunday service" : `Hour ${state.calendar.slot + 1} of 4`;
  return `${WEEK_DAYS[state.calendar.dayIndex]}, Week ${state.calendar.week} — ${session}`;
}

export function populationCount(state) {
  return activeResidents(state).length;
}

export function knownResidents(state) {
  return state.residents.filter((person) => person.profileRevealed);
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
    } else if (command.type === "conversation_exchange") {
      const person = state.residents.find((resident) => resident.id === state.currentVisit?.personId);
      const resolution = resolvePriestSpeech(state, person, state.currentVisit, command.payload.playerText);
      if (command.payload.response.trustDelta !== resolution.trustDelta
        || command.payload.response.stressDelta !== resolution.stressDelta
        || command.payload.response.disclosure !== resolution.disclosure
        || command.payload.response.contradictionId !== resolution.contradictionId
        || command.payload.response.mood !== resolution.mood
        || JSON.stringify(command.payload.response.intents) !== JSON.stringify(resolution.intents)) {
        throw new Error(`Replay conversation audit mismatch at command ${command.id}`);
      }
      recordExchange(state, command.payload.playerText, {
        ...command.payload.response,
        source: command.source
      }, { record: false });
    } else if (command.type === "finish_visit") {
      finishVisit(state, { ...command.payload.plan, source: command.source }, { record: false });
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
