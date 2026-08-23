import { ParishAiClient, quantityPhrase } from "./ai.js";
import { churchResourceRows } from "./church.js";
import { SERMON_THEMES, SESSION_LOCATIONS, WEEK_DAYS } from "./data.js";
import { ChurchRenderer } from "./renderer.js";
import {
  applySermon,
  applyVisitOpening,
  buyAtMarket,
  marketOffer,
  beginVisit,
  calendarLabel,
  createGame,
  departureCandidates,
  fallbackConversation,
  fallbackDeparturePlan,
  fallbackSermonOutcome,
  finishVisit,
  knownResidents,
  materializeResident,
  populationCount,
  requestVisits,
  replayGame,
  recordExchange,
  rewindLastConversationTurn,
  setGameMode,
  sundayAttendance,
  sundayAttendanceReport
} from "./simulation.js";
import { compactReplayHistory, deserializeState, serializeState } from "./state.js";
import { queueAutosave, readAutosaves } from "./storage.js";
import {
  buildAgentPrompt,
  legalMoves,
  parseAgentReply,
  validateAgentChoice
} from "./agent.js";

const SAVE_KEY = "the-common-confessor-save-v2";
const LEGACY_SAVE_KEY = "the-common-confessor-save-v1";
const LEGACY_AUTOSAVE_KEYS = [
  "the-common-confessor-autosave-0",
  "the-common-confessor-autosave-1",
  "the-common-confessor-autosave-2"
];
const DEBUG_LOG_KEY = "the-common-confessor-debug-v1";
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const renderer = new ChurchRenderer(elements["church-canvas"]);
let ai = new ParishAiClient();
let copilotModels = [];
let state = null;
let aiReady = false;
let conversationInFlight = false;
let departureInFlight = false;
let sermonInFlight = false;
let stateGeneration = 0;
let initializationComplete = false;
let startActionInFlight = false;
let toastTimer = null;
let continueAfterPeriodReport = false;
const requestedVisitSelection = new Set();
let runtimeDebugLog = (() => {
  try {
    const stored = JSON.parse(localStorage.getItem(DEBUG_LOG_KEY) || "[]");
    return Array.isArray(stored) ? stored.slice(-100) : [];
  } catch {
    return [];
  }
})();

/* Church resources the priest has handed over through the interface, waiting
   to travel with the next thing he says. */
const stagedGifts = new Map();

let conversationDebugLog = (() => {
  try {
    const stored = JSON.parse(localStorage.getItem(`${DEBUG_LOG_KEY}-conversations`) || "[]");
    return Array.isArray(stored) ? stored.slice(-120) : [];
  } catch {
    return [];
  }
})();

function setHidden(element, hidden) {
  element.hidden = hidden;
}

function persistDebugLog() {
  try {
    localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(runtimeDebugLog.slice(-100)));
    localStorage.setItem(`${DEBUG_LOG_KEY}-conversations`, JSON.stringify(conversationDebugLog.slice(-120)));
  } catch (error) {
    console.warn("Debug log persistence failed:", error);
  }
}

function describeTransformations(trace) {
  const applied = trace?.transformations || [];
  const flags = {
    "semantic repair": applied.some((entry) => entry.type === "sentence_repaired"),
    "sentence removed": applied.some((entry) => entry.type === "sentence_removed"),
    "deterministic fallback": applied.some((entry) => entry.type === "deterministic_reaction")
      || trace?.responseSource === "scripted_reaction",
    "reaction override": applied.some((entry) => entry.type === "deterministic_reaction"),
    "repetition override": applied.some((entry) => entry.type.startsWith("repetition_")),
    "name normalisation": applied.some((entry) => entry.type === "names_naturalized"),
    "action dropped": applied.some((entry) => entry.type === "action_dropped")
  };
  return { flags, applied };
}

function recordConversationTelemetry(playerText, response) {
  const trace = response?.promptTrace || null;
  const { flags, applied } = describeTransformations(trace);
  const shown = String(response?.reply || "");
  const raw = String(trace?.rawModelReply || trace?.initialReply || "");
  const entry = {
    timestamp: new Date().toISOString(),
    visitId: state?.currentVisit?.visitId || null,
    personId: state?.currentVisit?.personId || null,
    turn: state?.currentVisit?.turnsUsed ?? null,
    player: String(playerText || ""),
    interpretedMeaning: trace?.understoodPlayerAs || "",
    suppliedKnowledge: trace?.suppliedKnowledge || [],
    includedFactIds: trace?.includedFactIds || [],
    rawModelResponse: raw,
    finalResponse: shown,
    unchanged: Boolean(raw) && raw === shown,
    responseSource: trace?.responseSource || response?.source || "unknown",
    route: trace?.route || "",
    modelCalled: Boolean(trace?.gemmaCalled),
    promptChars: trace?.promptLength ?? 0,
    transformations: flags,
    transformationDetail: applied,
    decisions: response?.decisions || [],
    proposedActions: response?.proposedActions || []
  };
  entry.readable = [
    `PLAYER:\n${entry.player}`,
    `MODEL CONTEXT:\n${(entry.suppliedKnowledge.length ? entry.suppliedKnowledge : ["(no authoritative facts supplied)"]).join("\n")}`,
    `INTERPRETED MEANING:\n${entry.interpretedMeaning || "(model returned none)"}`,
    `RAW MODEL RESPONSE:\n${entry.rawModelResponse || "(model not called)"}`,
    `FINAL DISPLAYED RESPONSE:\n${entry.finalResponse}`,
    `TRANSFORMATIONS:\n${Object.entries(flags).map(([label, value]) => `- ${label}: ${value ? "yes" : "no"}`).join("\n")}`,
    applied.length
      ? `IF CHANGED:\n${applied.map((change) => `- ${change.type}: ${change.detail} [${change.code}]`).join("\n")}`
      : "IF CHANGED:\n- unchanged; the displayed text is exactly what the model produced"
  ].join("\n\n");
  conversationDebugLog.push(entry);
  conversationDebugLog = conversationDebugLog.slice(-120);
  persistDebugLog();
  return entry;
}

function logRuntimeError(phase, error, extra = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    phase,
    message: String(error?.message || error || "Unknown error").slice(0, 1200),
    stack: String(error?.stack || "").slice(0, 5000),
    calendar: state?.calendar ? { ...state.calendar } : null,
    mode: state?.mode ? { ...state.mode } : null,
    visitId: state?.currentVisit?.visitId || null,
    personId: state?.currentVisit?.personId || null,
    latestHistory: state?.currentVisit?.history?.slice(-8) || [],
    currentObligation: state?.currentVisit?.continuity?.currentObligation || null,
    promptTraces: state?.currentVisit?.promptTraces?.slice(-3) || [],
    ...extra
  };
  runtimeDebugLog.push(entry);
  runtimeDebugLog = runtimeDebugLog.slice(-100);
  persistDebugLog();
  console.warn(`[${phase}]`, error, extra);
  return entry;
}

function showToast(message, duration = null) {
  const isError = /\b(?:failed|failure|error|unavailable|did not answer|could not|cannot read|timed out|invalid)\b/i.test(message);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), duration ?? (isError ? 15000 : 3500));
}

function setBusy(busy, title = "The village turns...", message = "Gemma is considering what follows.") {
  setHidden(elements["busy-overlay"], !busy);
  elements["busy-title"].textContent = title;
  elements["busy-message"].textContent = message;
}

function createSaveEnvelope(serialized, savedAt = Date.now()) {
  return JSON.stringify({
    format: "the-common-confessor-save",
    savedAt,
    data: serialized
  });
}

function decodeSaveEnvelope(stored) {
  try {
    const envelope = JSON.parse(stored);
    if (envelope?.format === "the-common-confessor-save"
      && Number.isFinite(envelope.savedAt)
      && typeof envelope.data === "string") {
      return { savedAt: envelope.savedAt, serialized: envelope.data };
    }
  } catch {
    // Legacy and corrupt payloads are handled by the state parser below.
  }
  return { savedAt: 0, serialized: stored };
}

function readLocalStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn(`localStorage read failed for ${key}:`, error);
    return null;
  }
}

function writeLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`localStorage write failed for ${key}:`, error);
    return false;
  }
}

function removeLocalStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn(`localStorage removal failed for ${key}:`, error);
  }
}

function setStartActionsDisabled(disabled) {
  elements["new-game"].disabled = disabled;
  elements["continue-game"].disabled = disabled;
  elements["start-import-game"].disabled = disabled;
  elements["import-game"].disabled = disabled;
}

function setGameplayMutationDisabled(disabled) {
  elements["speak-button"].disabled = disabled;
  elements["counsel-input"].disabled = disabled;
  elements["next-hour"].disabled = disabled;
  elements["deliver-sermon"].disabled = disabled;
  elements["sermon-theme"].disabled = disabled;
  elements["sermon-text"].disabled = disabled;
  elements["open-request-visits"].disabled = disabled;
  elements["undo-turn"].disabled = disabled;
}

function restoreGameplayControls() {
  if (state?.currentVisit) {
    const hourSpent = state.currentVisit.turnsUsed >= state.currentVisit.maxTurns;
    const endedEarly = Boolean(state.currentVisit.reactionState?.endedEarly);
    const blocked = startActionInFlight || conversationInFlight || departureInFlight;
    elements["speak-button"].disabled = blocked || hourSpent || endedEarly;
    elements["counsel-input"].disabled = blocked || hourSpent || endedEarly;
    elements["next-hour"].disabled = blocked;
    elements["undo-turn"].disabled = blocked || state.currentVisit.turnsUsed < 1;
  } else if (state?.calendar.dayIndex === 6) {
    const blocked = startActionInFlight || sermonInFlight;
    elements["deliver-sermon"].disabled = blocked;
    elements["sermon-theme"].disabled = blocked;
    elements["sermon-text"].disabled = blocked;
    elements["undo-turn"].disabled = true;
  }
}

function saveGame(silent = false, automatic = false) {
  if (!state) return;
  try {
    const serialized = serializeState(state);
    const envelope = createSaveEnvelope(serialized);
    const autosavePromise = automatic ? queueAutosave(envelope) : null;
    autosavePromise?.catch((error) => console.warn("IndexedDB autosave failed:", error));
    const primarySaved = writeLocalStorage(SAVE_KEY, envelope);
    if (primarySaved) {
      removeLocalStorage(LEGACY_SAVE_KEY);
    } else if (autosavePromise) {
      autosavePromise.then(() => removeLocalStorage(LEGACY_SAVE_KEY)).catch(() => {});
    }
    LEGACY_AUTOSAVE_KEYS.forEach(removeLocalStorage);
    if (!primarySaved && !automatic) throw new Error("Browser primary storage is unavailable");
    if (!silent) showToast("Parish saved.");
  } catch (error) {
    logRuntimeError("save", error);
    showToast(`Save failed: ${error.message}`);
  }
}

async function loadSavedGame() {
  async function promote(loaded, legacyRaw = null) {
    const serialized = serializeState(loaded);
    const envelope = createSaveEnvelope(serialized);
    if (legacyRaw) removeLocalStorage(LEGACY_SAVE_KEY);
    if (writeLocalStorage(SAVE_KEY, envelope)) {
      removeLocalStorage(LEGACY_SAVE_KEY);
      return loaded;
    }
    console.warn("Validated parish could not be promoted to localStorage.");
    if (legacyRaw) {
      if (!writeLocalStorage(LEGACY_SAVE_KEY, legacyRaw)) {
        console.warn("Legacy save rollback failed.");
      }
    }
    try {
      await queueAutosave(envelope);
    } catch (autosaveError) {
      console.warn("Validated parish could not be promoted to IndexedDB:", autosaveError);
    }
    return loaded;
  }

  const candidates = [];
  const primary = readLocalStorage(SAVE_KEY);
  if (primary) candidates.push({ source: "primary", raw: primary });
  try {
    for (const raw of await readAutosaves()) candidates.push({ source: "autosave", raw });
  } catch (error) {
    console.warn("IndexedDB autosave recovery is unavailable:", error);
  }
  const legacy = readLocalStorage(LEGACY_SAVE_KEY);
  if (legacy) candidates.push({ source: "legacy", raw: legacy });

  const valid = [];
  for (const candidate of candidates) {
    const decoded = decodeSaveEnvelope(candidate.raw);
    try {
      valid.push({
        ...candidate,
        savedAt: decoded.savedAt,
        loaded: deserializeState(decoded.serialized)
      });
    } catch (error) {
      console.warn(`${candidate.source} saved parish could not be loaded:`, error);
    }
  }
  if (!valid.length) return null;
  valid.sort((left, right) => right.savedAt - left.savedAt);
  const newest = valid[0];
  return promote(newest.loaded, newest.source === "legacy" ? newest.raw : null);
}

async function refreshAiStatus() {
  elements["ai-status"].dataset.state = "checking";
  elements["ai-status"].textContent = "Gemma: checking...";
  try {
    await ai.health();
    aiReady = true;
    elements["ai-status"].dataset.state = "ready";
    elements["ai-status"].textContent = state?.settings.aiProvider === "copilot"
      ? "Copilot: ready"
      : "Gemma: ready";
  } catch {
    aiReady = false;
    elements["ai-status"].dataset.state = "unavailable";
    elements["ai-status"].textContent = state?.settings.aiProvider === "copilot"
      ? "Copilot: unavailable"
      : "Gemma: parish rules";
  }
}

function configureAiProvider() {
  const provider = state?.settings?.aiProvider || "gemma";
  const model = provider === "copilot" ? state?.settings?.copilotModel || "auto" : "local-gemma";
  ai = new ParishAiClient({
    endpoint: provider === "copilot" ? "/copilot-ai" : "/local-ai",
    model,
    splitSemantic: provider === "gemma",
    timeoutMs: provider === "copilot" ? 120000 : 60000
  });
  elements["ai-provider"].value = provider;
  setHidden(elements["ai-model"], provider !== "copilot");
  if (provider === "copilot") elements["ai-model"].value = model;
}

