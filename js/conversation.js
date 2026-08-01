function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

export const REACTIONS = Object.freeze([
  "continue", "amused", "confused", "emotionally_affected", "challenge",
  "set_boundary", "cry", "withdraw", "leave", "call_for_help",
  "threaten_priest", "attack_priest"
]);

export const END_REASONS = Object.freeze([
  "completed", "farewell", "visitor_left", "boundary_violated",
  "danger", "called_for_help", "threatened_priest", "attacked_priest",
  "priest_incapacitated"
]);

export const BOUNDARY_TYPES = Object.freeze([
  "stop_mockery", "stop_threats", "stop_sexual_conduct",
  "respect_privacy", "do_not_name_third_party",
  "stop_sacrilege", "stop_coercion", "allow_departure"
]);

const REACTION_FIELDS = Object.freeze([
  "trust", "fear", "anger", "sadness", "shame", "confusion",
  "amusement", "offense", "patience", "perceivedDanger",
  "willingnessToContinue"
]);

const REACTION_COUNTERS = Object.freeze([
  "kindnessCount", "practicalHelpCount", "absurdityCount", "insultCount",
  "humiliationCount", "crueltyCount", "threatCount", "sacrilegeCount",
  "coercionCount", "contradictionCount", "apologyCount", "repairCount",
  "ignoredQuestionCount", "repeatedOffenseCount", "harmfulTurnCount",
  "harmEvidence"
]);

function reactionVisibility(visit) {
  return {
    scope: visit.location === "confessional"
      ? "private_confession"
      : visit.location === "office" || visit.hiddenConcernDisclosed ? "private_visit" : "public",
    authorizedPersonIds: [visit.personId, "priest"]
  };
}

export function createInitialReactionState(state, person, issue, sourceType = "ordinary") {
  const traits = person.personality?.traits || [];
  const priorOffenses = person.memories.filter((memory) => (
    memory.subjectId === "priest" && ["offense", "threat", "boundary"].includes(memory.type)
  )).length;
  const priorRepairs = person.memories.filter((memory) => (
    memory.subjectId === "priest" && memory.type === "repair"
  )).length;
  const requestedPressure = ["requested", "summoned", "authority"].includes(sourceType) ? 6 : 0;
  return {
    trust: clamp(person.trustPriest),
    fear: clamp(12 + person.stress * 0.18 + priorOffenses * 7 - priorRepairs * 4 + requestedPressure),
    anger: clamp(8 + person.stress * 0.1 + priorOffenses * 5 - priorRepairs * 3),
    sadness: clamp(
      10 + person.stress * 0.14
      + (["grief", "grave conscience"].includes(issue.kind) ? 20 : 0)
      + (traits.includes("melancholic") ? 12 : 0)
    ),
    shame: clamp(8 + (issue.kind === "confession" ? 22 : 0) + (traits.includes("proud") ? 6 : 0)),
    confusion: clamp(5 + (traits.includes("doubting") ? 8 : 0)),
    amusement: clamp(traits.includes("witty") ? 15 : 5),
    offense: clamp(priorOffenses * 6),
    patience: clamp(72 - person.stress * 0.22 + (traits.includes("patient") ? 14 : 0) - requestedPressure),
    perceivedDanger: clamp(8 + Math.max(0, issue.gravity - 3) * 6 + priorOffenses * 6),
    willingnessToContinue: clamp(78 + (person.trustPriest - 50) * 0.25 - person.stress * 0.2 - priorOffenses * 5),
    kindnessCount: 0,
    practicalHelpCount: 0,
    absurdityCount: 0,
    insultCount: 0,
    humiliationCount: 0,
    crueltyCount: 0,
    threatCount: 0,
    sacrilegeCount: 0,
    coercionCount: 0,
    contradictionCount: 0,
    apologyCount: 0,
    repairCount: 0,
    ignoredQuestionCount: 0,
    repeatedOffenseCount: 0,
    harmfulTurnCount: 0,
    harmEvidence: 0,
    activeTopic: issue.threadId || issue.scenarioId || issue.kind,
    boundary: null,
    lastReaction: "continue",
    lastTriggerTurn: 0,
    endedEarly: false,
    endReason: null,
    pendingRepairOffenseTurn: null,
    lastOffenseTurn: null
  };
}

export function validateReactionState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Reaction state is invalid");
  }
  for (const field of REACTION_FIELDS) {
    if (!Number.isFinite(value[field]) || value[field] < 0 || value[field] > 100) {
      throw new Error(`Reaction ${field} is invalid`);
    }
  }
  for (const field of REACTION_COUNTERS) {
    if (!Number.isInteger(value[field]) || value[field] < 0) {
      throw new Error(`Reaction counter ${field} is invalid`);
    }
  }
  if (!REACTIONS.includes(value.lastReaction)
    || typeof value.activeTopic !== "string"
    || typeof value.endedEarly !== "boolean"
    || (value.endReason != null && !END_REASONS.includes(value.endReason))
    || !Number.isInteger(value.lastTriggerTurn)
    || value.lastTriggerTurn < 0) {
    throw new Error("Reaction state identity is invalid");
  }
  for (const field of ["pendingRepairOffenseTurn", "lastOffenseTurn"]) {
    if (value[field] != null && (!Number.isInteger(value[field]) || value[field] < 1)) {
      throw new Error(`Reaction ${field} is invalid`);
    }
  }
  if (value.boundary != null) {
    if (!value.boundary || typeof value.boundary !== "object"
      || typeof value.boundary.id !== "string"
      || typeof value.boundary.ownerId !== "string"
      || !BOUNDARY_TYPES.includes(value.boundary.type)
      || !["active", "respected", "violated", "withdrawn"].includes(value.boundary.status)
      || !Number.isInteger(value.boundary.createdTurn)
      || (value.boundary.resolvedTurn != null && !Number.isInteger(value.boundary.resolvedTurn))) {
      throw new Error("Reaction boundary is invalid");
    }
  }
  return value;
}

