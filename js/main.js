import { ParishAiClient } from "./ai.js";
import { churchResourceRows } from "./church.js";
import { SERMON_THEMES, SESSION_LOCATIONS, WEEK_DAYS } from "./data.js";
import { ChurchRenderer } from "./renderer.js";
import {
  applySermon,
  applyVisitOpening,
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
  recordExchange,
  sundayAttendance,
  sundayAttendanceReport
} from "./simulation.js";
import { compactReplayHistory, deserializeState, serializeState } from "./state.js";
import { queueAutosave, readAutosaves } from "./storage.js";

const SAVE_KEY = "the-common-confessor-save-v2";
const LEGACY_SAVE_KEY = "the-common-confessor-save-v1";
const LEGACY_AUTOSAVE_KEYS = [
  "the-common-confessor-autosave-0",
  "the-common-confessor-autosave-1",
  "the-common-confessor-autosave-2"
];
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const renderer = new ChurchRenderer(elements["church-canvas"]);
const ai = new ParishAiClient();
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

function setHidden(element, hidden) {
  element.hidden = hidden;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2600);
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
}

function restoreGameplayControls() {
  if (state?.currentVisit) {
    const hourSpent = state.currentVisit.turnsUsed >= state.currentVisit.maxTurns;
    const endedEarly = Boolean(state.currentVisit.reactionState?.endedEarly);
    const blocked = startActionInFlight || conversationInFlight || departureInFlight;
    elements["speak-button"].disabled = blocked || hourSpent || endedEarly;
    elements["counsel-input"].disabled = blocked || hourSpent || endedEarly;
    elements["next-hour"].disabled = blocked;
  } else if (state?.calendar.dayIndex === 6) {
    const blocked = startActionInFlight || sermonInFlight;
    elements["deliver-sermon"].disabled = blocked;
    elements["sermon-theme"].disabled = blocked;
    elements["sermon-text"].disabled = blocked;
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
    elements["ai-status"].textContent = "Gemma: ready";
  } catch {
    aiReady = false;
    elements["ai-status"].dataset.state = "unavailable";
    elements["ai-status"].textContent = "Gemma: parish rules";
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
    crime: 100 - state.material.crime
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
    amount.textContent = `${resource.amount} ${resource.unit}`;
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
  const text = elements["counsel-input"].value.trim();
  if (!text || !state.currentVisit || state.currentVisit.turnsUsed >= 10) return;
  const person = materializeResident(state, state.currentVisit.personId, true);
  const requestState = state;
  const visitToken = state.currentVisit.visitId;
  const generation = stateGeneration;
  appendDialogue("priest", text);
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
      ? { ...(await ai.conversation(requestState, person, text)), source: "ai" }
      : { ...fallbackConversation(requestState, text), source: "fallback" };
  } catch (error) {
    if (generation !== stateGeneration || state !== requestState) return;
    response = { ...fallbackConversation(requestState, text), source: "fallback" };
    showToast(`Gemma did not answer; the visitor continued locally. ${error.message}`);
  }
  if (generation !== stateGeneration || state !== requestState) return;
  conversationInFlight = false;
  const currentToken = state.currentVisit?.visitId || "";
  if (generation !== stateGeneration || currentToken !== visitToken) return;
  const previousHistoryLength = state.currentVisit.history.length;
  const previousLocation = state.currentVisit.location;
  recordExchange(requestState, text, response);
  renderCommon();
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
  if (newReports.length) {
    showPeriodReports(newReports, true);
    return;
  }
  proceedToCurrentPeriod();
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
  }
}

elements["new-game"].addEventListener("click", () => {
  if (!initializationComplete || startActionInFlight) return;
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
    showToast(`Export failed: ${error.message}`);
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
elements["period-report-dialog"].addEventListener("close", () => {
  if (!continueAfterPeriodReport) return;
  continueAfterPeriodReport = false;
  proceedToCurrentPeriod();
});
elements["register-search"].addEventListener("input", (event) => renderRegister(event.target.value));
document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => elements[button.dataset.close].close());
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
  }
}

initialize();
