import { ParishAiClient } from "./ai.js";
import { SERMON_THEMES, SESSION_LOCATIONS, WEEK_DAYS } from "./data.js";
import { ChurchRenderer } from "./renderer.js";
import {
  applySermon,
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
  recordExchange,
  sundayAttendance
} from "./simulation.js";

const SAVE_KEY = "the-common-confessor-save-v1";
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const renderer = new ChurchRenderer(elements["church-canvas"]);
const ai = new ParishAiClient();
let state = null;
let aiReady = false;
let conversationInFlight = false;
let sermonInFlight = false;
let toastTimer = null;

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

function saveGame(silent = false) {
  if (!state) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    if (!silent) showToast("Parish saved.");
  } catch (error) {
    showToast(`Save failed: ${error.message}`);
  }
}

function loadSavedGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.version === 1 && Array.isArray(parsed.residents) ? parsed : null;
  } catch {
    return null;
  }
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
  elements["town-metrics"].replaceChildren(...Object.entries(state.town.metrics).map(([name, value]) => {
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
  }));
  elements["population-count"].textContent = populationCount(state);
}

function renderCommon() {
  elements["calendar-label"].textContent = calendarLabel(state);
  elements["town-name"].textContent = state.town.name;
  elements["town-description"].textContent = state.town.description;
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
  elements["visitor-summary"].textContent = `${visit.issue.kind}: ${visit.issue.detail}`;
  elements["visitor-occupation"].textContent = person.occupation;
  elements["visitor-age"].textContent = `age ${person.age}`;
  elements["visitor-mood"].textContent = visit.mood;
  elements["visitor-backstory"].textContent = person.backstory;
  elements["turn-counter"].textContent = `${visit.turnsUsed} / ${visit.maxTurns} things said`;
  elements["hour-state"].textContent = visit.turnsUsed >= visit.maxTurns ? "The hour is spent." : "The hour continues.";
  elements["speak-button"].disabled = visit.turnsUsed >= visit.maxTurns;
  elements["counsel-input"].disabled = visit.turnsUsed >= visit.maxTurns;
  elements["next-hour"].textContent = visit.turnsUsed >= visit.maxTurns ? "Continue to next hour" : "End hour";
}

function showVisit() {
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  renderer.beginVisit(visit.location, person.sprite);
  setHidden(elements["visitor-panel"], false);
  setHidden(elements["dialogue-panel"], false);
  setHidden(elements["sermon-panel"], true);
  elements["dialogue-log"].replaceChildren();
  visit.history.forEach((line) => appendDialogue(line.speaker === "visitor" ? "visitor" : "priest", line.text));
  renderCommon();
  renderVisit();
  saveGame(true);
  setTimeout(() => elements["counsel-input"].focus(), 400);
}

function showSunday() {
  const attendees = sundayAttendance(state);
  renderer.showSundayCrowd(attendees);
  setHidden(elements["visitor-panel"], true);
  setHidden(elements["dialogue-panel"], true);
  setHidden(elements["sermon-panel"], false);
  elements["attendance-count"].textContent = `${attendees.length} of ${populationCount(state)}`;
  elements["sermon-text"].value = "";
  elements["sermon-word-count"].textContent = "0 / 100 words";
  renderCommon();
  saveGame(true);
}

function proceedToCurrentPeriod() {
  if (state.calendar.dayIndex === 6) showSunday();
  else showVisit();
}

async function endHour() {
  if (!state.currentVisit || conversationInFlight) return;
  const person = materializeResident(state, state.currentVisit.personId, true);
  elements["speak-button"].disabled = true;
  elements["next-hour"].disabled = true;
  setBusy(true, `${person.name} leaves the church`, "Their counsel may pass through as many as three lives before the hour is truly over.");
  let plan;
  try {
    plan = aiReady && state.settings.aiEnabled
      ? await ai.departure(state, departureCandidates(state))
      : fallbackDeparturePlan(state);
  } catch (error) {
    plan = fallbackDeparturePlan(state);
    showToast(`Gemma unavailable; parish rules resolved the consequence. ${error.message}`);
  }
  finishVisit(state, plan);
  renderer.clearVisitor();
  setBusy(false);
  elements["next-hour"].disabled = false;
  renderCommon();
  proceedToCurrentPeriod();
}