async function probeCopilotProvider() {
  const option = [...elements["ai-provider"].options].find((entry) => entry.value === "copilot");
  try {
    const response = await fetch("/copilot-ai/health", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    copilotModels = Array.isArray(payload.models) ? payload.models : [];
    elements["ai-model"].replaceChildren(...copilotModels.map((model) => {
      const optionElement = document.createElement("option");
      optionElement.value = model.id;
      optionElement.textContent = model.name || model.id;
      return optionElement;
    }));
    if (!copilotModels.some((model) => model.id === "auto")) {
      const automatic = document.createElement("option");
      automatic.value = "auto";
      automatic.textContent = "Automatic";
      elements["ai-model"].prepend(automatic);
    }
    option.disabled = false;
    option.title = "Uses the signed-in GitHub Copilot account and its usage allowance.";
  } catch (error) {
    option.disabled = true;
    option.title = `Copilot SDK unavailable: ${error.message}`;
  }
}

function appendDialogue(speaker, text) {
  const line = document.createElement("p");
  line.className = `line ${speaker}`;
  const label = document.createElement("b");
  label.textContent = speaker === "priest" ? "YOU — " : "VISITOR — ";
  line.append(label, document.createTextNode(text));
  elements["dialogue-log"].append(line);
  elements["dialogue-log"].scrollTop = elements["dialogue-log"].scrollHeight;
}

function updateMetrics() {
  function metricRows(metrics) {
    return Object.entries(metrics).map(([name, value]) => {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const bar = document.createElement("span");
    bar.style.width = `${value}%`;
    dt.textContent = name;
    dt.append(bar);
    const dd = document.createElement("dd");
    dd.textContent = Math.round(value);
    row.append(dt, dd);
    return row;
    });
  }
  elements["town-metrics"].replaceChildren(...metricRows({
    ...state.town.metrics,
    food: state.material.foodSecurity,
    infrastructure: state.material.infrastructure,
    /* Shown the way every other row reads: more is better. This is how much
       order the parish keeps, not how much crime it suffers, because a bar
       labelled "crime" that fills up when the village is safest is a lie. */
    order: 100 - state.material.crime
  }));
  elements["priest-metrics"].replaceChildren(...metricRows({
    trust: state.priest.localTrust,
    authority: state.priest.moralAuthority,
    scandal: state.priest.scandal,
    health: state.priest.health
  }));
  elements["church-resources"].replaceChildren(...churchResourceRows(state.churchResources).flatMap((resource) => {
    const term = document.createElement("dt");
    const amount = document.createElement("dd");
    term.textContent = resource.label;
    const staged = stagedGifts.get(resource.key) || 0;
    amount.textContent = `${resource.amount} ${resource.unit}`;
    /* Charity can be handed over explicitly as well as spoken. What is staged
       here travels with the next thing the priest says, so the visitor sees it
       arrive and can react to it. */
    if (state.currentVisit && !state.currentVisit.reactionState?.endedEarly) {
      const give = document.createElement("button");
      give.type = "button";
      give.className = "give-button";
      give.textContent = staged ? `giving ${staged}` : "give";
      give.title = `Hand over one more ${resource.unit.replace(/s$/, "")} with your next words. Click again to add, right-click to clear.`;
      give.disabled = resource.amount <= staged;
      give.addEventListener("click", () => {
        const next = Math.min(resource.amount, staged + 1);
        if (next > 0) stagedGifts.set(resource.key, next);
        updateMetrics();
      });
      give.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        stagedGifts.delete(resource.key);
        updateMetrics();
      });
      amount.append(" ", give);
    }
    return [term, amount];
  }));
  elements["population-count"].textContent = populationCount(state);
}

function renderCommon() {
  elements["calendar-label"].textContent = calendarLabel(state);
  elements["town-name"].textContent = state.town.name;
  elements["town-description"].textContent = state.town.description;
  const requestsToday = state.visitRequests.filter((request) => request.requestedDay === state.calendar.absoluteDay);
  elements["open-request-visits"].disabled = state.calendar.absoluteDay < 1
    || state.calendar.dayIndex === 6
    || requestsToday.length >= 4
    || startActionInFlight;
  updateMetrics();
}

function renderVisit() {
  if (!state.currentVisit) stagedGifts.clear();
  const visit = state.currentVisit;
  if (!visit) return;
  const person = materializeResident(state, visit.personId, true);
  const location = SESSION_LOCATIONS[visit.location];
  elements["location-name"].textContent = location.name;
  elements["location-description"].textContent = location.description;
  elements["visitor-name"].textContent = person.name;
  elements["visitor-summary"].textContent = visit.hiddenConcernDisclosed
    ? `${visit.issue.kind}: ${visit.intent.hiddenConcern}`
    : `${visit.issue.kind}: ${visit.intent.desiredOutcome} sought`;
  elements["visitor-occupation"].textContent = person.occupation;
  elements["visitor-age"].textContent = `age ${person.age}`;
  elements["visitor-mood"].textContent = visit.reactionState?.lastReaction !== "continue"
    ? visit.reactionState.lastReaction.replaceAll("_", " ")
    : visit.mood;
  elements["visitor-backstory"].textContent = visit.hiddenConcernDisclosed ? person.backstory : person.publicBackstory;
  elements["turn-counter"].textContent = `${visit.turnsUsed} / ${visit.maxTurns} things said`;
  const latestTrace = visit.promptTraces.at(-1);
  const latestEntry = conversationDebugLog.at(-1);
  const changes = (latestTrace?.transformations || []).map((entry) => entry.type);
  elements["response-source"].textContent = latestTrace
    ? `Source: ${latestTrace.responseSource}${changes.length ? ` (framework changed: ${changes.join(", ")})` : (latestEntry?.unchanged ? " (unchanged)" : "")}`
    : "Source: opening";
  elements["hour-state"].textContent = visit.turnsUsed >= visit.maxTurns ? "The hour is spent." : "The hour continues.";
  if (visit.reactionState?.endedEarly) {
    elements["hour-state"].textContent = `${person.firstName} has ended the meeting.`;
  }
  elements["speak-button"].disabled = visit.turnsUsed >= visit.maxTurns || visit.reactionState?.endedEarly;
  elements["counsel-input"].disabled = visit.turnsUsed >= visit.maxTurns || visit.reactionState?.endedEarly;
  elements["next-hour"].textContent = visit.turnsUsed >= visit.maxTurns ? "Continue to next hour" : "End hour";
}

async function showVisit() {
  const existingVisit = Boolean(state.currentVisit);
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const requestState = state;
  const generation = stateGeneration;
  const visitToken = visit.visitId;
  renderer.beginVisit(visit.location, person.sprite);
  setHidden(elements["visitor-panel"], false);
  setHidden(elements["dialogue-panel"], false);
  setHidden(elements["sermon-panel"], true);
  elements["dialogue-log"].replaceChildren();
  renderCommon();
  renderVisit();
  if (!existingVisit && aiReady && state.settings.aiEnabled) {
    conversationInFlight = true;
    setBusy(true, `${person.firstName} gathers their thoughts`, "Gemma is shaping the visitor's first words from the facts of their life.");
    try {
      const generated = await ai.opening(requestState, person);
      if (generation !== stateGeneration || state !== requestState || state.currentVisit?.visitId !== visitToken) return;
      applyVisitOpening(requestState, generated.opening, "ai");
      saveGame(true, true);
    } catch (error) {
      if (generation === stateGeneration && state === requestState && state.currentVisit?.visitId === visitToken) {
        logRuntimeError("opening_ai", error);
        showToast(`Gemma could not shape the opening; the visitor spoke from parish rules. ${error.message}`);
      }
    } finally {
      if (generation === stateGeneration && state === requestState) {
        conversationInFlight = false;
        setBusy(false);
      }
    }
  }
  if (generation !== stateGeneration || state !== requestState || state.currentVisit?.visitId !== visitToken) return;
  visit.history.forEach((line) => appendDialogue(line.speaker === "visitor" ? "visitor" : "priest", line.text));
  renderCommon();
  renderVisit();
  setTimeout(() => elements["counsel-input"].focus(), 400);
}

function showSunday() {
  const report = sundayAttendanceReport(state);
  const attendees = report.filter((entry) => entry.attending).map((entry) => entry.person);
  renderer.showSundayCrowd(attendees);
  setHidden(elements["visitor-panel"], true);
  setHidden(elements["dialogue-panel"], true);
  setHidden(elements["sermon-panel"], false);
  elements["attendance-count"].textContent = `${attendees.length} of ${populationCount(state)}`;
  elements["notable-absences"].textContent = report
    .filter((entry) => !entry.attending)
    .slice(0, 5)
    .map((entry) => `${entry.person.name}: ${entry.reason}`)
    .join(" · ");
  elements["sermon-text"].value = "";
  elements["sermon-word-count"].textContent = "0 / 100 words";
  renderCommon();
}

function proceedToCurrentPeriod() {
  if (!state.priest.alive) {
    elements["ending-text"].textContent = "Father Benedict is dead. The parish chronicle has ended.";
    elements["ending-dialog"].showModal();
    return;
  }
  if (state.calendar.dayIndex === 6) showSunday();
  else showVisit();
}

