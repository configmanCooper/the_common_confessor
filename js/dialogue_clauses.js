const ACTION_START = /^(?:please\s+)?(?:tell|ask|send|speak|talk|visit|go|bring|collect|verify|check|inspect|investigate|prepare|have|get|make|organize|warn|mark|close|open|move|leave|flee|stay|defend|guard|watch|report|appeal|pray|ignore|wait|give|share|repair|build|hide|reveal|admit|confess|protect|help)\b/i;

function normalizeClause(value) {
  return String(value || "")
    .replace(/^[,;:\s]+|[,;:\s]+$/g, "")
    .replace(/\b(?:and|but)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function actionable(clause) {
  return ACTION_START.test(clause)
    || /^do nothing\b/i.test(clause)
    || /\b(?:you|we|they|people|households?|men|someone|scouts?)\s+(?:should|must|need to|ought to|will)\b/i.test(clause)
    || /\b(?:main|first|highest)\s+priority\s+(?:is|should be)\b/i.test(clause)
    || /\b(?:i want you to|i need you to|let us|let's|what if we|perhaps we|maybe we)\b/i.test(clause);
}

function splitActionableClauses(text) {
  const sentences = String(text || "")
    .split(/(?<=[.!?;])\s+/)
    .flatMap((sentence) => sentence.split(/\b(?:at the same time|meanwhile|but the main priority is to|the main priority is to|and then|then|also)\b/i))
    .map(normalizeClause)
    .filter(Boolean);
  const clauses = [];
  for (const sentence of sentences) {
    const conjunctionParts = sentence
      .split(/,\s*(?=(?:please\s+)?(?:tell|ask|send|speak|talk|bring|collect|verify|check|inspect|investigate|prepare|have|get|make|organize|warn|mark|close|move|leave|flee|defend|guard|watch|report|pray|ignore|wait|give|share|repair|build|protect|help)\b)/i)
      .flatMap((part) => part.split(/\s+\band\b\s+(?=(?:please\s+)?(?:tell|ask|send|speak|talk|bring|collect|verify|check|inspect|investigate|prepare|have|get|make|organize|warn|mark|close|move|leave|flee|defend|guard|watch|report|pray|ignore|wait|give|share|repair|build|protect|help)\b)/i));
    clauses.push(...conjunctionParts.map(normalizeClause).filter(Boolean));
  }
  return clauses;
}

function actionHint(clause) {
  const speech = clause.toLowerCase();
  if (/\b(?:scouts?|verify|check|inspect)\w*\b.*\b(?:roads?|route|approach|south)\b/.test(speech)) return "verify_route";
  if (/\b(?:prepare|ready|pack)\b.*\b(?:leave|flee|evacuat|depart)\b/.test(speech)) return "prepare_evacuation";
  if (/\b(?:prepare|organize|ready|arm)\b.*\b(?:defend|defense|guard|watch|men)\b/.test(speech)) return "organize_defense";
  if (/\b(?:speak|talk|tell|ask|visit|send)\b/.test(speech)) return "contact_person";
  if (/\b(?:do nothing|ignore|wait)\b/.test(speech)) return "delay_or_ignore";
  if (/\b(?:pray|prayer)\b/.test(speech)) return "pray";
  if (/\b(?:leave|flee|depart)\b/.test(speech)) return "leave";
  if (/\b(?:give|share|donate|food|coin|aid)\b/.test(speech)) return "resource_help";
  return "custom";
}

function proposalPriority(clause, index) {
  if (/\b(?:main|first|highest)\s+priority\b|\bmost important\b/i.test(clause)) return 100;
  if (/\b(?:quick|immediate|at once|as soon as possible|urgently)\b/i.test(clause)) return 80;
  return Math.max(20, 60 - index * 5);
}

function turnActKinds(text) {
  const speech = String(text || "").trim();
  const lower = speech.toLowerCase();
  const kinds = [];
  if (!speech || /^\[silence\]$|^\.{2,}$/.test(lower)) return ["silence"];
  if (speech.includes("?")) {
    kinds.push(/\b(?:you expect me to believe|isn't it obvious|do you really think|how could you)\b/i.test(speech)
      ? "rhetorical_question"
      : "direct_question");
  }
  if (/\b(?:i refuse|i will not|i won't|no,? i)\b/i.test(speech)) kinds.push("refusal");
  if (/\b(?:i have decided|i choose|we will|i will)\b/i.test(speech)) kinds.push("player_decision");
  if (/\b(?:you lied|you are lying|you caused|you stole|you knew|your fault)\b/i.test(speech)) kinds.push("accusation");
  if (/\b(?:joke|funny|chicken|flying pig|holy cheese|talking fish)\b/i.test(speech)) kinds.push("humor_or_absurdity");
  if (!kinds.length) kinds.push("observation_or_open_dialogue");
  return kinds;
}

export function analyzePlayerTurn(text, turnNumber = 1) {
  const speech = String(text || "").trim();
  const sharedPrayer = /\b(?:let us pray|let's pray|join me in prayer|amen\b|(?:god|lord|father in heaven)[,\s]+please)\b/i.test(speech);
  const rawClauses = splitActionableClauses(speech);
  const proposals = [];
  for (const clause of rawClauses) {
    if (!actionable(clause) || sharedPrayer) continue;
    const rawText = clause.slice(0, 180);
    const hint = actionHint(rawText);
    const duplicate = proposals.find((proposal) => proposal.actionHint === hint
      && (hint !== "custom" || proposal.rawText.toLowerCase() === rawText.toLowerCase()));
    if (duplicate) {
      duplicate.priority = Math.max(duplicate.priority, proposalPriority(rawText, proposals.length));
      continue;
    }
    proposals.push({
      proposalId: `proposal-turn-${String(turnNumber).padStart(2, "0")}-${String(proposals.length + 1).padStart(2, "0")}`,
      rawText,
      actionHint: hint,
      priority: proposalPriority(rawText, proposals.length)
    });
    if (proposals.length >= 6) break;
  }
  const mainPriority = speech.match(/\b(?:main|first|highest)\s+priority\s+(?:is|should be)?\s*(?:to\s+)?(.+)$/i);
  if (mainPriority) {
    const priorityHint = actionHint(mainPriority[1]);
    const priorityProposal = proposals.find((proposal) => proposal.actionHint === priorityHint);
    if (priorityProposal) priorityProposal.priority = 100;
  }
  proposals.sort((left, right) => right.priority - left.priority || left.proposalId.localeCompare(right.proposalId));
  const actKinds = turnActKinds(speech);
  if (proposals.length === 1) actKinds.push("simple_proposal");
  if (proposals.length >= 2) actKinds.push("compound_proposal");
  return {
    isSilence: actKinds.includes("silence"),
    actKinds: [...new Set(actKinds)],
    proposals,
    isCompound: proposals.length >= 2 || (proposals.length >= 1 && actKinds.includes("direct_question"))
  };
}
