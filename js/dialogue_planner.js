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
  scenarioFactIds = [],
  turnAnalysis = null
}) {
  const questionTurnId = `priest-${visit.history.length}`;
  const openObligations = (visit.continuity?.obligationStack || [])
    .filter((obligation) => obligation.status === "open");
  const proposalAddresses = (turnAnalysis?.proposals || []).length > 0;
  const addressedObligationIds = proposalAddresses
    ? openObligations.filter((obligation) => obligation.kind === "player_decision").map((obligation) => obligation.id)
    : [];
  const base = {
    obligationId: `obligation-${visit.visitId}-${String(visit.turnsUsed + 1).padStart(2, "0")}`,
    latestPlayerText: String(playerText).trim().slice(0, 600),
    mustAnswerFirst: String(playerText).includes("?") || Boolean(socialRequirement),
    answeredQuestionTurnIds: String(playerText).includes("?") ? [questionTurnId] : [],
    requiredFactIds: requiredFacts.map((fact) => fact.id),
    requiredAnswerSlots: socialRequirement?.answerSlots || requiredFacts.map((fact) => fact.id),
    actKinds: turnAnalysis?.actKinds || [],
    proposals: turnAnalysis?.proposals || [],
    followupRequested: Boolean(socialRequirement?.followupRequested),
    avoidRepeatingTexts: boundedTexts(
      visit.history.filter((line) => line.speaker === "visitor").map((line) => line.text)
    ),
    mentionedFactIdsBefore: [...new Set(visit.continuity?.mentionedFactIds || [])],
    completedObjectiveIds: [...new Set(visit.continuity?.mentionedFactIds || [])],
    activeObjectiveIds: scenarioFactIds.filter((id) => !(visit.continuity?.mentionedFactIds || []).includes(id)),
    prohibitedFallbackFactIds: (visit.continuity?.mentionedFactIds || [])
      .filter((id) => !requiredFacts.some((fact) => fact.id === id)),
    addressedObligationIds,
    preservedObligationIds: openObligations
      .filter((obligation) => !addressedObligationIds.includes(obligation.id))
      .map((obligation) => obligation.id),
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
  if (socialRequirement?.type === "compound_turn") {
    return {
      ...base,
      kind: "compound_turn",
      modelNeeded: true,
      routerConfidence: 0.95,
      responseSource: "gemma_dialogue",
      reason: "Multiple actionable clauses must each be accepted, rejected, deferred, or marked unknown."
    };
  }
  if (socialRequirement && deterministicSocial) {
    return {
      ...base,
      kind: socialRequirement.type,
      modelNeeded: true,
      routerConfidence: 0.9,
      responseSource: "gemma_dialogue",
      reason: "Authoritative knowledge and response duties are available for Gemma to render naturally."
    };
  }
  if (requiredFacts.length) {
    return {
      ...base,
      kind: "factual_answer",
      modelNeeded: true,
      routerConfidence: 0.9,
      responseSource: "gemma_dialogue",
      reason: "Authoritative facts answer the question, but Gemma should express them in character."
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
    decisions: Array.isArray(trace.decisions) ? trace.decisions.slice(0, 6).map((decision) => ({
      proposalId: String(decision.proposalId || "").slice(0, 80),
      status: String(decision.status || "unknown").slice(0, 20),
      reason: String(decision.reason || "").slice(0, 120)
    })) : [],
    semanticInterpretation: trace.semanticInterpretation || null,
    responsePlan: trace.responsePlan || null,
    claims: Array.isArray(trace.claims) ? trace.claims.slice(0, 12) : [],
    semanticValidation: trace.semanticValidation || null,
    repairedClaimIds: Array.isArray(trace.repairedClaimIds) ? trace.repairedClaimIds.slice(0, 12) : [],
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