async function endHour() {
  if (startActionInFlight || !state.currentVisit || conversationInFlight || departureInFlight) return;
  const person = materializeResident(state, state.currentVisit.personId, true);
  const requestState = state;
  const generation = stateGeneration;
  const visitToken = state.currentVisit.visitId;
  elements["speak-button"].disabled = true;
  elements["next-hour"].disabled = true;
  departureInFlight = true;
  setBusy(true, `${person.name} leaves the church`, "Their counsel may pass through as many as three lives before the hour is truly over.");
  let plan;
  try {
    const usedAi = aiReady && state.settings.aiEnabled;
    plan = usedAi
      ? { ...(await ai.departure(requestState, departureCandidates(requestState))), source: "ai" }
      : { ...fallbackDeparturePlan(requestState), source: "fallback" };
  } catch (error) {
    if (generation !== stateGeneration || state !== requestState) {
      setBusy(false);
      return;
    }
    plan = error.rejectedProposal
      ? { ...error.rejectedProposal, source: "ai" }
      : { ...fallbackDeparturePlan(requestState), source: "fallback" };
    logRuntimeError("departure_ai", error);
    showToast(`Gemma unavailable; parish rules resolved the consequence. ${error.message}`);
  }
  if (generation !== stateGeneration || state.currentVisit?.visitId !== visitToken) {
    setBusy(false);
    return;
  }
  departureInFlight = false;
  const priorReportIds = new Set(requestState.periodReports.map((report) => report.id));
  finishVisit(requestState, plan);
  compactReplayHistory(requestState);
  saveGame(true, true);
  if (!requestState.priest.alive) {
    setBusy(false);
    elements["ending-text"].textContent = `${person.name}'s actions ended Father Benedict's life. The village chronicle remains as the record of his counsel.`;
    elements["ending-dialog"].showModal();
    return;
  }
  renderer.clearVisitor();
  setBusy(false);
  elements["next-hour"].disabled = false;
  renderCommon();
  const newReports = requestState.periodReports.filter((report) => !priorReportIds.has(report.id));
  if (newReports.length) {
    showPeriodReports(newReports, true);
    return;
  }
  proceedToCurrentPeriod();
}

async function submitCounsel(event) {
  event.preventDefault();
  if (startActionInFlight || conversationInFlight || departureInFlight) return;
  const enteredText = elements["counsel-input"].value.trim();
  if (!state.currentVisit || state.currentVisit.turnsUsed >= 10) return;
  if (/^(?:pause|pause the game|pause game|meta pause)$/i.test(enteredText)) {
    setGameMode(state, "META_PAUSED");
    saveGame(true, true);
    setGameplayMutationDisabled(true);
    elements["meta-pause-dialog"].showModal();
    elements["counsel-input"].value = "";
    return;
  }
  if (/^(?:undo|undo last turn|rewind|rewind last turn|i did not mean to hit enter|i didn't mean to hit enter)$/i.test(enteredText)) {
    try {
      state = rewindLastConversationTurn(state, enteredText);
      saveGame(true, true);
      startGame(state, false);
      showToast("The last conversation turn was rewound.");
    } catch (error) {
      showToast(error.message);
    }
    elements["counsel-input"].value = "";
    return;
  }
  const text = enteredText || "[silence]";
  const person = materializeResident(state, state.currentVisit.personId, true);
  const requestState = state;
  const visitToken = state.currentVisit.visitId;
  const generation = stateGeneration;
  appendDialogue("priest", enteredText || "…");
  elements["counsel-input"].value = "";
  elements["speak-button"].disabled = true;
  elements["counsel-input"].disabled = true;
  elements["next-hour"].disabled = true;
  conversationInFlight = true;
  elements["hour-state"].textContent = `${person.firstName} considers your words...`;
  let response;
  try {
    const usedAi = aiReady && state.settings.aiEnabled;
    response = usedAi
      ? {
        ...(await ai.conversation(requestState, person, text, {
          stagedGifts: [...stagedGifts].map(([resource, amount]) => ({ resource, amount }))
        })),
        source: "ai"
      }
      : { ...fallbackConversation(requestState, text), source: "fallback" };
  } catch (error) {
    if (generation !== stateGeneration || state !== requestState) return;
    response = { ...fallbackConversation(requestState, text), source: "fallback" };
    logRuntimeError("conversation_ai", error, { playerText: text });
    showToast(`Gemma did not answer; the visitor continued locally. ${error.message}`);
  }
  if (generation !== stateGeneration || state !== requestState) return;
  conversationInFlight = false;
  stagedGifts.clear();
  recordConversationTelemetry(text, response);
  const currentToken = state.currentVisit?.visitId || "";
  if (generation !== stateGeneration || currentToken !== visitToken) return;
  const previousHistoryLength = state.currentVisit.history.length;
  const previousLocation = state.currentVisit.location;
  const preTurnCommands = JSON.parse(JSON.stringify(requestState.commandLog));
  try {
    recordExchange(requestState, text, response);
  } catch (error) {
    state = replayGame(requestState.seed, preTurnCommands, requestState.replayBase);
    startGame(state, false);
    showToast(`The turn was not committed: ${error.message}`);
    return;
  }
  renderCommon();
  if (response.churchAidApplied) {
    const aid = response.churchAidApplied;
    const label = String(aid.label || "").toLowerCase();
    const unit = String(aid.unit || "").toLowerCase();
    const given = label.includes(unit)
      ? quantityPhrase(aid.amount, label)
      : `${quantityPhrase(aid.amount, unit)} of ${label}`;
    showToast(
      `You gave ${given} from the church stores. ${quantityPhrase(aid.remaining, unit)} remain.`,
      6000
    );
  }
  if (state.currentVisit.location !== previousLocation) {
    renderer.moveVisit(state.currentVisit.location);
    showToast(`You continue the conversation in ${SESSION_LOCATIONS[state.currentVisit.location].name}.`);
  }
  state.currentVisit.history
    .slice(previousHistoryLength)
    .filter((line) => line.speaker === "visitor")
    .forEach((line) => appendDialogue("visitor", line.text));
  renderVisit();
  if (!state.priest.alive) {
    elements["ending-text"].textContent = `${person.name}'s reaction ended Father Benedict's life. The village chronicle remains as the record of his counsel.`;
    elements["ending-dialog"].showModal();
    return;
  }
  if (response.endsConversation || state.currentVisit.reactionState?.endedEarly) {
    elements["hour-state"].textContent = `${person.firstName} takes leave of the church.`;
    elements["counsel-input"].disabled = true;
    elements["speak-button"].disabled = true;
    elements["next-hour"].disabled = false;
    elements["next-hour"].textContent = "Let visitor depart";
  } else if (state.currentVisit.turnsUsed >= state.currentVisit.maxTurns) {
    elements["hour-state"].textContent = "Ten things have been said. The hour is spent.";
    elements["next-hour"].disabled = false;
  } else {
    elements["counsel-input"].disabled = false;
    elements["speak-button"].disabled = false;
    elements["next-hour"].disabled = false;
    elements["counsel-input"].focus();
  }
}

async function deliverSermon() {
  if (startActionInFlight || sermonInFlight || state.calendar.dayIndex !== 6) return;
  const text = elements["sermon-text"].value.trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 100) {
    showToast("Write a sermon of 1 to 100 words.");
    return;
  }
  const theme = elements["sermon-theme"].value;
  const attendees = sundayAttendance(state);
  const requestState = state;
  const sermonToken = `${state.calendar.absoluteDay}:${state.calendar.week}`;
  const generation = stateGeneration;
  sermonInFlight = true;
  elements["deliver-sermon"].disabled = true;
  elements["sermon-theme"].disabled = true;
  elements["sermon-text"].disabled = true;
  setBusy(true, "The congregation listens", "A whole village takes longer to understand than one troubled soul.");
  let outcome;
  try {
    const usedAi = aiReady && state.settings.aiEnabled;
    outcome = usedAi
      ? { ...(await ai.sermon(requestState, theme, text, attendees)), source: "ai" }
      : { ...fallbackSermonOutcome(requestState, theme, text), source: "fallback" };
  } catch (error) {
    if (generation !== stateGeneration || state !== requestState) {
      setBusy(false);
      return;
    }
    outcome = { ...fallbackSermonOutcome(requestState, theme, text), source: "fallback" };
    logRuntimeError("sermon_ai", error);
    showToast(`Gemma unavailable; parish rules interpreted the sermon. ${error.message}`);
  }
  if (generation !== stateGeneration || state !== requestState) return;
  sermonInFlight = false;
  const currentToken = `${state.calendar.absoluteDay}:${state.calendar.week}`;
  if (generation !== stateGeneration || state.calendar.dayIndex !== 6 || currentToken !== sermonToken) {
    setBusy(false);
    return;
  }
  const priorReportIds = new Set(requestState.periodReports.map((report) => report.id));
  const count = applySermon(requestState, theme, text, outcome);
  compactReplayHistory(requestState);
  saveGame(true, true);
  elements["deliver-sermon"].disabled = false;
  elements["sermon-theme"].disabled = false;
  elements["sermon-text"].disabled = false;
  setBusy(false);
  showToast(`${count} villagers heard the sermon. Monday begins.`);
  renderCommon();
  const newReports = requestState.periodReports.filter((report) => !priorReportIds.has(report.id));
  /* Before the day is allowed to turn, the priest sees what his own words did
     and has his one chance in the week to spend the collection. */
  pendingPeriodReports = newReports;
  if (renderSermonAftermath()) return;
  if (newReports.length) {
    showPeriodReports(newReports, true);
    return;
  }
  proceedToCurrentPeriod();
}

