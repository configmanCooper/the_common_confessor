import {
  ACTION_TYPES,
  BACKSTORY_PARTS,
  buildFirstNameBank,
  buildSurnameBank,
  ISSUE_TEMPLATES,
  OCCUPATIONS,
  PHASE_ZERO_SAFE_ACTIONS,
  SERMON_THEMES,
  TOWN_CHARACTERS,
  TOWN_LANDSCAPES,
  TOWN_NAMES,
  TOWN_TENSIONS,
  TRAITS,
  WEEK_DAYS
} from "./data.js";

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
  const state = {
    version: 1,
    seed: normalizedSeed,
    town,
    residents: createResidents(normalizedSeed, rng),
    calendar: { absoluteDay: 0, week: 1, dayIndex: 0, slot: 0 },
    currentVisit: null,
    chronicle: [{
      day: 0,
      title: `A new cure begins in ${town.name}`,
      text: town.description,
      tone: "neutral"
    }],
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
  addChronicle(state, "The parish register opens", "Exactly 200 living villagers are entered by name. Their inward lives remain unknown until events draw them into the parish story.", "faith");
  return state;
}

export function materializeResident(state, personId, revealProfile = false) {
  const person = state.residents.find((resident) => resident.id === personId);
  if (!person) {
    throw new Error(`Unknown resident: ${personId}`);
  }
  if (!person.materialized) {
    const rng = new SeededRng(`${state.seed}:${person.id}:soul`);
    const firstTrait = rng.pick(TRAITS);
    const secondTrait = chooseDifferent(rng, TRAITS, firstTrait);
    const origin = rng.pick(BACKSTORY_PARTS.origins);
    const turn = rng.pick(BACKSTORY_PARTS.turns);
    const pressure = rng.pick(BACKSTORY_PARTS.pressures);
    const texture = rng.pick(BACKSTORY_PARTS.textures);
    person.personality = {
      traits: [firstTrait, secondTrait],
      candor: rng.int(20, 90),
      empathy: rng.int(20, 90),
      boldness: rng.int(20, 90),
      piety: rng.int(20, 90)
    };
    person.backstory = `${person.firstName} ${origin}, ${turn}, and now ${pressure}. ${person.firstName} ${texture}.`;
    person.privatePressure = pressure;
    person.materialized = true;
  }
  if (revealProfile && !person.profileRevealed) {
    person.profileRevealed = true;
    state.statistics.peopleRevealed += 1;
  }
  return person;
}

