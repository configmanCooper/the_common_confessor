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
    const parents = [firstSpouse || adults[0], secondSpouse].filter(Boolean);
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

/* A village is not a set of identical cottages.

   Every household began the game with exactly fifty in coin, fifty in the
   larder, no debt and the same woodpile, which meant the parish had no rich and
   no poor and the priest's charity had nowhere meaningful to land. Standing is
   set here from the work its people actually do, the number of mouths it feeds,
   and its luck, so that the reeve's house and the day-labourer's hovel are
   different places from the first morning.

   The scale is the one the daily economy already uses: food and wealth run 0 to
   100, where a larder below about twenty means buying at market. */
const TRADE_STANDING = {
  reeve: 3, bailiff: 3, merchant: 3, clerk: 3, innkeeper: 3, miller: 3,
  blacksmith: 3, scribe: 3, teacher: 3, healer: 3,
  baker: 2, brewer: 2, carpenter: 2, mason: 2, weaver: 2, dyer: 2, tailor: 2,
  butcher: 2, tanner: 2, cooper: 2, potter: 2, candlemaker: 2, herbalist: 2,
  midwife: 2, cobbler: 2, fishmonger: 2, beekeeper: 2, sexton: 2, sacristan: 2,
  farmer: 2, watchman: 2, soldier: 2,
  shepherd: 1, thatcher: 1, woodcutter: 1, fisherman: 1, peddler: 1,
  spinner: 1, washerwoman: 1, servant: 1, laborer: 1, retired: 1,
  hunter: 1, forester: 1, "charcoal burner": 1, goatherd: 1, stablehand: 1,
  ferryman: 1, gravedigger: 1, unemployed: 0,
  "child laborer": 0, infant: 0
};

function seedHouseholdMeans(state) {
  const rng = new PopulationRng(`${state.seed || "parish"}:means`);
  for (const household of state.households || []) {
    const members = (household.memberIds || [])
      .map((id) => state.residents.find((person) => person.id === id))
      .filter((person) => person && person.alive !== false);
    if (!members.length) continue;
    const earners = members.filter((person) => person.age >= ADULT_AGE);
    /* A household lives by its best trade, helped a little by second earners. */
    const bestStanding = Math.max(0, ...members.map((person) => TRADE_STANDING[person.occupation] ?? 1));
    const secondEarners = Math.max(0, earners.length - 1);
    const mouths = members.length;
    const dependants = members.filter((person) => person.age < 14 || person.age >= 70).length;

    /* Luck of the family: some prosper at the same trade, some do not. */
    const fortune = rng.int(-12, 12);
    const base = [26, 40, 54, 70][bestStanding] ?? 40;
    const strain = dependants * 4 + Math.max(0, mouths - 4) * 3;
    const wealth = clamp(base + fortune + secondEarners * 5 - strain, 4, 96);
    /* The larder tracks means but not exactly: a farming house may be poor in
       coin and still eat, a clerk may be paid and buy everything. */
    const larderTilt = ["farmer", "shepherd", "fisherman", "beekeeper", "miller", "baker"]
      .includes(members[0]?.occupation) ? 10 : 0;
    household.wealth = wealth;
    household.food = clamp(base + rng.int(-14, 14) + larderTilt - strain, 6, 94);
    /* Debt falls on the poor and on households with more mouths than earners. */
    const debtRisk = (bestStanding <= 1 ? 0.45 : bestStanding === 2 ? 0.18 : 0.07)
      + (mouths > earners.length * 2 ? 0.12 : 0);
    household.debt = rng.next() < debtRisk ? rng.int(3, 22) : 0;
    household.fuel = clamp(6 + bestStanding * 5 + rng.int(-5, 9), 0, 40);
    household.dwelling = bestStanding >= 3
      ? (rng.next() < 0.4 ? "farmhouse" : "cottage")
      : bestStanding === 0 || (bestStanding === 1 && rng.next() < 0.45)
        ? "hovel"
        : "cottage";
    for (const property of household.properties || []) {
      if (property.type === "cottage" || property.type === household.dwelling) {
        property.type = household.dwelling;
        property.value = household.dwelling === "hovel" ? rng.int(6, 14)
          : household.dwelling === "farmhouse" ? rng.int(30, 52)
            : rng.int(15, 28);
      }
    }
    household.reputation = clamp(46 + bestStanding * 4 + rng.int(-10, 10), 20, 88);
  }
}