/* Reports wait until the priest has closed the market, so nothing is skipped
   past while he is still reading who he moved. */
/* Which sermon's aftermath the priest has already closed. Kept here rather than
   on the game state because the state must stay identical to a replay of its
   own command log. */
let aftermathDismissed = null;
let pendingPeriodReports = [];

function closeMarketAndMoveOn() {
  setHidden(elements["aftermath-panel"], true);
  aftermathDismissed = state.lastSermonAftermath?.day ?? null;
  const reports = pendingPeriodReports;
  pendingPeriodReports = [];
  if (reports.length) {
    showPeriodReports(reports, true);
    return;
  }
  proceedToCurrentPeriod();
}

/* ---------------------------------------------------------- the aftermath ---
   A sermon is the one act in this game that touches everybody at once, so it
   is also the one act whose consequences the priest cannot otherwise see. This
   lays them out plainly: what was put in the box and by whom, who the sermon
   actually reached and why it reached them, and what the village has to sell
   after a week of making things. */

let marketPanelOpen = false;

function renderSermonAftermath() {
  /* Deliberately not stored on the game state. A save is checked against a
     replay of its own command log, so anything the interface clears outside
     that log makes the parish unloadable; the panel being open is a fact about
     the screen, not about the village. */
  const aftermath = state.lastSermonAftermath;
  if (!aftermath || aftermathDismissed === aftermath.day) return false;

  elements["aftermath-title"].textContent = `The parish has heard you on ${aftermath.theme.toLowerCase()}`;
  elements["aftermath-summary"].textContent =
    `${aftermath.attendance} came into the church. ${aftermath.affected.length} of them went home changed by it.`
    + (aftermath.novelty != null && aftermath.novelty < 0.7
      ? " They have heard much of this from you before, and it landed the lighter for it."
      : "");

  const offering = aftermath.offering;
  const gathered = [
    offering.coin > 0 ? `${offering.coin} ${offering.coin === 1 ? "penny" : "pennies"}` : "",
    offering.grain > 0 ? `${offering.grain} ${offering.grain === 1 ? "sack" : "sacks"} of grain` : ""
  ].filter(Boolean).join(" and ");
  elements["offering-summary"].textContent = offering.givers.length
    ? `${offering.givers.length} ${offering.givers.length === 1 ? "household" : "households"} gave ${gathered}${
      aftermath.appeal.asked ? ` after you asked ${aftermath.appeal.manner === "threatening" ? "by way of fear" : "plainly"}` : " without being asked"}.`
    : aftermath.appeal.asked
      ? "You asked, and nobody gave. They have nothing to spare, or no reason to give it to you."
      : "Nothing was left in the box, and you did not ask.";

  elements["offering-list"].replaceChildren(...offering.givers
    .slice()
    .sort((a, b) => (b.coin + b.grain) - (a.coin + a.grain))
    .slice(0, 40)
    .map((giver) => {
      const item = document.createElement("li");
      const parts = [
        giver.coin > 0 ? `${giver.coin} ${giver.coin === 1 ? "penny" : "pennies"}` : "",
        giver.grain > 0 ? `${giver.grain} ${giver.grain === 1 ? "sack" : "sacks"} of grain` : ""
      ].filter(Boolean).join(" and ");
      item.innerHTML = `<b>${giver.name}</b> — ${parts}`;
      return item;
    }));

  const moved = aftermath.affected.filter((entry) => entry.direction === "moved");
  const hardened = aftermath.affected.filter((entry) => entry.direction === "hardened");
  const known = aftermath.affected.filter((entry) => entry.knownToPriest).length;
  elements["affected-summary"].textContent = aftermath.affected.length
    ? `${moved.length} were moved and ${hardened.length} hardened against you. ${known} of them had sat with you here.`
    : "Your words passed over them. Nobody in that room had their own trouble touched by it.";

  elements["affected-list"].replaceChildren(...aftermath.affected.slice(0, 30).map((entry) => {
    const item = document.createElement("li");
    item.className = entry.direction === "moved" ? "moved" : "hardened";
    const deltas = [
      entry.deltas.faith ? `faith ${entry.deltas.faith > 0 ? "+" : ""}${entry.deltas.faith}` : "",
      entry.deltas.trust ? `trust in you ${entry.deltas.trust > 0 ? "+" : ""}${entry.deltas.trust}` : "",
      entry.deltas.morale ? `heart ${entry.deltas.morale > 0 ? "+" : ""}${entry.deltas.morale}` : "",
      entry.deltas.stress ? `worry ${entry.deltas.stress > 0 ? "+" : ""}${entry.deltas.stress}` : ""
    ].filter(Boolean).join(", ");
    const why = entry.reasons.length ? entry.reasons.join("; ") : "the theme itself reached them";
    const seen = entry.knownToPriest ? " <em>(has spoken with you)</em>" : "";
    const eased = entry.easedThreadIds.length ? " <em>The weight of it has eased.</em>" : "";
    item.innerHTML = `<b>${entry.name}</b>, ${entry.occupation}${seen} — ${why}. <span class="deltas">${deltas}</span>${eased}`;
    return item;
  }));

  renderMarket();
  setHidden(elements["aftermath-panel"], false);
  return true;
}

function renderMarket() {
  const offer = marketOffer(state);
  elements["market-summary"].textContent =
    `${offer.season}, and the weather ${offer.weather}. The stalls sell what the village had left over this week.`;
  elements["market-purse"].textContent = `The church has ${offer.coin} ${offer.coin === 1 ? "penny" : "pennies"}.`;

  elements["market-list"].replaceChildren(...offer.listings.map((listing) => {
    const item = document.createElement("li");
    const title = document.createElement("div");
    title.innerHTML = `<b>${listing.label}</b> — ${listing.description}`;
    item.append(title);
    if (listing.stock > 0 && offer.coin >= listing.price) {
      const buttons = document.createElement("div");
      buttons.className = "market-buttons";
      for (const amount of [1, 5, 10]) {
        if (amount > listing.stock) continue;
        if (amount * listing.price > offer.coin) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "give-button";
        button.textContent = `buy ${amount} (${amount * listing.price}d)`;
        button.addEventListener("click", () => {
          const result = buyAtMarket(state, [{ good: listing.key, quantity: amount }]);
          if (!result.spent) {
            showToast("There is not enough of it, or not enough in the purse.");
            return;
          }
          const bought = result.bought[0];
          showToast(`${bought.amount} ${bought.unit} of ${bought.label.toLowerCase()} for ${result.spent}d.`);
          saveGame(true, true);
          renderMarket();
          renderCommon();
        });
        buttons.append(button);
      }
      if (buttons.childElementCount) item.append(buttons);
    }
    return item;
  }));
}

