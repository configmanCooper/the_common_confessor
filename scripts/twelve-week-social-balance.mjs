import {
  applySermon,
  beginVisit,
  createGame,
  fallbackDeparturePlan,
  fallbackSermonOutcome,
  finishVisit,
  recordExchange
} from "../js/simulation.js";

const seeds = ["social-balance-a", "social-balance-b", "social-balance-c"];
for (const seed of seeds) {
  const state = createGame(seed);
  let visits = 0;
  let keepSilence = 0;
  while (state.calendar.absoluteDay < 84) {
    if (state.calendar.dayIndex === 6) {
      const sermon = "Let truth be joined with mercy. Protect the vulnerable, correct wrongdoing honestly, and do not turn fear into cruelty.";
      applySermon(state, "Justice", sermon, {
        ...fallbackSermonOutcome(state, "Justice", sermon),
        source: "fallback"
      });
      continue;
    }
    const visit = beginVisit(state);
    const mode = visits % 6;
    const counsel = mode === 0
      ? "Tell the truth and make peace where you can."
      : mode === 1 ? "Speak directly with the person involved and gather evidence."
        : mode === 2 ? "Protect the vulnerable person and report violence to lawful authority."
          : mode === 3 ? "Pray, but also take one practical step before the deadline."
            : mode === 4 ? "Keep silent for now and do not widen the dispute."
              : "Share what you can and ask the church for help if survival is at stake.";
    const reply = mode === 4
      ? "I will remain silent for now."
      : "I will act on that counsel, Father, and begin with the practical step.";
    recordExchange(state, counsel, {
      reply,
      memory: `The priest gave ${mode === 4 ? "restrained" : "practical"} counsel.`
    });
    const plan = fallbackDeparturePlan(state);
    if (plan.steps[0]?.actionType === "keep_silence") keepSilence += 1;
    finishVisit(state, { ...plan, source: "fallback" });
    visits += 1;
  }
  const authorityVisits = state.events.filter((event) => event.type === "external_visit_started");
  const queuedAuthority = state.eventQueue.filter((event) => event.type === "external_visit");
  console.log(JSON.stringify({
    seed,
    days: state.calendar.absoluteDay,
    visits,
    keepSilence,
    issueThreads: state.issueThreads.length,
    openThreads: state.issueThreads.filter((thread) => thread.status === "open").length,
    escalatingThreads: state.issueThreads.filter((thread) => thread.status === "escalating").length,
    festeringThreads: state.issueThreads.filter((thread) => thread.status === "festering").length,
    resolvedThreads: state.issueThreads.filter((thread) => thread.status === "resolved").length,
    authorityVisits: authorityVisits.length,
    authorityRoles: authorityVisits.map((event) => event.facts.role),
    queuedAuthority: queuedAuthority.map((event) => event.role)
  }));
}
