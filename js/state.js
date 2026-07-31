import { PHASE_ZERO_SAFE_ACTIONS, SERMON_THEMES } from "./data.js";
import { validateConversation, validateSermonResponse } from "./ai.js";

export const STATE_SCHEMA_VERSION = 2;
const COMMAND_TYPES = new Set(["begin_visit", "conversation_exchange", "finish_visit", "deliver_sermon"]);
const COMMAND_SOURCES = new Set(["simulation", "fallback", "ai"]);
let replayVerifier = null;

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => key !== "integrityHash")
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export function computeIntegrityHash(state) {
  const text = stableStringify(state);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function sealState(state) {
  state.integrityHash = computeIntegrityHash(state);
  return state;
}

function verifyIntegrity(state) {
  if (typeof state.integrityHash !== "string" || state.integrityHash !== computeIntegrityHash(state)) {
    throw new Error("Save integrity check failed");
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
}

function requireFinite(value, label, minimum = -Infinity, maximum = Infinity) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is outside its valid range`);
  }
}

function buildHouseholds(residents) {
  const households = new Map();
  for (const resident of residents) {
    if (!households.has(resident.householdId)) {
      households.set(resident.householdId, {
        id: resident.householdId,
        surname: resident.surname,
        memberIds: [],
        wealth: 50,
        food: 50,
        debt: 0,
        reputation: 50,
        dwelling: "cottage"
      });
    }
    households.get(resident.householdId).memberIds.push(resident.id);
  }
  return [...households.values()];
}

function defaultPriest() {
  return {
    id: "priest",
    name: "Father Benedict",
    health: 100,
    fatigue: 0,
    safety: 70,
    localTrust: 50,
    moralAuthority: 50,
    scandal: 0,
    bishopFavor: 50,
    royalNotice: 0,
    romanAttention: 0,
    alive: true,
    promises: [],
    supporters: [],
    enemies: [],
    accusations: []
  };
}

export function migrateState(rawState) {
  requireObject(rawState, "Save");
  const state = cloneJson(rawState);
  const detectedVersion = Number(state.schemaVersion ?? state.version ?? 1);
  if (detectedVersion > STATE_SCHEMA_VERSION) {
    throw new Error(`Save schema ${detectedVersion} is newer than this game supports`);
  }
  if (detectedVersion < 1) {
    throw new Error(`Unsupported save schema ${detectedVersion}`);
  }
  if (detectedVersion === 1) {
    requireArray(state.residents, "Save residents");
    if (!state.residents.length || !state.residents.some((resident) => resident?.active === true)) {
      throw new Error("Legacy save has no active resident roster");
    }
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    state.priest = state.priest || defaultPriest();
    state.households = state.households || buildHouseholds(state.residents);
    state.externalActors = state.externalActors || [];
    state.eventQueue = state.eventQueue || [];
    state.commandLog = state.commandLog || [];
    state.aiProposals = state.aiProposals || [];
    const legacyChronicle = state.chronicle || [];
    const chronologicalChronicle = [...legacyChronicle].reverse();
    state.events = state.events || chronologicalChronicle.map((entry, index) => ({
      id: `event-${String(index + 1).padStart(6, "0")}`,
      type: index === 0 ? "world_started" : "legacy_chronicle",
      day: Number(entry.day) || 0,
      parentId: index === 0 ? null : `event-${String(index).padStart(6, "0")}`,
      actorId: null,
      targetId: null,
      facts: { title: entry.title || "Legacy event", tone: entry.tone || "neutral" }
    }));
    state.nextEventSequence = Math.max(state.events.length + 1, Number(state.nextEventSequence) || 1);
    state.nextCommandSequence = Math.max(state.commandLog.length + 1, Number(state.nextCommandSequence) || 1);
    state.chronicle = legacyChronicle.map((entry, index) => ({
      ...entry,
      eventId: entry.eventId || state.events[legacyChronicle.length - index - 1]?.id || null
    }));
    if (state.currentVisit) {
      state.currentVisit.visitId ||= `visit-${state.calendar?.absoluteDay || 0}-${state.calendar?.slot || 0}-${state.currentVisit.personId}`;
      delete state.currentVisit.startedAt;
      state.currentVisit.originEventId ||= state.events.at(-1)?.id || null;
      state.currentVisit.eventLicense ||= "ordinary";
    }
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    const replaySnapshot = {
      ...cloneJson(state),
      commandLog: [],
      aiProposals: [],
      nextCommandSequence: 1,
      replayBase: null
    };
    sealState(replaySnapshot);
    state.replayBase = {
      kind: "legacy",
      legacySchemaVersion: 1,
      legacySource: cloneJson(rawState),
      snapshot: replaySnapshot
    };
    sealState(state);
  }
  state.schemaVersion = STATE_SCHEMA_VERSION;
  state.version = STATE_SCHEMA_VERSION;
  return state;
}

export function validateState(state) {
  requireObject(state, "State");
  if (state.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new Error(`State schema must be ${STATE_SCHEMA_VERSION}`);
  }
  requireObject(state.town, "Town");
  for (const field of ["name", "description", "seed"]) {
    if (typeof state.town[field] !== "string" || !state.town[field].trim()) throw new Error(`Town ${field} is invalid`);
  }
  requireObject(state.town.metrics, "Town metrics");
  const townMetricNames = ["harmony", "faith", "prosperity", "health", "safety", "mercy"];
  if (Object.keys(state.town.metrics).sort().join(",") !== [...townMetricNames].sort().join(",")) {
    throw new Error("Town metrics have invalid keys");
  }
  for (const metric of townMetricNames) {
    requireFinite(state.town.metrics[metric], `Town metric ${metric}`, 0, 100);
  }
  requireObject(state.calendar, "Calendar");
  for (const [field, minimum, maximum] of [
    ["absoluteDay", 0, Infinity],
    ["week", 1, Infinity],
    ["dayIndex", 0, 6],
    ["slot", 0, 3]
  ]) {
    if (!Number.isInteger(state.calendar[field]) || state.calendar[field] < minimum || state.calendar[field] > maximum) {
      throw new Error(`Calendar ${field} is invalid`);
    }
  }
  if (state.calendar.dayIndex !== state.calendar.absoluteDay % 7
    || state.calendar.week !== Math.floor(state.calendar.absoluteDay / 7) + 1) {
    throw new Error("Calendar fields are inconsistent");
  }
  if (state.calendar.dayIndex === 6 && state.calendar.slot !== 0) {
    throw new Error("Sunday cannot contain an ordinary appointment slot");
  }
  requireObject(state.priest, "Priest");
  if (state.priest.id !== "priest") throw new Error("Priest ID is invalid");
  if (typeof state.priest.name !== "string" || !state.priest.name.trim()) throw new Error("Priest name is invalid");
  for (const field of [
    "health", "fatigue", "safety", "localTrust", "moralAuthority", "scandal",
    "bishopFavor", "royalNotice", "romanAttention"
  ]) {
    requireFinite(state.priest[field], `Priest ${field}`, 0, 100);
  }
  if (typeof state.priest.alive !== "boolean") throw new Error("Priest alive state is invalid");
  for (const field of ["promises", "supporters", "enemies", "accusations"]) {
    requireArray(state.priest[field], `Priest ${field}`);
    if (state.priest[field].some((entry) => typeof entry !== "string")) throw new Error(`Priest ${field} is invalid`);
  }
  requireArray(state.residents, "Residents");
  if (!state.residents.length || !state.residents.some((resident) => resident?.active === true)) {
    throw new Error("State has no active resident roster");
  }
  requireArray(state.households, "Households");
  requireArray(state.externalActors, "External actors");
  requireArray(state.eventQueue, "Event queue");
  requireArray(state.commandLog, "Command log");
  requireArray(state.aiProposals, "AI proposals");
  requireArray(state.events, "Events");
  requireArray(state.chronicle, "Chronicle");
  requireArray(state.sermons, "Sermons");
  requireArray(state.conversationHistory, "Conversation history");
  requireObject(state.settings, "Settings");
  requireObject(state.statistics, "Statistics");
  if (typeof state.settings.aiEnabled !== "boolean") throw new Error("AI setting is invalid");
  for (const field of [
    "conversations", "confessions", "peopleRevealed", "cascades",
    "births", "arrivals", "departures"
  ]) {
    if (!Number.isInteger(state.statistics[field]) || state.statistics[field] < 0) {
      throw new Error(`Statistic ${field} is invalid`);
    }
  }
  for (const sermon of state.sermons) {
    requireObject(sermon, "Sermon");
    if (!Number.isInteger(sermon.day) || sermon.day < 0 || !SERMON_THEMES.includes(sermon.theme)
      || typeof sermon.text !== "string" || typeof sermon.summary !== "string"
      || !Number.isInteger(sermon.attendance) || sermon.attendance < 0) {
      throw new Error("Sermon record is invalid");
    }
  }
  if (state.replayBase != null) {
    requireObject(state.replayBase, "Replay base");
    if (state.replayBase.kind === "legacy") {
      requireObject(state.replayBase.legacySource, "Replay base legacy source");
      if (state.replayBase.legacySource.version !== 1 || state.replayBase.legacySource.schemaVersion != null
        || state.replayBase.legacySource.replayBase != null) {
        throw new Error("Replay base was not created from a schema-v1 save");
      }
      const remigrated = migrateState(state.replayBase.legacySource);
      if (stableStringify(remigrated.replayBase.snapshot) !== stableStringify(state.replayBase.snapshot)) {
        throw new Error("Replay base does not match its legacy source migration");
      }
    } else if (state.replayBase.kind !== "periodic") {
      throw new Error("Replay base kind is invalid");
    }
    requireObject(state.replayBase.snapshot, "Replay base snapshot");
    if (state.replayBase.snapshot.replayBase != null) throw new Error("Replay base snapshots cannot be nested");
    if (state.replayBase.snapshot.commandLog.length || state.replayBase.snapshot.aiProposals.length) {
      throw new Error("Replay base snapshot must begin with an empty command log");
    }
    validateState(state.replayBase.snapshot);
  }

  const people = [...state.residents, ...state.externalActors];
  const personIds = new Set();
  const residentIds = new Set(state.residents.map((person) => person.id));
  const residentNames = new Set();
  for (const person of people) {
    requireObject(person, "Person");
    if (typeof person.id !== "string" || !person.id) throw new Error("Person ID is invalid");
    if (personIds.has(person.id)) throw new Error(`Duplicate person ID: ${person.id}`);
    personIds.add(person.id);
    if (typeof person.name !== "string" || !person.name.trim()) throw new Error(`Person ${person.id} has no name`);
    if (residentIds.has(person.id)) {
      if (residentNames.has(person.name)) throw new Error(`Duplicate resident name: ${person.name}`);
      residentNames.add(person.name);
      if (typeof person.firstName !== "string" || typeof person.surname !== "string") throw new Error(`Resident ${person.id} has invalid name fields`);
      if (!["female", "male"].includes(person.sex)) throw new Error(`Resident ${person.id} has invalid sex`);
      requireFinite(person.age, `Age for ${person.id}`, 0, 120);
      if (typeof person.householdId !== "string") throw new Error(`Resident ${person.id} has no household`);
      if (typeof person.occupation !== "string") throw new Error(`Resident ${person.id} has invalid occupation`);
      if (!Number.isInteger(person.sprite) || person.sprite < 0 || person.sprite > 41) throw new Error(`Resident ${person.id} has invalid sprite`);
      for (const field of ["active", "profileRevealed", "materialized"]) {
        if (typeof person[field] !== "boolean") throw new Error(`Resident ${person.id} has invalid ${field}`);
      }
      if (!Number.isInteger(person.visitCount) || person.visitCount < 0) throw new Error(`Resident ${person.id} has invalid visit count`);
      requireFinite(person.lastVisitDay, `Last visit day for ${person.id}`);
      for (const field of ["attendanceChance", "trustPriest", "faith", "morale", "prosperity", "health", "stress", "reputation"]) {
        requireFinite(person[field], `${field} for ${person.id}`, 0, 100);
      }
      requireArray(person.relationshipIds, `Relationships for ${person.id}`);
      requireArray(person.memories, `Memories for ${person.id}`);
      requireArray(person.flags, `Flags for ${person.id}`);
      if (person.memories.some((memory) => typeof memory !== "string")) throw new Error(`Resident ${person.id} has invalid memories`);
      if (person.flags.some((flag) => typeof flag !== "string")) throw new Error(`Resident ${person.id} has invalid flags`);
      if (person.materialized) {
        requireObject(person.personality, `Personality for ${person.id}`);
        requireArray(person.personality.traits, `Traits for ${person.id}`);
        if (person.personality.traits.some((trait) => typeof trait !== "string")) throw new Error(`Resident ${person.id} has invalid traits`);
        for (const field of ["candor", "empathy", "boldness", "piety"]) {
          requireFinite(person.personality[field], `${field} for ${person.id}`, 0, 100);
        }
        if (typeof person.backstory !== "string" || typeof person.privatePressure !== "string") {
          throw new Error(`Resident ${person.id} has incomplete materialized profile`);
        }
      }
    } else {
      if (typeof person.role !== "string" || typeof person.active !== "boolean") {
        throw new Error(`External actor ${person.id} has invalid role or active state`);
      }
      if (!Number.isInteger(person.sprite) || person.sprite < 0 || person.sprite > 41) {
        throw new Error(`External actor ${person.id} has invalid sprite`);
      }
      requireArray(person.relationshipIds, `Relationships for ${person.id}`);
      requireArray(person.memories, `Memories for ${person.id}`);
    }
  }

  const householdIds = new Set();
  const householdMembership = new Map();
  for (const household of state.households) {
    requireObject(household, "Household");
    if (!household.id || householdIds.has(household.id)) throw new Error(`Duplicate or missing household ID: ${household.id}`);
    if (typeof household.surname !== "string" || typeof household.dwelling !== "string") {
      throw new Error(`Household ${household.id} has invalid descriptive fields`);
    }
    for (const field of ["wealth", "food", "reputation"]) {
      requireFinite(household[field], `${field} for ${household.id}`, 0, 100);
    }
    requireFinite(household.debt, `Debt for ${household.id}`, 0);
    householdIds.add(household.id);
    requireArray(household.memberIds, `Household members for ${household.id}`);
    for (const memberId of household.memberIds) {
      if (!residentIds.has(memberId)) throw new Error(`Household ${household.id} references missing resident ${memberId}`);
      if (householdMembership.has(memberId)) throw new Error(`Person ${memberId} appears in multiple households`);
      householdMembership.set(memberId, household.id);
    }
  }
  for (const resident of state.residents) {
    if (!householdIds.has(resident.householdId)) throw new Error(`Resident ${resident.id} references missing household ${resident.householdId}`);
    if (householdMembership.get(resident.id) !== resident.householdId) {
      throw new Error(`Resident ${resident.id} is missing from household ${resident.householdId}`);
    }
    for (const relationId of resident.relationshipIds) {
      if (!personIds.has(relationId)) throw new Error(`Resident ${resident.id} references missing relationship ${relationId}`);
    }
  }

  const eventIds = new Set();
  const priorEventIds = new Set();
  for (const event of state.events) {
    requireObject(event, "Event");
    if (!event.id || eventIds.has(event.id)) throw new Error(`Duplicate or missing event ID: ${event.id}`);
    if (typeof event.type !== "string" || !Number.isInteger(event.day) || event.day < 0) {
      throw new Error(`Event ${event.id} has invalid type or day`);
    }
    requireObject(event.facts, `Facts for ${event.id}`);
    eventIds.add(event.id);
    if (event.actorId != null && event.actorId !== "priest" && !personIds.has(event.actorId)) {
      throw new Error(`Event ${event.id} references missing actor ${event.actorId}`);
    }
    if (event.targetId != null && event.targetId !== "priest" && !personIds.has(event.targetId)) {
      throw new Error(`Event ${event.id} references missing target ${event.targetId}`);
    }
    if (event.parentId != null && !priorEventIds.has(event.parentId)) {
      throw new Error(`Event ${event.id} has a missing or non-prior parent ${event.parentId}`);
    }
    priorEventIds.add(event.id);
  }
  for (const entry of state.chronicle) {
    requireObject(entry, "Chronicle entry");
    if (!Number.isInteger(entry.day) || entry.day < 0 || typeof entry.title !== "string"
      || typeof entry.text !== "string" || typeof entry.tone !== "string") {
      throw new Error("Chronicle entry is invalid");
    }
    if (entry.eventId != null && !eventIds.has(entry.eventId)) {
      throw new Error(`Chronicle references missing event ${entry.eventId}`);
    }
  }
  if (state.currentVisit) {
    requireObject(state.currentVisit, "Current visit");
    if (!residentIds.has(state.currentVisit.personId)) throw new Error("Current visit must reference a resident");
    if (typeof state.currentVisit.visitId !== "string" || !state.currentVisit.visitId) throw new Error("Current visit has no stable ID");
    requireObject(state.currentVisit.issue, "Current visit issue");
    if (typeof state.currentVisit.issue.kind !== "string" || typeof state.currentVisit.issue.opening !== "string") {
      throw new Error("Current visit issue is malformed");
    }
    if (!["confessional", "office", "nave", "shrine"].includes(state.currentVisit.location)) {
      throw new Error("Current visit location is invalid");
    }
    requireArray(state.currentVisit.history, "Current visit history");
    requireArray(state.currentVisit.counsel, "Current visit counsel");
    for (const line of state.currentVisit.history) {
      requireObject(line, "Conversation line");
      if (!["priest", "visitor"].includes(line.speaker) || typeof line.text !== "string") {
        throw new Error("Current visit history is malformed");
      }
    }
    if (state.currentVisit.counsel.some((entry) => typeof entry !== "string")) {
      throw new Error("Current visit counsel is malformed");
    }
    if (!Number.isInteger(state.currentVisit.turnsUsed) || state.currentVisit.turnsUsed < 0 || state.currentVisit.turnsUsed > 10) {
      throw new Error("Current visit turn count is invalid");
    }
    if (state.currentVisit.maxTurns !== 10) throw new Error("Current visit maximum turns is invalid");
    if (typeof state.currentVisit.mood !== "string") throw new Error("Current visit mood is invalid");
    if (!["ordinary", "comic", "outrageous"].includes(state.currentVisit.eventLicense)) {
      throw new Error("Current visit event license is invalid");
    }
    if (!eventIds.has(state.currentVisit.originEventId)) {
      throw new Error("Current visit references a missing origin event");
    }
  }
  const commandIds = new Set();
  let activeVisitPersonId = state.replayBase?.snapshot?.currentVisit?.personId || null;
  let activeVisitTurns = state.replayBase?.snapshot?.currentVisit?.turnsUsed || 0;
  for (let index = 0; index < state.commandLog.length; index += 1) {
    const command = state.commandLog[index];
    requireObject(command, "Command");
    if (command.sequence !== index + 1) throw new Error("Command log sequence is invalid");
    if (!COMMAND_TYPES.has(command.type)) throw new Error(`Unknown command type: ${command.type}`);
    if (!COMMAND_SOURCES.has(command.source)) throw new Error(`Unknown command source: ${command.source}`);
    if (!command.id || commandIds.has(command.id)) throw new Error(`Duplicate or missing command ID: ${command.id}`);
    if (command.id !== `command-${String(command.sequence).padStart(6, "0")}`) {
      throw new Error(`Command ID does not match sequence: ${command.id}`);
    }
    commandIds.add(command.id);
    requireObject(command.payload, `Command payload for ${command.id}`);
    if (command.type === "begin_visit") {
      if (activeVisitPersonId) throw new Error("Command log begins a visit while another is active");
      if (typeof command.payload.personId !== "string" || typeof command.payload.visitId !== "string") {
        throw new Error("Begin-visit command payload is invalid");
      }
      if (!residentIds.has(command.payload.personId)) throw new Error("Begin-visit command references a missing resident");
      activeVisitPersonId = command.payload.personId;
      activeVisitTurns = 0;
    } else if (command.type === "conversation_exchange") {
      if (!activeVisitPersonId) throw new Error("Conversation command has no active visit");
      if (activeVisitTurns >= 10) throw new Error("Command log exceeds the ten-exchange visit limit");
      if (typeof command.payload.playerText !== "string" || !command.payload.playerText.trim()) {
        throw new Error("Conversation command text is invalid");
      }
      requireObject(command.payload.response, "Conversation command response");
      validateConversation(command.payload.response);
      activeVisitTurns += 1;
    } else if (command.type === "finish_visit") {
      if (!activeVisitPersonId) throw new Error("Finish command has no active visit");
      requireObject(command.payload.plan, "Finish command plan");
      requireArray(command.payload.plan.steps, "Finish command steps");
      if (typeof command.payload.plan.summary !== "string") throw new Error("Finish command summary is invalid");
      if (command.payload.plan.steps.length < 1 || command.payload.plan.steps.length > 3) {
        throw new Error("Finish command chain depth is invalid");
      }
      let expectedActorId = activeVisitPersonId;
      for (let stepIndex = 0; stepIndex < command.payload.plan.steps.length; stepIndex += 1) {
        const step = command.payload.plan.steps[stepIndex];
        requireObject(step, "Finish command step");
        if (step.depth !== stepIndex + 1 || step.actorId !== expectedActorId || !residentIds.has(step.actorId)) {
          throw new Error("Finish command causal actor is invalid");
        }
        if (step.targetId != null && !residentIds.has(step.targetId)) throw new Error("Finish command target is invalid");
        if (!PHASE_ZERO_SAFE_ACTIONS.includes(step.actionType)) throw new Error("Finish command action is invalid");
        if (!Number.isInteger(step.intensity) || step.intensity < 1 || step.intensity > 5) {
          throw new Error("Finish command intensity is invalid");
        }
        for (const field of ["title", "description", "detail"]) {
          if (typeof step[field] !== "string") throw new Error(`Finish command ${field} is invalid`);
        }
        expectedActorId = step.targetId;
        if (stepIndex < command.payload.plan.steps.length - 1 && !expectedActorId) {
          throw new Error("Finish command continues after a targetless action");
        }
      }
      activeVisitPersonId = null;
      activeVisitTurns = 0;
    } else if (command.type === "deliver_sermon") {
      if (activeVisitPersonId) throw new Error("Sermon command occurs during an active visit");
      if (typeof command.payload.theme !== "string" || typeof command.payload.text !== "string") {
        throw new Error("Sermon command payload is invalid");
      }
      if (!SERMON_THEMES.includes(command.payload.theme)) throw new Error("Sermon command theme is invalid");
      const wordCount = command.payload.text.trim().split(/\s+/).filter(Boolean).length;
      if (!wordCount || wordCount > 100) throw new Error("Sermon command word count is invalid");
      requireObject(command.payload.outcome, "Sermon command outcome");
      validateSermonResponse(command.payload.outcome, [...residentIds]);
    }
  }
  if ((state.commandLog.length || state.replayBase) && Boolean(activeVisitPersonId) !== Boolean(state.currentVisit)) {
    throw new Error("Command log active-visit state does not match the saved state");
  }
  if (state.currentVisit && activeVisitTurns !== state.currentVisit.turnsUsed) {
    throw new Error("Command log turn count does not match the saved visit");
  }
  const proposalIds = new Set();
  const proposalCommandIds = new Set();
  const commandsById = new Map(state.commandLog.map((command) => [command.id, command]));
  for (const proposal of state.aiProposals) {
    requireObject(proposal, "AI proposal");
    if (!proposal.id || proposalIds.has(proposal.id)) throw new Error(`Duplicate or missing proposal ID: ${proposal.id}`);
    proposalIds.add(proposal.id);
    if (!commandIds.has(proposal.commandId)) throw new Error(`AI proposal ${proposal.id} references missing command ${proposal.commandId}`);
    if (proposalCommandIds.has(proposal.commandId)) throw new Error(`AI command ${proposal.commandId} has multiple proposals`);
    proposalCommandIds.add(proposal.commandId);
    const command = commandsById.get(proposal.commandId);
    if (command.source !== "ai") throw new Error(`AI proposal ${proposal.id} references a non-AI command`);
  }
  for (const command of state.commandLog) {
    if (command.source === "ai" && !proposalCommandIds.has(command.id)) {
      throw new Error(`AI command ${command.id} has no accepted proposal`);
    }
  }
  for (const queued of state.eventQueue) {
    requireObject(queued, "Queued event");
    if (typeof queued.id !== "string" || typeof queued.type !== "string"
      || !Number.isInteger(queued.dueDay) || queued.dueDay < state.calendar.absoluteDay) {
      throw new Error("Queued event has invalid identity or due day");
    }
    requireObject(queued.payload, `Payload for queued event ${queued.id}`);
    for (const field of ["actorId", "targetId", "sourcePersonId"]) {
      if (queued[field] != null && queued[field] !== "priest" && !personIds.has(queued[field])) {
        throw new Error(`Queued event references missing person ${queued[field]}`);
      }
    }
  }
  const maximumEventSequence = state.events.reduce((maximum, event) => {
    const match = /^event-(\d+)$/.exec(event.id);
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0);
  const maximumCommandSequence = state.commandLog.reduce((maximum, command) => Math.max(maximum, command.sequence), 0);
  if (!Number.isInteger(state.nextEventSequence) || state.nextEventSequence <= maximumEventSequence) {
    throw new Error("Next event sequence would create a duplicate ID");
  }
  if (!Number.isInteger(state.nextCommandSequence) || state.nextCommandSequence <= maximumCommandSequence) {
    throw new Error("Next command sequence would create a duplicate ID");
  }
  return state;
}

export function serializeState(state) {
  validateState(state);
  sealState(state);
  return JSON.stringify(state);
}

export function deserializeState(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Save file is not valid JSON");
  }
  const state = validateState(migrateState(parsed));
  verifyIntegrity(state);
  if (state.replayBase?.snapshot) verifyIntegrity(state.replayBase.snapshot);
  if (typeof replayVerifier !== "function") throw new Error("Replay verifier is unavailable");
  const replayed = replayVerifier(state.seed, state.commandLog, state.replayBase);
  if (stableStringify(replayed) !== stableStringify(state)) {
    throw new Error("Save state does not match its canonical replay");
  }
  return state;
}

export function appendCommand(state, type, payload, source = "simulation") {
  state.commandLog ||= [];
  state.aiProposals ||= [];
  state.nextCommandSequence ||= state.commandLog.length + 1;
  const command = {
    id: `command-${String(state.nextCommandSequence).padStart(6, "0")}`,
    sequence: state.nextCommandSequence,
    day: state.calendar.absoluteDay,
    slot: state.calendar.slot,
    type,
    source,
    payload: cloneJson(payload)
  };
  state.nextCommandSequence += 1;
  state.commandLog.push(command);
  if (source === "ai") {
    state.aiProposals.push({
      id: `proposal-${String(state.aiProposals.length + 1).padStart(6, "0")}`,
      commandId: command.id
    });
  }
  return command;
}

export function appendEvent(state, event) {
  state.events ||= [];
  state.nextEventSequence ||= state.events.length + 1;
  const stored = {
    id: `event-${String(state.nextEventSequence).padStart(6, "0")}`,
    day: state.calendar.absoluteDay,
    parentId: null,
    actorId: null,
    targetId: null,
    facts: {},
    ...cloneJson(event)
  };
  state.nextEventSequence += 1;
  state.events.push(stored);
  return stored;
}

export function createHouseholds(residents) {
  return buildHouseholds(residents);
}

export function createDefaultPriest() {
  return defaultPriest();
}

export function restoreReplayBase(replayBase) {
  requireObject(replayBase, "Replay base");
  requireObject(replayBase.snapshot, "Replay base snapshot");
  const restored = cloneJson(replayBase.snapshot);
  validateState(restored);
  verifyIntegrity(restored);
  return restored;
}

export function registerReplayVerifier(verifier) {
  replayVerifier = verifier;
}

export function compactReplayHistory(state) {
  if (state.currentVisit) throw new Error("Replay history can compact only between appointments");
  const retainedEventIds = new Set(state.chronicle.map((entry) => entry.eventId).filter(Boolean));
  const retainedEvents = state.events
    .filter((event) => retainedEventIds.has(event.id))
    .map((event) => ({
      ...event,
      parentId: retainedEventIds.has(event.parentId) ? event.parentId : null
    }));
  state.events = retainedEvents;
  const snapshot = cloneJson({
    ...state,
    commandLog: [],
    aiProposals: [],
    nextCommandSequence: 1,
    replayBase: null
  });
  sealState(snapshot);
  state.commandLog = [];
  state.aiProposals = [];
  state.nextCommandSequence = 1;
  state.replayBase = {
    kind: "periodic",
    checkpointDay: state.calendar.absoluteDay,
    checkpointSlot: state.calendar.slot,
    snapshot
  };
  sealState(state);
  return state;
}
