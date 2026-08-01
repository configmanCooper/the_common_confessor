import { AI_ALLOWED_ACTIONS, SERMON_THEMES } from "./data.js";
import { validateConversation, validateSermonResponse } from "./ai.js";
import { upgradeChurchResources } from "./church.js";
import {
  createInitialReactionState,
  REACTIONS,
  validateReactionState
} from "./conversation.js";
import { upgradePopulationState } from "./population.js";
import { upgradeParishState } from "./parish.js";
import {
  DAILY_REPORT_LIMIT,
  upgradeReportingState,
  VISIT_ARCHIVE_LIMIT,
  WEEKLY_REPORT_LIMIT
} from "./reporting.js";
import {
  PROMPT_TRACE_LIMIT,
  PROMPT_TRACE_MAX_CHARS
} from "./dialogue_planner.js";

export const STATE_SCHEMA_VERSION = 16;
const COMMAND_TYPES = new Set(["begin_visit", "conversation_exchange", "finish_visit", "deliver_sermon", "request_visits"]);
const COMMAND_SOURCES = new Set(["simulation", "fallback", "ai"]);
let replayVerifier = null;

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function upgradeDialoguePlannerState(state) {
  state.aiDiagnostics ||= { lastCompletedVisit: null };
  if (!state.currentVisit) return state;
  state.currentVisit.promptTraces ||= [];
  state.currentVisit.promptTraces = state.currentVisit.promptTraces.slice(-PROMPT_TRACE_LIMIT);
  state.currentVisit.continuity ||= {
    unresolvedQuestions: [],
    agreements: [],
    retractions: []
  };
  state.currentVisit.continuity.mentionedFactIds ||= [];
  state.currentVisit.continuity.currentObligation ??= null;
  state.currentVisit.continuity.lastAnsweredQuestionTurnIds ||= [];
  return state;
}

function upgradeLegacyActionEffects(state) {
  const bound = (value) => Math.max(0, Math.min(100, value));
  const eventsById = new Map((state.events || []).map((event) => [event.id, event]));
  for (const entry of state.chronicle || []) {
    const event = eventsById.get(entry.eventId);
    const prose = `${entry.title || ""} ${entry.text || ""}`.toLowerCase();
    if (event?.type !== "person_action" || event.facts?.actionType !== "improvise"
      || !/\b(?:water|well|spring)\b/.test(prose)
      || !/\b(?:carry|carried|secure|arrange|transport|organize|warn)\w*\b/.test(prose)) continue;
    const thread = (state.issueThreads || []).find((candidate) => (
      candidate.originatorId === event.actorId
      && String(candidate.scenarioId || "").includes("contaminated_well")
      && candidate.createdDay <= event.day
    ));
    if (!thread) continue;
    state.material.modifiers.diseasePressure = Math.max(
      -20,
      state.material.modifiers.diseasePressure - 8
    );
    state.town.metrics.health = bound(state.town.metrics.health + 2);
    thread.pressure = bound(thread.pressure - 25);
    thread.publicAwareness = bound(thread.publicAwareness + 18);
    thread.danger = bound(thread.danger - 4);
    thread.visibility = {
      scope: "public",
      authorizedPersonIds: [...new Set([...(thread.subjectIds || []), "priest"])]
    };
    event.facts.migratedFromActionType = "improvise";
    event.facts.actionType = "secure_clean_water";
  }
  return state;
}

function upgradeIssueThreadState(state) {
  state.issueThreads ||= [];
  state.nextIssueThreadSequence ||= state.issueThreads.length + 1;
  return state;
}

function upgradeReactionState(state) {
  upgradeDialoguePlannerState(state);
  upgradeVisibilityState(state);
  upgradeFactProvenanceState(state);
  state.priestReports ||= [];
  state.nextPriestReportSequence ||= state.priestReports.length + 1;
  if (!state.currentVisit) return upgradePropertyState(state);
  const person = [...(state.residents || []), ...(state.externalActors || [])]
    .find((resident) => resident.id === state.currentVisit.personId);
  if (!person) return state;
  const sourceType = person.id.startsWith("external-")
    ? "authority"
    : state.currentVisit.issue?.requestedByPriest ? "requested"
      : state.currentVisit.issue?.kind === "requested meeting" ? "summoned"
        : state.currentVisit.issue?.kind?.includes("follow-up") ? "followup" : "ordinary";
  state.currentVisit.reactionState ||= createInitialReactionState(
    state,
    person,
    state.currentVisit.issue,
    sourceType
  );
  state.currentVisit.turnAudits ||= [];
  state.currentVisit.reactionStateMigrated ??= state.currentVisit.turnsUsed > 0;
  state.currentVisit.continuity ||= {
    unresolvedQuestions: [],
    agreements: [],
    retractions: []
  };
  return upgradePropertyState(state);
}

function upgradeFactProvenanceState(state) {
  for (const thread of state.issueThreads || []) {
    const visibility = {
      scope: thread.location === "confessional"
        ? "private_confession"
        : thread.location === "office" ? "private_visit" : "public",
      authorizedPersonIds: [thread.originatorId, "priest"].filter(Boolean)
    };
    thread.visibility ||= visibility;
    thread.facts = (thread.facts || []).map((fact) => ({
      ...fact,
      issueId: fact.issueId || thread.id,
      provenance: fact.provenance || "state",
      confidence: fact.confidence ?? 100,
      visibility: fact.visibility || visibility,
      allowedSpeakers: fact.allowedSpeakers || [thread.originatorId].filter(Boolean)
    }));
  }
  if (state.currentVisit) {
    const visibility = {
      scope: state.currentVisit.location === "confessional"
        ? "private_confession"
        : state.currentVisit.location === "office" ? "private_visit" : "public",
      authorizedPersonIds: [state.currentVisit.personId, "priest"]
    };
    const issueId = state.currentVisit.issue?.threadId
      || state.currentVisit.issue?.scenarioId
      || state.currentVisit.issue?.kind
      || "legacy";
    state.currentVisit.scenarioFacts = (state.currentVisit.scenarioFacts || []).map((fact) => ({
      ...fact,
      issueId: fact.issueId || issueId,
      provenance: fact.provenance || "state",
      confidence: fact.confidence ?? 100,
      visibility: fact.visibility || visibility,
      allowedSpeakers: fact.allowedSpeakers || [state.currentVisit.personId]
    }));
  }
  return state;
}

function upgradeVisibilityState(state) {
  for (const person of [...(state.residents || []), ...(state.externalActors || [])]) {
    for (const memory of person.memories || []) {
      memory.visibility ||= {
        scope: memory.privateMemory ? "private_visit" : "public",
        authorizedPersonIds: [person.id, "priest"]
      };
    }
  }
  return state;
}