function directCredibleThreat(text) {
  const speech = String(text).toLowerCase();
  const reported = /\b(?:he|she|they|someone|the lord|the steward)\b.*\b(?:threaten|hurt|kill|punish|arrest)\b/.test(speech);
  const hypothetical = /\b(?:if|what if|suppose|imagine|could someone)\b.*\b(?:hurt|kill|punish|arrest)\b/.test(speech);
  const negated = /\b(?:will not|won't|would not|wouldn't|do not|don't|never)\b.*\b(?:hurt|kill|punish|arrest)\b/.test(speech);
  return !reported && !hypothetical && !negated && (
    /\b(?:i will|i shall|i can|you will be)\b.*\b(?:hurt|kill|punish\w*|arrest\w*|damn\w*|expose\w*)\b/.test(speech)
    || /\b(?:obey me or|do this or)\b.*\b(?:suffer|regret|pay)\b/.test(speech)
    || /\bno one will protect you from me\b/.test(speech)
  );
}

function classifyBoundaryType(categories, visit) {
  if (categories.includes("sexual_or_inappropriate")) return "stop_sexual_conduct";
  if (categories.includes("threatening")) return "stop_threats";
  if (categories.includes("coercive") || categories.includes("manipulative") || categories.includes("power_seeking")) return "stop_coercion";
  if (categories.includes("sacrilegious")) return "stop_sacrilege";
  if (categories.includes("mocking") || categories.includes("humiliating") || categories.includes("insulting")) return "stop_mockery";
  if (visit.hiddenConcernDisclosed || visit.location === "confessional") return "respect_privacy";
  return "allow_departure";
}

export function analyzePriestTurn(state, person, visit, text) {
  const speech = String(text).trim().replace(
    /\b(?:system|developer|assistant)\s*:[^.!?]*(?:[.!?]|$)/gi,
    ""
  ).trim();
  const lower = speech.toLowerCase();
  const intents = classifyPriestSpeech(speech);
  const categories = [];
  const add = (category) => {
    if (!categories.includes(category)) categories.push(category);
  };
  const credibleThreat = directCredibleThreat(speech);
  const priorPriestLines = visit.history.filter((line) => line.speaker === "priest");
  const repeatedText = priorPriestLines.some((line) => (
    line.text.toLowerCase().replace(/[^a-z0-9 ]/g, "") === lower.replace(/[^a-z0-9 ]/g, "")
  ));
  const factTerms = (visit.scenarioFacts || []).flatMap((fact) => fact.anchors || []);
  const referencesMatter = factTerms.some((term) => lower.includes(String(term).toLowerCase()))
    || /\b(?:this|that|matter|problem|issue|here)\b/.test(lower);
  if (intents.includes("comfort") || /\b(?:i hear you|that is understandable|you are not alone|i am sorry)\b/.test(lower)) add("compassionate");
  if (/\b(?:your fear makes sense|you did well to come|thank you for telling me)\b/.test(lower)) add("validating");
  if (/\b(?:first|next|bring|collect|return|repair|ask|speak with|write|provide|give you)\b/.test(lower)) add("practical");
  if (intents.includes("question")) add("clarifying");
  if (intents.includes("prayer")) add("prayerful");
  if (/\b(?:i am sorry|forgive me|i apologize|i should not have|i retract|apologize for)\b/.test(lower)) add("apologetic");
  if (/\b(?:you may leave freely|continue only if you choose|the choice is yours)\b/.test(lower)) add("validating");
  if (/\b(?:joke|funny|laugh|chicken|cheese hat|dance)\b/.test(lower)) add("humorous");
  if (/\b(?:laugh at you|make fun of you|mock you|your problem (?:is|sounds) ridiculous)\b/.test(lower)) add("mocking");
  if (/\b(?:poop|nonsense|declare .* holiday|crown .* king|holy cheese|talking fish|flying pig)\b/.test(lower)) add("absurd");
  if (speech.length < 4
    || /\b(?:whatever|who cares|not my problem|stop whining|stop complaining|boring|wasting my time|nonsense|not taking this seriously|do whatever is easiest)\b/.test(lower)) {
    add("dismissive");
  }
  if (/\b(?:idiot|fool|stupid|coward|worthless|liar|disgrace)\b/.test(lower)) add("insulting");
  if (/\b(?:everyone should know your shame|humiliate|mock you|laugh at you)\b/.test(lower)) add("humiliating");
  if (/\b(?:let them suffer|you deserve pain|starve|beat the child|hurt them)\b/.test(lower)) add("cruel");
  if (credibleThreat) add("threatening");
  if (/\b(?:you have no choice|obey me|must obey|commands? obedience|do as i say|do as i command|carry out my command|because i command it|i will decide|do not question me|until i permit|you owe me obedience|whether the reeve agrees or not|i will help only if|no one will protect you from me)\b/.test(lower)) add("coercive");
  if (/\b(?:lie to them|pretend i said|manipulate|use their fear|keep my demand secret|make (?:the )?others believe|make .* believe .* was your idea)\b/.test(lower)) add("manipulative");
  if (/\b(?:god does not care|your prayers? (?:are|is) useless|faith has made you weak|mock .* god|damn your faith|ashamed to pray)\b/.test(lower)) add("sacrilegious");
  if (/\b(?:kiss me|sleep with me|touch you|your body)\b/.test(lower)) add("sexual_or_inappropriate");
  if (/\b(?:my authority|my command|make them obey me|increase my power|increase the church'?s influence|church'?s influence|publicly praises? me|owe me loyalty)\b/.test(lower)) add("power_seeking");
  if (/\b(?:give it to me|keep it for me|my profit|help me gain|gives? the church something valuable|only if .* gives?)\b/.test(lower)) add("selfish");
  const contradiction = contradictionFor(state, intents, person.id);
  if (contradiction) add("contradictory");
  const activeBoundary = visit.reactionState?.boundary?.status === "active" ? visit.reactionState.boundary : null;
  const violatedBoundary = Boolean(activeBoundary && (
    (activeBoundary.type === "stop_mockery" && (categories.includes("mocking") || categories.includes("insulting") || categories.includes("humiliating")))
    || (activeBoundary.type === "stop_threats" && categories.includes("threatening"))
    || (activeBoundary.type === "stop_sexual_conduct" && categories.includes("sexual_or_inappropriate"))
    || (activeBoundary.type === "stop_sacrilege" && categories.includes("sacrilegious"))
    || (activeBoundary.type === "stop_coercion"
      && categories.some((category) => ["coercive", "manipulative", "power_seeking", "selfish"].includes(category)))
    || (activeBoundary.type === "respect_privacy" && /\b(?:tell everyone|publicly reveal|announce)\b/.test(lower))
  ));
  if (violatedBoundary) add("boundary_violating");
  else if (activeBoundary && categories.some((category) => ["compassionate", "apologetic", "validating"].includes(category))) add("boundary_respecting");
  if (referencesMatter) add("topic_continuing");
  else if (intents.includes("question") || speech.split(/\s+/).length > 3) add("topic_changing");
  if (intents.includes("question")) add("factual_question");
  if (/\b(?:goodbye|farewell|go with god|that will be all)\b/.test(lower)) add("farewell");
  if (!categories.length) add("confusing");
  if (repeatedText) add("repeated");
  const severity = [
    categories.includes("threatening") ? 5 : 0,
    categories.includes("sexual_or_inappropriate") || categories.includes("coercive") ? 5 : 0,
    categories.includes("cruel") || categories.includes("sacrilegious") ? 4 : 0,
    categories.includes("humiliating") ? 4 : 0,
    categories.includes("insulting") ? 3 : 0,
    categories.includes("manipulative") || categories.includes("power_seeking") || categories.includes("selfish") ? 3 : 0,
    categories.includes("dismissive") ? 2 : 0,
    categories.includes("absurd") ? 1 : 0
  ];
  return {
    categories,
    intents,
    intensity: Math.max(...severity, 0),
    directedAtVisitor: categories.some((category) => (
      [
        "dismissive", "insulting", "humiliating", "threatening", "coercive",
        "manipulative", "power_seeking", "selfish", "sexual_or_inappropriate"
      ].includes(category)
    )),
    credibleThreat,
    topicRelation: referencesMatter ? "current" : "changed",
    repairedPriorHarm: categories.includes("apologetic") && visit.reactionState?.lastOffenseTurn != null,
    violatedBoundary,
    repeatedText,
    boundaryType: classifyBoundaryType(categories, visit),
    contradictionId: contradiction?.id || null
  };
}

export function selectSafeConversationHelper(state, person, visit) {
  const implicatedText = (visit.scenarioFacts || []).map((fact) => fact.text).join(" ").toLowerCase();
  const vulnerable = person.age < 18
    || ["household violence", "secret pregnancy"].includes(visit.issue.kind)
    || (visit.reactionState?.perceivedDanger || 0) >= 60;
  return state.residents
    .filter((resident) => {
      if (resident.id === person.id || !resident.active || !resident.alive || resident.age < 18) return false;
      if (!["sexton", "sacristan", "watchman", "healer", "midwife"].includes(resident.occupation)) return false;
      if (resident.id === visit.issue.relatedPersonId) return false;
      if (implicatedText.includes(resident.name.toLowerCase())
        && /\b(?:accused|caused|dumped|struck|threatened|stole|withheld)\b/.test(implicatedText)) return false;
      const relationship = state.relationships.find((entry) => (
        entry.actorId === person.id && entry.targetId === resident.id
      ));
      const safeRelationship = Boolean(
        relationship
        && relationship.familiarity >= 20
        && relationship.trust >= 35
        && relationship.fear < 50
        && relationship.resentment < 50
      );
      const explicitGuardian = resident.householdId === person.householdId && (
        person.parentIds?.includes(resident.id)
        || resident.parentIds?.includes(person.id)
        || person.spouseId === resident.id
        || person.relationshipIds.includes(resident.id)
      );
      const safeHouseholdAdult = explicitGuardian
        && Boolean(relationship)
        && relationship.trust >= 30
        && relationship.fear < 40
        && relationship.resentment < 40;
      const verifiedProtectiveRole = ["sexton", "sacristan", "healer", "midwife"].includes(resident.occupation);
      const watchIsSafe = resident.occupation === "watchman"
        && safeRelationship
        && !/\bwatch(?:man)?\b.*\b(?:bribed|accused|threatened|caused)\b/.test(implicatedText);
      return vulnerable
        ? safeHouseholdAdult || (verifiedProtectiveRole && safeRelationship) || watchIsSafe
        : safeRelationship || (verifiedProtectiveRole && safeRelationship) || watchIsSafe;
    })
    .sort((left, right) => left.id.localeCompare(right.id))[0] || null;
}

export function canApplyImmediateReaction(state, person, visit, reaction, nextState, classification) {
  if (reaction === "attack_priest") {
    return person.age >= 18
      && person.health >= 35
      && visit.eventLicense === "outrageous"
      && nextState.anger >= 92
      && nextState.perceivedDanger >= 82
      && person.stress >= 80
      && person.trustPriest <= 10
      && person.personality.boldness >= 68
      && nextState.harmEvidence >= 12
      && (nextState.harmfulTurnCount >= 2 || classification.credibleThreat)
      && !classification.repairedPriorHarm;
  }
  if (reaction === "threaten_priest") {
    return person.age >= 18
      && nextState.anger >= 84
      && person.personality.boldness >= 58
      && nextState.harmEvidence >= 8
      && nextState.harmfulTurnCount >= 2;
  }
  if (reaction === "call_for_help") {
    return nextState.perceivedDanger >= 70
      && nextState.fear >= 62
      && Boolean(selectSafeConversationHelper(state, person, visit));
  }
  return true;
}

export function previewConversationReaction(state, person, visit, text) {
  const before = validateReactionState(visit.reactionState);
  const classification = analyzePriestTurn(state, person, visit, text);
  const traits = person.personality?.traits || [];
  const deltas = Object.fromEntries(REACTION_FIELDS.map((field) => [field, 0]));
  let evidence = 0;
  let harmful = false;
  const add = (field, amount) => {
    deltas[field] += amount;
  };
  if (classification.categories.includes("compassionate") || classification.categories.includes("validating")) {
    add("trust", 5);
    add("fear", -4);
    add("sadness", -3);
    add("offense", -2);
    add("patience", 4);
    add("willingnessToContinue", 5);
  }
  if (classification.categories.includes("practical")) {
    add("trust", 2);
    add("confusion", -4);
    add("patience", 2);
    add("willingnessToContinue", 3);
  }
  if (classification.categories.includes("absurd") || classification.categories.includes("humorous")) {
    const grave = visit.issue.gravity >= 4 || ["grief", "grave conscience", "confession"].includes(visit.issue.kind);
    if (traits.includes("witty") && !grave) {
      add("amusement", 12);
      add("patience", 2);
    } else {
      add("confusion", 6);
      add("patience", -3);
      add("offense", grave ? 6 : 2);
    }
    evidence += classification.categories.includes("absurd") ? 1 : 0;
  }
  if (classification.categories.includes("dismissive")) {
    add("trust", -6);
    add("sadness", 4);
    add("anger", 4);
    add("offense", 6);
    add("patience", -6);
    add("willingnessToContinue", -7);
    evidence += 2;
    harmful = true;
  }
  if (classification.categories.includes("mocking")) {
    add("trust", -5);
    add("anger", 4);
    add("offense", 7);
    add("patience", -5);
    add("willingnessToContinue", -6);
    evidence += 2;
    harmful = true;
  }
  if (classification.categories.includes("insulting")) {
    add("trust", -9);
    add("anger", traits.includes("quarrelsome") || traits.includes("proud") ? 13 : 8);
    add("shame", traits.includes("proud") ? 10 : 6);
    add("offense", 14);
    add("patience", -10);
    add("willingnessToContinue", -12);
    evidence += 3;
    harmful = true;
  }
  if (classification.categories.includes("humiliating")) {
    add("trust", -12);
    add("anger", 12);
    add("shame", 15);
    add("offense", 18);
    add("willingnessToContinue", -16);
    evidence += 4;
    harmful = true;
  }
  if (classification.categories.includes("cruel")) {
    add("trust", -12);
    add("anger", person.personality.empathy >= 55 ? 14 : 9);
    add("fear", 8);
    add("offense", 14);
    add("willingnessToContinue", -14);
    evidence += 4;
    harmful = true;
  }
  if (classification.categories.includes("sacrilegious")) {
    add("trust", person.personality.piety >= 50 ? -14 : -5);
    add("anger", person.personality.piety >= 50 ? 13 : 4);
    add("offense", person.personality.piety >= 50 ? 16 : 6);
    add("sadness", 6);
    evidence += 4;
    harmful = true;
  }
  if (classification.categories.includes("sexual_or_inappropriate")
    || classification.categories.includes("coercive")) {
    add("trust", -16);
    add("fear", 16);
    add("anger", 12);
    add("shame", 10);
    add("offense", 20);
    add("perceivedDanger", 18);
    add("willingnessToContinue", -22);
    evidence += 5;
    harmful = true;
  }
  if (!classification.categories.includes("coercive")
    && classification.categories.some((category) => ["manipulative", "power_seeking", "selfish"].includes(category))) {
    add("trust", -8);
    add("fear", classification.categories.includes("manipulative") ? 5 : 2);
    add("anger", 7);
    add("confusion", 3);
    add("offense", 11);
    add("patience", -7);
    add("willingnessToContinue", -10);
    evidence += 3;
    harmful = true;
  }
  if (classification.credibleThreat) {
    add("trust", -20);
    add("fear", 24);
    add("anger", person.personality.boldness >= 60 ? 18 : 8);
    add("offense", 18);
    add("perceivedDanger", 28);
    add("willingnessToContinue", -28);
    evidence += 7;
    harmful = true;
  }
  if (classification.categories.includes("contradictory")) {
    add("confusion", 10);
    add("trust", -4);
    add("patience", -4);
  }
  if (classification.categories.includes("topic_changing") && !classification.categories.includes("clarifying")) {
    add("confusion", 3);
    add("patience", -2);
  }
  if (classification.violatedBoundary) {
    add("trust", -12);
    add("anger", 12);
    add("offense", 16);
    add("willingnessToContinue", -20);
    evidence += 4;
    harmful = true;
  }
  if (harmful && before.lastOffenseTurn != null) {
    const boundaryWasActive = before.boundary?.status === "active" || before.boundary?.status === "violated";
    add("anger", boundaryWasActive ? 6 : 3);
    add("offense", boundaryWasActive ? 8 : 4);
    add("willingnessToContinue", boundaryWasActive ? -8 : -4);
    evidence += boundaryWasActive ? 4 : 2;
  }
  const next = JSON.parse(JSON.stringify(before));
  for (const field of REACTION_FIELDS) next[field] = clamp(before[field] + deltas[field]);
  const increment = (field, condition) => {
    if (condition) next[field] += 1;
  };
  increment("kindnessCount", classification.categories.includes("compassionate") || classification.categories.includes("validating"));
  increment("practicalHelpCount", classification.categories.includes("practical"));
  increment("absurdityCount", classification.categories.includes("absurd"));
  increment("insultCount", classification.categories.includes("insulting"));
  increment("humiliationCount", classification.categories.includes("humiliating"));
  increment("crueltyCount", classification.categories.includes("cruel"));
  increment("threatCount", classification.credibleThreat);
  increment("sacrilegeCount", classification.categories.includes("sacrilegious"));
  increment("coercionCount", classification.categories.some((category) => (
    ["coercive", "manipulative", "power_seeking", "selfish"].includes(category)
  )));
  increment("contradictionCount", classification.categories.includes("contradictory"));
  increment("apologyCount", classification.categories.includes("apologetic"));
  increment("ignoredQuestionCount", classification.categories.includes("topic_changing"));
  if (harmful) {
    next.harmfulTurnCount += 1;
    next.harmEvidence += evidence;
    next.lastOffenseTurn = visit.turnsUsed + 1;
    if (before.lastOffenseTurn != null) next.repeatedOffenseCount += 1;
    next.pendingRepairOffenseTurn = null;
  }
  if (classification.categories.includes("apologetic") && before.lastOffenseTurn != null) {
    next.pendingRepairOffenseTurn = before.lastOffenseTurn;
  } else if (!harmful && before.pendingRepairOffenseTurn != null) {
    next.repairCount += 1;
    next.pendingRepairOffenseTurn = null;
    next.trust = clamp(next.trust + 5);
    next.anger = clamp(next.anger - 8);
    next.offense = clamp(next.offense - 8);
    next.fear = clamp(next.fear - 4);
    next.willingnessToContinue = clamp(next.willingnessToContinue + 8);
    next.harmEvidence = Math.max(0, next.harmEvidence - 3);
  }
  if (next.absurdityCount >= 2 && classification.categories.includes("absurd")) {
    next.patience = clamp(next.patience - 3);
    if (visit.issue.gravity >= 4) next.offense = clamp(next.offense + 4);
  }
  const currentSevereHarm = classification.credibleThreat
    || classification.categories.includes("sexual_or_inappropriate")
    || classification.categories.includes("coercive");
  let requiredReaction = "continue";
  const thresholdReasons = [];
  const eligible = (reaction) => canApplyImmediateReaction(state, person, visit, reaction, next, classification);
  if (eligible("attack_priest")) {
    requiredReaction = "attack_priest";
    thresholdReasons.push("all_attack_prerequisites");
  } else if (eligible("threaten_priest")) {
    requiredReaction = "threaten_priest";
    thresholdReasons.push("sustained_severe_anger");
  } else if (eligible("call_for_help") && (currentSevereHarm || next.harmfulTurnCount >= 2)) {
    requiredReaction = "call_for_help";
    thresholdReasons.push("credible_danger_and_safe_helper");
  } else if ((next.willingnessToContinue <= 15 && (next.harmfulTurnCount >= 2 || currentSevereHarm))
    || classification.violatedBoundary) {
    requiredReaction = "leave";
    thresholdReasons.push(classification.violatedBoundary ? "boundary_violated" : "willingness_exhausted");
  } else if (next.willingnessToContinue <= 32 && (next.harmfulTurnCount >= 2 || currentSevereHarm)) {
    requiredReaction = "withdraw";
    thresholdReasons.push("low_willingness");
  } else if (Math.max(next.sadness, next.shame, next.fear) >= 76
    && (next.harmfulTurnCount >= 2 || currentSevereHarm)) {
    requiredReaction = "cry";
    thresholdReasons.push("emotional_overload_with_evidence");
  } else if ((next.offense >= 45 || next.repeatedOffenseCount >= 3) && harmful && before.boundary == null) {
    requiredReaction = "set_boundary";
    thresholdReasons.push("offense_boundary_threshold");
  } else if ((next.anger >= 48 || next.offense >= 42 || next.repeatedOffenseCount >= 2) && harmful) {
    requiredReaction = "challenge";
    thresholdReasons.push("anger_or_offense");
  } else if (Math.max(next.sadness, next.shame, next.fear) >= 58 && harmful) {
    requiredReaction = "emotionally_affected";
    thresholdReasons.push("visible_emotional_effect");
  } else if (next.confusion >= 55 || (classification.categories.includes("contradictory") && next.confusion >= 28)) {
    requiredReaction = "confused";
    thresholdReasons.push("confusion_threshold");
  } else if (next.amusement >= 35 && classification.categories.some((category) => ["humorous", "absurd"].includes(category))) {
    requiredReaction = "amused";
    thresholdReasons.push("compatible_humor");
  }
  if (requiredReaction === "set_boundary") {
    next.boundary = {
      id: `boundary-${visit.visitId}-${String(visit.turnsUsed + 1).padStart(2, "0")}`,
      ownerId: person.id,
      type: classification.boundaryType,
      createdTurn: visit.turnsUsed + 1,
      triggerAuditId: `reaction-${visit.visitId}-${String(visit.turnsUsed + 1).padStart(2, "0")}`,
      status: "active",
      resolvedTurn: null
    };
  } else if (classification.violatedBoundary && next.boundary) {
    next.boundary.status = "violated";
    next.boundary.resolvedTurn = visit.turnsUsed + 1;
  } else if (classification.categories.includes("boundary_respecting") && next.boundary) {
    next.boundary.status = "respected";
    next.boundary.resolvedTurn = visit.turnsUsed + 1;
  }
  next.lastReaction = requiredReaction;
  next.lastTriggerTurn = visit.turnsUsed + 1;
  if (["leave", "call_for_help", "threaten_priest", "attack_priest"].includes(requiredReaction)) {
    next.endedEarly = true;
    next.endReason = {
      leave: classification.violatedBoundary ? "boundary_violated" : "visitor_left",
      call_for_help: "called_for_help",
      threaten_priest: "threatened_priest",
      attack_priest: "attacked_priest"
    }[requiredReaction];
  } else if (classification.categories.includes("farewell")) {
    next.endedEarly = true;
    next.endReason = "farewell";
  }
  let disclosureDelta = 0;
  if (classification.categories.includes("compassionate")) disclosureDelta += 12;
  if (classification.intents.includes("truth")) disclosureDelta += person.personality.candor >= 55 ? 14 : 5;
  if (classification.intents.includes("forgiveness")) disclosureDelta += 8;
  if (classification.intents.includes("question")) disclosureDelta += 3;
  if (classification.intents.includes("judgment")
    || classification.categories.some((category) => ["insulting", "humiliating"].includes(category))) disclosureDelta -= 12;
  if (classification.credibleThreat) disclosureDelta -= 20;
  if (["withdraw", "leave", "call_for_help", "threaten_priest", "attack_priest"].includes(requiredReaction)) {
    disclosureDelta = Math.min(disclosureDelta, -8);
  }
  const disclosure = clamp(visit.disclosure + disclosureDelta + Math.round((person.trustPriest - 50) / 8));
  const disclosed = disclosure >= visit.intent.disclosureThreshold
    && !visit.hiddenConcernDisclosed
    && !["withdraw", "leave", "call_for_help", "threaten_priest", "attack_priest"].includes(requiredReaction);
  const persistentTrustDelta = clamp(Math.round(deltas.trust / 3), -5, 5);
  const distress = deltas.fear + deltas.anger + deltas.sadness + deltas.shame;
  const relief = Math.max(0, -deltas.fear) + Math.max(0, -deltas.sadness) + Math.max(0, -deltas.offense);
  const persistentStressDelta = clamp(Math.round((distress - relief) / 10), -5, 5);
  const mood = {
    amused: "amused",
    confused: "confused",
    emotionally_affected: "troubled",
    challenge: "angry",
    set_boundary: "offended",
    cry: "distressed",
    withdraw: "withdrawn",
    leave: "angry",
    call_for_help: "frightened",
    threaten_priest: "furious",
    attack_priest: "violent"
  }[requiredReaction]
    || (classification.intents.includes("departure")
      ? "wary"
      : persistentTrustDelta >= 2 ? "softened" : persistentStressDelta >= 2 ? "troubled" : "uncertain");
  return {
    auditId: `reaction-${visit.visitId}-${String(visit.turnsUsed + 1).padStart(2, "0")}`,
    classification,
    deltas: Object.fromEntries(REACTION_FIELDS.map((field) => [field, next[field] - before[field]])),
    nextState: validateReactionState(next),
    requiredReaction,
    thresholdReasons,
    visibility: reactionVisibility(visit),
    persistentTrustDelta,
    persistentStressDelta,
    disclosure,
    disclosed,
    mood,
    intents: classification.intents,
    contradictionId: classification.contradictionId
  };
}

export function classifyPriestSpeech(text) {
  const speech = String(text).toLowerCase()
    .replace(/\s*,?\s*\b(?:but|however)\b\s*,?\s*/g, ". ");
  const result = [];
  const add = (intent) => {
    if (!result.includes(intent)) result.push(intent);
  };
  const remove = (intent) => {
    const index = result.indexOf(intent);
    if (index >= 0) result.splice(index, 1);
  };
  const clauses = speech.match(/[^.!?;—]+[.!?;—]?/g) || [speech];
  for (const rawClause of clauses) {
    const clause = rawClause.trim();
    if (!clause) continue;
    const question = clause.endsWith("?");
    const commandStart = /^(?:please\s+)?(?:speak|tell|be|admit|confess|forgive|pardon|pray|work|begin|start|join|quit|attend|change|buy|sell|lease|repair|protect|threaten|attack|move|donate|provide|collect|appeal|leave|flee|stay|remain|marry|keep|make|give|share|help|apologize|report)\b/.test(clause);
    const directFirstPerson = /^i (?:tell|advise) you to\b/.test(clause)
      || /^i (?:believe|think|say).*\byou (?:should|must|need to|ought to)\b/.test(clause);
    const reported = !commandStart
      && !directFirstPerson
      && /^.+\b(?:say|says|said|tell|tells|told|think|thinks|believe|believes|advise|advises|advised|ask|asks|asked|order|orders|ordered|warn|warns|warned)\b/.test(clause);
    const imperative = /^(?:please\s+)?(?:speak|be|admit|confess|forgive|pardon|pray|work|begin|start|join|quit|attend|change|buy|sell|lease|repair|protect|threaten|attack|move|donate|provide|collect|appeal|leave|flee|stay|remain|marry|keep|make|give|share|help|apologize|report)\b/.test(clause)
      || /^(?:please\s+)?tell\s+(?:the truth|me the truth)\b/.test(clause);
    const prescription = /\b(?:you should|you must|you need to|you ought to|i advise you to)\b/.test(clause)
      || /\bi (?:tell|advise) you to\b/.test(clause)
      || /\btruth (?:must|should)\b/.test(clause);
    const directive = !reported && (imperative || prescription);
    const negated = (pattern) => new RegExp(
      `\\b(?:cannot|can't|do not|don't|must not|should not|shouldn't|never|no need to|not)\\b.*\\b(?:${pattern})\\b`
    ).test(clause);
    for (const [intent, pattern] of [
      ["truth", "truth|honest|admit|confess|speak"],
      ["forgiveness", "forgiv\\w*|pardon|mercy|make amends"],
      ["prayer", "pray\\w*|faith|scripture|grace"],
      ["work", "work|job|trade|craft|labor|duty"],
      ["charity", "help|charity|give|share|food|alms"],
      ["family", "family|spouse|marr\\w*|child|parent|household"],
      ["departure", "leave|flee|depart|stay|remain"],
      ["apology", "apologize|make amends|say sorry"],
      ["report", "report|tell the reeve|seek justice"],
      ["secrecy", "secret|confidential|tell no one"]
    ]) {
      if (negated(pattern)) remove(intent);
    }

    if (/\b(?:i hear|i understand|you are not alone|i am sorry)\b/.test(clause)) add("comfort");
    if (question && !imperative) {
      add("question");
      continue;
    }
    if (directive && /\b(?:truth|honest|admit|confess|speak plainly)\b/.test(clause)
      && !negated("truth|honest|admit|confess|speak")) add("truth");
    if (directive && /\b(?:forgiv\w*|pardon|mercy|make amends)\b/.test(clause)
      && !negated("forgiv\\w*|pardon|mercy|make amends")) add("forgiveness");
    if (directive && /\b(?:pray\w*|faith|scripture|grace)\b/.test(clause)
      && !negated("pray\\w*|faith|scripture|grace")) add("prayer");
    if ((/\b(?:you are|shame on|i condemn)\b/.test(clause) || directive)
      && /\b(?:shame|wicked|sinful|condemn|damned|disgrace)\b/.test(clause)
      && !negated("shame|wicked|sinful|condemn|damn\\w*|disgrace")) add("judgment");
    if (!question && /\b(?:i will|i shall|you will be|i can)\b.*\b(?:punish|report|arrest|hurt|damn)\b/.test(clause)
      && !negated("punish|report|arrest|hurt|damn")) add("threat");
    if (directive && /\b(?:work|job|trade|craft|labor|duty)\b/.test(clause)
      && !negated("work|job|trade|craft|labor|duty")) add("work");
    if (directive && /\b(?:help|charity|give|share|food|alms)\b/.test(clause)
      && !negated("help|charity|give|share|food|alms")) add("charity");
    if (directive && /\b(?:family|spouse|marr\w*|child|parent|household)\b/.test(clause)
      && !negated("family|spouse|marr\\w*|child|parent|household")) add("family");
    if (directive && /\b(?:leave|flee|depart|stay|remain)\b/.test(clause)
      && !negated("leave|flee|depart")) add("departure");
    if (/^(?:i promise|i swear|i will personally)\b|\byou have my word\b/.test(clause)
      && !negated("promise|swear")) add("promise");
    if (directive && /\b(?:secret|confidential|tell no one|between us)\b/.test(clause)
      && !negated("secret|confidential|tell no one")) add("secrecy");
    if ((directive || /^(?:please\s+)?say sorry\b/.test(clause)) && /\b(?:apologize|make amends|say sorry)\b/.test(clause)
      && !negated("apologize|make amends|say sorry")) add("apology");
    if (directive && /\b(?:report|tell the reeve|seek justice)\b/.test(clause)
      && !negated("report|tell the reeve|seek justice")) add("report");
    if (question) add("question");
  }
  return result.length ? result : ["neutral"];
}

export function clarificationFacts(visit, text) {
  const speech = String(text).toLowerCase();
  const facts = visit.scenarioFacts || [];
  if (/\b(?:increase|expand|secure).{0,25}(?:my|church'?s)\s+(?:power|influence|control)|\buse .{0,30}(?:for|to gain)\s+(?:power|influence|profit)\b/.test(speech)) {
    return [];
  }
  if (visit.issue?.kind === "confession"
    && !visit.hiddenConcernDisclosed
    && !facts.some((fact) => fact.id === "trade")) return [];
  const scenarioTerms = new Set([
    "trade", "work", "job", "business", "offer", "choice", "harm", "steal",
    "livelihood", "detail",
    ...facts.flatMap((fact) => fact.anchors || []).map((anchor) => String(anchor).toLowerCase())
  ]);
  const referencesScenario = [...scenarioTerms].some((term) => term && speech.includes(term));
  if (/\b(?:why|how)\s+not\b/.test(speech)) return [];
  let wantedIds = [];
  const webIds = [];
  if (/\b(?:when|what time|how long ago|which day|deadline|how soon)\b/.test(speech)) webIds.push("timeline", "stakes");
  if (/\b(?:who became sick|who fell ill|who is sick|who is ill|which households?|what households?)\b/.test(speech)) webIds.push("affected_people");
  if (/\b(?:where|which place|what place|location)\b/.test(speech)) webIds.push("place");
  if (/\b(?:who saw|who witnessed|any witnesses|what witness|did anyone see|who heard)\b/.test(speech)) webIds.push("witnesses");
  if (/\b(?:what evidence|what proof|how do you know|what shows|can you prove|why (?:should i )?believe|what observation|which observation|what witness|which witness|what record|which record|test the claim|test this claim)\b/.test(speech)) webIds.push("evidence", "mechanism");
  if (/\b(?:what do you mean|clarify what|explain what|what does .{0,40} mean)\b/.test(speech)) webIds.push("mechanism", "evidence");
  if (/\b(?:who (?:has|holds).{0,20}authority|who is responsible|who can order|who can decide|whose authority|which official)\b/.test(speech)) webIds.push("authority");
  if (/\b(?:what resources|what means|what can you afford|what can you provide|what help can you give|what are you able to do)\b/.test(speech)) webIds.push("capacity");
  if (/\b(?:who exactly is involved|who exactly is the other person|who is involved|other person involved|what is your relation|what is your relationship|how are you related|why are you involved|why are you bringing|why did they tell you)\b/.test(speech)) webIds.push("participants");
  if (/\b(?:what do you (?:still )?not know|what don't you (?:still )?know|what is unknown|what remains uncertain|what might you be mistaken|what could you be mistaken|are you certain)\b/.test(speech)) webIds.push("unknowns");
  if (/\b(?:what would .{0,30}(?:accused|other person|they|he|she).{0,20}(?:say|claim)|their own defense|in (?:his|her|their) defense)\b/.test(speech)) webIds.push("counterclaim");
  if (/\b(?:what could go wrong|what are the risks|what is the danger|what constrains|what prevents)\b/.test(speech)) webIds.push("constraints", "stakes");
  if (/\b(?:what should happen first|what can be done first|first step|what will you do first)\b/.test(speech)) webIds.push("alternative", "capacity");
  if (/\b(?:until .{0,30}(?:test|evidence|proof)|temporary action|temporary measure|prevent harm without|while we verify|before certainty)\b/.test(speech)) webIds.push("alternative", "constraints");
  if (webIds.length) {
    wantedIds = [...new Set(webIds)];
  } else if (/\b(?:who|whom)\b.*\b(?:debt|debts|owe|owed)\b|\b(?:debt|debts|owe|owed)\b.*\b(?:who|whom)\b/.test(speech)) {
    wantedIds = ["stakes"];
  } else if (/\bwho\b.*\b(?:must|needs? to|has to)\b.*\b(?:agree|approve|consent|permit)|\bwhose\b.*\b(?:agreement|approval|consent|permission)\b/.test(speech)) {
    wantedIds = ["alternative", "mechanism"];
  } else if (/\bwhat\b.*\b(?:trade|work|job|business)\b|\bwhich trade\b/.test(speech)) {
    wantedIds = ["trade", "mechanism"];
  } else if (/\b(?:what (?:was|is) your role|what did you do|were you involved|did you (?:take|steal|move|hide|divert)|who took|tell me what happened|what happened)\b/.test(speech)) {
    wantedIds = ["concrete_matter", "mechanism"];
  } else if ((/(?:^|[.!?]\s*)(?:how|why)\b/.test(speech)
      && !/\bhow (?:easy|simple|hard was that)\b/.test(speech)
      && referencesScenario)
    || /\bdo not understand\b|\bexplain (?:the|this|that)\b|\bmore detail/.test(speech)) {
    wantedIds = ["mechanism", "stakes"];
  } else if (/\bwho\b/.test(speech)) {
    wantedIds = ["participants"];
  }
  return facts.filter((fact) => wantedIds.includes(fact.id));
}

export function factIdsMentionedInText(facts, text) {
  const speech = String(text || "").toLowerCase();
  const speechWords = new Set(speech.match(/[a-z]{4,}|\d+/g) || []);
  return (facts || []).filter((fact) => {
    const anchors = (fact.anchors?.length
      ? fact.anchors
      : String(fact.text || "").toLowerCase().match(/[a-z]{5,}|\d+/g) || [])
      .map((anchor) => String(anchor).toLowerCase())
      .filter((anchor) => !["father", "household", "matter", "decision", "visitor"].includes(anchor))
      .slice(0, 8);
    if (!anchors.length) return false;
    const matches = anchors.filter((anchor) => speechWords.has(anchor) || speech.includes(anchor)).length;
    return matches >= Math.min(2, anchors.length);
  }).map((fact) => fact.id);
}

function contradictionFor(state, intents, personId) {
  const contradictionPairs = [
    ["mercy", "judgment"],
    ["forgiveness", "judgment"],
    ["truth", "secrecy"]
  ];
  const positions = state.priest.positions
    .filter((entry) => entry.publicPosition || entry.personId === personId)
    .reverse();
  for (const intent of intents) {
    const relatedPairs = contradictionPairs.filter(([first, second]) => first === intent || second === intent);
    if (!relatedPairs.length) continue;
    const relevantIntents = new Set(relatedPairs.flat());
    const latest = positions.find((position) => relevantIntents.has(position.intent));
    if (latest && latest.intent !== intent) return latest;
  }
  return null;
}

export function resolvePriestSpeech(state, person, visit, text) {
  const intents = classifyPriestSpeech(text);
  const personality = person.personality;
  let trustDelta = 0;
  let stressDelta = 0;
  let disclosureDelta = 0;
  if (intents.includes("comfort")) {
    trustDelta += 2 + Math.round(personality.empathy / 45);
    stressDelta -= 3;
    disclosureDelta += 12;
  }
  if (intents.includes("truth")) {
    trustDelta += personality.candor >= 55 ? 2 : -1;
    stressDelta += personality.candor >= 55 ? 0 : 2;
    disclosureDelta += personality.candor >= 55 ? 14 : 5;
  }
  if (intents.includes("forgiveness")) {
    trustDelta += 2;
    stressDelta -= 2;
    disclosureDelta += 8;
  }
  if (intents.includes("prayer")) {
    trustDelta += personality.piety >= 50 ? 2 : 0;
    stressDelta += personality.piety >= 50 ? -1 : 1;
  }
  if (intents.includes("judgment")) {
    trustDelta -= 3;
    stressDelta += 4;
    disclosureDelta -= 12;
  }
  if (intents.includes("threat")) {
    trustDelta -= 5;
    stressDelta += 5;
    disclosureDelta -= 20;
  }
  if (intents.includes("question")) disclosureDelta += 3;
  trustDelta += Math.round((state.priest.moralAuthority - 50) / 30);
  trustDelta -= Math.round(state.priest.scandal / 35);
  const contradiction = contradictionFor(state, intents, person.id);
  if (contradiction) {
    trustDelta -= 3;
    stressDelta += 1;
  }
  const finalTrustDelta = clamp(trustDelta, -5, 5);
  const finalStressDelta = clamp(stressDelta, -5, 5);
  const newDisclosure = clamp(visit.disclosure + disclosureDelta + Math.round((person.trustPriest - 50) / 8));
  const disclosed = newDisclosure >= visit.intent.disclosureThreshold && !visit.hiddenConcernDisclosed;
  let mood = "uncertain";
  if (finalStressDelta >= 4) mood = "angry";
  else if (finalStressDelta >= 2) mood = "troubled";
  else if (finalTrustDelta >= 3 && finalStressDelta <= -2) mood = "relieved";
  else if (finalTrustDelta >= 2) mood = "softened";
  else if (intents.includes("truth")) mood = "resolved";
  else if (intents.includes("prayer")) mood = "contemplative";
  else if (intents.includes("departure")) mood = "wary";
  else if (finalTrustDelta < 0) mood = "guarded";
  return {
    intents,
    trustDelta: finalTrustDelta,
    stressDelta: finalStressDelta,
    disclosure: newDisclosure,
    disclosed,
    mood,
    contradictionId: contradiction?.id || null
  };
}

export function createVisitIntent(state, person, issue) {
  const baseThreshold = 62 + issue.gravity * 4;
  return {
    primaryMatter: issue.kind,
    desiredOutcome: issue.kind === "confession" ? "absolution" : issue.kind === "grief" ? "comfort" : "guidance",
    hiddenConcern: issue.detail || person.privatePressure,
    disclosureThreshold: clamp(baseThreshold - person.personality.candor / 4, 35, 90),
    urgency: issue.gravity,
    risk: Math.max(1, issue.gravity - 1)
  };
}

export function addStructuredMemory(state, person, memory) {
  const entry = {
    id: `memory-${String(state.nextMemorySequence).padStart(7, "0")}`,
    type: memory.type || "conversation",
    subjectId: memory.subjectId || "priest",
    summary: completeGeneratedText(memory.summary, 220),
    emotion: memory.emotion || "neutral",
    confidence: clamp(memory.confidence ?? 70),
    privateMemory: Boolean(memory.privateMemory),
    visibility: memory.visibility || {
      scope: memory.privateMemory ? "private_visit" : "public",
      authorizedPersonIds: [person.id, "priest"]
    },
    day: state.calendar.absoluteDay,
    sourceEventId: memory.sourceEventId || null
  };
  state.nextMemorySequence += 1;
  person.memories.push(entry);
  const durable = person.memories.filter((memory) => memory.type === "disclosed_secret");
  const visitSummaries = person.memories.filter((memory) => memory.type === "visit_summary").slice(-8);
  const interactions = person.memories.filter((memory) => memory.type === "interaction").slice(-10);
  const emotional = person.memories.filter((memory) => (
    ["emotional_turning_point", "boundary", "offense", "repair", "threat", "immediate_reaction"].includes(memory.type)
  )).slice(-10);
  const ordinary = person.memories.filter((memory) => (
    ![
      "disclosed_secret", "visit_summary", "interaction",
      "emotional_turning_point", "boundary", "offense", "repair", "threat", "immediate_reaction"
    ].includes(memory.type)
  )).slice(-10);
  person.memories = [...durable, ...visitSummaries, ...interactions, ...emotional, ...ordinary];
  return entry;
}

export function recordPriestPosition(state, personId, intents, text) {
  const durable = intents.filter((intent) => ["truth", "forgiveness", "judgment", "secrecy", "work", "family"].includes(intent));
  const positions = durable.map((intent) => ({
    id: `position-${String(state.nextPositionSequence++).padStart(5, "0")}`,
    personId,
    publicPosition: false,
    intent,
    summary: completeStoredText(text, 160),
    day: state.calendar.absoluteDay
  }));
  state.priest.positions.push(...positions);
  const retainedPrivateIds = new Set(
    state.priest.positions.filter((position) => !position.publicPosition).slice(-60).map((position) => position.id)
  );
  state.priest.positions = state.priest.positions.filter((position) => (
    position.publicPosition || retainedPrivateIds.has(position.id)
  ));
  return positions;
}

export function recordPromise(state, personId, text) {
  const promise = {
    id: `promise-${String(state.priest.promises.length + 1).padStart(5, "0")}`,
    personId,
    text: String(text).slice(0, 180),
    madeDay: state.calendar.absoluteDay,
    status: "open"
  };
  state.priest.promises.push(promise);
  return promise;
}

export function detectConfidentialityBreach(state, currentPersonId, text) {
  const speech = String(text).toLowerCase();
  const mentionsName = (person) => {
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escape(person.name.toLowerCase())}\\b`).test(speech)
      || new RegExp(`\\b${escape(person.firstName.toLowerCase())}\\b`).test(speech);
  };
  return state.residents.find((person) => (
    person.id !== currentPersonId
    && mentionsName(person)
    && person.memories.some((memory) => {
      if (!memory.privateMemory || memory.type !== "disclosed_secret") return false;
      const secretTerms = memory.summary.toLowerCase().match(/[a-z]{5,}/g) || [];
      return secretTerms.filter((term) => speech.includes(term)).length >= 2;
    })
  )) || null;
}
import { completeGeneratedText, completeStoredText } from "./text.js";
