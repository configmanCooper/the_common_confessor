export const PROMPT_TRACE_LIMIT = 3;
export const PROMPT_TRACE_MAX_CHARS = 20000;

function boundedTexts(values, maximumItems = 3, maximumLength = 600) {
  return (values || [])
    .filter((value) => typeof value === "string" && value.trim())
    .slice(-maximumItems)
    .map((value) => value.trim().slice(0, maximumLength));
}

export function selectConversationObligation({
  visit,
  playerText,
  reactionPreview,
  socialRequirement,
  deterministicSocial,
  requiredFacts,
  directAnswer,
  scenarioFactIds = []
}) {
  const questionTurnId = `priest-${visit.history.length}`;
  const base = {
    obligationId: `obligation-${visit.visitId}-${String(visit.turnsUsed + 1).padStart(2, "0")}`,
    latestPlayerText: String(playerText).trim().slice(0, 600),
    mustAnswerFirst: String(playerText).includes("?") || Boolean(socialRequirement),
    answeredQuestionTurnIds: String(playerText).includes("?") ? [questionTurnId] : [],
    requiredFactIds: requiredFacts.map((fact) => fact.id),
    requiredAnswerSlots: socialRequirement?.answerSlots || requiredFacts.map((fact) => fact.id),
    followupRequested: Boolean(socialRequirement?.followupRequested),
    avoidRepeatingTexts: boundedTexts(
      visit.history.filter((line) => line.speaker === "visitor").map((line) => line.text)
    ),
    mentionedFactIdsBefore: [...new Set(visit.continuity?.mentionedFactIds || [])],
    completedObjectiveIds: [...new Set(visit.continuity?.mentionedFactIds || [])],
    activeObjectiveIds: scenarioFactIds.filter((id) => !(visit.continuity?.mentionedFactIds || []).includes(id)),
    prohibitedFallbackFactIds: (visit.continuity?.mentionedFactIds || [])
      .filter((id) => !requiredFacts.some((fact) => fact.id === id)),
    directAnswer: directAnswer || "",
    modelNeeded: true,
    kind: "open_response",
    routerConfidence: 0.55,
    responseSource: "gemma_dialogue",
    reason: "No deterministic reaction, direct social answer, or factual answer was required."
  };
  if (reactionPreview.requiredReaction !== "continue") {
    return {
      ...base,
      kind: "required_reaction",
      modelNeeded: false,
      routerConfidence: 1,
      responseSource: "scripted_reaction",
      reason: `The cumulative reaction engine requires ${reactionPreview.requiredReaction}.`
    };
  }
  if (socialRequirement && deterministicSocial) {
    return {
      ...base,
      kind: socialRequirement.type,
      modelNeeded: false,
      routerConfidence: 0.98,
      responseSource: "framework_static",
      reason: "A deterministic social or factual handler can answer the newest speech act."
    };
  }
  if (requiredFacts.length) {
    return {
      ...base,
      kind: "factual_answer",
      modelNeeded: false,
      routerConfidence: 0.96,
      responseSource: "router_fact",
      reason: "Authoritative scenario facts directly answer the newest question."
    };
  }
  if (socialRequirement) {
    return {
      ...base,
      kind: socialRequirement.type,
      modelNeeded: true,
      routerConfidence: 0.82,
      responseSource: "gemma_dialogue",
      reason: "Gemma should render a social response constrained by the detected speech act."
    };
  }
  return base;
}

export function boundedPromptTrace(trace) {
  if (!trace || typeof trace !== "object") return null;
  const prompt = typeof trace.prompt === "string" ? trace.prompt : "";
  return {
    obligation: trace.obligation,
    prompt: prompt.length <= PROMPT_TRACE_MAX_CHARS
      ? prompt
      : `[PROMPT TRUNCATED TO LAST ${PROMPT_TRACE_MAX_CHARS} CHARACTERS]\n${prompt.slice(-PROMPT_TRACE_MAX_CHARS)}`,
    promptLength: prompt.length,
    includedFactIds: Array.isArray(trace.includedFactIds) ? trace.includedFactIds.slice(0, 12) : [],
    initialReply: String(trace.initialReply || "").slice(0, 600),
    finalReply: String(trace.finalReply || "").slice(0, 600),
    mandatoryAnswerPassed: Boolean(trace.mandatoryAnswerPassed),
    retryUsed: Boolean(trace.retryUsed),
    route: String(trace.route || "").slice(0, 80),
    responseSource: String(trace.responseSource || trace.obligation?.responseSource || "").slice(0, 40),
    gemmaCalled: Boolean(trace.gemmaCalled),
    validation: {
      mandatoryAnswerPresent: Boolean(trace.mandatoryAnswerPassed),
      repetitionDetected: Boolean(trace.repetitionDetected)
    }
  };
}