function renderRegister(filter = "") {
  const query = filter.trim().toLowerCase();
  const residents = state.residents.filter((person) => (
    !query || person.name.toLowerCase().includes(query) || person.occupation.toLowerCase().includes(query)
  ));
  elements["register-list"].replaceChildren(...residents.map((person) => {
    const card = document.createElement("article");
    card.className = `resident-card${person.profileRevealed ? "" : " unknown"}`;
    const title = document.createElement("h3");
    title.textContent = person.name + (person.active ? "" : " — departed");
    const facts = document.createElement("p");
    facts.textContent = `${person.age}, ${person.occupation} · ${person.maritalStatus}`;
    const knowledge = document.createElement("p");
    knowledge.textContent = person.profileRevealed
      ? `${person.personality.traits.join(", ")}. Visited ${person.visitCount} time${person.visitCount === 1 ? "" : "s"}.`
      : "Named in the register; inward life not yet revealed.";
    const household = document.createElement("p");
    household.textContent = `${person.householdId.replace("household-", "Household ")} · health ${Math.round(person.health)} · morale ${Math.round(person.morale)}`;
    card.append(title, facts, household, knowledge);
    return card;
  }));
}

function renderVisitRequests(filter = "") {
  const query = filter.trim().toLowerCase();
  const existing = state.visitRequests.filter((request) => request.requestedDay === state.calendar.absoluteDay);
  const existingIds = new Set(existing.map((request) => request.personId));
  const residents = state.residents
    .filter((person) => person.active && person.alive && !existingIds.has(person.id))
    .filter((person) => !query || person.name.toLowerCase().includes(query) || person.occupation.toLowerCase().includes(query))
    .sort((left, right) => left.name.localeCompare(right.name));
  elements["request-visit-list"].replaceChildren(...residents.map((person) => {
    const label = document.createElement("label");
    label.className = "request-visit-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = requestedVisitSelection.has(person.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked && requestedVisitSelection.size >= Math.max(0, 4 - existing.length)) {
        checkbox.checked = false;
        showToast("Only four requested visitors may be named each day.");
        return;
      }
      if (checkbox.checked) requestedVisitSelection.add(person.id);
      else requestedVisitSelection.delete(person.id);
      elements["request-visit-count"].textContent = `${existing.length + requestedVisitSelection.size} / 4 selected`;
    });
    const text = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = person.name;
    const facts = document.createElement("small");
    facts.textContent = `${person.age}, ${person.occupation}`;
    text.append(name, facts);
    label.append(checkbox, text);
    return label;
  }));
  elements["request-visit-count"].textContent = `${existing.length + requestedVisitSelection.size} / 4 selected`;
  elements["request-visit-results"].textContent = existing.length
    ? existing.map((request) => {
      const person = state.residents.find((resident) => resident.id === request.personId);
      return `${person?.name || request.personId}: ${request.status}`;
    }).join(" · ")
    : "";
}

function renderChronicle() {
  elements["chronicle-list"].replaceChildren(...state.chronicle.map((entry) => {
    const article = document.createElement("article");
    article.className = `chronicle-entry ${entry.tone || ""}`;
    const title = document.createElement("h3");
    title.textContent = entry.title;
    const date = document.createElement("p");
    date.className = "eyebrow";
    date.textContent = `${WEEK_DAYS[entry.day % 7]}, Week ${Math.floor(entry.day / 7) + 1}`;
    const text = document.createElement("p");
    text.textContent = entry.text;
    article.append(date, title, text);
    return article;
  }));
}

function renderPeriodReports(reports) {
  const articles = reports.map((report) => {
    const article = document.createElement("article");
    article.className = "period-report";
    const header = document.createElement("header");
    const heading = document.createElement("h3");
    heading.textContent = `${report.type === "week" ? "Weekly" : "Daily"} report — ${report.label}`;
    const note = document.createElement("p");
    note.className = "small";
    note.textContent = report.partial
      ? "This report begins from the point when the older save was upgraded."
      : `${report.visits.length} completed appointment${report.visits.length === 1 ? "" : "s"} · ${report.affectedPeople.length} named people affected`;
    header.append(heading, note);
    article.append(header);

    const groups = [...new Set(report.metrics.map((metric) => metric.group))];
    for (const group of groups) {
      const section = document.createElement("section");
      section.className = "report-group";
      const title = document.createElement("h4");
      title.textContent = group;
      const table = document.createElement("table");
      table.className = "report-metrics";
      const tableHead = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const label of ["Measure", "Start", "End", "Change"]) {
        const th = document.createElement("th");
        th.textContent = label;
        headRow.append(th);
      }
      tableHead.append(headRow);
      const body = document.createElement("tbody");
      for (const metric of report.metrics.filter((entry) => entry.group === group)) {
        const row = document.createElement("tr");
        const direction = metric.delta > 0 ? "rise" : metric.delta < 0 ? "fall" : "same";
        const arrow = metric.delta > 0 ? "↑" : metric.delta < 0 ? "↓" : "—";
        const values = [
          metric.label,
          `${metric.start}${metric.unit ? ` ${metric.unit}` : ""}`,
          `${metric.end}${metric.unit ? ` ${metric.unit}` : ""}`,
          `${arrow} ${metric.delta > 0 ? "+" : ""}${metric.delta}`
        ];
        values.forEach((value, index) => {
          const cell = document.createElement(index === 0 ? "th" : "td");
          cell.textContent = value;
          if (index === 3) cell.className = `metric-change ${direction}`;
          row.append(cell);
        });
        body.append(row);
      }
      table.append(tableHead, body);
      section.append(title, table);
      article.append(section);
    }

    const eventsTitle = document.createElement("h4");
    eventsTitle.textContent = "What happened";
    article.append(eventsTitle);
    const eventList = document.createElement("div");
    eventList.className = "report-events";
    if (!report.summaries.length) {
      const empty = document.createElement("p");
      empty.className = "report-empty";
      empty.textContent = "No chronicle-worthy event was recorded.";
      eventList.append(empty);
    }
    for (const event of report.summaries) {
      const entry = document.createElement("article");
      entry.className = `report-event ${event.tone || ""}`;
      const title = document.createElement("h4");
      title.textContent = event.title;
      const text = document.createElement("p");
      text.textContent = event.text;
      entry.append(title, text);
      eventList.append(entry);
    }
    if (report.omittedSummaryCount) {
      const omitted = document.createElement("p");
      omitted.className = "small";
      omitted.textContent = `${report.omittedSummaryCount} additional minor events are retained in the save.`;
      eventList.append(omitted);
    }
    article.append(eventList);

    const affected = document.createElement("details");
    const affectedSummary = document.createElement("summary");
    affectedSummary.textContent = `Everyone affected (${report.affectedPeople.length})`;
    affected.append(affectedSummary);
    const people = document.createElement("div");
    people.className = "report-people";
    for (const person of report.affectedPeople) {
      const chip = document.createElement("span");
      chip.className = "report-person";
      chip.textContent = person.name;
      chip.title = person.reasons.join("\n");
      people.append(chip);
    }
    affected.append(people);
    article.append(affected);
    return article;
  });
  elements["period-report-list"].replaceChildren(...articles);
}

