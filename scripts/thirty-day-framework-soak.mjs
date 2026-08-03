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
import { compactReplayHistory, deserializeState, serializeState } from "../js/state.js";

const seeds = ["framework-soak-a", "framework-soak-b", "framework-soak-c"];

for (const seed of seeds) {
  const state = createGame(seed);
  let visits = 0;
  let exchanges = 0;
  let neighborVisits = 0;
  while (state.calendar.absoluteDay < 30) {
    if (state.calendar.dayIndex === 6) {
      const text = "Speak truth without panic, protect the vulnerable, and share only what this parish can spare.";
      applySermon(state, "Duty", text, {
        ...fallbackSermonOutcome(state, "Duty", text),
        source: "fallback"
      });
      compactReplayHistory(state);
      continue;
    }
    const visit = beginVisit(state);
    const visitor = [...state.residents, ...state.externalActors].find((person) => person.id === visit.personId);
    const counsel = visitor?.role === "neighbor_priest"
      ? "We will give your church four sacks of grain."
      : "Tell me what you know, what remains uncertain, and what honest step you can attempt without claiming authority you do not have.";
    if (visitor?.role === "neighbor_priest") neighborVisits += 1;
    recordExchange(state, counsel, fallbackConversation(state, counsel));
    exchanges += 1;
    finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
    compactReplayHistory(state);
    visits += 1;
  }
  const serialized = serializeState(state);
  deserializeState(serialized);
  const openCommitments = state.commitments.filter((commitment) => commitment.status === "open");
  const reliefEvents = state.events.filter((event) => event.type === "neighbor_relief_delivered");
  const invalidObligations = state.visitArchive.flatMap((visit) => visit.continuity?.obligationStack || [])
    .filter((obligation) => !["open", "suspended", "resolved", "cancelled"].includes(obligation.status));
  const summary = {
    seed,
    days: state.calendar.absoluteDay,
    visits,
    exchanges,
    neighborVisits,
    reliefEvents: reliefEvents.length,
    commitments: {
      total: state.commitments.length,
      open: openCommitments.length,
      fulfilled: state.commitments.filter((entry) => entry.status === "fulfilled").length,
      failed: state.commitments.filter((entry) => entry.status === "failed").length,
      cancelled: state.commitments.filter((entry) => entry.status === "cancelled").length
    },
    narrativeStages: state.narrativeThreads.map((thread) => ({
      parish: thread.neighborParishId,
      stage: thread.stage,
      status: thread.status,
      pressure: Math.round(thread.pressure)
    })),
    saveBytes: Buffer.byteLength(serialized),
    replayPassed: true
  };
  const hasReliefProgress = reliefEvents.length > 0
    || openCommitments.some((entry) => entry.dueDay >= state.calendar.absoluteDay);
  if (!neighborVisits || !hasReliefProgress || invalidObligations.length
    || openCommitments.some((entry) => entry.dueDay < state.calendar.absoluteDay)) {
    console.error(JSON.stringify({
      ...summary,
      invariantFailure: {
        neighborVisits,
        reliefEvents: reliefEvents.length,
        invalidObligations: invalidObligations.length,
        overdueCommitments: openCommitments.filter((entry) => entry.dueDay < 30)
      }
    }));
    throw new Error(`${seed} failed framework soak invariants`);
  }
  console.log(JSON.stringify(summary));
}
