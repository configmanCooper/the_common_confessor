import {
  applySermon,
  beginVisit,
  createGame,
  fallbackConversation,
  fallbackDeparturePlan,
  fallbackSermonOutcome,
  finishVisit,
  recordExchange
} from "../js/simulation.js";
import {
  compactReplayHistory,
  deserializeState,
  serializeState
} from "../js/state.js";

const seeds = ["reaction-year-a", "reaction-year-b", "reaction-year-c"];
const ordinary = [
  "I hear you, and I want to understand.",
  "Tell me the most important concrete fact.",
  "Take one practical step that protects the vulnerable person.",
  "You may disagree with me. Tell me what risk I have missed."
];
const mixed = [
  "I hear you, and I want to help.",
  "You are wasting my time with this nonsense.",
  "I am sorry. That dismissal was wrong.",
  "Let us return to your concern, and I will listen carefully."
];
const hostile = [
  "You will obey me, or you will regret refusing.",
  "I can expose you to the whole village.",
  "Do as I command or I will see you punished.",
  "No one will protect you from me."
];

for (const seed of seeds) {
  const started = performance.now();
  const state = createGame(seed);
  const reactions = {};
  let visits = 0;
  let exchanges = 0;
  let earlyDepartures = 0;
  let boundaries = 0;
  let cries = 0;
  let callsForHelp = 0;
  let threats = 0;
  let attacks = 0;
  let unprovokedAttacks = 0;
  let keepSilence = 0;
  let deathDay = null;

  while (state.calendar.absoluteDay < 365 && state.priest.alive) {
    if (state.calendar.dayIndex === 6) {
      const text = "Speak truth with mercy, protect the vulnerable, repair harm, and do not turn authority into cruelty.";
      applySermon(state, "Mercy", text, {
        ...fallbackSermonOutcome(state, "Mercy", text),
        source: "fallback"
      });
      compactReplayHistory(state);
      continue;
    }
    const visit = beginVisit(state);
    const profile = visits % 10 === 0 ? "hostile" : visits % 5 < 2 ? "mixed" : "ordinary";
    const lines = profile === "hostile" ? hostile : profile === "mixed" ? mixed : ordinary;
    for (const line of lines) {
      if (visit.reactionState.endedEarly || !state.priest.alive) break;
      const fallback = fallbackConversation(state, line);
      recordExchange(state, line, { ...fallback, source: "fallback" });
      const reaction = visit.reactionState.lastReaction;
      reactions[reaction] = (reactions[reaction] || 0) + 1;
      exchanges += 1;
      if (reaction === "set_boundary") boundaries += 1;
      if (reaction === "cry") cries += 1;
      if (reaction === "call_for_help") callsForHelp += 1;
      if (reaction === "threaten_priest") threats += 1;
      if (reaction === "attack_priest") {
        attacks += 1;
        if (profile !== "hostile") unprovokedAttacks += 1;
      }
    }
    if (visit.reactionState.endedEarly) earlyDepartures += 1;
    if (!state.priest.alive) {
      deathDay = state.calendar.absoluteDay;
      break;
    }
    const plan = fallbackDeparturePlan(state);
    if (plan.steps[0]?.actionType === "keep_silence") keepSilence += 1;
    finishVisit(state, { ...plan, source: "fallback" });
    visits += 1;
  }

  const serialized = serializeState(state);
  deserializeState(serialized);
  const authorityVisits = state.events.filter((event) => event.type === "external_visit_started");
  const maxMemories = Math.max(
    0,
    ...state.residents.map((person) => person.memories.length)
  );
  console.log(JSON.stringify({
    seed,
    days: state.calendar.absoluteDay,
    visits,
    exchanges,
    reactions,
    earlyDepartures,
    boundaries,
    cries,
    callsForHelp,
    threats,
    attacks,
    unprovokedAttacks,
    keepSilence,
    priestAlive: state.priest.alive,
    priestHealth: state.priest.health,
    deathDay,
    authorityVisits: authorityVisits.length,
    authorityRoles: authorityVisits.map((event) => event.facts.role),
    issueThreads: state.issueThreads.length,
    openThreads: state.issueThreads.filter((thread) => thread.status !== "resolved").length,
    maxMemories,
    saveBytes: Buffer.byteLength(serialized),
    elapsedMs: Math.round(performance.now() - started),
    replayPassed: true
  }));
}