function showPeriodReports(reports, continueAfter = false) {
  continueAfterPeriodReport = continueAfter;
  renderPeriodReports(reports);
  if (!elements["period-report-dialog"].open) elements["period-report-dialog"].showModal();
}

function startGame(nextState, isNew) {
  stateGeneration += 1;
  conversationInFlight = false;
  departureInFlight = false;
  sermonInFlight = false;
  continueAfterPeriodReport = false;
  setBusy(false);
  elements["next-hour"].disabled = false;
  elements["deliver-sermon"].disabled = false;
  elements["sermon-theme"].disabled = false;
  elements["sermon-text"].disabled = false;
  state = nextState;
  configureAiProvider();
  setGameplayMutationDisabled(false);
  setHidden(elements["start-screen"], true);
  document.querySelectorAll(".game-ui").forEach((element) => setHidden(element, false));
  setHidden(elements["sermon-panel"], true);
  setHidden(elements["visitor-panel"], true);
  setHidden(elements["dialogue-panel"], true);
  renderCommon();
  if (isNew) {
    elements["prologue-title"].textContent = `Welcome to ${state.town.name}`;
    elements["prologue-text"].textContent = state.town.description;
    elements["prologue-dialog"].showModal();
  } else {
    proceedToCurrentPeriod();
    if (state.mode.type === "META_PAUSED") {
      setGameplayMutationDisabled(true);
      elements["meta-pause-dialog"].showModal();
    }
  }
}

elements["leave-market"].addEventListener("click", () => {
  closeMarketAndMoveOn();
});
elements["new-game"].addEventListener("click", () => {  if (!initializationComplete || startActionInFlight) return;
  const seed = elements["seed-input"].value.trim() || `${Date.now()}`;
  startGame(createGame(seed), true);
});
elements["continue-game"].addEventListener("click", async () => {
  if (!initializationComplete || startActionInFlight) return;
  startActionInFlight = true;
  const generation = stateGeneration;
  setStartActionsDisabled(true);
  setGameplayMutationDisabled(true);
  try {
    const saved = await loadSavedGame();
    if (saved && generation === stateGeneration) startGame(saved, false);
  } finally {
    startActionInFlight = false;
    setStartActionsDisabled(false);
  }
});
elements["begin-monday"].addEventListener("click", () => {
  elements["prologue-dialog"].close();
  proceedToCurrentPeriod();
});
elements["counsel-form"].addEventListener("submit", submitCounsel);
elements["next-hour"].addEventListener("click", endHour);

/* ---------------------------------------------------------- watch AI ----
   A debugging tool: hand the parish to a Copilot model and watch it work.
   The rule that holds everywhere else holds here most strictly — the model
   never touches game state. The engine enumerates the moves that are legal
   right now, the model returns the index of one, and the interface performs
   it exactly as a click would, so a watched run stays replayable and the
   model can never reach a move a player does not have. */
let watchRunning = false;
let watchBusy = false;
const watchHistory = [];

function watchLog(text, kind = "move") {
  const item = document.createElement("li");
  item.className = `watch-ai-entry watch-ai-${kind}`;
  item.textContent = text;
  elements["watch-ai-log"].prepend(item);
  while (elements["watch-ai-log"].children.length > 40) {
    elements["watch-ai-log"].lastChild.remove();
  }
}

function setWatchStatus(text) {
  elements["watch-ai-status"].textContent = text;
}

async function askWatchAgent(prompt) {
  const response = await fetch("/copilot-ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: elements["watch-ai-model"].value || "auto",
      messages: [{ role: "user", content: prompt }],
      timeout_ms: 180000
    })
  });
  if (!response.ok) throw new Error(`the watching model is unavailable (HTTP ${response.status})`);
  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content || "";
}

async function watchTakeTurn() {
  if (watchBusy || !state) return false;
  if (conversationInFlight || departureInFlight || startActionInFlight) return false;
  watchBusy = true;
  try {
    const moves = legalMoves(state);
    if (!moves.length) {
      /* Nothing to do usually means the priest is still standing in front of
         the market board with the day waiting behind it. Close it and let the
         week go on rather than spinning here. */
      if (!elements["aftermath-panel"].hidden) {
        watchLog("Closes the church for the night.", "move");
        closeMarketAndMoveOn();
        setWatchStatus("Ready.");
        return true;
      }
      setWatchStatus("There is nothing for the priest to do just now.");
      return false;
    }
    setWatchStatus("The model is deciding...");
    let prompt = buildAgentPrompt(state, moves, {
      steer: elements["watch-ai-steer"].value.trim(),
      recent: watchHistory
    });
    let decision = null;
    for (let attempt = 0; attempt < 2 && !decision; attempt += 1) {
      const raw = await askWatchAgent(prompt);
      const validated = validateAgentChoice(moves, parseAgentReply(raw));
      if (validated.ok) decision = validated;
      else {
        watchLog(`Refused: ${validated.error}`, "refused");
        prompt = `${prompt}\n\nYour previous reply was refused: ${validated.error}\nReply again with JSON only, choosing a legal index.`;
      }
    }
    if (!decision) {
      setWatchStatus("The model did not choose a legal move.");
      return false;
    }
    watchHistory.push(`${decision.move.kind}: ${(decision.text || decision.move.label).slice(0, 70)}`);
    while (watchHistory.length > 8) watchHistory.shift();
    watchLog(`${decision.move.label} — ${decision.reason}`, "move");

    if (decision.move.kind === "speak") {
      for (const gift of decision.gives || []) stagedGifts.set(gift.resource, gift.amount);
      elements["counsel-input"].value = decision.text;
      await submitCounsel(new Event("submit"));
    } else if (decision.move.kind === "next_hour") {
      await endHour();
    } else if (decision.move.kind === "request_visit") {
      requestVisits(state, [decision.move.personId], decision.reason);
      renderCommon();
    } else if (decision.move.kind === "deliver_sermon") {
      elements["sermon-theme"].value = decision.theme;
      elements["sermon-text"].value = decision.text;
      await deliverSermon();
    } else if (decision.move.kind === "buy_at_market") {
      const result = buyAtMarket(state, decision.purchases);
      if (result.spent) {
        showToast(`Bought ${result.bought.map((item) => `${item.amount} ${item.unit} of ${item.label.toLowerCase()}`).join(", ")} for ${result.spent}d.`);
        saveGame(true, true);
        if (!elements["aftermath-panel"].hidden) renderMarket();
      }
      renderCommon();
    } else if (!elements["aftermath-panel"].hidden) {
      /* Anything else chosen while the board is up means he is done shopping. */
      closeMarketAndMoveOn();
    }
    setWatchStatus("Ready.");
    return true;
  } catch (error) {
    logRuntimeError("watch_ai", error);
    setWatchStatus(`Stopped: ${error.message}`);
    watchRunning = false;
    return false;
  } finally {
    watchBusy = false;
    elements["watch-ai-stop"].hidden = !watchRunning;
    elements["watch-ai-run"].hidden = watchRunning;
  }
}

