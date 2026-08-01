import { buildFirstNameBank, buildSurnameBank, OCCUPATIONS } from "./data.js";
import { upgradeChurchResources } from "./church.js";

export const ADULT_AGE = 18;

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < String(value).length; index += 1) {
    hash ^= String(value).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

class PopulationRng {
  constructor(seed) {
    this.state = hashString(seed) || 0x9e3779b9;
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
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function relationshipId(actorId, targetId) {
  return `relationship-${actorId}-${targetId}`;
}

function defaultRelationship(state, actorId, targetId) {
  const rng = new PopulationRng(`${state.seed}:relationship:${actorId}:${targetId}`);
  return {
    id: relationshipId(actorId, targetId),
    actorId,
    targetId,
    familiarity: rng.int(25, 70),
    trust: rng.int(30, 68),
    affection: rng.int(20, 65),
    attraction: rng.int(0, 45),
    fear: rng.int(0, 30),
    respect: rng.int(25, 70),
    resentment: rng.int(0, 35),
    obligation: rng.int(10, 60),
    lastInteractionDay: -1
  };
}

function seedHouseholdFamilies(state) {
  for (const household of state.households || []) {
    const members = household.memberIds
      .map((id) => state.residents.find((person) => person.id === id))
      .filter(Boolean)
      .sort((left, right) => right.age - left.age);
    if (members.some((person) => person.spouseId || person.parentIds.length)) continue;
    const adults = members.filter((person) => person.age >= ADULT_AGE);
    const firstSpouse = adults.find((person) => person.sex === "female");
    const secondSpouse = adults.find((person) => (
      person.sex === "male"
      && firstSpouse
      && Math.abs(person.age - firstSpouse.age) <= 20
    ));
    if (firstSpouse && secondSpouse) {
      firstSpouse.maritalStatus = "married";
      secondSpouse.maritalStatus = "married";
      firstSpouse.spouseId = secondSpouse.id;
      secondSpouse.spouseId = firstSpouse.id;
      firstSpouse.marriageDay = 0;
      secondSpouse.marriageDay = 0;
      if (!firstSpouse.relationshipIds.includes(secondSpouse.id)) firstSpouse.relationshipIds.push(secondSpouse.id);
      if (!secondSpouse.relationshipIds.includes(firstSpouse.id)) secondSpouse.relationshipIds.push(firstSpouse.id);
      getRelationship(state, firstSpouse.id, secondSpouse.id, true);
      getRelationship(state, secondSpouse.id, firstSpouse.id, true);
    }
    const parents = [firstSpouse, secondSpouse].filter(Boolean);
    for (const member of members) {
      if (parents.includes(member)) continue;
      const eligibleParents = parents.filter((parent) => parent.age - member.age >= 16);
      if (eligibleParents.length && (member.age < 18 || eligibleParents.some((parent) => parent.age - member.age >= 20))) {
        member.parentIds = eligibleParents.map((parent) => parent.id);
        for (const parent of eligibleParents) {
          if (!parent.childrenIds.includes(member.id)) parent.childrenIds.push(member.id);
          if (!parent.relationshipIds.includes(member.id)) parent.relationshipIds.push(member.id);
          if (!member.relationshipIds.includes(parent.id)) member.relationshipIds.push(parent.id);
          getRelationship(state, parent.id, member.id, true);
          getRelationship(state, member.id, parent.id, true);
        }
      }
    }
  }
}

export function upgradePopulationState(state) {
  state.relationships ||= [];
  state.knowledge ||= [];
  state.rumors ||= [];
  state.populationSequence ||= state.residents.length + 1;
  state.nextKnowledgeSequence ||= state.knowledge.length + 1;
  state.nextRumorSequence ||= state.rumors.length + 1;
  state.lastInvitedMigrationDay ??= -999;
  state.visitRequests ||= [];
  state.nextVisitRequestSequence ||= state.visitRequests.length + 1;
  state.issueThreads ||= [];
  state.nextIssueThreadSequence ||= state.issueThreads.length + 1;
  state.nextPropertySequence ||= 1;
  state.priestReports ||= [];
  state.nextPriestReportSequence ||= state.priestReports.length + 1;
  state.material ||= {
    season: "Spring",
    weather: "mild",
    foodSecurity: 60,
    grainPrice: 50,
    diseasePressure: 20,
    crime: 25,
    infrastructure: 50
  };
  upgradeChurchResources(state);
  const shouldSeedFamilies = state.householdFamiliesSeeded !== true;
  for (const command of state.commandLog || []) {
    if (command.type === "finish_visit") {
      for (const step of command.payload?.plan?.steps || []) {
        step.decisionScore ??= 50;
        if (["change_job", "offer_work"].includes(step.actionType) && !step.detail) step.detail = "laborer";
      }
    }
  }

  for (const household of state.households || []) {
    household.wealth ??= 50;
    household.food ??= 50;
    household.debt ??= 0;
    household.reputation ??= 50;
    household.dwelling ??= "cottage";
    household.dailyProduction ??= 0;
    household.lastBalanceDay ??= -1;
    household.lastAdoptionDay ??= -999;
    household.properties ||= [{
      id: `property-${household.id}`,
      type: household.dwelling || "cottage",
      location: state.town?.name || "the village",
      value: 20,
      status: "owned"
    }];
    for (const property of household.properties) {
      const numericId = Number(String(property.id || "").replace(/\D/g, ""));
      if (Number.isFinite(numericId)) state.nextPropertySequence = Math.max(state.nextPropertySequence, numericId + 1);
    }
  }

  for (const person of state.residents || []) {
    person.alive ??= true;
    person.ageDays ??= person.age * 365;
    person.maritalStatus ??= "single";
    person.spouseId ??= null;
    person.marriageDay ??= null;
    person.parentIds ??= [];
    person.childrenIds ??= [];
    person.pregnantDueDay ??= null;
    person.pregnancyCoParentId ??= null;
    person.illness ??= null;
    person.illnessDays ??= 0;
    person.causeOfDeath ??= null;
    person.arrivalDay ??= 0;
    person.departureDay ??= null;
  }
  if (shouldSeedFamilies) {
    seedHouseholdFamilies(state);
    state.householdFamiliesSeeded = true;
  }

  const existing = new Set(state.relationships.map((relationship) => relationship.id));
  for (const person of state.residents || []) {
    for (const targetId of person.relationshipIds || []) {
      const id = relationshipId(person.id, targetId);
      if (!existing.has(id)) {
        state.relationships.push(defaultRelationship(state, person.id, targetId));
        existing.add(id);
      }
    }
  }
  return state;
}

export function getRelationship(state, actorId, targetId, create = true) {
  let relationship = state.relationships.find((entry) => entry.actorId === actorId && entry.targetId === targetId);
  if (!relationship && create) {
    relationship = defaultRelationship(state, actorId, targetId);
    state.relationships.push(relationship);
    const actor = state.residents.find((person) => person.id === actorId);
    if (actor && !actor.relationshipIds.includes(targetId)) actor.relationshipIds.push(targetId);
  }
  return relationship || null;
}

export function adjustRelationship(state, actorId, targetId, deltas, day = state.calendar.absoluteDay) {
  const relationship = getRelationship(state, actorId, targetId, true);
  for (const field of ["familiarity", "trust", "affection", "attraction", "fear", "respect", "resentment", "obligation"]) {
    if (deltas[field] !== undefined) relationship[field] = clamp(relationship[field] + Number(deltas[field]));
  }
  relationship.lastInteractionDay = day;
  return relationship;
}

export function addKnowledge(state, {
  holderId,
  subjectId,
  topic,
  belief,
  confidence = 60,
  sourceEventId = null,
  isTrue = true,
  privateKnowledge = false
}) {
  const existing = state.knowledge.find((entry) => (
    entry.holderId === holderId && entry.subjectId === subjectId && entry.topic === topic
  ));
  if (existing) {
    existing.belief = String(belief).slice(0, 240);
    existing.confidence = clamp(confidence);
    existing.sourceEventId = sourceEventId;
    existing.isTrue = Boolean(isTrue);
    existing.privateKnowledge = Boolean(privateKnowledge);
    return existing;
  }
  const entry = {
    id: `knowledge-${String(state.nextKnowledgeSequence).padStart(6, "0")}`,
    holderId,
    subjectId,
    topic: String(topic).slice(0, 60),
    belief: String(belief).slice(0, 240),
    confidence: clamp(confidence),
    sourceEventId,
    isTrue: Boolean(isTrue),
    privateKnowledge: Boolean(privateKnowledge)
  };
  state.nextKnowledgeSequence += 1;
  state.knowledge.push(entry);
  return entry;
}

export function createRumor(state, {
  originatorId,
  subjectId,
  claim,
  truth = 50,
  intensity = 2,
  sourceEventId = null
}) {
  const rumor = {
    id: `rumor-${String(state.nextRumorSequence).padStart(6, "0")}`,
    originatorId,
    subjectId,
    claim: String(claim).slice(0, 240),
    truth: clamp(truth),
    intensity: clamp(intensity, 1, 5),
    sourceEventId,
    createdDay: state.calendar.absoluteDay,
    heardByIds: [originatorId],
    active: true
  };
  state.nextRumorSequence += 1;
  state.rumors.push(rumor);
  return rumor;
}

export function isAdultRelationshipEligible(person) {
  return Boolean(person?.alive && person.active && person.age >= ADULT_AGE);
}

function ancestorsOf(state, personId) {
  const ancestors = new Set();
  let frontier = [personId];
  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      const person = state.residents.find((candidate) => candidate.id === id);
      for (const parentId of person?.parentIds || []) {
        if (!ancestors.has(parentId)) {
          ancestors.add(parentId);
          next.push(parentId);
        }
      }
    }
    frontier = next;
  }
  return ancestors;
}

function ancestorDistances(state, personId) {
  const distances = new Map();
  let frontier = [{ id: personId, distance: 0 }];
  while (frontier.length) {
    const current = frontier.shift();
    const person = state.residents.find((candidate) => candidate.id === current.id);
    for (const parentId of person?.parentIds || []) {
      const distance = current.distance + 1;
      if (!distances.has(parentId) || distance < distances.get(parentId)) {
        distances.set(parentId, distance);
        frontier.push({ id: parentId, distance });
      }
    }
  }
  return distances;
}

export function areProhibitedKin(state, firstId, secondId) {
  if (firstId === secondId) return true;
  const first = state.residents.find((person) => person.id === firstId);
  const second = state.residents.find((person) => person.id === secondId);
  if (!first || !second) return true;
  if (first.householdId === second.householdId && first.spouseId !== second.id) return true;
  if (ancestorsOf(state, firstId).has(secondId) || ancestorsOf(state, secondId).has(firstId)) return true;
  const firstParents = new Set(first.parentIds);
  if (second.parentIds.some((parentId) => firstParents.has(parentId))) return true;
  const firstAncestors = ancestorDistances(state, firstId);
  const secondAncestors = ancestorDistances(state, secondId);
  for (const [ancestorId, firstDistance] of firstAncestors) {
    const secondDistance = secondAncestors.get(ancestorId);
    if (secondDistance !== undefined && firstDistance + secondDistance <= 4) return true;
  }
  return false;
}

function connectToCommunity(state, person, count) {
  const candidates = state.residents
    .filter((candidate) => (
      candidate.id !== person.id
      && candidate.active
      && candidate.alive
      && !areProhibitedKin(state, person.id, candidate.id)
    ))
    .sort((left, right) => (
      Math.abs(left.age - person.age) - Math.abs(right.age - person.age)
      || Number(right.occupation === person.occupation) - Number(left.occupation === person.occupation)
      || left.id.localeCompare(right.id)
    ))
    .slice(0, count);
  for (const neighbor of candidates) {
    if (!person.relationshipIds.includes(neighbor.id)) person.relationshipIds.push(neighbor.id);
    if (!neighbor.relationshipIds.includes(person.id)) neighbor.relationshipIds.push(person.id);
    getRelationship(state, person.id, neighbor.id, true);
    getRelationship(state, neighbor.id, person.id, true);
  }
}

function uniqueName(state, sex, surname, rng) {
  const firstNames = buildFirstNameBank(sex);
  const used = new Set(state.residents.map((person) => person.name));
  for (let attempt = 0; attempt < firstNames.length; attempt += 1) {
    const firstName = firstNames[(rng.int(0, firstNames.length - 1) + attempt) % firstNames.length];
    const name = `${firstName} ${surname}`;
    if (!used.has(name)) return { firstName, name };
  }
  return { firstName: `Child${state.populationSequence}`, name: `Child${state.populationSequence} ${surname}` };
}

export function createPopulationResident(state, {
  sex,
  age,
  surname,
  householdId,
  occupation,
  parentIds = [],
  arrivalDay = state.calendar.absoluteDay,
  reason
}) {
  const rng = new PopulationRng(`${state.seed}:new-person:${state.populationSequence}:${reason}`);
  const identity = uniqueName(state, sex, surname, rng);
  const id = `person-${String(state.populationSequence).padStart(3, "0")}`;
  state.populationSequence += 1;
  const person = {
    id,
    name: identity.name,
    firstName: identity.firstName,
    surname,
    sex,
    age,
    ageDays: age * 365,
    householdId,
    occupation,
    sprite: 1 + ((state.populationSequence - 1) % 41),
    active: true,
    alive: true,
    profileRevealed: false,
    materialized: false,
    visitCount: 0,
    lastVisitDay: -999,
    attendanceChance: rng.int(45, 90),
    trustPriest: 50,
    faith: rng.int(35, 70),
    morale: 55,
    prosperity: 45,
    health: age === 0 ? 72 : 68,
    stress: 30,
    reputation: 50,
    relationshipIds: [...parentIds],
    memories: [],
    flags: [reason],
    maritalStatus: "single",
    spouseId: null,
    marriageDay: null,
    parentIds: [...parentIds],
    childrenIds: [],
    pregnantDueDay: null,
    pregnancyCoParentId: null,
    illness: null,
    illnessDays: 0,
    causeOfDeath: null,
    arrivalDay,
    departureDay: null
  };
  state.residents.push(person);
  let household = state.households.find((entry) => entry.id === householdId);
  if (!household) {
    household = {
      id: householdId,
      surname,
      memberIds: [],
      wealth: 40,
      food: 40,
      debt: 0,
      reputation: 50,
      dwelling: "cottage",
      dailyProduction: 0,
      lastBalanceDay: -1,
      lastAdoptionDay: -999,
      properties: []
    };
    state.households.push(household);
  }
  household.memberIds.push(person.id);
  if (!parentIds.length) {
    connectToCommunity(state, person, 4);
  }
  for (const parentId of parentIds) {
    const parent = state.residents.find((entry) => entry.id === parentId);
    if (parent && !parent.childrenIds.includes(person.id)) parent.childrenIds.push(person.id);
    getRelationship(state, parentId, person.id, true);
    getRelationship(state, person.id, parentId, true);
  }
  return person;
}

function householdFor(state, person) {
  return state.households.find((household) => household.id === person.householdId);
}

function processHouseholds(state, day, events) {
  for (const household of state.households) {
    const members = household.memberIds
      .map((id) => state.residents.find((person) => person.id === id))
      .filter((person) => person?.alive && person.active);
    const workers = members.filter((person) => person.age >= 14 && person.occupation !== "unemployed" && person.occupation !== "infant");
    const harvestFactor = {
      Spring: 0.9,
      Summer: 1.25,
      Autumn: 1.4,
      Winter: 0.55
    }[state.material.season];
    const weatherFactor = ["storm", "frost", "snow"].includes(state.material.weather) ? 0.75 : state.material.weather === "sun" ? 1.12 : 1;
    const production = workers.reduce((total, worker) => {
      const base = Math.max(0.25, worker.prosperity / 50);
      return total + base * (["farmer", "shepherd", "miller"].includes(worker.occupation) ? harvestFactor * weatherFactor : 1);
    }, 0);
    const consumption = members.reduce((total, member) => (
      total + (member.age < 10 ? 0.5 : 0.85) * (state.material.season === "Winter" ? 1.1 : 1)
    ), 0);
    const shortage = Math.max(0, consumption - production);
    const surplus = Math.max(0, production - consumption);
    const marketCost = shortage * (state.material.grainPrice / 50) * 0.15;
    const marketIncome = surplus * (state.material.grainPrice / 50) * 0.16;
    household.dailyProduction = production;
    household.food = clamp(household.food + production - consumption, 0, 100);
    household.wealth = clamp(
      household.wealth + production * 0.24 + marketIncome - consumption * 0.15 - marketCost - household.debt * 0.002,
      0,
      100
    );
    household.food = clamp(household.food - Math.max(0, household.food - 75) * 0.03);
    household.wealth = clamp(household.wealth - Math.max(0, household.wealth - 80) * 0.02);
    household.debt = Math.max(0, household.debt + (household.food < 15 ? 0.8 : -0.15));
    household.lastBalanceDay = day;
    if (household.food < 8 && members.length) {
      events.push({
        type: "household_hunger",
        actorId: members[0].id,
        title: `Hunger troubles the ${household.surname} household`,
        text: `The ${household.surname} household has nearly exhausted its food stores.`,
        tone: "danger"
      });
    }
  }
}

function spreadRumors(state, day, events) {
  for (const rumor of state.rumors.filter((entry) => entry.active)) {
    const rng = new PopulationRng(`${state.seed}:rumor:${rumor.id}:${day}`);
    const hearers = [...rumor.heardByIds];
    for (const holderId of hearers) {
      const holder = state.residents.find((person) => person.id === holderId);
      if (!holder?.active || !holder.alive) continue;
      const possible = holder.relationshipIds
        .filter((id) => !rumor.heardByIds.includes(id))
        .map((id) => state.residents.find((person) => person.id === id))
        .filter((person) => person?.active && person.alive);
      if (possible.length && rng.next() < 0.12 * rumor.intensity) {
        const listener = rng.pick(possible);
        rumor.heardByIds.push(listener.id);
        addKnowledge(state, {
          holderId: listener.id,
          subjectId: rumor.subjectId,
          topic: "rumor",
          belief: rumor.claim,
          confidence: clamp(35 + rumor.intensity * 8),
          sourceEventId: rumor.sourceEventId,
          isTrue: rumor.truth >= 60
        });
      }
    }
    if (rumor.heardByIds.length >= Math.min(80, state.residents.length * 0.45)) {
      rumor.active = false;
      events.push({
        type: "rumor_became_public",
        actorId: rumor.originatorId,
        targetId: rumor.subjectId,
        title: "A rumor becomes common knowledge",
        text: rumor.claim,
        tone: rumor.truth < 40 ? "danger" : "change"
      });
    }
  }
}

function processHealthAndAging(state, day, events) {
  for (const person of state.residents) {
    if (!person.alive || !person.active) continue;
    person.ageDays += 1;
    const newAge = Math.floor(person.ageDays / 365);
    if (newAge > person.age) {
      person.age = newAge;
      if (person.age >= 12 && person.relationshipIds.length <= person.parentIds.length + 1) {
        connectToCommunity(state, person, 4);
      }
      if (person.age >= 14 && person.occupation === "infant") person.occupation = "child laborer";
      if (person.age >= ADULT_AGE && ["infant", "child laborer"].includes(person.occupation)) {
        const workRng = new PopulationRng(`${state.seed}:mature-work:${person.id}`);
        person.occupation = workRng.pick(OCCUPATIONS.filter((occupation) => !["unemployed", "infant"].includes(occupation)));
        connectToCommunity(state, person, 7);
      }
      events.push({
        type: "birthday",
        actorId: person.id,
        title: `${person.name} reaches age ${person.age}`,
        text: `${person.name} has completed another year of life.`,
        tone: "neutral"
      });
    }
    const household = householdFor(state, person);
    const rng = new PopulationRng(`${state.seed}:health:${person.id}:${day}`);
    const diseaseMultiplier = 1 + (state.material?.diseasePressure || 20) / 300;
    if (!person.illness && rng.next() < (person.health < 35 ? 0.0008 : 0.00015) * diseaseMultiplier) {
      person.illness = rng.next() < 0.7 ? "fever" : "lung sickness";
      person.illnessDays = 1;
      person.health = clamp(person.health - rng.int(4, 10));
      events.push({
        type: "illness_began",
        actorId: person.id,
        title: `${person.name} falls ill`,
        text: `${person.name} is suffering from ${person.illness}.`,
        tone: "danger"
      });
    } else if (person.illness) {
      person.illnessDays += 1;
      const care = household ? household.food / 100 + household.wealth / 150 : 0.5;
      person.health = clamp(person.health + (care > 0.55 ? 1.4 : care < 0.25 ? -1.2 : 0.2));
      const complicationRisk = person.illnessDays > 8
        ? (person.illness === "lung sickness" ? 0.004 : 0.002)
        : 0;
      if (rng.next() < complicationRisk) {
        person.health = clamp(person.health - rng.int(5, 12));
      }
      if ((person.health > 55 && rng.next() < 0.2)
        || (person.illnessDays > 18 && person.health > 30 && rng.next() < 0.12)) {
        person.illness = null;
        person.illnessDays = 0;
        events.push({
          type: "illness_recovered",
          actorId: person.id,
          title: `${person.name} recovers`,
          text: `${person.name} has recovered enough to resume ordinary life.`,
          tone: "change"
        });
      }
    }
    const ageRisk = person.age > 78 ? (person.age - 77) * 0.000025 : 0;
    const illnessRisk = person.illness && person.health < 8 ? 0.015 : 0;
    if (rng.next() < ageRisk + illnessRisk) {
      person.alive = false;
      person.active = false;
      person.causeOfDeath = person.illness || "old age";
      person.departureDay = day;
      person.pregnantDueDay = null;
      person.pregnancyCoParentId = null;
      const spouse = state.residents.find((candidate) => candidate.id === person.spouseId);
      if (spouse?.alive) {
        spouse.maritalStatus = "widowed";
        spouse.spouseId = null;
        spouse.marriageDay = null;
      }
      person.maritalStatus = "deceased";
      person.spouseId = null;
      person.marriageDay = null;
      events.push({
        type: "death",
        actorId: person.id,
        title: `${person.name} dies`,
        text: `${person.name} has died from ${person.causeOfDeath}.`,
        tone: "danger"
      });
    }
  }
}

function processFamilyAndWork(state, day, events) {
  const rng = new PopulationRng(`${state.seed}:family-work:${day}`);
  for (const person of state.residents.filter((entry) => entry.alive && entry.active)) {
    if (person.pregnantDueDay != null && day >= person.pregnantDueDay) {
      const coParent = state.residents.find((entry) => entry.id === person.pregnancyCoParentId);
      const child = createPopulationResident(state, {
        sex: rng.next() < 0.5 ? "female" : "male",
        age: 0,
        surname: person.surname,
        householdId: person.householdId,
        occupation: "infant",
        parentIds: [person.id, coParent?.id].filter(Boolean),
        reason: "birth"
      });
      person.pregnantDueDay = null;
      person.pregnancyCoParentId = null;
      state.statistics.births += 1;
      events.push({
        type: "birth",
        actorId: person.id,
        targetId: child.id,
        title: `${child.name} is born`,
        text: `${child.name} is born into the ${person.surname} household.`,
        tone: "change"
      });
    }
    if (person.occupation === "unemployed" && person.age >= ADULT_AGE && rng.next() < 0.006) {
      person.occupation = rng.pick(OCCUPATIONS.filter((occupation) => occupation !== "unemployed"));
      events.push({
        type: "occupation_changed",
        actorId: person.id,
        title: `${person.name} finds work`,
        text: `${person.name} has begun working as a ${person.occupation}.`,
        tone: "change"
      });
    }
    if (person.maritalStatus === "single" && isAdultRelationshipEligible(person) && rng.next() < 0.00145) {
      const candidates = person.relationshipIds
        .map((id) => state.residents.find((entry) => entry.id === id))
        .filter((candidate) => (
          candidate
          && candidate.id !== person.id
          && candidate.sex !== person.sex
          && !areProhibitedKin(state, person.id, candidate.id)
          && candidate.maritalStatus === "single"
          && isAdultRelationshipEligible(candidate)
        ));
      const partner = candidates.find((candidate) => {
        const forward = getRelationship(state, person.id, candidate.id, false);
        const reverse = getRelationship(state, candidate.id, person.id, false);
        return forward?.affection > 45 && reverse?.affection > 45 && forward.resentment < 45 && reverse.resentment < 45;
      });
      if (partner) {
        person.maritalStatus = "married";
        partner.maritalStatus = "married";
        person.spouseId = partner.id;
        partner.spouseId = person.id;
        person.marriageDay = day;
        partner.marriageDay = day;
        events.push({
          type: "marriage",
          actorId: person.id,
          targetId: partner.id,
          title: `${person.name} and ${partner.name} marry`,
          text: `The two households witness a lawful marriage between ${person.name} and ${partner.name}.`,
          tone: "change"
        });
      }
    }
    if (person.maritalStatus === "married" && person.spouseId) {
      const spouse = state.residents.find((entry) => entry.id === person.spouseId);
      const relationship = spouse ? getRelationship(state, person.id, spouse.id, false) : null;
      if (relationship?.resentment > 88 && rng.next() < 0.001) {
        const hasChildren = person.childrenIds.length > 0 || spouse?.childrenIds.length > 0;
        const outcome = hasChildren ? "separated" : "annulled";
        person.maritalStatus = outcome;
        person.spouseId = null;
        person.marriageDay = null;
        if (spouse) {
          spouse.maritalStatus = outcome;
          spouse.spouseId = null;
          spouse.marriageDay = null;
        }
        events.push({
          type: outcome === "annulled" ? "annulment" : "separation",
          actorId: person.id,
          targetId: spouse?.id || null,
          title: outcome === "annulled"
            ? `${person.name}'s marriage is annulled`
            : `${person.name} separates from a spouse`,
          text: outcome === "annulled"
            ? `${person.name}'s marriage is declared invalid after sustained dispute.`
            : `${person.name}'s marriage has broken into a formal separation.`,
          tone: "danger"
        });
      } else if (relationship?.resentment > 80 && person.stress > 75 && rng.next() < 0.00045) {
        person.maritalStatus = "deserted";
        person.spouseId = null;
        person.marriageDay = null;
        if (spouse) {
          spouse.maritalStatus = "deserted";
          spouse.spouseId = null;
          spouse.marriageDay = null;
        }
        person.active = false;
        person.departureDay = day;
        state.statistics.departures += 1;
        events.push({
          type: "desertion",
          actorId: person.id,
          targetId: spouse?.id || null,
          title: `${person.name} deserts a household`,
          text: `${person.name} abandons the village and a broken marriage.`,
          tone: "danger"
        });
      } else if (person.sex === "female" && person.age >= ADULT_AGE && person.age <= 42
        && spouse?.sex === "male"
        && person.pregnantDueDay == null && spouse.alive && spouse.active && rng.next() < 0.0019) {
        person.pregnantDueDay = day + 280;
        person.pregnancyCoParentId = spouse.id;
      }
    }
  }
}

function processMigration(state, day, events) {
  const rng = new PopulationRng(`${state.seed}:migration:${day}`);
  const active = state.residents.filter((person) => person.active && person.alive);
  for (const person of active) {
    if (active.length <= 25) break;
    if (person.age >= ADULT_AGE && person.morale < 18 && person.prosperity < 20 && rng.next() < 0.0008) {
      const spouse = state.residents.find((candidate) => candidate.id === person.spouseId);
      if (spouse) {
        spouse.maritalStatus = "deserted";
        spouse.spouseId = null;
        spouse.marriageDay = null;
        person.maritalStatus = "deserted";
        person.spouseId = null;
        person.marriageDay = null;
      }
      person.active = false;
      person.departureDay = day;
      state.statistics.departures += 1;
      events.push({
        type: "emigration",
        actorId: person.id,
        title: `${person.name} leaves the village`,
        text: `${person.name} departs after prolonged hardship.`,
        tone: "danger"
      });
    }
  }
  if (rng.next() < 0.0024) {
    const surname = rng.pick(buildSurnameBank());
    const migrant = createPopulationResident(state, {
      sex: rng.next() < 0.5 ? "female" : "male",
      age: rng.int(18, 48),
      surname,
      householdId: `household-new-${state.populationSequence}`,
      occupation: rng.pick(OCCUPATIONS.filter((occupation) => occupation !== "infant")),
      reason: "arrival"
    });
    state.statistics.arrivals += 1;
    events.push({
      type: "immigration",
      actorId: migrant.id,
      title: `${migrant.name} settles in the village`,
      text: `${migrant.name}, a ${migrant.occupation}, has joined the parish.`,
      tone: "change"
    });
  }
}

export function advancePopulationDay(state) {
  upgradePopulationState(state);
  state.material.modifiers ||= {
    foodSecurity: 0,
    grainPrice: 0,
    diseasePressure: 0,
    crime: 0,
    infrastructure: 0
  };
  const day = state.calendar.absoluteDay;
  const events = [];
  const seasons = ["Spring", "Summer", "Autumn", "Winter"];
  state.material.season = seasons[Math.floor((day % 364) / 91)];
  const weatherRng = new PopulationRng(`${state.seed}:weather:${day}`);
  const weatherBySeason = {
    Spring: ["rain", "mild", "wind"],
    Summer: ["sun", "heat", "storm"],
    Autumn: ["rain", "wind", "mild"],
    Winter: ["frost", "snow", "cold"]
  };
  state.material.weather = weatherRng.pick(weatherBySeason[state.material.season]);
  processHouseholds(state, day, events);
  processHealthAndAging(state, day, events);
  processFamilyAndWork(state, day, events);
  processMigration(state, day, events);
  spreadRumors(state, day, events);
  const occupiedHouseholds = state.households.filter((household) => household.memberIds.some((id) => {
    const person = state.residents.find((resident) => resident.id === id);
    return person?.active && person.alive;
  }));
  const averageFood = occupiedHouseholds.reduce((sum, household) => sum + household.food, 0) / Math.max(1, occupiedHouseholds.length);
  const averageWealth = occupiedHouseholds.reduce((sum, household) => sum + household.wealth, 0) / Math.max(1, occupiedHouseholds.length);
  state.material.foodSecurity = clamp(averageFood + state.material.modifiers.foodSecurity);
  state.material.grainPrice = clamp(
    100 - averageFood + (state.material.season === "Winter" ? 15 : 0) + state.material.modifiers.grainPrice
  );
  state.material.diseasePressure = clamp(
    20
      + (100 - averageFood) * 0.2
      + (["cold", "snow", "rain"].includes(state.material.weather) ? 10 : 0)
      + state.material.modifiers.diseasePressure
  );
  state.material.crime = clamp(
    20
      + (100 - averageWealth) * 0.35
      + (state.town.metrics.harmony < 40 ? 15 : 0)
      - state.town.metrics.safety * 0.2
      + state.material.modifiers.crime
  );
  const maintenance = averageWealth * 0.0008 + state.residents.filter((person) => (
    person.active && person.alive && ["carpenter", "mason", "thatcher", "laborer"].includes(person.occupation)
  )).length * 0.0008;
  state.material.infrastructure = clamp(
    state.material.infrastructure
      + maintenance
      - (state.material.weather === "storm" ? 0.5 : 0.08)
      + state.material.modifiers.infrastructure
  );
  if (state.material.crime > 65 && weatherRng.next() < 0.02) {
    const possibleVictims = state.residents.filter((person) => person.active && person.alive);
    if (possibleVictims.length) {
      const victim = weatherRng.pick(possibleVictims);
      victim.prosperity = clamp(victim.prosperity - 5);
      events.push({
        type: "material_crime",
        actorId: victim.id,
        title: `${victim.name} suffers a theft`,
        text: `Hard conditions and weak order lead to theft from ${victim.name}.`,
        tone: "danger"
      });
    }
  }
  state.town.metrics.prosperity = clamp(state.town.metrics.prosperity + (averageWealth - 50) * 0.002);
  state.town.metrics.health = clamp(
    state.town.metrics.health
      + (55 - state.town.metrics.health) * 0.002
      - state.material.diseasePressure * 0.00035
  );
  state.town.metrics.safety = clamp(
    state.town.metrics.safety
      + (55 - state.town.metrics.safety) * 0.002
      - state.material.crime * 0.00035
  );
  for (const key of Object.keys(state.material.modifiers)) {
    const value = state.material.modifiers[key];
    state.material.modifiers[key] = Math.abs(value) <= 1 ? 0 : value - Math.sign(value);
  }
  return events;
}
