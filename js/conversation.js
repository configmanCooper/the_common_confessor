function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
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
    const commandStart = /^(?:please\s+)?(?:speak|tell|be|admit|confess|forgive|pardon|pray|work|attend|change|leave|flee|stay|remain|marry|keep|make|give|share|help|apologize|report)\b/.test(clause);
    const directFirstPerson = /^i (?:tell|advise) you to\b/.test(clause)
      || /^i (?:believe|think|say).*\byou (?:should|must|need to|ought to)\b/.test(clause);
    const reported = !commandStart
      && !directFirstPerson
      && /^.+\b(?:say|says|said|tell|tells|told|think|thinks|believe|believes|advise|advises|advised|ask|asks|asked|order|orders|ordered|warn|warns|warned)\b/.test(clause);
    const imperative = /^(?:please\s+)?(?:speak|be|admit|confess|forgive|pardon|pray|work|attend|change|leave|flee|stay|remain|marry|keep|make|give|share|help|apologize|report)\b/.test(clause)
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
  if (/\b(?:who|whom)\b.*\b(?:debt|debts|owe|owed)\b|\b(?:debt|debts|owe|owed)\b.*\b(?:who|whom)\b/.test(speech)) {
    wantedIds = ["stakes"];
  } else if (/\bwhat\b.*\b(?:trade|work|job|business)\b|\bwhich trade\b/.test(speech)) {
    wantedIds = ["trade", "mechanism"];
  } else if (/\b(?:what (?:was|is) your role|what did you do|were you involved|did you (?:take|steal|move|hide|divert)|who took|tell me what happened|what happened)\b/.test(speech)) {
    wantedIds = ["concrete_matter", "mechanism"];
  } else if ((/\bhow\b|\bwhy\b/.test(speech) && referencesScenario)
    || /\bdo not understand\b|\bexplain (?:the|this|that)\b|\bmore detail/.test(speech)) {
    wantedIds = ["mechanism", "stakes"];
  } else if (/\bwho\b/.test(speech)) {
    wantedIds = ["trade", "concrete_matter"];
  }
  return facts.filter((fact) => wantedIds.includes(fact.id));
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
    hiddenConcern: person.privatePressure,
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
    summary: String(memory.summary || "").slice(0, 220),
    emotion: memory.emotion || "neutral",
    confidence: clamp(memory.confidence ?? 70),
    privateMemory: Boolean(memory.privateMemory),
    day: state.calendar.absoluteDay,
    sourceEventId: memory.sourceEventId || null
  };
  state.nextMemorySequence += 1;
  person.memories.push(entry);
  const durable = person.memories.filter((memory) => memory.type === "disclosed_secret");
  const ordinary = person.memories.filter((memory) => memory.type !== "disclosed_secret").slice(-20);
  person.memories = [...durable, ...ordinary];
  return entry;
}

export function recordPriestPosition(state, personId, intents, text) {
  const durable = intents.filter((intent) => ["truth", "forgiveness", "judgment", "secrecy", "work", "family"].includes(intent));
  const positions = durable.map((intent) => ({
    id: `position-${String(state.nextPositionSequence++).padStart(5, "0")}`,
    personId,
    publicPosition: false,
    intent,
    summary: String(text).slice(0, 160),
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