function activeResidents(state) {
  return state.residents.filter((person) => person.active);
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

export function beginVisit(state) {
  if (state.calendar.dayIndex === 6) {
    throw new Error("Sunday is reserved for the parish service");
  }
  if (state.currentVisit) {
    return state.currentVisit;
  }
  const candidates = activeResidents(state)
    .filter((person) => person.lastVisitDay < state.calendar.absoluteDay - 4)
    .sort((a, b) => (a.visitCount - b.visitCount) || (a.lastVisitDay - b.lastVisitDay));
  const backfill = candidates.length
    ? candidates
    : activeResidents(state).sort((a, b) => (a.lastVisitDay - b.lastVisitDay) || (a.visitCount - b.visitCount));
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
  state.currentVisit = {
    personId: person.id,
    issue,
    location: issue.location,
    turnsUsed: 0,
    maxTurns: 10,
    startedAt: Date.now(),
    history: [{ speaker: "visitor", text: issue.opening }],
    counsel: [],
    mood: issue.gravity >= 4 ? "troubled" : "guarded",
    eventLicense: eventRoll < 0.01 ? "outrageous" : eventRoll < 0.08 ? "comic" : "ordinary"
  };
  if (issue.kind === "confession") {
    state.statistics.confessions += 1;
  }
  return state.currentVisit;
}

export function recordExchange(state, playerText, response) {
  const visit = state.currentVisit;
  if (!visit) {
    throw new Error("There is no visitor in the church");
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
  visit.turnsUsed += 1;
  visit.history.push({ speaker: "priest", text: cleanText });
  visit.history.push({ speaker: "visitor", text: reply });
  visit.counsel.push(cleanText);
  visit.mood = response.mood || visit.mood;
  person.trustPriest = clamp(person.trustPriest + clamp(response.trustDelta, -5, 5), 0, 100);
  person.stress = clamp(person.stress + clamp(response.stressDelta, -5, 5), 0, 100);
  if (response.memory) {
    person.memories.push(String(response.memory).slice(0, 180));
    person.memories = person.memories.slice(-8);
  }
  state.statistics.conversations += 1;
  return visit;
}

export function fallbackConversation(state, playerText) {
  const visit = state.currentVisit;
  const person = materializeResident(state, visit.personId, true);
  const text = playerText.toLowerCase();
  let reply;
  let mood = "uncertain";
  let trustDelta = 0;
  let stressDelta = 0;
  if (/\b(forgive|mercy|grace|pardon)\b/.test(text)) {
    reply = `"Mercy is easier to ask for than to give. Yet I think I understand what you are asking of me, Father."`;
    mood = "softened";
    trustDelta = 2;
    stressDelta = -2;
  } else if (/\b(confess|truth|honest|admit)\b/.test(text)) {
    reply = `"Then I must tell the truth, though it may cost me. I hoped you would offer an easier road."`;
    mood = "resolved";
    trustDelta = 2;
    stressDelta = 1;
  } else if (/\b(pray|god|faith|scripture)\b/.test(text)) {
    reply = person.personality.piety > 55
      ? `"I will pray on it. The words feel less empty when another person believes I may still be heard."`
      : `"I will try, Father, though prayer has not answered me as plainly as people claim."`;
    mood = "contemplative";
    trustDelta = 1;
    stressDelta = -1;
  } else if (/\b(leave|flee|go away|depart)\b/.test(text)) {
    reply = `"To leave would end one trouble and begin five more. Still, perhaps I have been too afraid to count that path."`;
    mood = "wary";
    stressDelta = 1;
  } else if (/\b(sorry|hear you|listen|understand)\b/.test(text)) {
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

function addChronicle(state, title, text, tone = "neutral") {
  state.chronicle.unshift({
    day: state.calendar.absoluteDay,
    title: String(title).slice(0, 120),
    text: String(text).slice(0, 700),
    tone
  });
  state.chronicle = state.chronicle.slice(0, 250);
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

function createNewResident(state, sourcePerson, reason) {
  const idNumber = state.residents.length + 1;
  const rng = new SeededRng(`${state.seed}:new:${idNumber}:${reason}`);
  const sex = rng.next() < 0.5 ? "female" : "male";
  const firstNames = buildFirstNameBank(sex);
  const surnames = buildSurnameBank();
  const surname = reason === "birth" && sourcePerson ? sourcePerson.surname : rng.pick(surnames);
  const person = {
    id: `person-${String(idNumber).padStart(3, "0")}`,
    name: `${rng.pick(firstNames)} ${surname}`,
    firstName: "",
    surname,
    sex,
    age: reason === "birth" ? 0 : rng.int(16, 55),
    householdId: sourcePerson?.householdId || `household-new-${idNumber}`,
    occupation: reason === "birth" ? "infant" : rng.pick(OCCUPATIONS),
    sprite: 1 + (idNumber % 41),
    active: true,
    profileRevealed: false,
    materialized: false,
    visitCount: 0,
    lastVisitDay: -999,
    attendanceChance: rng.int(45, 90),
    trustPriest: 50,
    faith: rng.int(35, 70),
    morale: 55,
    prosperity: 45,
    health: 70,
    stress: 35,
    reputation: 50,
    relationshipIds: sourcePerson ? [sourcePerson.id] : [],
    memories: [],
    flags: [reason]
  };
  person.firstName = person.name.split(" ")[0];
  state.residents.push(person);
  return person;
}

export function applyAction(state, step) {
  if (!ACTION_TYPES.includes(step.actionType)) {
    return null;
  }
  const actor = materializeResident(state, step.actorId, false);
  const target = step.targetId ? materializeResident(state, step.targetId, false) : null;
  const intensity = clamp(step.intensity || 2, 1, 5);
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
  if (step.actionType === "conceive_child" || step.actionType === "adopt_child") {
    const child = createNewResident(state, actor, step.actionType === "conceive_child" ? "birth" : "adoption");
    state.statistics.births += step.actionType === "conceive_child" ? 1 : 0;
    step.detail = `${step.detail || ""} ${child.name} enters the parish register.`.trim();
  }
  if (step.actionType === "invite_migrant") {
    const migrant = createNewResident(state, actor, "arrival");
    state.statistics.arrivals += 1;
    step.detail = `${step.detail || ""} ${migrant.name} arrives in ${state.town.name}.`.trim();
  }
  if (step.actionType === "leave_village" || step.actionType === "expel") {
    actor.active = false;
    state.statistics.departures += 1;
  }

  const description = step.description
    || `${actor.name} chose to ${step.actionType.replaceAll("_", " ")}${target ? ` with ${target.name}` : ""}.`;
  addChronicle(state, step.title || step.actionType.replaceAll("_", " "), description, Object.values(deltas).some((value) => value < 0) ? "danger" : "change");
  return { actor, target, description };
}

export function fallbackDeparturePlan(state) {
  const visit = state.currentVisit;
  const person = materializeResident(state, visit.personId, true);
  const combined = visit.counsel.join(" ").toLowerCase();
  let actionType = "keep_silence";
  if (/\bforgiv|mercy|pardon\b/.test(combined)) actionType = "forgive";
  else if (/\bapolog|make amends|say sorry\b/.test(combined)) actionType = "apologize";
  else if (/\btruth|confess|admit|honest\b/.test(combined)) actionType = "seek_absolution";
  else if (/\bhelp|charity|give|share\b/.test(combined)) actionType = "share_food";
  else if (/\bwork|duty|labor\b/.test(combined)) actionType = "work_harder";
  else if (/\bpray|faith|god\b/.test(combined)) actionType = "pray_with";
  else if (/\breport|reeve|justice\b/.test(combined)) actionType = "report_crime";
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
  "visit", "write_letter", "protect", "offer_work", "refuse_work"
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

export function validateDeparturePlan(state, plan, candidates = departureCandidates(state)) {
  const visit = state.currentVisit;
  if (!visit) return { summary: "", steps: [] };
  const candidateMap = new Map(candidates.filter((person) => person?.active).map((person) => [person.id, person]));
  const rawSteps = Array.isArray(plan?.steps) ? plan.steps.slice(0, 3) : [];
  const steps = [];
  let expectedActorId = visit.personId;
  const maximumIntensity = maximumIntensityForLicense(visit.eventLicense);
  for (let index = 0; index < rawSteps.length; index += 1) {
    const raw = rawSteps[index] || {};
    const actor = candidateMap.get(raw.actorId);
    const target = raw.targetId == null ? null : candidateMap.get(raw.targetId);
    const requestedIntensity = Number(raw.intensity);
    if (!actor || actor.id !== expectedActorId) break;
    if (!PHASE_ZERO_SAFE_ACTIONS.includes(raw.actionType)) break;
    if (raw.targetId != null && (!target || target.id === actor.id)) break;
    if (target && !actor.relationshipIds.includes(target.id)) break;
    if (TARGET_REQUIRED_ACTIONS.has(raw.actionType) && !target) break;
    if (!TARGET_REQUIRED_ACTIONS.has(raw.actionType) && target) break;
    if (!hasPhaseZeroCapability(actor, raw.actionType)) break;
    if (!Number.isInteger(requestedIntensity) || requestedIntensity < 1 || requestedIntensity > maximumIntensity) break;
    steps.push({
      depth: index + 1,
      actorId: actor.id,
      targetId: target?.id ?? null,
      actionType: raw.actionType,
      intensity: requestedIntensity,
      title: raw.actionType.replaceAll("_", " "),
      description: `${actor.name} chose to ${raw.actionType.replaceAll("_", " ")}${target ? ` in dealing with ${target.name}` : ""}.`,
      detail: ""
    });
    if (!target) break;
    expectedActorId = target.id;
  }
  return {
    summary: `${candidateMap.get(visit.personId)?.name || "The visitor"} acted after the hour's counsel.`,
    steps
  };
}

export function finishVisit(state, plan) {
  const visit = state.currentVisit;
  if (!visit) throw new Error("There is no visit to finish");
  const person = materializeResident(state, visit.personId, true);
  let validated = validateDeparturePlan(state, plan);
  if (!validated.steps.length) validated = validateDeparturePlan(state, fallbackDeparturePlan(state));
  if (!validated.steps.length) {
    validated = validateDeparturePlan(state, {
      summary: `${person.name} left with the matter unresolved.`,
      steps: [{
        actorId: person.id,
        targetId: null,
        actionType: "keep_silence",
        intensity: 1
      }]
    });
  }
  for (const step of validated.steps) {
    if (applyAction(state, step)) state.statistics.cascades += 1;
  }
  person.memories.push(`On ${calendarLabel(state)}, the parish counsel ended: ${String(validated.summary || "The hour left its mark.").slice(0, 180)}`);
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

export function applySermon(state, theme, text, outcome) {
  if (state.calendar.dayIndex !== 6) throw new Error("Sermons are delivered on Sunday");
  if (!SERMON_THEMES.includes(theme)) throw new Error("Unknown sermon theme");
  const wordCount = String(text).trim().split(/\s+/).filter(Boolean).length;
  if (!wordCount || wordCount > 100) throw new Error("The sermon must contain 1 to 100 words");
  const attendees = sundayAttendance(state);
  const attendeeIds = new Set(attendees.map((person) => person.id));
  const deltas = outcome?.townDeltas || {};
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
      person.memories.push(`Sunday sermon: ${theme} — ${String(text).slice(0, 100)}`);
      person.memories = person.memories.slice(-8);
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
    if (effect.memory) person.memories.push(String(effect.memory).slice(0, 180));
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
  addChronicle(state, `A sermon on ${theme}`, `${attendees.length} villagers attended. ${mechanicalSummary}`, "faith");
  state.calendar.absoluteDay += 1;
  state.calendar.dayIndex = state.calendar.absoluteDay % 7;
  state.calendar.week = Math.floor(state.calendar.absoluteDay / 7) + 1;
  state.calendar.slot = 0;
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