async function watchLoop() {
  while (watchRunning) {
    const moved = await watchTakeTurn();
    if (!moved) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  watchRunning = false;
  elements["watch-ai-stop"].hidden = true;
  elements["watch-ai-run"].hidden = false;
}

elements["toggle-watch-ai"].addEventListener("click", () => {
  const panel = elements["watch-ai-panel"];
  panel.hidden = !panel.hidden;
  if (!panel.hidden && !elements["watch-ai-model"].options.length) {
    const options = copilotModels.length
      ? copilotModels
      : [{ id: "auto", name: "Automatic" }];
    elements["watch-ai-model"].replaceChildren(...options.map((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.name || model.id;
      return option;
    }));
  }
});
elements["watch-ai-step"].addEventListener("click", () => { watchTakeTurn(); });
elements["watch-ai-run"].addEventListener("click", () => {
  if (watchRunning) return;
  watchRunning = true;
  elements["watch-ai-run"].hidden = true;
  elements["watch-ai-stop"].hidden = false;
  watchLoop();
});
elements["watch-ai-stop"].addEventListener("click", () => {
  watchRunning = false;
  setWatchStatus("Paused. You can take over at any time.");
});

elements["save-game"].addEventListener("click", () => saveGame());
elements["export-game"].addEventListener("click", () => {
  try {
    const blob = new Blob([serializeState(state)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${state.town.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-week-${state.calendar.week}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    logRuntimeError("game_export", error);
    showToast(`Export failed: ${error.message}`);
  }
});
elements["export-debug-log"].addEventListener("click", () => {
  try {
    let stateSnapshot = null;
    let stateError = null;
    try {
      stateSnapshot = JSON.parse(serializeState(state));
    } catch (error) {
      stateError = { message: error.message, stack: error.stack };
    }
    const payload = {
      format: "the-common-confessor-debug-log",
      exportedAt: new Date().toISOString(),
      gameVersion: "0.19.0-playtest",
      page: location.href,
      userAgent: navigator.userAgent,
      ai: {
        ready: aiReady,
        statusText: elements["ai-status"].textContent
      },
      errors: runtimeDebugLog,
      conversations: conversationDebugLog,
      conversationTranscript: conversationDebugLog.map((entry) => entry.readable).join("\n\n========================\n\n"),
      conversationSummary: {
        turns: conversationDebugLog.length,
        modelCalled: conversationDebugLog.filter((entry) => entry.modelCalled).length,
        displayedExactlyAsModelWroteIt: conversationDebugLog.filter((entry) => entry.unchanged).length,
        transformedByFramework: conversationDebugLog.filter((entry) => entry.modelCalled && !entry.unchanged).length,
        averagePromptChars: conversationDebugLog.length
          ? Math.round(conversationDebugLog.reduce((sum, entry) => sum + (entry.promptChars || 0), 0) / conversationDebugLog.length)
          : 0
      },
      stateError,
      state: stateSnapshot
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${state?.town?.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "parish"}-debug.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Debug log exported.");
  } catch (error) {
    logRuntimeError("debug_export", error);
    showToast(`Debug export failed: ${error.message}`);
  }
});
elements["import-game"].addEventListener("click", () => {
  if (!startActionInFlight) elements["import-file"].click();
});
elements["start-import-game"].addEventListener("click", () => {
  if (initializationComplete && !startActionInFlight) elements["import-file"].click();
});
elements["import-file"].addEventListener("change", async (event) => {
  if (!initializationComplete || startActionInFlight) return;
  const file = event.target.files?.[0];
  if (!file) return;
  startActionInFlight = true;
  const generation = stateGeneration;
  setStartActionsDisabled(true);
  setGameplayMutationDisabled(true);
  try {
    const imported = deserializeState(await file.text());
    if (generation === stateGeneration) {
      startGame(imported, false);
      saveGame(true, true);
      showToast("Imported parish loaded.");
    }
  } catch (error) {
    logRuntimeError("game_import", error);
    showToast(`Import failed: ${error.message}`);
  } finally {
    startActionInFlight = false;
    setStartActionsDisabled(false);
    restoreGameplayControls();
    event.target.value = "";
  }
});
elements["deliver-sermon"].addEventListener("click", deliverSermon);
elements["close-ending"].addEventListener("click", () => elements["ending-dialog"].close());
elements["sermon-text"].addEventListener("input", () => {
  const words = elements["sermon-text"].value.trim().split(/\s+/).filter(Boolean).length;
  elements["sermon-word-count"].textContent = `${words} / 100 words`;
  elements["sermon-word-count"].style.color = words > 100 ? "#8b1f25" : "";
});
elements["open-register"].addEventListener("click", () => {
  renderRegister();
  elements["register-dialog"].showModal();
});
elements["open-request-visits"].addEventListener("click", () => {
  requestedVisitSelection.clear();
  elements["request-visit-search"].value = "";
  elements["request-visit-reason"].value = "";
  renderVisitRequests();
  elements["request-visits-dialog"].showModal();
});
elements["request-visit-search"].addEventListener("input", (event) => renderVisitRequests(event.target.value));
elements["send-visit-requests"].addEventListener("click", () => {
  try {
    const personIds = [...requestedVisitSelection];
    const results = requestVisits(state, personIds, elements["request-visit-reason"].value);
    requestedVisitSelection.clear();
    saveGame(true, true);
    renderCommon();
    renderVisitRequests(elements["request-visit-search"].value);
    const accepted = results.filter((result) => result.status === "accepted").length;
    showToast(`${accepted} of ${results.length} requested villagers agreed to come.`);
  } catch (error) {
    showToast(error.message);
  }
});
elements["open-chronicle"].addEventListener("click", () => {
  renderChronicle();
  elements["chronicle-dialog"].showModal();
});
elements["open-reports"].addEventListener("click", () => {
  showPeriodReports([...state.periodReports].reverse(), false);
});
elements["ai-provider"].addEventListener("change", async () => {
  if (!state) return;
  state.settings.aiProvider = elements["ai-provider"].value;
  configureAiProvider();
  await refreshAiStatus();
  saveGame(true, true);
  showToast(state.settings.aiProvider === "copilot"
    ? "GitHub Copilot selected. Prompts count toward the signed-in account's usage allowance."
    : "Local Gemma selected.");
});
elements["ai-model"].addEventListener("change", async () => {
  if (!state) return;
  state.settings.copilotModel = elements["ai-model"].value;
  configureAiProvider();
  await refreshAiStatus();
  saveGame(true, true);
});
elements["pause-game"].addEventListener("click", () => {
  setGameMode(state, "META_PAUSED");
  saveGame(true, true);
  setGameplayMutationDisabled(true);
  elements["meta-pause-dialog"].showModal();
});
elements["resume-game"].addEventListener("click", () => {
  setGameMode(state, "IN_WORLD");
  saveGame(true, true);
  elements["meta-pause-dialog"].close();
  restoreGameplayControls();
});
elements["undo-turn"].addEventListener("click", () => {
  try {
    state = rewindLastConversationTurn(state);
    saveGame(true, true);
    startGame(state, false);
    showToast("The last conversation turn was rewound.");
  } catch (error) {
    showToast(error.message);
  }
});
elements["period-report-dialog"].addEventListener("close", () => {
  if (!continueAfterPeriodReport) return;
  continueAfterPeriodReport = false;
  proceedToCurrentPeriod();
});
elements["register-search"].addEventListener("input", (event) => renderRegister(event.target.value));
document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => elements[button.dataset.close].close());
});
elements.toast.addEventListener("click", () => {
  elements.toast.classList.remove("show");
  clearTimeout(toastTimer);
});

window.addEventListener("error", (event) => {
  logRuntimeError("window_error", event.error || new Error(event.message), {
    filename: event.filename,
    line: event.lineno,
    column: event.colno
  });
});
window.addEventListener("unhandledrejection", (event) => {
  logRuntimeError("unhandled_rejection", event.reason);
});

SERMON_THEMES.forEach((theme) => {
  const option = document.createElement("option");
  option.value = theme;
  option.textContent = theme;
  elements["sermon-theme"].append(option);
});
elements["seed-input"].value = `parish-${new Date().toISOString().slice(0, 10)}`;

async function initialize() {
  try {
    const saved = await loadSavedGame();
    setHidden(elements["continue-game"], !saved);
  } catch (error) {
    console.warn("Save recovery failed during initialization:", error);
    setHidden(elements["continue-game"], true);
  } finally {
    initializationComplete = true;
    setStartActionsDisabled(false);
    renderer.load().catch((error) => {
      elements["start-screen"].querySelector(".small").textContent = `Art failed to load: ${error.message}`;
    });
    refreshAiStatus();
    probeCopilotProvider();
  }
}

initialize();
