import { ParishAiClient } from "../js/ai.js";

function parsePrompt(prompt) {
  const plan = JSON.parse(prompt.split("RESPONSE_PLAN_JSON=")[1].split("\nCONVERSATIONAL PRIORITY:")[0]);
  const context = JSON.parse(prompt.split("BACKGROUND_CONTEXT_JSON=")[1].split("\nRESPONSE_PLAN_JSON=")[0]);
  return { plan, context };
}

export function semanticResponse(prompt, overrides = {}) {
  const { plan, context } = parsePrompt(prompt);
  const visibleFacts = context.activeIssues?.[0]?.facts || [];
  const factById = new Map(visibleFacts.map((fact) => [fact.factId, fact]));
  const required = plan.requiredAnswerSlots.length ? plan.requiredAnswerSlots : [plan.obligationId];
  const decisions = (plan.proposals || []).map((proposal) => ({
    proposalId: proposal.proposalId,
    status: "accepted",
    reason: "The visitor believes this part is possible enough to attempt."
  }));
  const claims = (plan.requiredFactIds || [])
    .filter((factId) => factById.has(factId))
    .map((factId, index) => ({
      claimId: `claim-${index + 1}`,
      sentenceIndex: 0,
      type: "fact",
      text: factById.get(factId).text,
      subjectId: null,
      targetIds: [],
      evidenceFactIds: [factId],
      confidence: 0.95
    }));
  return {
    reply: plan.knownAnswer || "I hear what you are asking, Father, and I will answer as plainly as I can.",
    memory: "The visitor answered the priest's newest meaning.",
    interpretation: {
      speechActs: [{
        type: plan.latestPlayerText.includes("?") ? "question" : "request",
        meaning: plan.latestPlayerText,
        referenceText: null,
        confidence: 0.95
      }],
      implicitMeaning: "The newest player meaning has priority.",
      tone: "measured",
      mandatoryResponseNeeds: required
    },
    responsePlan: {
      primaryObligationId: required[0] || null,
      secondaryObligationIds: required.slice(1),
      knownFactIds: plan.requiredFactIds || [],
      unknowns: [],
      proposalPositions: decisions,
      desiredMovement: "Answer naturally and preserve unresolved matters.",
      endConversation: false
    },
    claims,
    answeredObligations: required,
    newQuestions: [],
    decisions,
    ...overrides
  };
}

export function semanticClient(overrides = {}) {
  return new ParishAiClient({
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      const prompt = payload.messages[1].content;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(semanticResponse(prompt, overrides)) } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
}