function upgradePropertyState(state) {
  state.nextPropertySequence ||= 1;
  for (const household of state.households || []) {
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
  return state;
}
function upgradeAuthorityState(state) {
  state.outsideAttention ||= { church: 0, rome: 0, crown: 0, legal: 0 };
  state.authorityStages ||= {
    archdeaconCompleted: false,
    bishopCompleted: false,
    examinerCompleted: false,
    sheriffCompleted: false,
    papalLegateCompleted: false,
    royalCommissionerCompleted: false,
    nobleCompleted: false,
    kingRollAttempted: false,
    popeRollAttempted: false
  };
  state.authorityStages.archdeaconCompleted ??= false;
  state.authorityStages.examinerCompleted ??= false;
  state.authorityStages.sheriffCompleted ??= false;
  state.authorityStages.nobleCompleted ??= false;
  state.nextExternalSequence ||= state.externalActors.length + 1;
  state.nextQueueSequence ||= state.eventQueue.length + 1;
  return state;
}

function upgradeGroundedConversationState(state) {
  state.scenarioHistory ||= [];
  if (state.currentVisit) {
    state.currentVisit.scenarioFacts ||= state.currentVisit.issue?.scenarioFacts || [];
    state.currentVisit.revealedFactIds ||= [];
    state.currentVisit.stagnationCount ??= 0;
    state.currentVisit.lastVisitorReplies ||= state.currentVisit.history
      .filter((line) => line.speaker === "visitor")
      .map((line) => line.text)
      .slice(-6);
  }
  for (const command of state.commandLog || []) {
    if (command.type === "conversation_exchange") {
      command.payload.response.groundedFallback ??= false;
      command.payload.response.stagnationCount ??= 0;
    }
  }
  return state;
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

function validateVisibility(value, label) {
  requireObject(value, label);
  if (!["private_confession", "private_visit", "public"].includes(value.scope)) {
    throw new Error(`${label} scope is invalid`);
  }
  requireArray(value.authorizedPersonIds, `${label} authorized people`);
  if (value.authorizedPersonIds.some((personId) => typeof personId !== "string")) {
    throw new Error(`${label} authorized people are invalid`);
  }
}

function validateReactionAudit(audit, label) {
  requireObject(audit, label);
  if (typeof audit.auditId !== "string"
    || !Number.isInteger(audit.turn) || audit.turn < 1
    || !REACTIONS.includes(audit.requiredReaction)
    || !REACTIONS.includes(audit.expressedReaction)
    || typeof audit.fallbackUsed !== "boolean") {
    throw new Error(`${label} identity is invalid`);
  }

  requireObject(audit.classification, `${label} classification`);
  requireArray(audit.classification.categories, `${label} categories`);
  requireArray(audit.classification.intents, `${label} intents`);
  if (!Number.isInteger(audit.classification.intensity)
    || audit.classification.intensity < 0 || audit.classification.intensity > 5
    || typeof audit.classification.credibleThreat !== "boolean"
    || typeof audit.classification.violatedBoundary !== "boolean") {
    throw new Error(`${label} classification is invalid`);
  }
  requireObject(audit.deltas, `${label} deltas`);
  for (const value of Object.values(audit.deltas)) {
    if (!Number.isFinite(value) || value < -100 || value > 100) throw new Error(`${label} deltas are invalid`);
  }
  validateReactionState(audit.stateAfter);
  requireArray(audit.thresholdReasons, `${label} threshold reasons`);
  validateVisibility(audit.visibility, `${label} visibility`);
  if (audit.conversationObligation != null) {
    validateConversationObligation(audit.conversationObligation, `${label} obligation`);
  }
}

function validateConversationObligation(obligation, label) {
  requireObject(obligation, label);
  for (const field of [
    "obligationId", "latestPlayerText", "kind", "reason",
    "directAnswer", "responseSource"
  ]) {
    if (typeof obligation[field] !== "string") throw new Error(`${label} ${field} is invalid`);
  }
  for (const field of [
    "answeredQuestionTurnIds", "requiredFactIds", "requiredAnswerSlots",
    "avoidRepeatingTexts", "mentionedFactIdsBefore", "completedObjectiveIds",
    "activeObjectiveIds", "prohibitedFallbackFactIds"
  ]) {
    requireArray(obligation[field], `${label} ${field}`);
    if (obligation[field].some((entry) => typeof entry !== "string")) {
      throw new Error(`${label} ${field} is invalid`);
    }
  }
  if (typeof obligation.mustAnswerFirst !== "boolean"
    || typeof obligation.modelNeeded !== "boolean"
    || typeof obligation.followupRequested !== "boolean"
    || !Number.isFinite(obligation.routerConfidence)
    || obligation.routerConfidence < 0 || obligation.routerConfidence > 1) {
    throw new Error(`${label} routing metadata is invalid`);
  }
}

function validatePromptTrace(trace, label) {
  requireObject(trace, label);
  validateConversationObligation(trace.obligation, `${label} obligation`);
  if (typeof trace.prompt !== "string"
    || trace.prompt.length > PROMPT_TRACE_MAX_CHARS + 100
    || !Number.isInteger(trace.promptLength) || trace.promptLength < 0
    || typeof trace.initialReply !== "string" || trace.initialReply.length > 600
    || typeof trace.finalReply !== "string" || trace.finalReply.length > 600
    || typeof trace.mandatoryAnswerPassed !== "boolean"
    || typeof trace.retryUsed !== "boolean"
    || typeof trace.route !== "string"
    || typeof trace.responseSource !== "string"
    || typeof trace.gemmaCalled !== "boolean") {
    throw new Error(`${label} is invalid`);
  }
  requireArray(trace.includedFactIds, `${label} included facts`);
  requireObject(trace.validation, `${label} validation`);
  if (typeof trace.validation.mandatoryAnswerPresent !== "boolean"
    || typeof trace.validation.repetitionDetected !== "boolean") {
    throw new Error(`${label} validation result is invalid`);
  }
}

function validateScenarioFact(fact, label) {
  requireObject(fact, label);
  if (typeof fact.id !== "string" || typeof fact.text !== "string"
    || typeof fact.issueId !== "string"
    || !["state", "witnessed", "heard_rumor", "inferred"].includes(fact.provenance)
    || !Number.isFinite(fact.confidence) || fact.confidence < 0 || fact.confidence > 100) {
    throw new Error(`${label} is invalid`);
  }
  requireArray(fact.anchors, `${label} anchors`);
  requireArray(fact.allowedSpeakers, `${label} allowed speakers`);
  validateVisibility(fact.visibility, `${label} visibility`);
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
    relicStolenById: null,
    alive: true,
    promises: [],
    positions: [],
    confidentialityBreaches: [],
    supporters: [],
    enemies: [],
    accusations: []
  };
}

function upgradeConversationState(state) {
  state.nextMemorySequence ||= 1;
  for (const person of state.residents || []) {
    person.memories = (person.memories || []).map((memory) => {
      if (memory && typeof memory === "object") {
        const numericId = Number(String(memory.id || "").replace(/\D/g, ""));
        if (Number.isFinite(numericId)) state.nextMemorySequence = Math.max(state.nextMemorySequence, numericId + 1);
        memory.visibility ||= {
          scope: memory.privateMemory ? "private_visit" : "public",
          authorizedPersonIds: [person.id, "priest"]
        };
        return memory;
      }
      const entry = {
        id: `memory-${String(state.nextMemorySequence).padStart(7, "0")}`,
        type: "legacy",
        subjectId: "priest",
        summary: String(memory || "").slice(0, 220),
        emotion: "neutral",
        confidence: 60,
        privateMemory: true,
        visibility: {
          scope: "private_visit",
          authorizedPersonIds: [person.id, "priest"]
        },
        day: 0,
        sourceEventId: null
      };
      state.nextMemorySequence += 1;
      return entry;
    });
    if (person.materialized && !person.publicBackstory) {
      person.publicBackstory = `${String(person.backstory || "").split(",")[0]}.`;
    }
  }
  state.priest.promises = (state.priest.promises || []).map((promise, index) => (
    promise && typeof promise === "object"
      ? promise
      : {
        id: `promise-${String(index + 1).padStart(5, "0")}`,
        personId: null,
        text: String(promise || "").slice(0, 180),
        madeDay: 0,
        status: "open"
      }
  ));
  state.priest.positions ||= [];
  state.priest.relicStolenById ??= null;
  upgradeAuthorityState(state);
  upgradeParishState(state);
  for (const position of state.priest.positions) {
    position.personId ||= state.currentVisit?.personId || state.residents?.[0]?.id || "priest";
    position.publicPosition ??= false;
  }
  state.priest.confidentialityBreaches ||= [];
  state.nextPositionSequence ||= state.priest.positions.reduce((maximum, position) => {
    const match = /^position-(\d+)$/.exec(position.id || "");
    return Math.max(maximum, match ? Number(match[1]) + 1 : 1);
  }, 1);
  if (state.currentVisit) {
    state.currentVisit.intent ||= {
      primaryMatter: state.currentVisit.issue?.kind || "counsel",
      desiredOutcome: state.currentVisit.issue?.kind === "confession" ? "absolution" : "guidance",
      hiddenConcern: state.currentVisit.issue?.detail || "an undisclosed concern",
      disclosureThreshold: 70,
      urgency: state.currentVisit.issue?.gravity || 2,
      risk: Math.max(1, (state.currentVisit.issue?.gravity || 2) - 1)
    };
    state.currentVisit.disclosure ??= 10;
    state.currentVisit.hiddenConcernDisclosed ??= false;
  }
  upgradeReactionState(state);
  for (const command of state.commandLog || []) {
    if (command.type === "conversation_exchange") {
      command.payload.response.intents ||= ["neutral"];
      command.payload.response.disclosure ??= 10;
      command.payload.response.contradictionId ??= null;
    }
  }
  upgradeGroundedConversationState(state);
  return state;
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
  if (detectedVersion === 2) verifyIntegrity(state);
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
    upgradePopulationState(state);
    upgradeConversationState(state);
    upgradeAuthorityState(state);
    upgradeParishState(state);
    upgradeReportingState(state, true);
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
  if (detectedVersion === 2) {
    upgradePopulationState(state);
    upgradeConversationState(state);
    upgradeAuthorityState(state);
    upgradeParishState(state);
    upgradeReportingState(state, true);
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    const migrationSnapshot = cloneJson({
      ...state,
      commandLog: [],
      aiProposals: [],
      nextCommandSequence: 1,
      replayBase: null
    });
    sealState(migrationSnapshot);
    state.commandLog = [];
    state.aiProposals = [];
    state.nextCommandSequence = 1;
    state.replayBase = {
      kind: "migration",
      sourceSchemaVersion: 2,
      source: cloneJson(rawState),
      snapshot: migrationSnapshot
    };
    sealState(state);
  }
  if (detectedVersion === 3) {
    verifyIntegrity(state);
    upgradePopulationState(state);
    upgradeConversationState(state);
    upgradeAuthorityState(state);
    upgradeParishState(state);
    upgradeReportingState(state, true);
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    const migrationSnapshot = cloneJson({
      ...state,
      commandLog: [],
      aiProposals: [],
      nextCommandSequence: 1,
      replayBase: null
    });
    sealState(migrationSnapshot);
    state.commandLog = [];
    state.aiProposals = [];
    state.nextCommandSequence = 1;
    state.replayBase = {
      kind: "migration",
      sourceSchemaVersion: 3,
      source: cloneJson(rawState),
      snapshot: migrationSnapshot
    };
    sealState(state);
  }
  if (detectedVersion === 5) {
    verifyIntegrity(state);
    upgradePopulationState(state);
    upgradeConversationState(state);
    upgradeAuthorityState(state);
    upgradeParishState(state);
    upgradeReportingState(state, true);
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    const migrationSnapshot = cloneJson({ ...state, commandLog: [], aiProposals: [], nextCommandSequence: 1, replayBase: null });
    sealState(migrationSnapshot);
    state.commandLog = [];
    state.aiProposals = [];
    state.nextCommandSequence = 1;
    state.replayBase = {
      kind: "migration",
      sourceSchemaVersion: 5,
      source: cloneJson(rawState),
      snapshot: migrationSnapshot
    };
    sealState(state);
  }
  if (detectedVersion === 6) {
    verifyIntegrity(state);
    upgradePopulationState(state);
    upgradeConversationState(state);
    upgradeParishState(state);
    upgradeReportingState(state, true);
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    const migrationSnapshot = cloneJson({ ...state, commandLog: [], aiProposals: [], nextCommandSequence: 1, replayBase: null });
    sealState(migrationSnapshot);
    state.commandLog = [];
    state.aiProposals = [];
    state.nextCommandSequence = 1;
    state.replayBase = { kind: "migration", sourceSchemaVersion: 6, source: cloneJson(rawState), snapshot: migrationSnapshot };
    sealState(state);
  }
  if (detectedVersion === 4) {
    verifyIntegrity(state);
    upgradePopulationState(state);
    upgradeConversationState(state);
    state.priest.relicStolenById ??= null;
    upgradeAuthorityState(state);
    upgradeParishState(state);
    upgradeReportingState(state, true);
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    const migrationSnapshot = cloneJson({
      ...state,
      commandLog: [],
      aiProposals: [],
      nextCommandSequence: 1,
      replayBase: null
    });
    sealState(migrationSnapshot);
    state.commandLog = [];
    state.aiProposals = [];
    state.nextCommandSequence = 1;
    state.replayBase = {
      kind: "migration",
      sourceSchemaVersion: 4,
      source: cloneJson(rawState),
      snapshot: migrationSnapshot
    };
    sealState(state);
  }
  if (detectedVersion === 7) {
    verifyIntegrity(state);
    upgradePopulationState(state);
    upgradeGroundedConversationState(state);
    upgradeReactionState(state);
    upgradeReportingState(state, true);
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    const migrationSnapshot = cloneJson({ ...state, commandLog: [], aiProposals: [], nextCommandSequence: 1, replayBase: null });
    sealState(migrationSnapshot);
    state.commandLog = [];
    state.aiProposals = [];
    state.nextCommandSequence = 1;
    state.replayBase = { kind: "migration", sourceSchemaVersion: 7, source: cloneJson(rawState), snapshot: migrationSnapshot };
    sealState(state);
  }
  if (detectedVersion === 8) {
    verifyIntegrity(state);
    upgradeGroundedConversationState(state);
    state.visitRequests ||= [];
    state.nextVisitRequestSequence ||= 1;
    upgradeIssueThreadState(state);
    upgradeReactionState(state);
    upgradeReportingState(state, true);
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    const migrationSnapshot = cloneJson({ ...state, commandLog: [], aiProposals: [], nextCommandSequence: 1, replayBase: null });
    sealState(migrationSnapshot);
    state.commandLog = [];
    state.aiProposals = [];
    state.nextCommandSequence = 1;
    state.replayBase = { kind: "migration", sourceSchemaVersion: 8, source: cloneJson(rawState), snapshot: migrationSnapshot };
    sealState(state);
  }
  if (detectedVersion === 9) {
    verifyIntegrity(state);
    upgradeGroundedConversationState(state);
    state.visitRequests ||= [];
    state.nextVisitRequestSequence ||= 1;
    upgradeIssueThreadState(state);
    upgradeReactionState(state);
    upgradeReportingState(state, true);
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    const migrationSnapshot = cloneJson({ ...state, commandLog: [], aiProposals: [], nextCommandSequence: 1, replayBase: null });
    sealState(migrationSnapshot);
    state.commandLog = [];
    state.aiProposals = [];
    state.nextCommandSequence = 1;
    state.replayBase = { kind: "migration", sourceSchemaVersion: 9, source: cloneJson(rawState), snapshot: migrationSnapshot };
    sealState(state);
  }
  if (detectedVersion === 10) {
    verifyIntegrity(state);
    upgradeChurchResources(state);
    state.visitRequests ||= [];
    state.nextVisitRequestSequence ||= 1;
    upgradeIssueThreadState(state);
    upgradeReactionState(state);
    upgradeReportingState(state, true);
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    const migrationSnapshot = cloneJson({ ...state, commandLog: [], aiProposals: [], nextCommandSequence: 1, replayBase: null });
    sealState(migrationSnapshot);
    state.commandLog = [];
    state.aiProposals = [];
    state.nextCommandSequence = 1;
    state.replayBase = { kind: "migration", sourceSchemaVersion: 10, source: cloneJson(rawState), snapshot: migrationSnapshot };
    sealState(state);
  }
  if (detectedVersion === 11) {
    verifyIntegrity(state);
    state.visitRequests ||= [];
    state.nextVisitRequestSequence ||= 1;
    upgradeIssueThreadState(state);
    upgradeReactionState(state);
    upgradeReportingState(state, true);
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    const migrationSnapshot = cloneJson({ ...state, commandLog: [], aiProposals: [], nextCommandSequence: 1, replayBase: null });
    sealState(migrationSnapshot);
    state.commandLog = [];
    state.aiProposals = [];
    state.nextCommandSequence = 1;
    state.replayBase = { kind: "migration", sourceSchemaVersion: 11, source: cloneJson(rawState), snapshot: migrationSnapshot };
    sealState(state);
  }
  if (detectedVersion === 12) {
    verifyIntegrity(state);
    upgradeIssueThreadState(state);
    upgradeReactionState(state);
    upgradeReportingState(state, true);
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    const migrationSnapshot = cloneJson({ ...state, commandLog: [], aiProposals: [], nextCommandSequence: 1, replayBase: null });
    sealState(migrationSnapshot);
    state.commandLog = [];
    state.aiProposals = [];
    state.nextCommandSequence = 1;
    state.replayBase = { kind: "migration", sourceSchemaVersion: 12, source: cloneJson(rawState), snapshot: migrationSnapshot };
    sealState(state);
  }
  if (detectedVersion === 13) {
    verifyIntegrity(state);
    upgradeReactionState(state);
    upgradeReportingState(state, true);
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    const migrationSnapshot = cloneJson({ ...state, commandLog: [], aiProposals: [], nextCommandSequence: 1, replayBase: null });
    sealState(migrationSnapshot);
    state.commandLog = [];
    state.aiProposals = [];
    state.nextCommandSequence = 1;
    state.replayBase = { kind: "migration", sourceSchemaVersion: 13, source: cloneJson(rawState), snapshot: migrationSnapshot };
    sealState(state);
  }
  if (detectedVersion === 14) {
    verifyIntegrity(state);
    upgradeReportingState(state, true);
    upgradeDialoguePlannerState(state);
    upgradeLegacyActionEffects(state);
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    const migrationSnapshot = cloneJson({
      ...state,
      commandLog: [],
      aiProposals: [],
      nextCommandSequence: 1,
      replayBase: null
    });
    sealState(migrationSnapshot);
    state.commandLog = [];
    state.aiProposals = [];
    state.nextCommandSequence = 1;
    state.replayBase = {
      kind: "migration",
      sourceSchemaVersion: 14,
      source: cloneJson(rawState),
      snapshot: migrationSnapshot
    };
    sealState(state);
  }
  if (detectedVersion === 15) {
    verifyIntegrity(state);
    upgradeDialoguePlannerState(state);
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = STATE_SCHEMA_VERSION;
    const migrationSnapshot = cloneJson({
      ...state,
      commandLog: [],
      aiProposals: [],
      nextCommandSequence: 1,
      replayBase: null
    });
    sealState(migrationSnapshot);
    state.commandLog = [];
    state.aiProposals = [];
    state.nextCommandSequence = 1;
    state.replayBase = {
      kind: "migration",
      sourceSchemaVersion: 15,
      source: cloneJson(rawState),
      snapshot: migrationSnapshot
    };
    sealState(state);
  }
  upgradeDialoguePlannerState(state);
  upgradeReportingState(state, detectedVersion < STATE_SCHEMA_VERSION);
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
    ["slot", 0, 7]
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
  if (state.priest.relicStolenById != null && typeof state.priest.relicStolenById !== "string") {
    throw new Error("Priest relic state is invalid");
  }
  for (const field of ["supporters", "enemies", "accusations"]) {
    requireArray(state.priest[field], `Priest ${field}`);
    if (state.priest[field].some((entry) => typeof entry !== "string")) throw new Error(`Priest ${field} is invalid`);
  }
  requireArray(state.priest.promises, "Priest promises");
  requireArray(state.priest.positions, "Priest positions");
  requireArray(state.priest.confidentialityBreaches, "Priest confidentiality breaches");
  requireArray(state.priestReports, "Priest reports");
  if (!Number.isInteger(state.nextPriestReportSequence) || state.nextPriestReportSequence < 1) {
    throw new Error("Priest report sequence is invalid");
  }
  const priestReportIds = new Set();
  for (const report of state.priestReports) {
    requireObject(report, "Priest report");
    if (typeof report.id !== "string" || priestReportIds.has(report.id)
      || ![...state.residents, ...state.externalActors].some((resident) => resident.id === report.reporterId)
      || typeof report.allegation !== "string"
      || !Number.isInteger(report.createdDay) || report.createdDay < 0
      || !["private_complaint", "submitted", "dismissed"].includes(report.status)) {
      throw new Error("Priest report is invalid");
    }
    requireArray(report.auditIds, "Priest report audits");
    requireArray(report.eligibleRecipients, "Priest report recipients");
    validateVisibility(report.visibility, "Priest report visibility");
    priestReportIds.add(report.id);
  }
  const promiseIds = new Set();
  for (const promise of state.priest.promises) {
    requireObject(promise, "Priest promise");
    if (typeof promise.id !== "string" || (promise.personId != null && typeof promise.personId !== "string")
      || typeof promise.text !== "string" || !Number.isInteger(promise.madeDay)
      || !["open", "kept", "broken"].includes(promise.status)) {
      throw new Error("Priest promise is invalid");
    }
    if (promiseIds.has(promise.id)) throw new Error(`Duplicate promise ID: ${promise.id}`);
    promiseIds.add(promise.id);
  }
  const positionIds = new Set();
  for (const position of state.priest.positions) {
    requireObject(position, "Priest position");
    if (typeof position.id !== "string" || typeof position.intent !== "string"
      || (position.personId != null && typeof position.personId !== "string") || typeof position.publicPosition !== "boolean"
      || typeof position.summary !== "string" || !Number.isInteger(position.day)) {
      throw new Error("Priest position is invalid");
    }
    if (positionIds.has(position.id)) throw new Error(`Duplicate position ID: ${position.id}`);
    positionIds.add(position.id);
  }
  requireArray(state.residents, "Residents");
  if (!state.residents.length || !state.residents.some((resident) => resident?.active === true)) {
    throw new Error("State has no active resident roster");
  }
  requireArray(state.households, "Households");
  requireArray(state.relationships, "Relationships");
  requireArray(state.knowledge, "Knowledge");
  requireArray(state.rumors, "Rumors");
  requireArray(state.parishFactions, "Parish factions");
  requireArray(state.sermonReactions, "Sermon reactions");
  requireArray(state.scenarioHistory, "Scenario history");
  requireArray(state.visitRequests, "Requested visits");
  if (!Number.isInteger(state.nextVisitRequestSequence) || state.nextVisitRequestSequence < 1) {
    throw new Error("Requested visit sequence is invalid");
  }
  const visitRequestIds = new Set();
  for (const request of state.visitRequests) {
    requireObject(request, "Requested visit");
    if (typeof request.id !== "string" || visitRequestIds.has(request.id)
      || !state.residents.some((resident) => resident.id === request.personId)
      || !Number.isInteger(request.requestedDay) || request.requestedDay < 1
      || !["accepted", "declined", "completed", "missed"].includes(request.status)
      || typeof request.reason !== "string") {
      throw new Error("Requested visit is invalid");
    }
    visitRequestIds.add(request.id);
  }
  const acceptedRequestsToday = state.visitRequests.filter((request) => (
    request.requestedDay === state.calendar.absoluteDay
    && ["accepted", "completed"].includes(request.status)
  )).length;
  if (state.calendar.dayIndex !== 6 && state.calendar.slot >= 4 + acceptedRequestsToday) {
    throw new Error("Calendar slot exceeds the day's scheduled appointments");
  }
  requireArray(state.issueThreads, "Issue threads");
  if (!Number.isInteger(state.nextIssueThreadSequence) || state.nextIssueThreadSequence < 1) {
    throw new Error("Issue thread sequence is invalid");
  }
  const issueThreadIds = new Set();
  for (const thread of state.issueThreads) {
    requireObject(thread, "Issue thread");
    if (typeof thread.id !== "string" || issueThreadIds.has(thread.id)
      || typeof thread.kind !== "string" || typeof thread.scenarioId !== "string"
      || typeof thread.summary !== "string"
      || !state.residents.some((resident) => resident.id === thread.originatorId)
      || !["open", "escalating", "festering", "resolved"].includes(thread.status)
      || !Number.isInteger(thread.createdDay) || thread.createdDay < 0
      || !Number.isInteger(thread.lastTouchedDay) || thread.lastTouchedDay < thread.createdDay
      || !Number.isInteger(thread.deadlineDay) || thread.deadlineDay < thread.createdDay
      || !Number.isInteger(thread.lastFollowupDay)
      || !Number.isInteger(thread.authorityStage) || thread.authorityStage < 0 || thread.authorityStage > 3) {
      throw new Error("Issue thread identity is invalid");
    }
    for (const field of ["pressure", "publicAwareness", "danger", "momentum"]) {
      requireFinite(thread[field], `Issue thread ${field}`, 0, 100);
    }
    requireArray(thread.subjectIds, "Issue thread subjects");
    if (!thread.subjectIds.length
      || !thread.subjectIds.includes(thread.originatorId)
      || thread.subjectIds.some((personId) => !state.residents.some((resident) => resident.id === personId))) {
      throw new Error("Issue thread subjects are invalid");
    }
    requireArray(thread.facts, "Issue thread facts");
    validateVisibility(thread.visibility, `Issue thread visibility for ${thread.id}`);
    for (const fact of thread.facts) validateScenarioFact(fact, `Issue fact for ${thread.id}`);
    requireArray(thread.sourceVisitIds, "Issue thread source visits");
    if (thread.relatedPersonId != null
      && !state.residents.some((resident) => resident.id === thread.relatedPersonId)) {
      throw new Error("Issue thread related person is invalid");
    }
    issueThreadIds.add(thread.id);
  }
  requireObject(state.churchResources, "Church resources");
  const churchResourceKeys = ["coin", "grain", "bread", "beans", "onions", "saltedFish", "cheese", "firewood", "medicine"];
  if (Object.keys(state.churchResources).sort().join(",") !== [...churchResourceKeys].sort().join(",")) {
    throw new Error("Church resources have invalid keys");
  }
  for (const field of churchResourceKeys) {
    if (!Number.isInteger(state.churchResources[field]) || state.churchResources[field] < 0 || state.churchResources[field] > 9999) {
      throw new Error(`Church resource ${field} is invalid`);
    }
  }
  requireObject(state.material, "Material village state");
  for (const field of ["foodSecurity", "grainPrice", "diseasePressure", "crime", "infrastructure"]) {
    requireFinite(state.material[field], `Material ${field}`, 0, 100);
  }
  requireObject(state.material.modifiers, "Material modifiers");
  const materialModifierKeys = ["foodSecurity", "grainPrice", "diseasePressure", "crime", "infrastructure"];
  if (Object.keys(state.material.modifiers).sort().join(",") !== [...materialModifierKeys].sort().join(",")) {
    throw new Error("Material modifiers have invalid keys");
  }
  for (const field of materialModifierKeys) {
    requireFinite(state.material.modifiers[field], `Material modifier ${field}`, -20, 20);
  }
  if (typeof state.material.season !== "string" || typeof state.material.weather !== "string") {
    throw new Error("Material season or weather is invalid");
  }
  const requiredFactionIds = ["traditionalists", "reformers", "brotherhood"];
  if (state.parishFactions.length !== requiredFactionIds.length
    || requiredFactionIds.some((id) => !state.parishFactions.some((faction) => faction.id === id))) {
    throw new Error("Parish factions are incomplete");
  }
  for (const faction of state.parishFactions) {
    requireArray(faction.memberIds, `Faction members for ${faction.id}`);
    if (typeof faction.name !== "string") throw new Error(`Faction ${faction.id} has invalid name`);
    requireFinite(faction.influence, `Faction influence for ${faction.id}`, 0, 100);
  }
  if (typeof state.householdFamiliesSeeded !== "boolean") throw new Error("Household family seed state is invalid");
  requireArray(state.externalActors, "External actors");
  requireArray(state.eventQueue, "Event queue");
  requireObject(state.outsideAttention, "Outside attention");
  requireObject(state.authorityStages, "Authority stages");
  for (const field of [
    "archdeaconCompleted", "bishopCompleted", "examinerCompleted", "sheriffCompleted",
    "papalLegateCompleted", "royalCommissionerCompleted", "nobleCompleted",
    "kingRollAttempted", "popeRollAttempted"
  ]) {
    if (typeof state.authorityStages[field] !== "boolean") throw new Error(`Authority stage ${field} is invalid`);
  }
  for (const field of ["church", "rome", "crown", "legal"]) {
    requireFinite(state.outsideAttention[field], `Outside attention ${field}`, 0, 100);
  }
  requireArray(state.commandLog, "Command log");
  requireArray(state.aiProposals, "AI proposals");
  requireArray(state.events, "Events");
  requireArray(state.chronicle, "Chronicle");
  requireArray(state.sermons, "Sermons");
  requireArray(state.conversationHistory, "Conversation history");
  requireObject(state.aiDiagnostics, "AI diagnostics");
  if (state.aiDiagnostics.lastCompletedVisit != null) {
    const diagnostic = state.aiDiagnostics.lastCompletedVisit;
    requireObject(diagnostic, "Last completed visit diagnostics");
    requireArray(diagnostic.promptTraces, "Last completed visit prompt traces");
    if (typeof diagnostic.visitId !== "string"
      || !Number.isInteger(diagnostic.day) || diagnostic.day < 0
      || typeof diagnostic.personId !== "string"
      || typeof diagnostic.personName !== "string"
      || diagnostic.promptTraces.length > PROMPT_TRACE_LIMIT) {
      throw new Error("Last completed visit diagnostics are invalid");
    }
    for (const trace of diagnostic.promptTraces) validatePromptTrace(trace, "Completed visit prompt trace");
  }
  requireArray(state.visitArchive, "Visit archive");
  requireArray(state.periodReports, "Period reports");
  requireObject(state.periodTracking, "Period tracking");
  if (!Number.isInteger(state.nextPeriodReportSequence) || state.nextPeriodReportSequence < 1) {
    throw new Error("Period report sequence is invalid");
  }
  if (state.visitArchive.length > VISIT_ARCHIVE_LIMIT
    || state.periodReports.filter((report) => report.type === "day").length > DAILY_REPORT_LIMIT
    || state.periodReports.filter((report) => report.type === "week").length > WEEKLY_REPORT_LIMIT) {
    throw new Error("Report or visit archive retention limit is invalid");
  }
  for (const field of ["dayStart", "weekStart"]) {
    const baseline = state.periodTracking[field];
    requireObject(baseline, `Period tracking ${field}`);
    requireArray(baseline.metrics, `Period tracking ${field} metrics`);
    if (!Number.isInteger(baseline.day) || baseline.day < 0
      || !Number.isInteger(baseline.week) || baseline.week < 1
      || !Number.isInteger(baseline.eventSequence) || baseline.eventSequence < 1
      || typeof baseline.partial !== "boolean") {
      throw new Error("Period tracking baseline is invalid");
    }
    for (const metric of baseline.metrics) {
      if (typeof metric.group !== "string" || typeof metric.key !== "string"
        || typeof metric.label !== "string" || typeof metric.unit !== "string"
        || !Number.isFinite(metric.value)) {
        throw new Error("Period tracking metric is invalid");
      }
    }
  }
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
    } else if (state.replayBase.kind === "migration") {
      requireObject(state.replayBase.source, "Replay migration source");
      if (![2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].includes(state.replayBase.sourceSchemaVersion)
        || Number(state.replayBase.source.schemaVersion ?? state.replayBase.source.version) !== state.replayBase.sourceSchemaVersion) {
        throw new Error("Replay migration source is invalid");
      }
      const remigrated = migrateState(state.replayBase.source);
      if (stableStringify(remigrated.replayBase.snapshot) !== stableStringify(state.replayBase.snapshot)) {
        throw new Error("Replay base does not match its schema migration");
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
  const memoryIds = new Set();
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
      requireFinite(person.age, `Age for ${person.id}`, 0);
      if (typeof person.householdId !== "string") throw new Error(`Resident ${person.id} has no household`);
      if (typeof person.occupation !== "string") throw new Error(`Resident ${person.id} has invalid occupation`);
      if (!Number.isInteger(person.sprite) || person.sprite < 0 || person.sprite > 41) throw new Error(`Resident ${person.id} has invalid sprite`);
      for (const field of ["active", "profileRevealed", "materialized"]) {
        if (typeof person[field] !== "boolean") throw new Error(`Resident ${person.id} has invalid ${field}`);
      }
      if (typeof person.alive !== "boolean") throw new Error(`Resident ${person.id} has invalid alive state`);
      if (!Number.isInteger(person.ageDays) || person.ageDays < 0 || Math.floor(person.ageDays / 365) !== person.age) {
        throw new Error(`Resident ${person.id} has invalid age-day state`);
      }
      if (!Number.isInteger(person.visitCount) || person.visitCount < 0) throw new Error(`Resident ${person.id} has invalid visit count`);
      requireFinite(person.lastVisitDay, `Last visit day for ${person.id}`);
      for (const field of ["attendanceChance", "trustPriest", "faith", "morale", "prosperity", "health", "stress", "reputation"]) {
        requireFinite(person[field], `${field} for ${person.id}`, 0, 100);
      }
      requireArray(person.relationshipIds, `Relationships for ${person.id}`);
      requireArray(person.memories, `Memories for ${person.id}`);
      requireArray(person.flags, `Flags for ${person.id}`);
      requireArray(person.parentIds, `Parents for ${person.id}`);
      requireArray(person.childrenIds, `Children for ${person.id}`);
      if (!["single", "married", "separated", "annulled", "deserted", "widowed", "deceased"].includes(person.maritalStatus)) {
        throw new Error(`Resident ${person.id} has invalid marital status`);
      }
      if (person.spouseId != null && typeof person.spouseId !== "string") throw new Error(`Resident ${person.id} has invalid spouse`);
      if (person.marriageDay != null && (!Number.isInteger(person.marriageDay) || person.marriageDay < 0)) {
        throw new Error(`Resident ${person.id} has invalid marriage day`);
      }
      if (person.pregnantDueDay != null && (!Number.isInteger(person.pregnantDueDay) || person.pregnantDueDay < 0)) {
        throw new Error(`Resident ${person.id} has invalid pregnancy state`);
      }
      if (person.pregnancyCoParentId != null && typeof person.pregnancyCoParentId !== "string") {
        throw new Error(`Resident ${person.id} has invalid pregnancy co-parent`);
      }
      if ((person.pregnantDueDay == null) !== (person.pregnancyCoParentId == null)
        || (person.pregnantDueDay != null && (person.sex !== "female" || !person.alive))) {
        throw new Error(`Resident ${person.id} has inconsistent pregnancy state`);
      }
      if (person.illness != null && typeof person.illness !== "string") throw new Error(`Resident ${person.id} has invalid illness`);
      if (!Number.isInteger(person.illnessDays) || person.illnessDays < 0) throw new Error(`Resident ${person.id} has invalid illness duration`);
      if (person.causeOfDeath != null && typeof person.causeOfDeath !== "string") throw new Error(`Resident ${person.id} has invalid cause of death`);
      if (!Number.isInteger(person.arrivalDay) || person.arrivalDay < 0
        || (person.departureDay != null && (!Number.isInteger(person.departureDay) || person.departureDay < person.arrivalDay))) {
        throw new Error(`Resident ${person.id} has invalid migration dates`);
      }
      for (const memory of person.memories) {
        requireObject(memory, `Memory for ${person.id}`);
        if (typeof memory.id !== "string" || typeof memory.type !== "string"
          || typeof memory.subjectId !== "string" || typeof memory.summary !== "string"
          || typeof memory.emotion !== "string" || typeof memory.privateMemory !== "boolean"
          || !Number.isInteger(memory.day)) {
          throw new Error(`Resident ${person.id} has invalid memory`);
        }
        validateVisibility(memory.visibility, `Memory visibility for ${person.id}`);
        if (memoryIds.has(memory.id)) throw new Error(`Duplicate memory ID: ${memory.id}`);
        memoryIds.add(memory.id);
        requireFinite(memory.confidence, `Memory confidence for ${person.id}`, 0, 100);
      }
      if (person.flags.some((flag) => typeof flag !== "string")) throw new Error(`Resident ${person.id} has invalid flags`);
      if (person.materialized) {
        requireObject(person.personality, `Personality for ${person.id}`);
        requireArray(person.personality.traits, `Traits for ${person.id}`);
        if (person.personality.traits.some((trait) => typeof trait !== "string")) throw new Error(`Resident ${person.id} has invalid traits`);
        for (const field of ["candor", "empathy", "boldness", "piety"]) {
          requireFinite(person.personality[field], `${field} for ${person.id}`, 0, 100);
        }
        if (typeof person.backstory !== "string" || typeof person.publicBackstory !== "string"
          || typeof person.privatePressure !== "string") {
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
      for (const memory of person.memories) {
        requireObject(memory, `Memory for ${person.id}`);
        if (typeof memory.id !== "string" || typeof memory.type !== "string"
          || typeof memory.subjectId !== "string" || typeof memory.summary !== "string"
          || typeof memory.emotion !== "string" || typeof memory.privateMemory !== "boolean"
          || !Number.isInteger(memory.day)) {
          throw new Error(`External actor ${person.id} has invalid memory`);
        }
        validateVisibility(memory.visibility, `Memory visibility for ${person.id}`);
        requireFinite(memory.confidence, `Memory confidence for ${person.id}`, 0, 100);
        if (memoryIds.has(memory.id)) throw new Error(`Duplicate memory ID: ${memory.id}`);
        memoryIds.add(memory.id);
      }
    }
  }

  const householdIds = new Set();
  const householdMembership = new Map();
  const propertyIds = new Set();
  if (!Number.isInteger(state.nextPropertySequence) || state.nextPropertySequence < 1) {
    throw new Error("Property sequence is invalid");
  }
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
    requireFinite(household.dailyProduction, `Daily production for ${household.id}`, 0);
    if (!Number.isInteger(household.lastBalanceDay)) throw new Error(`Household ${household.id} has invalid balance day`);
    if (!Number.isInteger(household.lastAdoptionDay)) throw new Error(`Household ${household.id} has invalid adoption day`);
    requireArray(household.properties, `Properties for ${household.id}`);
    for (const property of household.properties) {
      requireObject(property, `Property for ${household.id}`);
      if (typeof property.id !== "string" || propertyIds.has(property.id)
        || typeof property.type !== "string" || typeof property.location !== "string"
        || !Number.isFinite(property.value) || property.value < 0
        || !["owned", "leased"].includes(property.status)) {
        throw new Error(`Property for ${household.id} is invalid`);
      }
      propertyIds.add(property.id);
    }
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
    for (const promise of state.priest.promises) {
      if (promise.personId != null && !personIds.has(promise.personId)) throw new Error(`Promise ${promise.id} has missing person`);
    }
    for (const position of state.priest.positions) {
      if (position.personId != null && !personIds.has(position.personId)) throw new Error(`Position ${position.id} has missing person`);
    }
    for (const breach of state.priest.confidentialityBreaches) {
      requireObject(breach, "Confidentiality breach");
      if (typeof breach.id !== "string" || !personIds.has(breach.subjectId) || !personIds.has(breach.listenerId)
        || !Number.isInteger(breach.day)) {
        throw new Error("Confidentiality breach is invalid");
      }
    }
    for (const relationId of resident.relationshipIds) {
      if (!personIds.has(relationId)) throw new Error(`Resident ${resident.id} references missing relationship ${relationId}`);
    }
    for (const relativeId of [...resident.parentIds, ...resident.childrenIds]) {
      if (!personIds.has(relativeId)) throw new Error(`Resident ${resident.id} references missing relative ${relativeId}`);
    }
    if (resident.spouseId != null && !personIds.has(resident.spouseId)) {
      throw new Error(`Resident ${resident.id} references missing spouse ${resident.spouseId}`);
    }
    if (resident.pregnancyCoParentId != null && !personIds.has(resident.pregnancyCoParentId)) {
      throw new Error(`Resident ${resident.id} references missing pregnancy co-parent ${resident.pregnancyCoParentId}`);
    }
    if (resident.spouseId != null) {
      const spouse = state.residents.find((person) => person.id === resident.spouseId);
      if (spouse?.spouseId !== resident.id || resident.age < 18 || spouse.age < 18) {
        throw new Error(`Resident ${resident.id} has invalid reciprocal adult spouse`);
      }
      if (spouse.sex === resident.sex) throw new Error(`Resident ${resident.id} has invalid same-sex marriage`);
    }
  }

  const relationshipIds = new Set();
  for (const relationship of state.relationships) {
    requireObject(relationship, "Relationship");
    if (!relationship.id || relationshipIds.has(relationship.id)) throw new Error(`Duplicate or missing relationship ID: ${relationship.id}`);
    relationshipIds.add(relationship.id);
    if (!personIds.has(relationship.actorId) || !personIds.has(relationship.targetId) || relationship.actorId === relationship.targetId) {
      throw new Error(`Relationship ${relationship.id} has invalid people`);
    }
    if (relationship.id !== `relationship-${relationship.actorId}-${relationship.targetId}`) {
      throw new Error(`Relationship ${relationship.id} has invalid canonical ID`);
    }
    for (const field of ["familiarity", "trust", "affection", "attraction", "fear", "respect", "resentment", "obligation"]) {
      requireFinite(relationship[field], `${field} for ${relationship.id}`, 0, 100);
    }
    if (!Number.isInteger(relationship.lastInteractionDay)) throw new Error(`Relationship ${relationship.id} has invalid interaction day`);
  }
  const knowledgeIds = new Set();
  for (const entry of state.knowledge) {
    requireObject(entry, "Knowledge entry");
    if (!entry.id || knowledgeIds.has(entry.id)) throw new Error(`Duplicate or missing knowledge ID: ${entry.id}`);
    knowledgeIds.add(entry.id);
    if (!personIds.has(entry.holderId) || (entry.subjectId !== "priest" && !personIds.has(entry.subjectId))) {
      throw new Error(`Knowledge ${entry.id} has invalid people`);
    }
    if (typeof entry.topic !== "string" || typeof entry.belief !== "string"
      || typeof entry.isTrue !== "boolean" || typeof entry.privateKnowledge !== "boolean") {
      throw new Error(`Knowledge ${entry.id} is malformed`);
    }
    requireFinite(entry.confidence, `Confidence for ${entry.id}`, 0, 100);
  }
  const rumorIds = new Set();
  for (const rumor of state.rumors) {
    requireObject(rumor, "Rumor");
    if (!rumor.id || rumorIds.has(rumor.id)) throw new Error(`Duplicate or missing rumor ID: ${rumor.id}`);
    rumorIds.add(rumor.id);
    if (!personIds.has(rumor.originatorId) || (rumor.subjectId !== "priest" && !personIds.has(rumor.subjectId))) {
      throw new Error(`Rumor ${rumor.id} has invalid people`);
    }
    if (typeof rumor.claim !== "string" || typeof rumor.active !== "boolean") throw new Error(`Rumor ${rumor.id} is malformed`);
    requireFinite(rumor.truth, `Truth for ${rumor.id}`, 0, 100);
    requireFinite(rumor.intensity, `Intensity for ${rumor.id}`, 1, 5);
    requireArray(rumor.heardByIds, `Hearers for ${rumor.id}`);
    if (rumor.heardByIds.some((id) => !personIds.has(id))) throw new Error(`Rumor ${rumor.id} has missing hearers`);
    if (!Number.isInteger(rumor.createdDay) || rumor.createdDay < 0) throw new Error(`Rumor ${rumor.id} has invalid day`);
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
  const archivedVisitIds = new Set();
  for (const visit of state.visitArchive) {
    requireObject(visit, "Archived visit");
    requireArray(visit.history, "Archived visit history");
    requireArray(visit.counsel, "Archived visit counsel");
    requireArray(visit.turnAudits, "Archived visit audits");
    requireArray(visit.eventIds, "Archived visit events");
    requireObject(visit.issue, "Archived visit issue");
    requireObject(visit.acceptedPlan, "Archived visit accepted plan");
    requireArray(visit.acceptedPlan.steps, "Archived visit accepted steps");
    if (typeof visit.visitId !== "string" || archivedVisitIds.has(visit.visitId)
      || !personIds.has(visit.personId) || typeof visit.personName !== "string"
      || !Number.isInteger(visit.day) || visit.day < 0
      || !Number.isInteger(visit.week) || visit.week < 1
      || !Number.isInteger(visit.slot) || visit.slot < 0
      || !["confessional", "office", "nave", "shrine"].includes(visit.location)
      || typeof visit.issue.kind !== "string" || typeof visit.issue.summary !== "string"
      || typeof visit.resolution !== "string") {
      throw new Error("Archived visit is invalid");
    }
    validateVisibility(visit.visibility, "Archived visit visibility");
    for (const line of visit.history) {
      if (!["priest", "visitor"].includes(line.speaker) || typeof line.text !== "string") {
        throw new Error("Archived visit history is invalid");
      }
    }
    for (const audit of visit.turnAudits) validateReactionAudit(audit, "Archived visit audit");
    if (visit.eventIds.some((eventId) => !eventIds.has(eventId))) {
      throw new Error("Archived visit references a missing event");
    }
    archivedVisitIds.add(visit.visitId);
  }
  const reportIds = new Set();
  for (const report of state.periodReports) {
    requireObject(report, "Period report");
    requireArray(report.metrics, "Period report metrics");
    requireArray(report.eventIds, "Period report events");
    requireArray(report.summaries, "Period report summaries");
    requireArray(report.visits, "Period report visits");
    requireArray(report.affectedPeople, "Period report affected people");
    if (typeof report.id !== "string" || reportIds.has(report.id)
      || !["day", "week"].includes(report.type) || typeof report.label !== "string"
      || !Number.isInteger(report.startDay) || report.startDay < 0
      || !Number.isInteger(report.endDay) || report.endDay < report.startDay
      || !Number.isInteger(report.week) || report.week < 1
      || typeof report.partial !== "boolean"
      || !Number.isInteger(report.omittedSummaryCount) || report.omittedSummaryCount < 0) {
      throw new Error("Period report is invalid");
    }
    for (const metric of report.metrics) {
      if (typeof metric.group !== "string" || typeof metric.key !== "string"
        || typeof metric.label !== "string" || typeof metric.unit !== "string"
        || !Number.isFinite(metric.start) || !Number.isFinite(metric.end)
        || metric.delta !== metric.end - metric.start) {
        throw new Error("Period report metric is invalid");
      }
    }
    if (report.eventIds.some((eventId) => !eventIds.has(eventId))
      || report.affectedPeople.some((entry) => !personIds.has(entry.personId))) {
      throw new Error("Period report references missing people or events");
    }
    reportIds.add(report.id);
  }
  for (const person of [...state.residents, ...state.externalActors]) {
    for (const memory of person.memories) {
      if (memory.sourceEventId != null && !eventIds.has(memory.sourceEventId)) {
        throw new Error(`Memory ${memory.id} has missing source event`);
      }
    }
  }
  for (const entry of state.knowledge) {
    if (entry.sourceEventId != null && !eventIds.has(entry.sourceEventId)) {
      throw new Error(`Knowledge ${entry.id} has missing source event`);
    }
  }
  for (const rumor of state.rumors) {
    if (rumor.sourceEventId != null && !eventIds.has(rumor.sourceEventId)) {
      throw new Error(`Rumor ${rumor.id} has missing source event`);
    }
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
    if (!personIds.has(state.currentVisit.personId)) throw new Error("Current visit must reference a known person");
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
    requireObject(state.currentVisit.intent, "Current visit intent");
    for (const field of ["primaryMatter", "desiredOutcome", "hiddenConcern"]) {
      if (typeof state.currentVisit.intent[field] !== "string") throw new Error(`Current visit intent ${field} is invalid`);
    }
    for (const field of ["disclosureThreshold", "urgency", "risk"]) {
      requireFinite(state.currentVisit.intent[field], `Current visit intent ${field}`, 0, 100);
    }
    requireFinite(state.currentVisit.disclosure, "Current visit disclosure", 0, 100);
    if (typeof state.currentVisit.hiddenConcernDisclosed !== "boolean") throw new Error("Current visit disclosure state is invalid");
    requireArray(state.currentVisit.scenarioFacts, "Current visit scenario facts");
    for (const fact of state.currentVisit.scenarioFacts) validateScenarioFact(fact, "Current visit scenario fact");
    requireArray(state.currentVisit.revealedFactIds, "Current visit revealed facts");
    requireArray(state.currentVisit.lastVisitorReplies, "Current visit visitor replies");
    if (!Number.isInteger(state.currentVisit.stagnationCount) || state.currentVisit.stagnationCount < 0) {
      throw new Error("Current visit stagnation count is invalid");
    }
    if (!Number.isInteger(state.currentVisit.turnsUsed) || state.currentVisit.turnsUsed < 0 || state.currentVisit.turnsUsed > 10) {
      throw new Error("Current visit turn count is invalid");
    }
    if (state.currentVisit.maxTurns !== 10) throw new Error("Current visit maximum turns is invalid");
    if (typeof state.currentVisit.mood !== "string") throw new Error("Current visit mood is invalid");
    if (!["ordinary", "comic", "outrageous"].includes(state.currentVisit.eventLicense)) {
      throw new Error("Current visit event license is invalid");
    }
    validateReactionState(state.currentVisit.reactionState);
    requireArray(state.currentVisit.turnAudits, "Current visit reaction audits");
    if (typeof state.currentVisit.reactionStateMigrated !== "boolean") {
      throw new Error("Current visit reaction migration state is invalid");
    }
    let priorAuditTurn = 0;
    for (const audit of state.currentVisit.turnAudits) {
      validateReactionAudit(audit, "Current visit reaction audit");
      if (audit.turn <= priorAuditTurn || audit.turn > state.currentVisit.turnsUsed) {
        throw new Error("Current visit reaction audit order is invalid");
      }
      priorAuditTurn = audit.turn;
    }
    if (!state.currentVisit.reactionStateMigrated
      && state.currentVisit.turnAudits.length !== state.currentVisit.turnsUsed) {
      throw new Error("Fresh visit reaction audit count does not match turns");
    }
    requireObject(state.currentVisit.continuity, "Current visit continuity");
    for (const field of [
      "unresolvedQuestions", "agreements", "retractions",
      "mentionedFactIds", "lastAnsweredQuestionTurnIds"
    ]) {
      requireArray(state.currentVisit.continuity[field], `Current visit ${field}`);
    }
    if (state.currentVisit.continuity.mentionedFactIds.some((factId) => (
      typeof factId !== "string" || !state.currentVisit.scenarioFacts.some((fact) => fact.id === factId)
    )) || state.currentVisit.continuity.lastAnsweredQuestionTurnIds.some((turnId) => typeof turnId !== "string")) {
      throw new Error("Current visit fact or question progress is invalid");
    }
    if (state.currentVisit.continuity.currentObligation != null) {
      validateConversationObligation(state.currentVisit.continuity.currentObligation, "Current visit obligation");
    }
    requireArray(state.currentVisit.promptTraces, "Current visit prompt traces");
    if (state.currentVisit.promptTraces.length > PROMPT_TRACE_LIMIT) {
      throw new Error("Current visit has too many prompt traces");
    }
    for (const trace of state.currentVisit.promptTraces) validatePromptTrace(trace, "Current visit prompt trace");
    for (const question of state.currentVisit.continuity.unresolvedQuestions) {
      requireObject(question, "Unresolved question");
      if (typeof question.turnId !== "string" || typeof question.text !== "string"
        || typeof question.issueId !== "string" || !["open", "answered", "unknown", "refused"].includes(question.status)) {
        throw new Error("Unresolved question is invalid");
      }
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
      if (command.payload.opening != null
        && (typeof command.payload.opening !== "string"
          || !command.payload.opening.trim()
          || command.payload.opening.length > 800)) {
        throw new Error("Begin-visit opening is invalid");
      }
      if (!personIds.has(command.payload.personId)) throw new Error("Begin-visit command references a missing person");
      activeVisitPersonId = command.payload.personId;
      activeVisitTurns = 0;
    } else if (command.type === "request_visits") {
      requireArray(command.payload.personIds, "Requested visit command people");
      requireArray(command.payload.results, "Requested visit command results");
      if (command.payload.personIds.length < 1 || command.payload.personIds.length > 4
        || command.payload.personIds.some((personId) => typeof personId !== "string" || !personIds.has(personId))
        || typeof command.payload.reason !== "string"
        || command.payload.results.length !== command.payload.personIds.length) {
        throw new Error("Requested visit command is invalid");
      }
      for (const result of command.payload.results) {
        if (!command.payload.personIds.includes(result.personId)
          || !["accepted", "declined"].includes(result.status)) {
          throw new Error("Requested visit command result is invalid");
        }
      }
    } else if (command.type === "conversation_exchange") {
      if (!activeVisitPersonId) throw new Error("Conversation command has no active visit");
      if (activeVisitTurns >= 10) throw new Error("Command log exceeds the ten-exchange visit limit");
      if (typeof command.payload.playerText !== "string" || !command.payload.playerText.trim()) {
        throw new Error("Conversation command text is invalid");
      }
      requireObject(command.payload.response, "Conversation command response");
      validateConversation(command.payload.response);
      if (command.payload.response.conversationObligation != null) {
        validateConversationObligation(
          command.payload.response.conversationObligation,
          "Conversation command obligation"
        );
      }
      if (command.payload.response.promptTrace != null) {
        validatePromptTrace(command.payload.response.promptTrace, "Conversation command prompt trace");
      }
      if (command.payload.response.reactionAudit != null) {
        validateReactionAudit(command.payload.response.reactionAudit, "Conversation command reaction audit");
      }
      if (typeof command.payload.response.mood !== "string") throw new Error("Conversation command mood is invalid");
      for (const field of ["trustDelta", "stressDelta"]) {
        if (!Number.isInteger(command.payload.response[field])
          || command.payload.response[field] < -5
          || command.payload.response[field] > 5) {
          throw new Error(`Conversation command ${field} is invalid`);
        }
      }
      requireArray(command.payload.response.intents, "Conversation command intents");
      if (command.payload.response.intents.some((intent) => typeof intent !== "string")) {
        throw new Error("Conversation command intents are invalid");
      }
      requireFinite(command.payload.response.disclosure, "Conversation command disclosure", 0, 100);
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
        if (step.depth !== stepIndex + 1 || step.actorId !== expectedActorId || !personIds.has(step.actorId)) {
          throw new Error("Finish command causal actor is invalid");
        }
        if (step.targetId != null && step.targetId !== "priest" && !personIds.has(step.targetId)) {
          throw new Error("Finish command target is invalid");
        }
        if (!AI_ALLOWED_ACTIONS.includes(step.actionType)) throw new Error("Finish command action is invalid");
        if (!Number.isInteger(step.intensity) || step.intensity < 1 || step.intensity > 5) {
          throw new Error("Finish command intensity is invalid");
        }
        for (const field of ["title", "description", "detail"]) {
          if (typeof step[field] !== "string") throw new Error(`Finish command ${field} is invalid`);
        }
        const stepEffects = step.effects ?? [];
        requireArray(stepEffects, "Finish command custom effects");
        if (stepEffects.length > 3 || (step.actionType !== "improvise" && stepEffects.length)) {
          throw new Error("Finish command custom effects are invalid");
        }
        for (const effect of stepEffects) {
          if (!["town", "material", "issue", "actor", "target"].includes(effect.scope)
            || typeof effect.key !== "string" || !Number.isInteger(effect.delta)
            || effect.delta < -3 || effect.delta > 3 || typeof effect.reason !== "string") {
            throw new Error("Finish command custom effect is invalid");
          }
        }
        if (!Number.isInteger(step.decisionScore) || step.decisionScore < 0 || step.decisionScore > 100) {
          throw new Error("Finish command decision score is invalid");
        }
        if (step.createdResidentId != null && !residentIds.has(step.createdResidentId)) {
          throw new Error("Finish command created resident is invalid");
        }
        const createsResident = ["adopt_child", "invite_migrant"].includes(step.actionType);
        if (createsResident !== (typeof step.createdResidentId === "string")) {
          throw new Error("Finish command created resident identity is inconsistent");
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
  if ((state.commandLog.length || state.replayBase)
    && state.currentVisit
    && activeVisitTurns !== state.currentVisit.turnsUsed) {
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
      || !Number.isInteger(queued.dueDay) || queued.dueDay < 0) {
      throw new Error("Queued event has invalid identity or due day");
    }
    const queueIds = new Set();
    for (const queued of state.eventQueue) {
      if (queueIds.has(queued.id)) throw new Error(`Duplicate queue ID: ${queued.id}`);
      queueIds.add(queued.id);
    }
    requireObject(queued.payload, `Payload for queued event ${queued.id}`);
    for (const field of ["actorId", "targetId", "sourcePersonId"]) {
      if (queued[field] != null && queued[field] !== "priest" && !personIds.has(queued[field])) {
        throw new Error(`Queued event references missing person ${queued[field]}`);
      }
      if (queued.sourceEventId != null && !eventIds.has(queued.sourceEventId)) {
        throw new Error(`Queued event ${queued.id} has missing source event`);
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
  const maximumResidentSequence = state.residents.reduce((maximum, resident) => {
    const match = /^person-(\d+)$/.exec(resident.id);
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0);
  const maximumKnowledgeSequence = state.knowledge.reduce((maximum, entry) => {
    const match = /^knowledge-(\d+)$/.exec(entry.id);
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0);
  const maximumRumorSequence = state.rumors.reduce((maximum, rumor) => {
    const match = /^rumor-(\d+)$/.exec(rumor.id);
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0);
  const maximumMemorySequence = [...state.residents, ...state.externalActors].flatMap((person) => person.memories).reduce((maximum, memory) => {
    const match = /^memory-(\d+)$/.exec(memory.id);
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0);
  const maximumPositionSequence = state.priest.positions.reduce((maximum, position) => {
    const match = /^position-(\d+)$/.exec(position.id);
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0);
  if (!Number.isInteger(state.populationSequence) || state.populationSequence <= maximumResidentSequence) {
    throw new Error("Population sequence would create a duplicate resident");
  }
  if (!Number.isInteger(state.nextKnowledgeSequence) || state.nextKnowledgeSequence <= maximumKnowledgeSequence) {
    throw new Error("Knowledge sequence would create a duplicate entry");
  }
  if (!Number.isInteger(state.nextRumorSequence) || state.nextRumorSequence <= maximumRumorSequence) {
    throw new Error("Rumor sequence would create a duplicate entry");
  }
  if (!Number.isInteger(state.nextMemorySequence) || state.nextMemorySequence <= maximumMemorySequence) {
    throw new Error("Memory sequence would create a duplicate entry");
  }
  if (!Number.isInteger(state.nextPositionSequence) || state.nextPositionSequence <= maximumPositionSequence) {
    throw new Error("Position sequence would create a duplicate entry");
  }
  if (!Number.isInteger(state.lastInvitedMigrationDay)) {
    throw new Error("Invited migration cooldown is invalid");
  }
  const maximumExternalSequence = state.externalActors.reduce((maximum, actor) => {
    const match = /^external-(\d+)$/.exec(actor.id);
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0);
  const maximumQueueSequence = state.eventQueue.reduce((maximum, event) => {
    const match = /^queue-(\d+)$/.exec(event.id);
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0);
  if (!Number.isInteger(state.nextExternalSequence) || state.nextExternalSequence <= maximumExternalSequence) {
    throw new Error("External actor sequence is invalid");
  }
  if (!Number.isInteger(state.nextQueueSequence) || state.nextQueueSequence <= maximumQueueSequence) {
    throw new Error("Queue sequence is invalid");
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
  const unresolvedThreads = state.issueThreads.filter((thread) => thread.status !== "resolved");
  const recentResolvedThreads = state.issueThreads
    .filter((thread) => thread.status === "resolved")
    .sort((left, right) => right.lastTouchedDay - left.lastTouchedDay || right.id.localeCompare(left.id))
    .slice(0, 50);
  state.issueThreads = [...unresolvedThreads, ...recentResolvedThreads];
  const retainedEventIds = new Set([
    ...state.chronicle.map((entry) => entry.eventId),
    ...state.knowledge.map((entry) => entry.sourceEventId),
    ...state.rumors.map((rumor) => rumor.sourceEventId),
    ...[...state.residents, ...state.externalActors].flatMap((person) => person.memories.map((memory) => memory.sourceEventId)),
    ...state.eventQueue.map((event) => event.sourceEventId),
    ...state.visitArchive.flatMap((visit) => visit.eventIds),
    ...state.periodReports.flatMap((report) => report.eventIds)
  ].filter(Boolean));
  const eventsById = new Map(state.events.map((event) => [event.id, event]));
  const frontier = [...retainedEventIds];
  while (frontier.length) {
    const event = eventsById.get(frontier.pop());
    if (event?.parentId && !retainedEventIds.has(event.parentId)) {
      retainedEventIds.add(event.parentId);
      frontier.push(event.parentId);
    }
  }
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