/* Nobody arrives in the world without a past.

   Every villager began the game with an empty memory list, so the first time
   anyone spoke to the priest they had nothing behind them: no grief, no old
   quarrel, no wedding, no hard winter. These are the few things a person would
   actually carry into a conversation, drawn from the family, the graves and the
   relationships already seeded, so that what they remember is true of the
   world rather than invented in the moment.

   Seeded memories are dated before the game opens, which is why the day is
   negative, and they are marked so that later code can tell a remembered past
   from something that happened in play. */
function seedPersonalHistories(state) {
  const findPerson = (id) => state.residents.find((person) => person.id === id);
  for (const person of state.residents || []) {
    if (person.alive === false) continue;
    if ((person.memories || []).length) continue;
    const rng = new PopulationRng(`${state.seed || "parish"}:history:${person.id}`);
    const remember = (memory) => {
      person.memories.push({
        id: `memory-${String(state.nextMemorySequence).padStart(7, "0")}`,
        type: memory.type,
        subjectId: memory.subjectId,
        summary: memory.summary,
        emotion: memory.emotion,
        confidence: memory.confidence ?? 85,
        privateMemory: Boolean(memory.privateMemory),
        visibility: {
          scope: memory.privateMemory ? "private_visit" : "public",
          authorizedPersonIds: [person.id, "priest"]
        },
        day: memory.day,
        seeded: true,
        sourceEventId: null
      });
      state.nextMemorySequence += 1;
    };

    /* The graves they carry. */
    for (const relatedId of person.relationshipIds || []) {
      const departed = findPerson(relatedId);
      if (!departed || departed.alive !== false) continue;
      const years = Math.max(1, Math.round(Math.abs(departed.departureDay || 365) / 365));
      const bond = departed.survivingSpouseId === person.id
        ? `${departed.firstName}, ${person.sex === "female" ? "my husband" : "my wife"},`
        : (departed.parentIds || []).includes(person.id)
          ? `my child ${departed.firstName}`
          : (departed.childrenIds || []).includes(person.id)
            ? `my ${departed.sex === "female" ? "mother" : "father"} ${departed.firstName}`
            : departed.firstName;
      remember({
        type: "bereavement",
        subjectId: departed.id,
        summary: `${bond} died of ${departed.causeOfDeath} about ${years === 1 ? "a year" : `${years} years`} ago.`,
        emotion: "grief",
        day: departed.departureDay || -365
      });
    }

    /* Their marriage. */
    const spouse = person.spouseId ? findPerson(person.spouseId) : null;
    if (spouse) {
      remember({
        type: "life_event",
        subjectId: spouse.id,
        summary: `I married ${spouse.firstName}, and we keep the household together.`,
        emotion: rng.next() < 0.75 ? "warmth" : "resignation",
        day: -rng.int(200, 5000)
      });
    }

    /* The quarrel they have not let go of, and the kindness they have not
       forgotten, both taken from relationships that already exist. */
    const bonds = (state.relationships || []).filter((entry) => entry.actorId === person.id);
    const worst = bonds.reduce((found, entry) => (
      (entry.resentment || 0) > (found?.resentment || 0) ? entry : found
    ), null);
    if (worst && (worst.resentment || 0) >= 26) {
      const other = findPerson(worst.targetId);
      if (other) {
        /* The parish knows whether a neighbour is a man or a woman, so their
           grievances should say so rather than reaching for a bare "them". */
        const hisHer = other.sex === "female" ? "her" : "his";
        remember({
          type: "grievance",
          subjectId: other.id,
          summary: rng.pick([
            `${other.firstName} shorted me over a debt and has never owned it.`,
            `${other.firstName} spoke against me where the whole lane could hear.`,
            `${other.firstName} took work that was promised to me.`,
            `${other.firstName} let ${hisHer} beasts into my ground and denied it after.`,
            `${other.firstName} carried a tale about my household that was not true.`
          ]),
          emotion: "resentment",
          privateMemory: true,
          day: -rng.int(30, 900)
        });
      }
    }
    const best = bonds.reduce((found, entry) => (
      (entry.affection || 0) > (found?.affection || 0) ? entry : found
    ), null);
    if (best && (best.affection || 0) >= 52) {
      const other = findPerson(best.targetId);
      if (other) {
        const himHer = other.sex === "female" ? "her" : "him";
        remember({
          type: "kindness",
          subjectId: other.id,
          summary: rng.pick([
            `${other.firstName} sat with us through a bad winter and asked nothing for it.`,
            `${other.firstName} lent us grain when the larder was bare.`,
            `${other.firstName} worked my ground for me when I could not stand.`,
            `${other.firstName} has never once repeated what I told ${himHer}.`
          ]),
          emotion: "gratitude",
          day: -rng.int(30, 1200)
        });
      }
    }

    /* Something from their own life: the work, or the year that went badly. */
    if (person.age >= ADULT_AGE) {
      remember({
        type: "hardship",
        subjectId: person.id,
        summary: rng.pick([
          `The bad harvest three years back emptied our store and we have not caught up.`,
          `I took my trade as a ${person.occupation} from my father and have kept it since.`,
          `There was a winter we burned the furniture, and I do not speak of it.`,
          `Fever went through this lane and left us thinner than it found us.`,
          `I have worked as a ${person.occupation} since I was old enough to carry.`,
          `We lost beasts to the murrain and bought none to replace them.`
        ]),
        emotion: "weariness",
        day: -rng.int(200, 1600)
      });
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

  /* Household membership must agree with who is actually alive. A living
     villager always belongs to their household's roll; the dead never do,
     because the roll is the list of mouths the household feeds. Repairing this
     during the upgrade keeps older saves loadable and stops a resurrected or
     newly buried resident from breaking the integrity check. */
  for (const household of state.households || []) {
    household.memberIds ||= [];
    household.memberIds = household.memberIds.filter((memberId) => {
      const member = (state.residents || []).find((person) => person.id === memberId);
      return member && member.alive !== false;
    });
  }
  for (const person of state.residents || []) {
    if (person.alive === false) continue;
    const household = (state.households || []).find((entry) => entry.id === person.householdId);
    if (household && !household.memberIds.includes(person.id)) household.memberIds.push(person.id);
  }

  for (const household of state.households || []) {
    household.wealth ??= 50;
    household.food ??= 50;
    household.debt ??= 0;
    /* A woodpile a household would ordinarily keep: enough that it is not
       cold, and not so much that a gift of fuel is meaningless. */
    household.fuel ??= 16;
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
    seedHouseholdMeans(state);
    state.householdFamiliesSeeded = true;
  }
  const existing = new Set(state.relationships.map((relationship) => relationship.id));
  for (const person of state.residents || []) {
    /* The living remember the dead; the dead hold no opinions. A grave keeps
       its place in a mourner's list of acquaintances, which is what lets grief
       find a real body, but it is never the actor in a relationship. This also
       covers villagers who die during play and whose acquaintances outlive
       them. */
    if (person.alive === false) continue;
    for (const targetId of person.relationshipIds || []) {
      const id = relationshipId(person.id, targetId);
      if (!existing.has(id)) {
        state.relationships.push(defaultRelationship(state, person.id, targetId));
        existing.add(id);
      }
    }
  }
  /* Runs last, because a person's remembered past is drawn from the family,
     the graves and the relationships seeded above. */
  if (shouldSeedFamilies) seedPersonalHistories(state);
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
    const workers = members.filter((person) => (
      person.age >= 14 && !["unemployed", "infant", "retired"].includes(person.occupation)
    ));
    const harvestFactor = {
      Spring: 0.9,
      Summer: 1.25,
      Autumn: 1.4,
      Winter: 0.55
    }[state.material.season];
    const weatherFactor = ["storm", "frost", "snow"].includes(state.material.weather) ? 0.75 : state.material.weather === "sun" ? 1.12 : 1;
    const production = workers.reduce((total, worker) => {
      const base = Math.max(0.35, worker.prosperity / 42);
      /* A man in his bed brings nothing home. The household economy read only
         prosperity, so a worker could be bedridden with lung sickness for a
         fortnight and his household lose not a penny by it - which made
         medicine a kindness with no consequence rather than the thing that
         puts a family back on its feet. */
      const wellEnough = worker.illness
        ? (worker.illness === "lung sickness" ? 0.2 : 0.4)
        : worker.injury
          ? (worker.injury.severity >= 60 ? 0.25 : 0.65)
          : 1;
      const strength = 0.55 + clamp(worker.health, 0, 100) / 100 * 0.45;
      return total + base * wellEnough * strength
        * (["farmer", "shepherd", "miller"].includes(worker.occupation) ? harvestFactor * weatherFactor : 1);
    }, 0);
    const householdSupport = members.reduce((total, member) => {
      if (member.age >= 10 && member.age < 14 && member.occupation === "child laborer") return total + 0.22;
      if (member.occupation === "retired" && member.health >= 35) return total + 0.18;
      return total;
    }, 0);
    const consumption = members.reduce((total, member) => (
      total + (member.age < 10 ? 0.5 : 0.85) * (state.material.season === "Winter" ? 1.1 : 1)
    ), 0);
    const totalProduction = production + householdSupport;
    const consumptionShortfall = Math.max(0, consumption - totalProduction);
    /* A household short of what it eats does not always go to market. It goes
       to its own larder first, and only buys what the larder cannot cover.
       That is the piece this economy was missing: a full store meant nothing,
       because the shortfall was bought at market whatever was on the shelf.
       Now anything that fills a larder - a good harvest, a neighbour's
       kindness, or bread from the church - is felt twice, once as food and
       again as coin not spent.
       It is self-limiting in the way it should be: a household that already
       has plenty was never going to buy, so giving it bread saves it nothing.
       Only the ones actually running short keep any silver by it. */
    const larder = household.food ?? 50;
    const drawableFromStore = Math.max(0, Math.min(consumptionShortfall, (larder - 20) / 25));
    const shortage = consumptionShortfall - drawableFromStore;
    const surplus = Math.max(0, totalProduction - consumption);
    const marketCost = shortage * (state.material.grainPrice / 50) * 0.15;
    const marketIncome = surplus * (state.material.grainPrice / 50) * 0.16;
    /* Keeping warm is an expense, and a heavier one in winter. A household with
       fuel in the woodpile burns that instead of buying, so firewood - from
       their own cutting, a neighbour, or the church - is felt as coin the same
       way a full larder is. A household with plenty stacked was never going to
       buy any, so it keeps nothing by being given more. */
    const fuelNeed = state.material.season === "Winter" ? 0.5
      : state.material.season === "Autumn" ? 0.25
        : 0.1;
    const woodpile = household.fuel ?? 0;
    const burned = Math.min(woodpile, fuelNeed);
    household.fuel = clamp(woodpile - burned, 0, 100);
    const fuelCost = (fuelNeed - burned) * (state.material.season === "Winter" ? 0.5 : 0.3);
    household.dailyProduction = totalProduction;
    household.food = clamp(household.food + totalProduction - consumption, 0, 100);
    household.wealth = clamp(
      household.wealth + totalProduction * 0.24 + marketIncome
        - consumption * 0.15 - marketCost - fuelCost - household.debt * 0.002,
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
    const livingCount = state.residents.reduce(
      (total, resident) => total + (resident.alive === false ? 0 : 1),
      0
    );
    if (rumor.heardByIds.length >= Math.min(80, livingCount * 0.45)) {
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
        person.occupation = workRng.pick(OCCUPATIONS.filter((occupation) => (
          !["unemployed", "infant", "retired"].includes(occupation)
        )));
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
    /* Dying of an illness.

       A sickness in this century is dangerous in proportion to three things:
       what it is, how long it has held, and whether anyone is caring for the
       person who has it. A fever in a warm house with food in it is survivable;
       the same fever in a cold house with an empty larder and nobody to sit up
       at night is how people died. Church medicine and a well-fed household are
       therefore not decoration — they are the difference. */
    let illnessRisk = 0;
    if (person.illness) {
      const severity = person.illness === "lung sickness" ? 1.7 : 1;
      const duration = Math.min(2.4, 0.5 + (person.illnessDays || 0) * 0.07);
      const frailty = person.age > 62 ? 1.9 : person.age < 5 ? 2.2 : person.age < 14 ? 1.3 : 1;
      const weakness = Math.max(0, (55 - person.health) / 55);
      const care = household ? household.food / 100 + household.wealth / 150 : 0.2;
      const nursing = (person.flags || []).some((flag) => flag.startsWith("tended_by_church"))
        ? 0.45
        : care > 0.7 ? 0.6 : care > 0.4 ? 1 : 1.8;
      illnessRisk = 0.0016 * severity * duration * frailty * nursing * (0.25 + weakness * 1.9);
    }
    if (person.injury && !person.injury.treated) {
      /* A wound left alone does not stay the same size. */
      illnessRisk += (person.injury.severity / 100) * 0.004;
    }
    if (rng.next() < ageRisk + illnessRisk) {
      person.alive = false;
      person.active = false;
      person.causeOfDeath = person.illness
        || (person.injury && !person.injury.treated ? `an untended ${person.injury.kind || "injury"}` : null)
        || "old age";
      person.departureDay = day;
      person.pregnantDueDay = null;
      person.pregnancyCoParentId = null;
      const spouse = state.residents.find((candidate) => candidate.id === person.spouseId);
      if (spouse?.alive) {
        spouse.maritalStatus = "widowed";
        /* Who they were widowed from, so the survivor can still name their own
           husband. Clearing spouseId alone left the link on the dead side only,
           and the roster then told a widow that her buried husband was merely
           somebody of her household. */
        spouse.widowedFromId = person.id;
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

/* ==========================================================================
   Injuries, and what people do to one another
   --------------------------------------------------------------------------
   A wound is not a number that ticks down to zero on its own. Left alone in a
   cold house it festers and can kill; cleaned and bound by someone who knows
   how, it closes. That makes a healer in the parish, and a dose of the church's
   medicine, worth something concrete.

   Violence here is never random. It grows out of a bond that has actually
   soured — resentment built up between two named people over weeks — and it
   needs someone who has run out of other things to do: ruined, frightened, or
   drunk on his own grievance. Most such bonds never come to anything. A few end
   in a beating. Very rarely, where the hatred is total and the man has nothing
   left to lose, one of them kills the other.
   ========================================================================== */

const INJURY_KINDS = Object.freeze([
  { kind: "broken arm", description: "with a broken arm", severity: [35, 55], work: true },
  { kind: "crushed foot", description: "with a crushed foot", severity: [30, 50], work: true },
  { kind: "deep cut", description: "with a deep cut gone bad", severity: [25, 45], work: true },
  { kind: "cracked ribs", description: "with cracked ribs", severity: [30, 50], work: false },
  { kind: "burn", description: "with a bad burn", severity: [25, 45], work: true },
  { kind: "beating", description: "from a beating", severity: [30, 60], work: false }
]);

/** Give someone a wound, and say so. */
export function inflictInjury(state, person, kind, severity, events, cause) {
  const template = INJURY_KINDS.find((entry) => entry.kind === kind) || INJURY_KINDS[0];
  person.injury = {
    kind: template.kind,
    description: template.description,
    severity: clamp(severity, 5, 100),
    day: state.calendar.absoluteDay,
    treated: false,
    cause: cause || null
  };
  person.health = clamp(person.health - severity * 0.35);
  person.stress = clamp(person.stress + severity * 0.25);
  events?.push({
    type: "injury",
    actorId: person.id,
    title: `${person.name} is hurt`,
    text: `${person.name} is laid up ${template.description}.`,
    tone: "danger"
  });
  return person.injury;
}

function processInjuries(state, day, events) {
  for (const person of state.residents.filter((entry) => entry.alive && entry.active)) {
    const rng = new PopulationRng(`${state.seed}:injury:${person.id}:${day}`);
    const household = householdFor(state, person);

    if (!person.injury) {
      /* Ordinary hazards of ordinary work. Some trades are simply dangerous,
         and the man who slips is the one who is exhausted or unwell. */
      const dangerous = ["woodcutter", "forester", "charcoal burner", "blacksmith", "mason", "thatcher",
        "carpenter", "miller", "tanner", "butcher", "soldier", "hunter", "ferryman", "laborer", "stablehand"];
      if (person.age >= 14 && person.age <= 70 && dangerous.includes(person.occupation)) {
        const tiredness = 1 + Math.max(0, person.stress - 50) / 60 + Math.max(0, 55 - person.health) / 70;
        if (rng.next() < 0.00035 * tiredness) {
          const template = rng.pick(INJURY_KINDS.filter((entry) => entry.work));
          inflictInjury(state, person, template.kind, rng.int(template.severity[0], template.severity[1]), events, "work");
        }
      }
      continue;
    }

    /* Who is looking after it: a healer under the same roof, the church's
       medicine, or simply a house with food and warmth in it. */
    const healerAtHand = state.residents.some((entry) => (
      entry.alive && entry.active
        && entry.householdId === person.householdId
        && ["healer", "herbalist", "midwife"].includes(entry.occupation)
    ));
    const tendedByChurch = (person.flags || []).some((flag) => flag.startsWith("tended_by_church"));
    const comfort = household ? household.food / 120 + household.wealth / 200 : 0.1;
    const cared = tendedByChurch || healerAtHand || comfort > 0.65;

    if (cared) {
      person.injury.treated = true;
      person.injury.severity = clamp(person.injury.severity - rng.int(3, 7), 0, 100);
      person.health = clamp(person.health + 0.9);
    } else {
      person.injury.treated = false;
      person.injury.severity = clamp(person.injury.severity + rng.int(0, 3), 0, 100);
      person.health = clamp(person.health - 0.5);
      if (person.injury.severity > 70 && !person.illness && rng.next() < 0.03) {
        person.illness = "wound fever";
        person.illnessDays = 1;
        events.push({
          type: "illness_began",
          actorId: person.id,
          title: `${person.name}'s wound turns bad`,
          text: `${person.name}'s untended ${person.injury.kind} has gone to wound fever.`,
          tone: "danger"
        });
      }
    }

    if (person.injury.severity <= 4) {
      const kind = person.injury.kind;
      person.injury = null;
      events.push({
        type: "injury_healed",
        actorId: person.id,
        title: `${person.name} is mended`,
        text: `${person.name}'s ${kind} has healed.`,
        tone: "change"
      });
    }
  }
}

function processViolence(state, day, events) {
  for (const bond of state.relationships || []) {
    const resentment = bond.resentment ?? 0;
    const affection = bond.affection ?? 50;
    /* Only bonds that have genuinely gone rotten are even considered. */
    if (resentment < 68 || affection > 30) continue;

    const actor = state.residents.find((entry) => entry.id === bond.actorId);
    const target = state.residents.find((entry) => entry.id === bond.targetId);
    if (!actor?.alive || !actor.active || !target?.alive || !target.active) continue;
    if (actor.age < 15 || actor.age > 70) continue;

    const rng = new PopulationRng(`${state.seed}:violence:${bond.id}:${day}`);
    const household = householdFor(state, actor);
    const traits = actor.personality?.traits || [];

    /* Someone with something to lose rarely does this. Desperation, drink and a
       violent temper are what turn a grudge into a broken arm. */
    let pressure = (resentment - 68) / 32;
    pressure += Math.max(0, actor.stress - 60) / 55;
    pressure += Math.max(0, 35 - actor.morale) / 70;
    if (household && household.food < 22) pressure += 0.35;
    if (household && household.wealth < 15) pressure += 0.3;
    if (traits.includes("violent") || traits.includes("hot-tempered") || traits.includes("wrathful")) pressure += 0.5;
    if (traits.includes("vengeful") || traits.includes("resentful")) pressure += 0.3;
    if (traits.includes("gentle") || traits.includes("pious") || traits.includes("devout")) pressure -= 0.45;
    /* A parish that holds together, and a priest they believe, restrain people. */
    pressure -= (state.town.metrics.harmony - 50) / 130;
    /* A parish that expects mercy is slower to take matters into its own hands. */
    pressure -= (state.town.metrics.mercy - 50) / 160;
    pressure += Math.max(0, 45 - state.material.foodSecurity) / 90;
    pressure -= Math.max(0, actor.faith - 55) / 110;
    pressure -= Math.max(0, actor.trustPriest - 60) / 120;
    pressure -= (state.town.metrics.safety - 50) / 150;
    if (pressure <= 0) continue;
    if (rng.next() > 0.0022 * pressure) continue;

    /* How far it goes. Killing is the rarest end of this, and needs a hatred
       that has consumed everything else. */
    const murderous = resentment > 92
      && affection < 10
      && pressure > 1.6
      && (traits.includes("violent") || traits.includes("vengeful") || actor.morale < 15)
      && rng.next() < 0.1;

    if (murderous) {
      target.alive = false;
      target.active = false;
      target.causeOfDeath = "violence";
      target.departureDay = day;
      target.pregnantDueDay = null;
      target.pregnancyCoParentId = null;
      const spouse = state.residents.find((entry) => entry.id === target.spouseId);
      if (spouse?.alive) {
        spouse.maritalStatus = "widowed";
        spouse.widowedFromId = target.id;
        spouse.spouseId = null;
        spouse.marriageDay = null;
      }
      target.maritalStatus = "deceased";
      target.spouseId = null;
      target.marriageDay = null;
      actor.flags = [...(actor.flags || []), "suspected_of_killing"];
      actor.reputation = clamp(actor.reputation - 45);
      actor.stress = clamp(actor.stress + 40);
      state.town.metrics.safety = clamp(state.town.metrics.safety - 9);
      state.town.metrics.harmony = clamp(state.town.metrics.harmony - 7);
      state.material.modifiers.crime = (state.material.modifiers.crime || 0) + 14;
      events.push({
        type: "killing",
        actorId: actor.id,
        targetId: target.id,
        title: `${target.name} is killed`,
        text: `${target.name} is found dead. ${actor.name} is spoken of, and the parish is afraid.`,
        tone: "danger"
      });
      continue;
    }

    const severity = rng.int(25, 55) + Math.round(Math.min(20, pressure * 10));
    inflictInjury(state, target, "beating", severity, events, actor.id);
    actor.reputation = clamp(actor.reputation - 18);
    target.stress = clamp(target.stress + 18);
    bond.resentment = clamp(resentment + 8);
    bond.fear = clamp((bond.fear ?? 0) + 20);
    state.town.metrics.safety = clamp(state.town.metrics.safety - 2.5);
    state.town.metrics.harmony = clamp(state.town.metrics.harmony - 1.5);
    state.material.modifiers.crime = (state.material.modifiers.crime || 0) + 5;
    events.push({
      type: "assault",
      actorId: actor.id,
      targetId: target.id,
      title: `${actor.name} attacks ${target.name}`,
      text: `A grudge between ${actor.name} and ${target.name} has come to blows.`,
      tone: "danger"
    });
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
      person.occupation = rng.pick(OCCUPATIONS.filter((occupation) => !["unemployed", "retired"].includes(occupation)));
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

/* ==========================================================================
   Settling the parish
   --------------------------------------------------------------------------
   Every figure on the priest's panel has to be two things at once: something
   the week can move, and something that moves the week. A number that only
   goes up is scenery; a number nothing reads is a lie.

   This is where the day's events are turned back into the parish's condition,
   so that charity shows up as mercy, violence shows up as fear, a good harvest
   shows up as prosperity, and each of those then goes on to change what
   happens next. What reads what:

     harmony        restrains violence, slows rumour, keeps people from leaving
     faith          restrains violence, raises attendance and giving
     prosperity     sets what the village can pay at market, and who leaves
     health         sets how ill people get and how quickly they mend
     safety         restrains violence and holds down crime
     mercy          decides how freely the parish gives, and how it treats its own
     food security  drives hunger, illness, crime and what is left to sell
     infrastructure sets how much the mill, roads and bridges let the parish make
     crime          eats prosperity and safety
   ========================================================================== */
function settleParishConsequences(state, day, events) {
  const metrics = state.town.metrics;
  const counts = {};
  for (const event of events) counts[event.type] = (counts[event.type] || 0) + 1;
  /* What the priest himself did does not arrive through the population day —
     charity, collections and market trade are written when he acts, into the
     parish's own record. They have to be read from there or the church's
     generosity would never show up in the parish's condition at all. */
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index];
    if ((event.day ?? 0) < day - 1) break;
    if (event.type === "church_aid_given" || event.type === "sunday_offering" || event.type === "market_purchase") {
      counts[event.type] = (counts[event.type] || 0) + 1;
    }
  }

  /* Blood in the parish is felt as fear and as division, and it is felt for
     longer than the day it happened. */
  const violence = (counts.assault || 0) + (counts.killing || 0) * 4;
  if (violence) {
    metrics.safety = clamp(metrics.safety - violence * 0.8);
    metrics.harmony = clamp(metrics.harmony - violence * 0.6);
    metrics.mercy = clamp(metrics.mercy - violence * 0.4);
  }

  /* Charity is the parish learning what it is for. Where the church gives, the
     village gives; where it turns people away, the village hardens. */
  const charity = counts.church_aid_given || 0;
  if (charity) {
    metrics.mercy = clamp(metrics.mercy + charity * 0.9);
    metrics.harmony = clamp(metrics.harmony + charity * 0.3);
  }
  if (counts.sunday_offering) metrics.faith = clamp(metrics.faith + 0.6);
  if (counts.market_purchase) metrics.prosperity = clamp(metrics.prosperity + 0.4);

  /* Suffering nobody answers costs the parish its faith and its softness. */
  const suffering = (counts.death || 0) * 1.4 + (counts.injury || 0) * 0.5 + (counts.illness_began || 0) * 0.3;
  if (suffering) {
    metrics.faith = clamp(metrics.faith - suffering * 0.35);
    metrics.health = clamp(metrics.health - suffering * 0.5);
  }
  if (counts.illness_recovered || counts.injury_healed) {
    metrics.health = clamp(metrics.health + ((counts.illness_recovered || 0) + (counts.injury_healed || 0)) * 0.4);
    metrics.mercy = clamp(metrics.mercy + 0.2);
  }

  /* Mercy is not sentiment, and it is not a running total either. It is the
     parish's present belief about whether it will be caught when it falls, so
     it is drawn towards what the parish can presently see: a church that gives,
     a priest they trust, neighbours who are fed, nobody being beaten. It moves
     slowly, because a reputation for hardness takes weeks to earn and weeks to
     lose. */
  const living = state.residents.filter((person) => person.alive && person.active);
  const hungry = living.filter((person) => {
    const household = householdFor(state, person);
    return household && household.food < 30;
  }).length;
  const hungryShare = living.length ? hungry / living.length : 0;
  const mercyTarget = clamp(
    38
      + (metrics.faith - 50) * 0.35
      + (state.priest.moralAuthority - 50) * 0.25
      + charity * 4.5
      - hungryShare * 28
      - violence * 5
      - state.priest.scandal * 0.2
  );
  metrics.mercy = clamp(metrics.mercy + (mercyTarget - metrics.mercy) * 0.05);

  /* The building trades keep the mill turning, the bridge up and the roofs on.
     Storms undo it, and nobody has time for it in a hungry year. */
  const builders = living.filter((person) => (
    ["carpenter", "mason", "thatcher", "cooper", "laborer"].includes(person.occupation)
      && person.age >= 14 && person.age <= 70 && !person.illness && !person.injury
  )).length;
  state.material.infrastructure = clamp(
    state.material.infrastructure
      + builders * 0.02 * (1 - hungryShare)
      - (state.material.weather === "storm" ? 0.55 : 0.12)
      - Math.max(0, 45 - metrics.prosperity) * 0.004
      + (state.material.modifiers.infrastructure || 0)
  );

  /* Roads and a sound mill are what let a village turn its labour into goods,
     and standing water and broken roofs are what make it sick. */
  metrics.prosperity = clamp(metrics.prosperity + (state.material.infrastructure - 50) * 0.004);
  state.material.diseasePressure = clamp(
    state.material.diseasePressure + (50 - state.material.infrastructure) * 0.006
  );

  /* A parish at peace with itself keeps more of its people. */
  metrics.harmony = clamp(metrics.harmony + (metrics.faith - 50) * 0.002 - (state.material.crime - 40) * 0.004);
  metrics.faith = clamp(metrics.faith - state.priest.scandal * 0.004);
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
  for (const resident of state.residents) {
    resident.flags = (resident.flags || []).filter((flag) => {
      const match = /_until_day_(\d+)$/.exec(flag);
      return !match || Number(match[1]) >= day;
    });
  }
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
  processInjuries(state, day, events);
  processViolence(state, day, events);
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
  /* Infrastructure is settled once, in settleParishConsequences, where the
     builders' actual condition is known. Applying it here too decayed it twice
     and no parish could keep its roads up. */
  void maintenance;
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
  settleParishConsequences(state, day, events);
  return events;
}