async function submitCounsel(event) {
  event.preventDefault();
  const text = elements["counsel-input"].value.trim();
  if (!text || !state.currentVisit || state.currentVisit.turnsUsed >= 10) return;
  const person = materializeResident(state, state.currentVisit.personId, true);
  const visitToken = `${state.currentVisit.personId}:${state.currentVisit.startedAt}`;
  appendDialogue("priest", text);
  elements["counsel-input"].value = "";
  elements["speak-button"].disabled = true;
  elements["counsel-input"].disabled = true;
  elements["next-hour"].disabled = true;
  conversationInFlight = true;
  elements["hour-state"].textContent = `${person.firstName} considers your words...`;
  let response;
  try {
    response = aiReady && state.settings.aiEnabled
      ? await ai.conversation(state, person, text)
      : fallbackConversation(state, text);
  } catch (error) {
    response = fallbackConversation(state, text);
    showToast(`Gemma did not answer; the visitor continued locally. ${error.message}`);
  }
  conversationInFlight = false;
  const currentToken = state.currentVisit ? `${state.currentVisit.personId}:${state.currentVisit.startedAt}` : "";
  if (currentToken !== visitToken) return;
  recordExchange(state, text, response);
  appendDialogue("visitor", response.reply);
  renderVisit();
  saveGame(true);
  if (state.currentVisit.turnsUsed >= state.currentVisit.maxTurns) {
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
  if (sermonInFlight || state.calendar.dayIndex !== 6) return;
  const text = elements["sermon-text"].value.trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 100) {
    showToast("Write a sermon of 1 to 100 words.");
    return;
  }
  const theme = elements["sermon-theme"].value;
  const attendees = sundayAttendance(state);
  const sermonToken = `${state.calendar.absoluteDay}:${state.calendar.week}`;
  sermonInFlight = true;
  elements["deliver-sermon"].disabled = true;
  elements["sermon-theme"].disabled = true;
  elements["sermon-text"].disabled = true;
  setBusy(true, "The congregation listens", "A whole village takes longer to understand than one troubled soul.");
  let outcome;
  try {
    outcome = aiReady && state.settings.aiEnabled
      ? await ai.sermon(state, theme, text, attendees)
      : fallbackSermonOutcome(state, theme, text);
  } catch (error) {
    outcome = fallbackSermonOutcome(state, theme, text);
    showToast(`Gemma unavailable; parish rules interpreted the sermon. ${error.message}`);
  }
  sermonInFlight = false;
  const currentToken = `${state.calendar.absoluteDay}:${state.calendar.week}`;
  if (state.calendar.dayIndex !== 6 || currentToken !== sermonToken) {
    setBusy(false);
    return;
  }
  const count = applySermon(state, theme, text, outcome);
  elements["deliver-sermon"].disabled = false;
  elements["sermon-theme"].disabled = false;
  elements["sermon-text"].disabled = false;
  setBusy(false);
  showToast(`${count} villagers heard the sermon. Monday begins.`);
  renderCommon();
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
    facts.textContent = `${person.age}, ${person.occupation}`;
    const knowledge = document.createElement("p");
    knowledge.textContent = person.profileRevealed
      ? `${person.personality.traits.join(", ")}. Visited ${person.visitCount} time${person.visitCount === 1 ? "" : "s"}.`
      : "Named in the register; inward life not yet revealed.";
    card.append(title, facts, knowledge);
    return card;
  }));
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

function startGame(nextState, isNew) {
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
  const seed = elements["seed-input"].value.trim() || `${Date.now()}`;
  startGame(createGame(seed), true);
});
elements["continue-game"].addEventListener("click", () => {
  const saved = loadSavedGame();
  if (saved) startGame(saved, false);
});
elements["begin-monday"].addEventListener("click", () => {
  elements["prologue-dialog"].close();
  proceedToCurrentPeriod();
});
elements["counsel-form"].addEventListener("submit", submitCounsel);
elements["next-hour"].addEventListener("click", endHour);
elements["save-game"].addEventListener("click", () => saveGame());
elements["deliver-sermon"].addEventListener("click", deliverSermon);
elements["sermon-text"].addEventListener("input", () => {
  const words = elements["sermon-text"].value.trim().split(/\s+/).filter(Boolean).length;
  elements["sermon-word-count"].textContent = `${words} / 100 words`;
  elements["sermon-word-count"].style.color = words > 100 ? "#8b1f25" : "";
});
elements["open-register"].addEventListener("click", () => {
  renderRegister();
  elements["register-dialog"].showModal();
});
elements["open-chronicle"].addEventListener("click", () => {
  renderChronicle();
  elements["chronicle-dialog"].showModal();
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
const saved = loadSavedGame();
setHidden(elements["continue-game"], !saved);
renderer.load().catch((error) => {
  elements["start-screen"].querySelector(".small").textContent = `Art failed to load: ${error.message}`;
});
refreshAiStatus();
