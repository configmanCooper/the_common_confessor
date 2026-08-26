import { AI_ALLOWED_ACTIONS } from "./data.js";
import {
  BOUNDARY_TYPES,
  clarificationFacts,
  ensureConversationContinuity,
  factIdsMentionedInText,
  previewConversationReaction,
  REACTIONS
} from "./conversation.js";
import {
  boundedPromptTrace,
  selectConversationObligation
} from "./dialogue_planner.js";
import { analyzePlayerTurn } from "./dialogue_clauses.js";
import {
  churchDonationCapacity,
  churchResourceRows,
  MERELY_CONSIDERING,
  mentionsChurchResource,
  namesChurchResource,
  offerClauses,
  parseChurchTransferIntent,
  readDonationRequest,
  REFUSES_TO_GIVE
} from "./church.js";
import { completeGeneratedText } from "./text.js";

function boundedString(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function boundedProse(value, maximum) {
  return completeGeneratedText(value, maximum);
}

function stripControlSuffix(value) {
  return String(value || "").replace(
    /([.!?])\s*(?:continue|amused|confused|emotionally_affected|challenge|set_boundary|cry|withdraw|leave|call_for_help|threaten_priest|attack_priest)\s*$/i,
    "$1"
  );
}

function trimToSentence(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/[.!?"']\s*$/.test(text)) return text;
  const lastBreak = Math.max(text.lastIndexOf("."), text.lastIndexOf("!"), text.lastIndexOf("?"));
  return lastBreak > 20 ? text.slice(0, lastBreak + 1).trim() : text;
}

function parseContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (content && typeof content === "object") return content;
  if (typeof content !== "string") throw new Error("The local model returned no usable content");
  try {
    return JSON.parse(content);
  } catch (error) {
    /* A small model asked for JSON will occasionally run past its token
       budget and stop mid-string, which throws away an otherwise good reply
       over a missing brace. Recover the fields we actually need before
       giving up and spending another call. */
    const salvaged = salvageJsonFields(content);
    if (salvaged) return salvaged;
    throw error;
  }
}

function salvageJsonFields(raw) {
  const text = String(raw);
  const field = (name) => {
    const match = new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, "s").exec(text);
    if (!match) return "";
    try {
      return JSON.parse(`"${match[1].replace(/\\?$/, "")}"`);
    } catch {
      return match[1].replace(/\\n/g, " ").replace(/\\"/g, '"').trim();
    }
  };
  const reply = field("reply");
  if (!reply || reply.length < 4) return null;
  return {
    reply,
    understoodPlayerAs: field("understoodPlayerAs"),
    npcIntent: field("npcIntent"),
    memory: field("memory"),
    truncatedRecovery: true
  };
}

function naturalReference(state, resident) {
  const duplicateFirstName = state.residents.some((candidate) => (
    candidate.id !== resident.id && candidate.active && candidate.firstName === resident.firstName
  ));
  if (duplicateFirstName) return resident.name;
  const title = {
    bailiff: "Bailiff",
    reeve: "Reeve",
    watchman: "Watchman",
    magistrate: "Magistrate",
    clerk: "Clerk"
  }[resident.occupation];
  /* "Reeve Woodvale" is only a safe way to name a man if he is the only
     Woodvale. In one parish a widow's late husband and the living reeve shared
     a surname, and she told the priest that Reeve Woodvale was her dead
     husband. Where the surname is shared, his full name is used instead - and
     without the office in front of it, because the substitution that rewrites
     names in dialogue would otherwise stack the title on each pass and produce
     "Reeve Reeve Reeve Edric Marshbank". */
  if (!title) return resident.firstName;
  const sharedSurname = state.residents.some((candidate) => (
    candidate.id !== resident.id
    && candidate.surname === resident.surname
    && (candidate.alive !== false || Boolean(candidate.deceased))
  ));
  return sharedSurname ? `the ${title.toLowerCase()}, ${resident.name}` : `${title} ${resident.surname}`;
}

function naturalizeDialogueNames(state, speaker, text) {
  let result = String(text || "");
  let substituted = false;
  for (const resident of state.residents) {
    if (resident.id === speaker?.id || !result.toLowerCase().includes(resident.name.toLowerCase())) continue;
    const reference = naturalReference(state, resident);
    /* Where the reference still contains the full name - which happens when an
       office holder shares a surname and must be named in full - replacing the
       name with it would stack the office on every pass and give "Reeve Reeve
       Reeve Edric Marshbank". Skip once the text already reads correctly. */
    if (reference.includes(resident.name) && result.includes(reference)) continue;
    const before = result;
    result = result.replace(
      new RegExp(`\\b${resident.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
      reference
    );
    if (result !== before) substituted = true;
  }
  /* A substitution that begins with an article can land at the start of a
     sentence, leaving "the reeve, Edric Marshbank can organize the inquiry"
     opening in lower case. Only tidy where something was actually replaced, so
     that an untouched line is not recorded as having been repaired. */
  if (!substituted) return result;
  return result.replace(
    /(^|[.!?]\s+)([a-z])/g,
    (whole, lead, letter) => `${lead}${letter.toUpperCase()}`
  );
}

function spokenScenarioFact(text, state, person) {
  const name = String(person?.name || "").trim();
  if (!name) return String(text || "");
  const possessive = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'s\\b`, "gi");
  let result = String(text || "")
    .replace(/\bthe visitor's\b/gi, "my")
    .replace(/\bthe visitor\b/gi, "I")
    .replace(possessive, (_match, offset) => offset === 0 ? "My" : "my")
    .replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+is\\b`, "gi"), "I am")
    .replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "gi"), "I ")
    .replace(/\bI knows\b/g, "I know")
    .replace(/\bI fears\b/g, "I fear")
    .replace(/\bI has\b/g, "I have")
    .replace(/\bI holds\b/g, "I hold")
    .replace(/\bI uses\b/g, "I use")
    .replace(/\bI receives\b/g, "I receive")
    .replace(/\bI needs\b/g, "I need");
  return naturalizeDialogueNames(state, person, result);
}

function renderRequiredFactAnswer(state, person, visit, facts) {
  const factIds = new Set(facts.map((fact) => fact.id));
  if (String(visit.issue?.scenarioId || "").includes("panic_rumor")) {
    if (factIds.has("alternative") || factIds.has("constraints")) {
      return appendPendingDecisionReminder(
        "I think the safest course is to ask people I trust what they actually saw and send someone reliable to check the road before I reassure anyone. Until then, I can keep my household calm and ready without pretending the rumor is proven or ordering the whole village about.",
        visit
      );
    }
    if (factIds.has("threat_status") || factIds.has("mechanism") || factIds.has("evidence")) {
      return appendPendingDecisionReminder(
        "The fear is feeding on itself, Father. I have heard families repeating the same talk of soldiers and sickness, and some have begun hoarding or preparing to leave, but no one I trust has actually seen an army or confirmed a pestilence. At present I know only that the rumor is spreading—not that either danger is real.",
        visit
      );
    }
  }
  if (factIds.has("threat_status")) {
    return appendPendingDecisionReminder(
      `No one has confirmed either story, Father. There is no declared war involving ${state.town.name} that I know of, and no trustworthy witness has identified a banner, commander, company, number, intention, or direction. Some people say soldiers and others say plague, so I cannot yet tell you which—if either—is true.`,
      visit
    );
  }
  const answer = boundedProse(
    facts.map((fact) => spokenScenarioFact(fact.text, state, person)).join(" "),
    600
  );
  return appendPendingDecisionReminder(answer, visit);
}

function appendPendingDecisionReminder(answer, visit) {
  const pending = (visit.continuity?.obligationStack || [])
    .find((obligation) => obligation.kind === "player_decision" && obligation.status === "open");
  if (!pending || !pending.prompt || answer.length > 430) return answer;
  const course = normalizeAdvicePhrase(pending.prompt)
    .replace(/[.!?]+$/, "")
    .replace(/^([A-Z])/, (letter) => letter.toLowerCase());
  return boundedProse(`${answer} I still need your counsel on whether I should ${course}.`, 600);
}

function adviceQuestion(visit, person = null) {
  const alternative = (visit.scenarioFacts || []).find((fact) => fact.id === "alternative")?.text;
  if (!alternative) {
    const general = [
      "What would you have me do, Father?",
      "I cannot settle this alone. What do you think is right?",
      "Tell me plainly, Father—where should I begin?",
      "How would you counsel me to face this?"
    ];
    return general[Math.abs(String(visit.visitId || "").length + (person?.age || 0)) % general.length];
  }
  const course = alternative.replace(/[.!?]+$/, "").replace(/^([A-Z])/, (letter) => letter.toLowerCase());
  const immediateNeed = /^the immediate need is (.+)$/i.exec(alternative.replace(/[.!?]+$/, ""));
  if (immediateNeed) {
    const permission = /^permission to (.+)$/i.exec(immediateNeed[1]);
    return permission
      ? `Would it be wrong to let myself ${permission[1]}, Father?`
      : `Do you believe ${immediateNeed[1]} is truly the right course?`;
  }
  const traits = person?.personality?.traits || [];
  const templates = traits.includes("devout")
    ? [
      `Which course would be honest before God, Father—would you have me ${course}?`,
      `Do you believe it would be right before God to ${course}?`
    ]
    : traits.includes("fearful") || traits.includes("secretive")
      ? [
        `I keep turning it over in my mind. Do you think I should ${course}?`,
        `I am afraid of choosing badly. Would you counsel me to ${course}?`
      ]
      : traits.includes("proud") || traits.includes("candid")
        ? [
          `Tell me plainly, Father: should I ${course}?`,
          `Would you have me ${course}, or choose another way?`
        ]
        : [
          `What would you have me do, Father—${course}, or hold back?`,
          `Do you think it would be wiser to ${course}?`,
          `If you were in my place, would you ${course}?`,
          `I cannot settle it in my own mind. Should I ${course}?`
        ];
  const key = [...String(visit.visitId || "")].reduce((sum, character) => sum + character.charCodeAt(0), person?.age || 0);
  return templates[Math.abs(key) % templates.length];
}

function humanizeOpeningQuestion(opening, visit, person) {
  const stock = /\b(?:i need your advice on the choice itself|what course of action would you counsel|i need your advice, father|given the potential consequences|i understand a decision is expected|i find myself troubled|i'?m hoping you might offer some guidance|how best to proceed)\b/i;
  if (!stock.test(opening)) return opening;
  const sentences = String(opening).match(/[^.!?]+[.!?]?/g) || [opening];
  const retained = sentences.filter((sentence) => !stock.test(sentence)).join(" ").trim();
  return `${retained} ${adviceQuestion(visit, person)}`.trim();
}

function generalizeOpeningQuestion(opening) {
  const withoutTrailingQuestion = String(opening)
    .replace(/[^.!?]*\?\s*$/, "")
    .trim();
  return `${withoutTrailingQuestion} What would you have me do, Father?`.trim();
}

function normalizeAdvicePhrase(value) {
  let phrase = String(value || "").trim()
    .replace(/^this course\s*:?\s*/i, "")
    .replace(/^the course\s*:?\s*/i, "");
  phrase = phrase
    .replace(/^a private plan for (.+?) is needed before (.+)$/i, "make a private plan for $1 before $2")
    .replace(/^giving (.+)$/i, "give $1")
    .replace(/^collecting (.+)$/i, "collect $1")
    .replace(/^speaking (.+)$/i, "speak $1")
    .replace(/^returning (.+)$/i, "return $1")
    .replace(/^protecting (.+)$/i, "protect $1");
  return phrase;
}

function keywordsForRequirement(text) {
  return (String(text).toLowerCase().match(/[a-z]{4,}/g) || [])
    .filter((word) => !["with", "from", "that", "this", "before", "after"].includes(word))
    .slice(0, 5);
}

/* Plain speech for what a household holds. A villager does not know a number
   for their own means; they know whether there is anything to spare. */
function bandOfMeans(value) {
  if (value >= 75) return "a good deal";
  if (value >= 55) return "enough, with a little over";
  if (value >= 35) return "barely enough";
  if (value >= 18) return "almost nothing";
  return "nothing at all";
}

/* What the household actually has, in words a person would use about their own
   life. The visitor is told this every turn so that talk of money stays tied to
   the ledger: an invented debt is not a colourful detail, it sends the priest
   looking for a creditor who does not exist. */
function householdMeansLine(household, visit) {
  const debt = Number(household.debt) || 0;
  const owing = debt > 0.5
    ? `Your household owes about ${Math.round(debt)} silver pennies, and the reckoning weighs on you.`
    : "Your household owes nothing to anybody. You are in no one's debt, and you must not say or imply that you are.";
  const scenarioDebt = (visit?.scenarioFacts || []).some((fact) => /\bdebt|owe|unpaid|wages\b/i.test(String(fact.text)));
  return [
    `What is actually in your house: ${bandOfMeans(household.wealth)} in ready coin, ${bandOfMeans(household.food)} in the larder.`,
    owing,
    scenarioDebt
      ? "Any debt in the matter you came about is the one described above under your situation, with the sum given there. Do not name a different sum."
      : "Do not invent a debt, a loan, a sum of money, or a creditor. If money comes up and none was given to you, speak of it plainly without naming a figure."
  ].join(" ");
}

export function quantityPhrase(amount, unit) {
  const singular = {
    pennies: "penny",
    sacks: "sack",
    loaves: "loaf",
    measures: "measure",
    wheels: "wheel",
    bundles: "bundle",
    doses: "dose"
  }[unit] || unit;
  return `${amount} ${amount === 1 ? singular : unit}`;
}

function selfActionFact(visit, person) {
  const name = String(person?.name || "").toLowerCase();
  return (visit.scenarioFacts || []).find((fact) => (
    fact.id === "concrete_matter"
    && name
    && String(fact.text || "").toLowerCase().startsWith(`${name} `)
  )) || null;
}

function deniesKnownSelfAction(text) {
  return /\b(?:i (?:did not|didn't|never) (?:take|steal|divert|move|hide|conceal|cause|use|help|poach)|i (?:do not|don't) know who|i have no idea who)\b/i.test(text);
}

function validateOpeningGrounding(opening, context, state) {
  const grounding = JSON.stringify(context).toLowerCase();
  const speech = String(opening).toLowerCase();
  for (const concept of ["debt", "creditor", "pregnancy", "marriage", "another well", "second well"]) {
    if (speech.includes(concept) && !grounding.includes(concept)) {
      throw new Error(`The visitor introduced unsupported opening material: ${concept}`);
    }
  }
  const allowedNumbers = new Set(grounding.match(/\b\d+\b/g) || []);
  for (const number of speech.match(/\b\d+\b/g) || []) {
    if (!allowedNumbers.has(number)) throw new Error("The visitor invented an unsupported quantity");
  }
  const titledNames = [...String(opening).matchAll(
    /\b(?:Lord|Lady|Master|Mistress|Mr|Mrs|Steward|Bailiff|Magistrate|Bishop)\.?\s+([A-Z][a-z'-]+)\b/g
  )];
  for (const match of titledNames) {
    const surname = match[1].toLowerCase();
    const known = [...state.residents, ...state.externalActors].some((resident) => (
      resident.surname?.toLowerCase() === surname || resident.name.toLowerCase().includes(surname)
    ));
    if (!known && !grounding.includes(surname)) {
      throw new Error(`The visitor invented an unsupported titled person: ${match[0]}`);
    }
  }
  return opening;
}

function relevantMemories(state, person, visit, limit = 8) {
  return person.memories
    .filter((memory) => (
      memory.visibility?.scope === "public"
      || memory.visibility?.authorizedPersonIds?.includes(person.id)
      || (visit.hiddenConcernDisclosed && memory.subjectId === "priest")
    ))
    .map((memory, index) => ({
      memory,
      score: index
        + (memory.type === "disclosed_secret" ? 1000 : 0)
        + (memory.type === "visit_summary" ? 700 : 0)
        + (memory.type === "interaction" ? 450 : 0)
        + (memory.subjectId === visit.issue.relatedPersonId ? 500 : 0)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ memory }) => {
      let summary = memory.summary;
      for (const resident of state.residents) {
        if (resident.id === person.id || !summary.toLowerCase().includes(resident.name.toLowerCase())) continue;
        summary = summary.replace(
          new RegExp(`\\b${resident.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
          naturalReference(state, resident)
        );
      }
      return { ...memory, summary };
    });
}

function findMentionedResident(state, speech) {
  const fullMatches = state.residents.filter((resident) => speech.includes(resident.name.toLowerCase()));
  if (fullMatches.length === 1) return fullMatches[0];
  const firstMatches = state.residents.filter((resident) => (
    resident.firstName.length >= 4
    && new RegExp(`\\b${resident.firstName.toLowerCase()}\\b`).test(speech)
  ));
  if (firstMatches.length === 1) return firstMatches[0];
  const titledSurnameMatches = state.residents.filter((resident) => (
    new RegExp(`\\b(?:master|mistress|lord|lady|steward|bailiff)\\s+${resident.surname.toLowerCase()}\\b`).test(speech)
  ));
  return titledSurnameMatches.length === 1 ? titledSurnameMatches[0] : null;
}

function tradeCapacity(person) {
  const tools = {
    farmer: "farm labor and ordinary field tools",
    shepherd: "animal care and herding",
    miller: "milling, lifting, and grain work",
    baker: "baking and kitchen labor",
    stablehand: "horse care, hauling, and stable work",
    carpenter: "carpentry labor and trade tools",
    mason: "stone labor and masonry tools",
    blacksmith: "forge labor and smithing skill",
    peddler: "delivery, carrying, and market travel",
    merchant: "accounting, purchasing, and trade work",
    healer: "care work and knowledge of remedies",
    herbalist: "herb gathering and remedy preparation",
    midwife: "care work related to childbirth",
    servant: "household labor",
    laborer: "general physical labor",
    clerk: "writing, accounts, and records",
    scribe: "writing and copying",
    watchman: "guard and watch duty"
  };
  return tools[person.occupation] || `${person.occupation} work and ordinary labor`;
}

function householdQuestionRequirement(state, person, visit, playerText) {
  const speech = String(playerText).toLowerCase();
  const asksAssets = /\b(?:what do you have|anything at home|what can you sell|what can you give|what can you pay|property do you own)\b/.test(speech);
  const asksChildren = /\b(?:children|child|son|daughter)\b.*\b(?:work|labor|pay|debt)\b/.test(speech);
  const asksLabor = /\b(?:can you|could you)\b.*\b(?:work for|labor for|repay through work)\b/.test(speech);
  if (!asksAssets && !asksChildren && !asksLabor) return null;
  const household = state.households.find((entry) => entry.id === person.householdId);
  const children = state.residents.filter((resident) => (
    person.childrenIds?.includes(resident.id) && resident.active && resident.alive
  ));
  const parts = [];
  if (asksAssets) {
    const means = (household?.wealth || 0) < 20
      ? "almost no ready coin"
      : (household?.wealth || 0) < 50 ? "a little ready coin" : "some ready coin";
    const food = (household?.food || 0) < 25 ? "low food stores" : "modest food stores";
    const properties = household?.properties?.length
      ? household.properties.map((property) => `${property.status} ${property.type}`).join(", ")
      : `a ${household?.dwelling || "cottage"}`;
    parts.push(`My household has ${means}, ${food}, and ${properties}. I have the ordinary tools needed for ${tradeCapacity(person)}, but selling them could cost me my livelihood.`);
  }
  if (asksChildren) {
    if (!children.length) {
      parts.push("I have no child in my household who could answer this debt.");
    } else {
      const minors = children.filter((child) => child.age < 18);
      const adults = children.filter((child) => child.age >= 18);
      parts.push(`I have ${children.length} ${children.length === 1 ? "child" : "children"}: ${children.map((child) => `${child.firstName}, age ${child.age}`).join(", ")}.`);
      if (minors.length) parts.push("I will not pledge a minor child as payment or send one into unsafe labor.");
      if (adults.length) parts.push("Any adult child would have to agree freely before offering work.");
    }
  }
  if (asksLabor) {
    const capable = person.age >= 18 && person.health >= 35;
    parts.push(capable
      ? `I can offer ${tradeCapacity(person)} toward repayment if the creditor agrees to fair terms.`
      : "My age or health does not allow me to promise dependable labor for this debt.");
  }
  return {
    type: "household_capacity",
    requireAll: false,
    minimumMatches: 1,
    requiredTerms: ["household", "work", "child", "coin"],
    responsePattern: /\b(?:household|ready coin|food stores|tools|child|work|labor)\b/i,
    fallbackReply: parts.join(" ")
  };
}

function expertQuestionRequirement(state, visit, playerText) {
  const speech = String(playerText).toLowerCase();
  if (!/\b(?:who|someone|expert|knowledgeable)\b.*\b(?:well|water|illness|sickness|runoff|contamination|determine|examine)\b/.test(speech)) {
    return null;
  }
  const eligible = state.residents
    .filter((resident) => resident.active && resident.alive && ["healer", "herbalist", "midwife", "reeve", "miller", "tanner"].includes(resident.occupation))
    .sort((left, right) => {
      const rank = { healer: 0, herbalist: 1, midwife: 2, reeve: 3, miller: 4, tanner: 5 };
      return rank[left.occupation] - rank[right.occupation] || left.id.localeCompare(right.id);
    });
  const expert = eligible[0];
  return {
    type: "expert_request",
    requireAll: false,
    minimumMatches: 1,
    requiredTerms: expert ? [expert.firstName.toLowerCase(), expert.occupation] : ["know"],
    responsePattern: expert
      ? new RegExp(`\\b${expert.firstName}\\b.*\\b(?:${expert.occupation}|water|well|examine)\\b`, "i")
      : /\b(?:do not know|know of no one|no one qualified)\b/i,
    fallbackReply: expert
      ? `${naturalReference(state, expert)} has the most relevant knowledge available in the village as a ${expert.occupation}. I can ask ${expert.firstName} to examine the sick households, the water, and the runoff, though that will not replace closing access if danger becomes clear.`
      : "I know of no qualified person in the village who can prove the cause immediately. We should warn people away, secure temporary clean water, and gather evidence without inventing an expert."
  };
}

function investigationQuestionRequirement(state, person, visit, playerText) {
  const speech = String(playerText).toLowerCase();
  if (!/\bwho\b.*\b(?:investigate|inspect|examine|look into|speak to|talk to|question)\b/.test(speech)) {
    return null;
  }
  const related = state.residents.find((resident) => resident.id === visit.issue.relatedPersonId);
  const officials = state.residents
    .filter((resident) => resident.active && resident.alive
      && resident.id !== related?.id && ["reeve", "bailiff", "watchman"].includes(resident.occupation))
    .sort((left, right) => {
      const rank = { reeve: 0, bailiff: 1, watchman: 2 };
      return rank[left.occupation] - rank[right.occupation] || left.id.localeCompare(right.id);
    });
  const experts = state.residents
    .filter((resident) => resident.active && resident.alive
      && resident.id !== related?.id
      && ["healer", "herbalist", "midwife", "miller", "tanner"].includes(resident.occupation))
    .sort((left, right) => {
      const rank = { healer: 0, herbalist: 1, midwife: 2, miller: 3, tanner: 4 };
      return rank[left.occupation] - rank[right.occupation] || left.id.localeCompare(right.id);
    });
  const official = officials[0];
  const expert = experts[0];
  const relatedReference = related ? naturalReference(state, related) : "the person accused";
  const asksTemporaryWater = /\b(?:family|household|neighbors?)\b.*\b(?:avoid|stop using|stay away from)\b.*\bwell\b|\b(?:avoid|stop using|stay away from)\b.*\bwell\b/.test(speech);
  const parts = [];
  if (official) {
    parts.push(`${naturalReference(state, official)} can organize the local inquiry, preserve witnesses, and question ${relatedReference}.`);
  } else {
    parts.push(`I know of no named reeve or bailiff presently available to lead the inquiry.`);
  }
  if (expert) {
    parts.push(`${naturalReference(state, expert)}, the ${expert.occupation}, can examine the practical evidence and compare it with the reported harm.`);
  } else {
    parts.push("I know of no qualified local expert who can establish the cause alone.");
  }
  parts.push(`I can carry the warning and speak with ${relatedReference}, but I should do so with a witness rather than pretend I hold legal authority.`);
  if (asksTemporaryWater) {
    parts.push("My household and the nearby families can avoid the well only if we mark it clearly and arrange carried water from a source already known to be clean; I should not invent a second well.");
  }
  return {
    type: "investigation_people",
    answerSlots: [
      "investigator",
      "person_who_questions_related_person",
      ...(asksTemporaryWater ? ["temporary_safe_water"] : [])
    ],
    requireAll: false,
    minimumMatches: 1,
    requiredTerms: [
      official?.firstName?.toLowerCase(),
      expert?.firstName?.toLowerCase(),
      related?.firstName?.toLowerCase(),
      "investigate"
    ].filter(Boolean),
    responsePattern: /\b(?:reeve|bailiff|watchman|healer|herbalist|midwife|investigat|inquiry|question)\b/i,
    fallbackReply: parts.join(" ")
  };
}

function groundedInstitutionReply(state, person, visit, reply) {
  if (!/\bvillage elder\b/i.test(reply)) return null;
  const official = state.residents
    .filter((resident) => resident.active && resident.alive
      && ["reeve", "bailiff"].includes(resident.occupation))
    .sort((left, right) => {
      const rank = { reeve: 0, bailiff: 1 };
      return rank[left.occupation] - rank[right.occupation] || left.id.localeCompare(right.id);
    })[0];
  const related = state.residents.find((resident) => resident.id === visit.issue.relatedPersonId);
  const officialText = official
    ? `${naturalReference(state, official)} is the named local official who can organize an inquiry.`
    : "I know of no named reeve or bailiff presently available to organize an inquiry.";
  const relatedText = related
    ? `I can speak with ${naturalReference(state, related)} with a witness present.`
    : "I can carry warnings and help gather witnesses without pretending to hold legal authority.";
  return `I do not know of a separate village elder with recognized authority here, Father. ${officialText} ${relatedText}`;
}

function unsupportedLocationRequirement(playerText) {
  const speech = String(playerText).toLowerCase();
  if (/\b(?:go|send|direct|use)\b.*\b(?:another|other|nearby)\s+well\b/.test(speech)) {
    return {
      type: "unsupported_location",
      requireAll: false,
      minimumMatches: 1,
      requiredTerms: ["know", "well", "water"],
      responsePattern: /\b(?:do not know|no other|another well|clean water)\b/i,
      fallbackReply: "I do not know of another nearby well that has been confirmed clean, Father. We can warn people away from this one and arrange carried water, but I should not promise a second well that may not exist."
    };
  }
  return null;
}

function additionalCurrentMatterHelp(visit) {
  const scenarioId = String(visit.issue.scenarioId || "");
  if (/pregnancy/.test(scenarioId)) {
    return "Help me identify a safe adult household, a midwife or healer, and what shelter or food the church can actually provide before anyone confronts the family.";
  }
  if (/well|contaminated/.test(scenarioId)) {
    return "Help warn the households using the well, secure carried water, and ask a healer and the reeve to compare the illnesses with the runoff.";
  }
  if (/apprentice|children/.test(scenarioId)) {
    return "Help arrange immediate safety for the child, then bring the master, guardian, healer, or reeve into a witnessed discussion.";
  }
  if (/tax|wage|debt/.test(scenarioId)) {
    return "Help gather the written terms, receipts, and affected households before approaching the steward or magistrate.";
  }
  if (/violence/.test(scenarioId)) {
    return "Help secure a safe place first, then involve a trustworthy healer, watchman, or household protector without warning the violent person too soon.";
  }
  return "Help me identify who can carry out the plan, what resources it requires, and the first step that can be taken without creating another harm.";
}

function directiveRequirement(state, visit, playerText) {
  const speech = String(playerText).toLowerCase();
  const directsContact = /^(?:yes[,.]?\s*)?(?:please\s+)?(?:speak|talk|go|ask|tell|visit)\b/.test(speech);
  if (!directsContact) return null;
  const mentioned = findMentionedResident(state, speech);
  const related = state.residents.find((resident) => resident.id === visit.issue.relatedPersonId);
  const asksElder = /\b(?:village )?elder\b/.test(speech);
  const official = asksElder
    ? state.residents
      .filter((resident) => resident.active && resident.alive
        && ["reeve", "bailiff"].includes(resident.occupation))
      .sort((left, right) => left.id.localeCompare(right.id))[0]
    : null;
  const target = mentioned || related || official;
  const groupInstruction = String(playerText).match(/\b(?:speak|talk)\s+to\s+((?:others|people|neighbors|families|households)[^.!?]*)/i);
  const returnsLater = /\b(?:then|and)\s+(?:return|come back)\b|\breturn tomorrow\b|\bcome back tomorrow\b/.test(speech);
  let fallbackReply;
  if (asksElder && !mentioned) {
    fallbackReply = official
      ? `I know of no separate village elder with recognized authority, Father. I will speak with ${naturalReference(state, official)} instead${returnsLater ? " and return tomorrow to tell you what was said" : ""}.`
      : "I know of no named village elder, reeve, or bailiff whom I can truthfully promise to contact.";
  } else if (groupInstruction) {
    fallbackReply = `I will speak with ${groupInstruction[1].replace(/[.!?]+$/, "")} as you asked, Father.`;
  } else if (target) {
    fallbackReply = `I will speak with ${naturalReference(state, target)} as you asked${returnsLater ? " and return tomorrow to tell you what was said" : ""}.`;
  } else {
    fallbackReply = "I cannot identify the person you mean, Father. Name them plainly and I will answer whether I can carry the message.";
  }
  return {
    type: "instruction_acknowledgment",
    answerSlots: ["acknowledge_requested_action", ...(returnsLater ? ["return_followup"] : [])],
    requireAll: false,
    minimumMatches: 1,
    requiredTerms: [target?.firstName?.toLowerCase(), "speak", returnsLater ? "return" : ""].filter(Boolean),
    responsePattern: /\b(?:I will|I cannot|I know of no)\b/i,
    fallbackReply,
    followupRequested: returnsLater
  };
}

function fallbackDecisionForProposal(state, person, proposal) {
  const official = state.residents
    .filter((resident) => resident.active && resident.alive
      && ["reeve", "bailiff", "watchman"].includes(resident.occupation))
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (proposal.actionHint === "verify_route") {
    return {
      proposalId: proposal.proposalId,
      status: "accepted",
      reason: "I can ask a trusted traveler to scout the road and report before rumors are treated as fact."
    };
  }
  if (proposal.actionHint === "prepare_evacuation") {
    return {
      proposalId: proposal.proposalId,
      status: "accepted",
      reason: "I can warn my household to pack essentials, but I cannot order every family to abandon home."
    };
  }
  if (proposal.actionHint === "organize_defense") {
    const canLead = ["reeve", "bailiff", "watchman", "soldier"].includes(person.occupation);
    return {
      proposalId: proposal.proposalId,
      status: canLead ? "accepted" : "deferred",
      reason: canLead
        ? "I can help ready a limited watch without claiming to raise an army."
        : `${official ? naturalReference(state, official) : "A lawful local officer"} must authorize and lead any organized defense.`
    };
  }
  if (proposal.actionHint === "contact_person") {
    return {
      proposalId: proposal.proposalId,
      status: "accepted",
      reason: "I can carry a message to a named person I can actually reach."
    };
  }
  if (proposal.actionHint === "pray") {
    return {
      proposalId: proposal.proposalId,
      status: "accepted",
      reason: "I can ask the people involved to pray if they consent, though prayer does not replace practical safety."
    };
  }
  if (proposal.actionHint === "delay_or_ignore") {
    return {
      proposalId: proposal.proposalId,
      status: visitRiskHigh(person) ? "rejected" : "deferred",
      reason: "Ignoring a credible danger may expose households to preventable harm."
    };
  }
  return {
    proposalId: proposal.proposalId,
    status: "deferred",
    reason: "I need to test whether this part is possible, lawful, and within our actual means."
  };
}

function visitRiskHigh(person) {
  return person.stress >= 65 || person.personality.boldness < 35;
}

function compoundTurnRequirement(state, person, turnAnalysis) {
  if (turnAnalysis.proposals.length < 2) return null;
  const decisions = turnAnalysis.proposals.map((proposal) => fallbackDecisionForProposal(state, person, proposal));
  const ordered = [...turnAnalysis.proposals].sort((left, right) => right.priority - left.priority);
  const parts = ordered.map((proposal) => {
    const decision = decisions.find((entry) => entry.proposalId === proposal.proposalId);
    if (decision.status === "accepted") return decision.reason;
    const proposalText = proposal.rawText.replace(/[.!?]+$/, "");
    return `${decision.status === "rejected" ? "I cannot agree to" : "I cannot promise yet to"} ${proposalText}. ${decision.reason}`;
  });
  return {
    type: "compound_turn",
    answerSlots: turnAnalysis.proposals.map((proposal) => proposal.proposalId),
    proposalClauses: turnAnalysis.proposals,
    fallbackDecisions: decisions,
    requireAll: true,
    minimumMatches: turnAnalysis.proposals.length,
    requiredTerms: [],
    responsePattern: null,
    fallbackReply: boundedProse(parts.join(" "), 600)
  };
}

function proposalDecisionQuestionRequirement(visit, playerText) {
  const speech = String(playerText).toLowerCase();
  const asksAccepted = /\bwhich part\b.*\b(?:can|will|accept|do)\b/.test(speech);
  const asksRejected = /\bwhich part\b.*\b(?:refuse|reject|cannot|can't|will not)\b/.test(speech);
  const asksFirst = /\b(?:what|which).{0,20}(?:happen|do|come).{0,10}first\b|\bwhat will happen first\b/.test(speech);
  if (!asksAccepted && !asksRejected && !asksFirst) return null;
  const decisions = new Map(
    (visit.continuity?.visitorDecisions || []).map((decision) => [decision.proposalId, decision])
  );
  const proposals = (visit.continuity?.proposals || [])
    .filter((proposal) => decisions.has(proposal.proposalId))
    .sort((left, right) => right.priority - left.priority);
  if (!proposals.length) return null;
  let selected;
  let fallbackReply;
  if (asksFirst) {
    selected = proposals.find((proposal) => decisions.get(proposal.proposalId).status === "accepted");
    fallbackReply = selected
      ? `First I will act on this: ${selected.rawText.replace(/[.!?]+$/, "")}.`
      : "I have not yet accepted a first action; the proposals remain deferred or refused.";
  } else if (asksRejected) {
    selected = proposals.find((proposal) => decisions.get(proposal.proposalId).status === "rejected");
    if (selected) {
      fallbackReply = `I refuse this part: ${selected.rawText.replace(/[.!?]+$/, "")}. ${decisions.get(selected.proposalId).reason}`;
    } else {
      const deferred = proposals.find((proposal) => decisions.get(proposal.proposalId).status === "deferred");
      fallbackReply = deferred
        ? `I have not rejected every part, but I cannot yet promise this one: ${deferred.rawText.replace(/[.!?]+$/, "")}. ${decisions.get(deferred.proposalId).reason}`
        : "I did not refuse any of the recorded parts.";
    }
  } else {
    const accepted = proposals.filter((proposal) => decisions.get(proposal.proposalId).status === "accepted");
    fallbackReply = accepted.length
      ? `I can do ${accepted.map((proposal) => proposal.rawText.replace(/[.!?]+$/, "")).join("; and ")}.`
      : "I have not yet accepted any part as something I can truly do.";
  }
  return {
    type: "proposal_decision_answer",
    answerSlots: ["prior_proposal_status"],
    requireAll: false,
    minimumMatches: 1,
    requiredTerms: ["first", "refuse", "can", selected?.rawText?.split(/\s+/)[0]?.toLowerCase()].filter(Boolean),
    responsePattern: /\b(?:first|refuse|cannot|can do|not yet accepted|did not refuse)\b/i,
    fallbackReply
  };
}

export function deterministicCompoundFallback(state, person, playerText) {
  const visit = state.currentVisit;
  if (!visit) return null;
  const turnAnalysis = analyzePlayerTurn(playerText, visit.turnsUsed + 1);
  const requirement = compoundTurnRequirement(state, person, turnAnalysis);
  if (!requirement) return null;
  const reactionPreview = previewConversationReaction(state, person, visit, playerText);
  const obligation = selectConversationObligation({
    visit,
    playerText,
    reactionPreview,
    socialRequirement: requirement,
    deterministicSocial: false,
    requiredFacts: clarificationFacts(visit, playerText),
    directAnswer: requirement.fallbackReply,
    scenarioFactIds: (visit.scenarioFacts || []).map((fact) => fact.id),
    turnAnalysis
  });
  return {
    reply: requirement.fallbackReply,
    memory: "The visitor considered each part of the priest's proposal separately.",
    groundedFallback: true,
    structuredFallback: true,
    expressedReaction: reactionPreview.requiredReaction,
    decisions: requirement.fallbackDecisions,
    conversationObligation: obligation,
    promptTrace: boundedPromptTrace({
      obligation,
      prompt: "",
      includedFactIds: obligation.requiredFactIds,
      initialReply: requirement.fallbackReply,
      finalReply: requirement.fallbackReply,
      decisions: requirement.fallbackDecisions,
      mandatoryAnswerPassed: true,
      retryUsed: false,
      route: "compound_turn_fallback",
      responseSource: "framework_static",
      gemmaCalled: false,
      repetitionDetected: false
    })
  };
}

function directSocialRequirement(state, person, visit, playerText, mode) {
  const speech = String(playerText).toLowerCase();
  const correction = /\b(?:that did not answer|that didn't answer|you did not answer|you didn't answer|answer my question)\b/.test(speech);
  if (correction) {
    const priorQuestion = [...visit.history].reverse().find((line) => line.speaker === "priest")?.text || "";
    return householdQuestionRequirement(state, person, visit, priorQuestion)
      || expertQuestionRequirement(state, visit, priorQuestion)
      || {
        type: "answer_repair",
        requireAll: false,
        minimumMatches: 1,
        requiredTerms: ["answer"],
        responsePattern: /\b(?:you asked|the answer is|I do not know|plainly)\b/i,
        fallbackReply: `You are right, Father. You asked: "${priorQuestion.slice(0, 180)}" I do not have a more specific fact than those already stated, and I should have said that plainly instead of changing the subject.`
      };
  }
  const asksAuthorityAndCapacity = /\b(?:authority|responsible|authorize|official)\b/.test(speech)
    && /\b(?:resources|means|afford|provide|work)\b/.test(speech);
  if (!asksAuthorityAndCapacity) {
    const householdRequirement = householdQuestionRequirement(state, person, visit, playerText);
    if (householdRequirement) return householdRequirement;
  }
  const investigationRequirement = investigationQuestionRequirement(state, person, visit, playerText);
  if (investigationRequirement) return investigationRequirement;
  const expertRequirement = expertQuestionRequirement(state, visit, playerText);
  if (expertRequirement) return expertRequirement;
  const locationRequirement = unsupportedLocationRequirement(playerText);
  if (locationRequirement) return locationRequirement;
  const farewell = /\b(?:goodbye|farewell|go with god|god go with you|god be with you|peace be with you|you may go|that will be all)\b/.test(speech);
  if (farewell) {
    const nextStep = (visit.scenarioFacts || []).find((fact) => fact.id === "alternative")?.text;
    return {
      type: "farewell",
      requireAll: false,
      minimumMatches: 1,
      requiredTerms: ["god", "thank", "farewell", "peace"],
      responsePattern: /\b(?:god|thank you|farewell|peace|goodbye)\b/i,
      fallbackReply: nextStep
        ? `Thank you, Father. I will go with your blessing and take the next honest step: ${nextStep}`
        : "Thank you, Father. God keep you. I will go and do what conscience now requires.",
      endsConversation: true
    };
  }
  const guardedDetailQuestion = visit.issue.kind === "confession"
    && !visit.hiddenConcernDisclosed
    && /\b(?:what happened|what did you do|what was your role|tell me plainly|speak plainly|who did it|who is involved|who exactly|other person|when did|where did|who witnessed|what evidence|what proof|how do you know|why should i believe|what might you be mistaken|what do you still not know|what observation|test the claim|temporary action|prevents? harm|exact decision|what decision|need me to decide|personally do first|what will you do when|honestly commit|commit to)\b/.test(speech);
  if (guardedDetailQuestion) {
    return {
      type: "guarded_disclosure",
      requireAll: false,
      minimumMatches: 1,
      requiredTerms: ["not ready", "afraid", "tell"],
      responsePattern: /\b(?:not ready|afraid to say|hard to say|need a moment|will tell you)\b/i,
      fallbackReply: "I will tell you, Father, but I need a moment before I can name the act plainly. I am afraid of what follows once the truth is spoken aloud."
    };
  }
  const asksExactDecision = /\b(?:state|tell|say).{0,25}exact decision|\bwhat decision\b|\bwhat do you need me to decide\b|\bone sentence\b.*\bdecision\b/.test(speech);
  if (asksExactDecision) {
    return {
      type: "exact_decision",
      requireAll: false,
      minimumMatches: 1,
      requiredTerms: ["advice", "should", "choice"],
      responsePattern: /\b(?:should i|the choice is|need your advice|need you to decide)\b/i,
      fallbackReply: adviceQuestion(visit, person)
    };
  }
  const asksPersonalFirstStep = /\b(?:what can you personally do first|what can you do first today|what will you do first|what is your first step)\b/.test(speech);
  if (asksPersonalFirstStep) {
    const alternative = (visit.scenarioFacts || []).find((fact) => fact.id === "alternative")?.text;
    const capacity = (visit.scenarioFacts || []).find((fact) => fact.id === "capacity")?.text;
    const course = normalizeAdvicePhrase(alternative || "seek one safe and honest next step")
      .replace(/[.!?]+$/, "")
      .replace(/^([A-Z])/, (letter) => letter.toLowerCase());
    return {
      type: "first_step",
      requireAll: false,
      minimumMatches: 1,
      requiredTerms: keywordsForRequirement(course),
      responsePattern: /\b(?:first|begin|start|I will|I can)\b/i,
      fallbackReply: `First, I can ${course}. ${capacity ? spokenScenarioFact(capacity, state, person) : ""}`.trim()
    };
  }
  const asksCooperationAndAuthority = /\bwho\b.*\b(?:cooperate|agree|help|participate)\b.*\b(?:authority|authorize|order|approve|decide)|\bwho\b.*\b(?:authority|authorize|order|approve|decide)\b/.test(speech);
  if (asksCooperationAndAuthority) {
    const participants = (visit.scenarioFacts || []).find((fact) => fact.id === "participants")?.text;
    const authority = (visit.scenarioFacts || []).find((fact) => fact.id === "authority")?.text;
    return {
      type: "cooperation_authority",
      requireAll: false,
      minimumMatches: 1,
      requiredTerms: ["reeve", "steward", "magistrate", "watch", "household", "people"],
      responsePattern: /\b(?:reeve|steward|magistrate|watch|household|must cooperate|must agree)\b/i,
      fallbackReply: [participants, authority]
        .filter(Boolean)
        .map((fact) => spokenScenarioFact(fact, state, person))
        .join(" ")
    };
  }
  const asksStrongestRisk = /\b(?:strongest|greatest|main|largest).{0,20}(?:risk|danger)|\bhow (?:can|could|do) we reduce (?:it|the risk)\b/.test(speech);
  if (asksStrongestRisk) {
    const constraints = (visit.scenarioFacts || []).find((fact) => fact.id === "constraints")?.text;
    const stakes = (visit.scenarioFacts || []).find((fact) => fact.id === "stakes")?.text;
    return {
      type: "strongest_risk",
      requireAll: false,
      minimumMatches: 1,
      requiredTerms: ["risk", "safety", "authority", "retaliation", "livelihood"],
      responsePattern: /\b(?:risk|danger|retaliation|safety|livelihood|reduce)\b/i,
      fallbackReply: [constraints, stakes]
        .filter(Boolean)
        .map((fact) => spokenScenarioFact(fact, state, person))
        .join(" ")
    };
  }
  const asksDepartureCommitment = /\b(?:tell me plainly )?what (?:will you|you will) do when you leave (?:the )?(?:church|meeting)|\bwhat are you going to do when you leave\b/.test(speech);
  if (asksDepartureCommitment) {
    const agreement = visit.continuity.agreements.at(-1)?.text;
    const alternative = (visit.scenarioFacts || []).find((fact) => fact.id === "alternative")?.text;
    const course = normalizeAdvicePhrase(alternative || "take the first safe and honest step")
      .replace(/[.!?]+$/, "")
      .replace(/^([A-Z])/, (letter) => letter.toLowerCase());
    return {
      type: "departure_commitment",
      requireAll: false,
      minimumMatches: 1,
      requiredTerms: ["will", "first", "begin"],
      responsePattern: /\b(?:I will|I shall|first I|I am going to)\b/i,
      fallbackReply: agreement || `I will begin by trying to ${course}.`
    };
  }
  const asksVoluntaryCommitment = /\b(?:free to disagree|honestly commit|what course can you commit|what can you commit to)\b/.test(speech);
  if (asksVoluntaryCommitment) {
    const agreement = visit.continuity.agreements.at(-1)?.text;
    const alternative = (visit.scenarioFacts || []).find((fact) => fact.id === "alternative")?.text;
    const course = normalizeAdvicePhrase(alternative || "take one safe and honest next step")
      .replace(/[.!?]+$/, "")
      .replace(/^([A-Z])/, (letter) => letter.toLowerCase());
    return {
      type: "voluntary_commitment",
      requireAll: false,
      minimumMatches: 1,
      requiredTerms: ["will", "can", "commit"],
      responsePattern: /\b(?:I will|I can|I commit|I intend)\b/i,
      fallbackReply: agreement || `I can honestly commit to trying to ${course}.`
    };
  }
  const sharedPrayer = /\b(?:let us pray|let's pray|we (?:shall|will) pray|join me in prayer|i will pray with you|amen\b|(?:god|lord|father in heaven)[,\s]+please)\b/.test(speech);
  if (sharedPrayer) {
    return {
      type: "shared_prayer",
      requireAll: false,
      minimumMatches: 1,
      requiredTerms: ["amen", "pray", "thank"],
      responsePattern: /\b(?:amen|thank you|pray|god hear|lord hear)\b/i,
      fallbackReply: "Amen, Father. Thank you for praying with me and for naming this burden before God. I will hold to the honest course we discussed."
    };
  }
  const asksWhoMustAgree = /\bwho\b.*\b(?:must|needs? to|has to)\b.*\b(?:agree|approve|consent|permit)|\bwhose\b.*\b(?:agreement|approval|consent|permission)\b/.test(speech);
  if (asksWhoMustAgree) {
    const factText = (visit.scenarioFacts || []).map((fact) => fact.text).join(" ");
    const named = state.residents
      .filter((resident) => factText.toLowerCase().includes(resident.name.toLowerCase()))
      .map((resident) => naturalReference(state, resident));
    const roles = [...new Set(
      (factText.toLowerCase().match(/\b(?:households?|witnesses?|clerk|reeve|watch|midwife|family|creditor|apprentice|official|steward|magistrate)\b/g) || [])
    )];
    const participants = [...new Set([...named, ...roles])].slice(0, 5);
    const alternative = (visit.scenarioFacts || []).find((fact) => fact.id === "alternative")?.text;
    return {
      type: "feasibility_people",
      requireAll: false,
      minimumMatches: 1,
      requiredTerms: participants,
      responsePattern: /\b(?:must agree|need agreement|need consent|must consent|would need)\b/i,
      fallbackReply: participants.length
        ? `${participants.join(", ")}${participants.length > 1 ? " must agree or cooperate" : " must agree"} before the plan can work. ${alternative || ""}`.trim()
        : `The people directly affected and whoever has lawful authority over the decision must agree before it can work. ${alternative || ""}`.trim()
    };
  }
  const mentionedPerson = findMentionedResident(state, speech);
  const mentionedReference = mentionedPerson ? naturalReference(state, mentionedPerson) : "";
  const relatedPerson = state.residents.find((resident) => resident.id === visit.issue.relatedPersonId);
  const asksAnonymousIdentity = relatedPerson
    && /\bwho (?:is|was) (?:the |that |this )?(?:man|woman|person|fugitive|refugee|apprentice|watchman|creditor|master|victim)\b/.test(speech);
  if (asksAnonymousIdentity) {
    return {
      type: "related_identity",
      requireAll: true,
      minimumMatches: 2,
      requiredTerms: [relatedPerson.firstName.toLowerCase(), relatedPerson.surname.toLowerCase()],
      fallbackReply: `${relatedPerson.name}, Father. That is the person I mean.`
    };
  }
  const asksFullName = mentionedPerson
    && /\b(?:full|whole|complete)\s+name\b|\bwhat is .{0,25} name\b/.test(speech);
  if (asksFullName) {
    return {
      type: "full_name_request",
      requireAll: true,
      minimumMatches: 2,
      requiredTerms: [mentionedPerson.firstName.toLowerCase(), mentionedPerson.surname.toLowerCase()],
      fallbackReply: `${mentionedPerson.name}, Father. That is the full name.`
    };
  }
  const identityQuestion = mentionedPerson
    && /\b(?:same person|same man|same woman|one and the same|aren't .* the same|are not .* the same)\b/.test(speech);
  if (identityQuestion) {
    const titleMatch = speech.match(/\b(master|mistress|lord|lady|steward|bailiff)\s+[a-z'-]+\b/);
    const titledReference = titleMatch
      ? `${titleMatch[1][0].toUpperCase()}${titleMatch[1].slice(1)} ${mentionedPerson.surname}`
      : mentionedPerson.surname;
    return {
      type: "identity_check",
      requireAll: true,
      minimumMatches: 2,
      requiredTerms: [mentionedPerson.firstName.toLowerCase(), mentionedPerson.surname.toLowerCase()],
      fallbackReply: `Yes, Father. ${mentionedPerson.firstName} and ${titledReference} are the same person. I meant that I fear confronting ${mentionedPerson.firstName} directly, not that there are two different people.`
    };
  }
  const asksForSummons = mentionedPerson
    && /\b(?:send (?:him|her)|tell .{0,35} to come|ask .{0,35} to come|have .{0,35} come|come (?:talk|speak) to me|come see me)\b/.test(speech);
  if (asksForSummons) {
    return {
      type: "summon_request",
      requireAll: true,
      minimumMatches: 2,
      requiredTerms: [mentionedPerson.firstName.toLowerCase(), "come"],
      responsePattern: new RegExp(`\\b(?:tell|ask|send)\\b.*\\b${mentionedPerson.firstName}\\b|\\b${mentionedPerson.firstName}\\b.*\\bcome\\b`, "i"),
      fallbackReply: `I will tell ${mentionedReference} that you have asked to speak with them, Father, and I will ask them to come to the church.`
    };
  }
  const offersIntervention = /\b(?:could|can|shall|should|may|would)\s+i\s+(?:talk|speak|meet|write)\s+(?:to|with)?\s*/.test(speech);
  if (mentionedPerson && offersIntervention) {
    const supportingFact = (visit.scenarioFacts || []).find((fact) => (
      String(fact.text).toLowerCase().includes(mentionedPerson.name.toLowerCase())
    ));
    return {
      type: "priest_intervention",
      requireAll: true,
      minimumMatches: 2,
      requiredTerms: [mentionedPerson.firstName.toLowerCase(), "speak"],
      responsePattern: new RegExp(`\\b${mentionedPerson.firstName}\\b.*\\b(?:speak|talk|meet|ask|show|bring)\\b|\\b(?:speak|talk|meet|ask|show|bring)\\b.*\\b${mentionedPerson.firstName}\\b`, "i"),
      fallbackReply: `Yes, Father. Speak with ${mentionedReference}, but ask for the facts plainly before naming me as the source. ${supportingFact?.text || "A private meeting may resolve this without widening the dispute."}`
    };
  }
  const asksForMoreHelp = /\b(?:anything else|what else|any other way)\b/.test(speech);
  const explicitlyInvitesNewTopic = /\b(?:else you wish to discuss|another matter|something else|other concern|different matter)\b/.test(speech);
  const currentMatterHelp = asksForMoreHelp && !explicitlyInvitesNewTopic && (
    /\b(?:can i help|could i help|help with|help here|help with this|do here|do about this|for this matter|help (?:convince|persuade)|deal with|resolve this)\b/.test(speech)
    || Boolean(mentionedPerson)
  );
  if (currentMatterHelp) {
    const alternative = (visit.scenarioFacts || []).find((fact) => fact.id === "alternative")?.text;
    const alternativeKeywords = (String(alternative || "").toLowerCase().match(/[a-z]{5,}/g) || [])
      .filter((keyword) => !["father", "should", "would", "could", "their", "there"].includes(keyword))
      .slice(0, 3);
    const alternativeAlreadyDiscussed = alternative && visit.counsel.some((line) => (
      alternativeKeywords.some((keyword) => line.toLowerCase().includes(keyword))
    ));
    return {
      type: "current_matter_help",
      requireAll: false,
      minimumMatches: 1,
      requiredTerms: ["also", "could", "help"],
      responsePattern: /\b(?:you could also|another way|what would help|please|speak with|ask|bring|gather)\b/i,
      fallbackReply: mentionedPerson
        ? `Yes, Father. When you approach ${mentionedReference}, bring the evidence and ask for a direct answer rather than relying on persuasion alone. ${alternative || "That would help keep this matter focused on facts instead of fear."}`
        : alternative && !alternativeAlreadyDiscussed
          ? `There is one more way you could help with this matter, Father: ${alternative}`
          : additionalCurrentMatterHelp(visit)
    };
  }
  const openInvitation = explicitlyInvitesNewTopic || (asksForMoreHelp && !currentMatterHelp);
  if (openInvitation) {
    const household = state.households.find((entry) => entry.id === person.householdId);
    const spouse = state.residents.find((entry) => entry.id === person.spouseId);
    const child = state.residents.find((entry) => person.childrenIds?.includes(entry.id) && entry.active && entry.alive);
    const rumor = state.rumors.find((entry) => entry.active && entry.heardByIds.includes(person.id));
    const topics = [
      child && `There is one other thing, Father. ${child.name} has been troubled lately, and I do not know whether it is illness, fear, or something the child will not tell me.`,
      spouse && `There is another matter. ${spouse.name} and I have been speaking past one another, and I fear this dispute will follow me home.`,
      household?.debt > 5 && `There is one other concern: our household owes ${Math.round(household.debt)} measures of debt, and the next payment may cost us food.`,
      household?.food < 30 && `There is another matter, Father. Our household food stores are low enough that I am already counting the days until the next market.`,
      person.illness && `Yes. I have concealed that I am suffering from ${person.illness}, because I fear losing work if others know.`,
      rumor && `There is another matter. I heard a rumor that ${rumor.claim.toLowerCase()}, and I do not know whether repeating it would warn someone or merely spread harm.`,
      `There is one other thing, Father. I have been neglecting prayer, not from disbelief, but because I am ashamed to ask for help only when I am afraid.`,
      `No, Father. That is all I wished to discuss today. Thank you for hearing me plainly.`
    ].filter(Boolean);
    let hash = 2166136261;
    for (const character of `${state.seed}:${person.id}:${visit.visitId}:${visit.turnsUsed}`) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    const closes = visit.turnsUsed >= 8 || (hash >>> 0) % 4 === 0;
    const fallbackReply = closes ? topics.at(-1) : topics[(hash >>> 0) % Math.max(1, topics.length - 1)];
    return {
      type: "open_invitation",
      requireAll: false,
      minimumMatches: 1,
      requiredTerms: closes ? ["no", "all"] : ["other", "another", "yes"],
      responsePattern: closes
        ? /\b(?:no|nothing else|that is all|all i wished)\b/i
        : /\b(?:yes|there is|one other|another matter|another concern)\b/i,
      fallbackReply
    };
  }
  const asksHowToHelp = /\b(?:so )?(?:how can i help|what help do you need|what do you need from me|what advice do you want|what are you asking me to advise|what do you want me to tell you)\b/.test(speech);
  if (asksHowToHelp) {
    return {
      type: "help_request",
      requireAll: false,
      minimumMatches: 1,
      requiredTerms: ["advice", "should", "help", "need"],
      responsePattern: /\b(?:should i|do you advise me to|help me decide whether|tell me whether)\b/i,
      fallbackReply: adviceQuestion(visit, person)
    };
  }
  const churchTransfer = parseChurchTransferIntent(playerText);
  if (churchTransfer) {
    const resource = churchResourceRows(state.churchResources)
      .find((entry) => entry.key === churchTransfer.resource);
    const household = state.households.find((entry) => entry.id === person.householdId);
    const canGive = churchTransfer.direction === "outgoing"
      ? (resource?.amount || 0) >= churchTransfer.amount
      : churchTransfer.resource === "coin"
        ? (household?.wealth || 0) >= churchTransfer.amount
        : churchDonationCapacity(state, person, churchTransfer.resource) >= churchTransfer.amount;
    return {
      type: churchTransfer.direction === "outgoing" ? "church_aid" : "church_donation",
      requireAll: false,
      minimumMatches: 1,
      requiredTerms: [churchTransfer.resource, canGive ? "thank" : "cannot"],
      responsePattern: canGive
        ? /\b(?:thank|yes|i will|i can|gladly|grateful)\b/i
        : /\b(?:cannot|not enough|unable|have none|do not have)\b/i,
      fallbackReply: canGive
        ? churchTransfer.direction === "outgoing"
          ? `Thank you, Father. ${quantityPhrase(churchTransfer.amount, resource?.unit || churchTransfer.resource)} from the church will give my household immediate relief.`
          : `Yes, Father. I can give ${quantityPhrase(churchTransfer.amount, resource?.unit || churchTransfer.resource)} to the church for those in greater need.`
        : churchTransfer.direction === "outgoing"
          ? `Father, the church does not have enough ${resource?.label.toLowerCase() || churchTransfer.resource} remaining to give that amount.`
          : `I cannot honestly promise that donation; my household does not have enough to spare.`
    };
  }
  const offer = speech.match(/\b(?:would you like|do you want|may i offer|can i offer)\b.*\b(cheese|bread|food|ale|water|coin)\b/);
  if (offer) {
    const item = offer[1];
    const household = state.households.find((entry) => entry.id === person.householdId);
    const accepts = (household?.food ?? 50) < 75 || person.personality?.traits?.includes("generous");
    return {
      type: "offer",
      requireAll: true,
      minimumMatches: 2,
      item,
      requiredTerms: [item, accepts ? "yes" : "no"],
      fallbackReply: mode.includes("humorous")
        ? accepts
          ? `Yes, Father. If wisdom is slow today, perhaps a little ${item} will reach me first.`
          : `No, thank you. If I eat more ${item}, I may confess only to gluttony.`
        : accepts
          ? `Yes, Father, thank you. I would gladly take a little ${item}.`
          : `No, thank you, Father. I have no need of ${item} just now.`
    };
  }
  const ownTrade = /\b(?:start|open|build|run)\s+(?:your\s+)?own\s+(?:trade|business|shop|workshop)\b|\bwork for yourself\b/.test(speech);
  if (ownTrade) {
    const household = state.households.find((entry) => entry.id === person.householdId);
    const canAttempt = person.personality.boldness >= 55 && (household?.wealth ?? 0) >= 35;
    const alternative = (visit.scenarioFacts || []).find((fact) => fact.id === "alternative")?.text;
    return {
      type: "independent_trade",
      requireAll: true,
      minimumMatches: 2,
      requiredTerms: ["trade", canAttempt ? "could" : "tools"],
      fallbackReply: mode.startsWith("outrageous")
        ? `My own trade? I could paint a sign tonight, crown myself master by dawn, and sell holy cheese by noon—but in truth I still need tools, coin, and customers.`
        : mode.includes("humorous")
          ? `My own trade would be cleaner in conscience, though at present my workshop consists of two hands and one optimistic stool. I would still need tools and coin.`
          : canAttempt
            ? `I could try to establish my own ${person.occupation} trade. ${alternative || "I have some standing and coin, though I would need tools, customers, and several months before it fed the household."}`
            : `My own trade might avoid the harm, but I do not yet have the tools or coin to begin it. ${alternative || "I would need a lender, an honest partner, or time to save."}`
    };
  }
  const advice = /\b(?:you should|you must|i advise you to|why don't you|why not|consider)\b/.test(speech);
  if (advice) {
    const trusts = person.trustPriest >= 60;
    const adviceParts = [];
    if (/\b(?:obey|lawful|order)\b/.test(speech)) adviceParts.push("obey the lawful order");
    if (/\b(?:church|help|aid)\b.*\b(?:hungry|poor|need)\b|\b(?:hungry|poor|need)\b.*\b(?:church|help|aid)\b/.test(speech)) {
      adviceParts.push("ask the church to help the hungry households");
    }
    const joinMatch = speech.match(/\b(?:ask|invite)\s+([a-z'-]+)\s+to\s+join\b/);
    if (joinMatch) adviceParts.push(`ask ${joinMatch[1]} to join the work`);
    else if (/\b(?:split|share|join|partner)\b/.test(speech)) adviceParts.push("propose sharing the work");
    if (/\b(?:refuse|decline|reject)\b/.test(speech)) adviceParts.push("refuse the harmful offer");
    if (/\b(?:start|open|run)\b.*\b(?:trade|business|workshop)\b/.test(speech)) adviceParts.push("start an independent trade");
    if (!joinMatch && /\b(?:speak|talk|ask)\b.*\b(?:hemlock|other|neighbor|victim)\b/.test(speech)) adviceParts.push("speak directly with the other person");
    if (/\bpray\b/.test(speech)) adviceParts.push("pray about the decision");
    else if (/\bforgive\b/.test(speech)) adviceParts.push("forgive the person who wronged you");
    else if (/\bconfess\b/.test(speech)) adviceParts.push("confess the truth");
    else if (/\bapologize\b/.test(speech)) adviceParts.push("apologize and make amends");
    const extracted = speech
      .replace(/^.*?\b(?:you should|you must|i advise you to|why don't you|why not|consider)\b/, "")
      .split(/[.;!?]/)[0]
      .trim()
      .split(/\s+/)
      .slice(0, 10)
      .join(" ");
    const proposedAction = adviceParts.slice(0, 2).join(" and also ")
      || normalizeAdvicePhrase(extracted)
      || "take that course";
    const adviceTerms = (proposedAction.match(/[a-z]{3,}/g) || [])
      .filter((word) => !["the", "and", "you", "him", "her", "should", "would", "could", "about", "their", "there"].includes(word))
      .slice(0, 2);
    return {
      type: "advice",
      requireAll: false,
      minimumMatches: Math.min(2, adviceTerms.length),
      requiredTerms: adviceTerms,
      proposedAction,
      fallbackReply: mode === "defensive"
        ? `I understand: you want me to ${proposedAction}. I can try, but I still need to know how my household survives if the plan fails.`
        : trusts
          ? `I will try to ${proposedAction}, Father. Tell me what help I may honestly rely upon if the cost becomes more than my household can bear.`
          : `I understand your counsel: ${proposedAction}. I cannot promise it yet, but I can test the first step without pretending the risk is gone.`
    };
  }
  return null;
}

function responseMode(state, person, visit) {
  const source = `${state.seed}:${visit.visitId}:${visit.turnsUsed}:${person.id}`;
  let hash = 2166136261;
  for (const character of source) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const normal = ["candid", "practical", "skeptical", "grateful", "defensive", "emotional"];
  if (visit.eventLicense === "outrageous" && (hash >>> 0) % 4 === 0) return "outrageous but still grounded in the supplied facts";
  if (visit.eventLicense !== "ordinary" && (hash >>> 0) % 3 === 0) return "dryly humorous";
  return normal[(hash >>> 0) % normal.length];
}

function departureActionHints(visit) {
  const text = `${visit.counsel.join(" ")} ${visit.history.map((line) => line.text).join(" ")} ${(visit.scenarioFacts || []).find((fact) => fact.id === "alternative")?.text || ""}`.toLowerCase();
  const hints = [];
  const add = (...actions) => {
    for (const action of actions) if (!hints.includes(action)) hints.push(action);
  };
  if (/\breturn\b.*\b(?:grain|flour|goods|coin|money|stolen)\b/.test(text)) add("return_stolen_goods");
  if (/\b(?:appeal|receipt|evidence|witness|report|magistrate|reeve|tax)\b/.test(text)) add("report_crime", "testify", "write_letter");
  if (/\b(?:speak|talk|meet|confront|ask)\b/.test(text)) add("visit");
  if (/\b(?:protect|safe|shelter|violence|injur)\b/.test(text)) add("protect", "shelter");
  if (/\b(?:scout|verify|check|inspect)\b.*\b(?:road|route)\b/.test(text)) add("verify_route");
  if (/\b(?:prepare|pack|ready)\b.*\b(?:leave|flee|evacuat)\b/.test(text)) add("prepare_evacuation");
  if (/\b(?:prepare|organize|ready)\b.*\b(?:defend|defense|guard|watch|men)\b/.test(text)) add("organize_defense");
  if (/\b(?:food|bread|grain|hungry|charity|aid)\b/.test(text)) add("share_food", "organize_aid", "donate");
  if (/\b(?:forgive|reconcile|peace|apolog)\b/.test(text)) add("forgive", "reconcile", "apologize", "make_peace");
  if (/\b(?:work|job|trade|apprentice)\b/.test(text)) add("work_harder", "offer_work", "refuse_work");
  if (/\b(?:pray|faith|repent|confess)\b/.test(text)) add("pray_with", "repent");
  if (/\b(?:invite|newcomer|refugee|settle)\b/.test(text)) add("invite_migrant");
  add("visit", "advise", "make_peace", "attend_church", "improvise");
  return hints.slice(0, 10);
}

function repetitionScore(first, second) {
  const words = (value) => new Set(String(value).toLowerCase().match(/[a-z]{4,}/g) || []);
  const left = words(first);
  const right = words(second);
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((word) => right.has(word)).length;
  return overlap / Math.min(left.size, right.size);
}

function reactionFallbackReply(person, preview) {
  const name = person.firstName;
  return {
    amused: `${name} gives a startled laugh. "That is a strange way to put it, Father, but I understand you are trying to help."`,
    confused: `"I am losing the thread, Father. Please answer the matter before us plainly."`,
    emotionally_affected: `${name}'s voice tightens. "That has struck more deeply than you may realize, Father."`,
    challenge: `"No, Father. I cannot let that pass as though it were ordinary counsel. Explain why you have spoken to me that way."`,
    set_boundary: `"Stop, Father. I will continue only if you speak without mockery, threats, or humiliation."`,
    cry: `${name}'s voice breaks, and tears come despite an effort to remain composed. "I cannot bear much more of this."`,
    withdraw: `${name} looks away. "I do not wish to answer further while you speak to me this way."`,
    leave: `${name} rises. "This meeting is over, Father. I will not remain here for more of this."`,
    call_for_help: `${name} moves toward the door and calls into the church for assistance.`,
    threaten_priest: `${name} stands abruptly. "Do not threaten or humiliate me again, Father. I will defend myself if you continue."`,
    attack_priest: `${name}'s anger breaks into sudden violence, and the visitor lunges toward the priest.`
  }[preview.requiredReaction] || `"I hear you, Father."`;
}

const HARD_MECHANICAL_REACTIONS = new Set([
  "leave",
  "call_for_help",
  "threaten_priest",
  "attack_priest"
]);

function firstSentence(value, maximum) {
  const text = String(value || "").trim();
  const match = text.match(/^[^.!?]+[.!?]?/);
  const chosen = (match ? match[0] : text).trim();
  return chosen.length > maximum ? `${chosen.slice(0, maximum - 1).trim()}…` : chosen;
}

function emotionalStateWords(visit) {
  const reaction = visit.reactionState || {};
  const words = [];
  if (reaction.anger >= 55) words.push("angry");
  else if (reaction.anger >= 30) words.push("irritated");
  if (reaction.fear >= 55) words.push("frightened");
  else if (reaction.fear >= 30) words.push("uneasy");
  if (reaction.sadness >= 45) words.push("grieving");
  if (reaction.shame >= 45) words.push("ashamed");
  if (reaction.confusion >= 45) words.push("struggling to follow the priest");
  if (reaction.offense >= 45) words.push("offended by something the priest said");
  if (reaction.perceivedDanger >= 55) words.push("afraid of what may happen to you");
  if (reaction.trust >= 68) words.push("trusting toward this priest");
  else if (reaction.trust <= 25) words.push("guarded toward this priest");
  if (reaction.willingnessToContinue <= 30) words.push("nearly ready to end this conversation");
  return words.length ? words : ["composed"];
}

const SOFT_REACTION_GUIDANCE = {
  amused: "Something the priest said struck you as absurd or funny; let that show.",
  confused: "You genuinely did not follow the priest's meaning; say so and ask.",
  emotionally_affected: "The priest's words landed hard; let the feeling show.",
  challenge: "You will not let the priest's last words pass unchallenged.",
  set_boundary: "You need to tell the priest plainly what you will not accept before continuing.",
  cry: "You are overcome and your voice breaks.",
  withdraw: "You no longer wish to answer freely while the priest speaks this way."
};

function compactHistorySummary(history, keepRecent, maximumChars = 620) {
  const older = history.slice(0, Math.max(0, history.length - keepRecent));
  if (!older.length) return "";
  const lines = older.map((line) => (
    `${line.speaker === "priest" ? "Priest" : "You"}: ${firstSentence(line.text, 105)}`
  ));
  const joined = lines.join(" | ");
  return joined.length > maximumChars ? `…${joined.slice(-maximumChars)}` : joined;
}

function conversationIntensity(visit) {
  const reaction = visit.reactionState || {};
  const heat = Math.max(0, (reaction.anger || 0) * 0.4 + (reaction.offense || 0) * 0.35
    + (reaction.fear || 0) * 0.15 + (reaction.perceivedDanger || 0) * 0.1) / 100;
  if (heat < 0.18) return "calm and ordinary. No speeches, no accusations, no dramatics.";
  if (heat < 0.38) return "civil but pointed. One edge at most.";
  if (heat < 0.62) return "openly unhappy. You may reproach the priest, but not insult him.";
  return "angry, and entitled to be. Plain accusation is in character.";
}

function knownPeopleForPrompt(state, person, visit, limit = 14) {
  const seen = new Set([person.id]);
  const rows = [];
  const push = (resident) => {
    if (!resident || seen.has(resident.id) || !resident.active || !resident.alive) return;
    seen.add(resident.id);
    /* Age and sex travel with the name. Without them the model guessed, and a
       newborn girl was described in one conversation as the man a woman loved
       and in the next as a seven-year-old orphan. */
    const years = Number.isFinite(resident.age) ? `${resident.age}` : "?";
    const sex = resident.sex === "female" ? "f" : "m";
    rows.push(`${naturalReference(state, resident)} (${resident.occupation}, ${sex}, aged ${years})`);
  };
  push(state.residents.find((resident) => resident.id === visit.issue.relatedPersonId));
  const thread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
  for (const subjectId of thread?.subjectIds || []) {
    push(state.residents.find((resident) => resident.id === subjectId));
  }
  /* The people under this visitor's own roof. Without them the model has no
     real name for a wife, a brother, or a grown child, and it will cheerfully
     invent one rather than leave the sentence unfinished. */
  for (const resident of state.residents) {
    if (rows.length >= limit) break;
    if (resident.householdId === person.householdId) push(resident);
  }
  for (const relationId of person.relationshipIds || []) {
    if (rows.length >= limit) break;
    push(state.residents.find((resident) => resident.id === relationId));
  }
  for (const resident of state.residents) {
    if (rows.length >= limit) break;
    if (resident.active && resident.alive && ["reeve", "bailiff", "watchman", "clerk"].includes(resident.occupation)) {
      push(resident);
    }
  }
  return rows.slice(0, limit);
}

/* Villagers the model invented.

   The parish has exactly two hundred people and every one of them is named
   before the game begins. When the model needs a person the prompt did not
   supply - "the other two workers", a sick neighbour, an apprentice - it will
   invent a name rather than leave the sentence unfinished, and the priest then
   repeats that name back as though it were a real parishioner. In one watched
   run a man called Thomas was discussed twenty-eight times and existed
   nowhere in the village.

   This finds name-shaped words belonging to nobody. It deliberately errs
   towards silence: a capitalised word is only suspected if it is never used in
   lowercase anywhere in the same text, which clears ordinary sentence openers
   like "Did" or "Forgive" without needing a dictionary of English. */
const NON_NAME_CAPITALS = new Set([
  "Father", "God", "Lord", "Christ", "Jesus", "Saint", "Amen", "Sunday", "Monday",
  "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Church", "Mass",
  "Advent", "Lent", "Easter", "Christmas", "Michaelmas", "Candlemas", "Whitsun",
  "Scripture", "Gospel", "Commandment", "Heaven", "Hell", "Almighty", "Blessed",
  "King", "Queen", "Bishop", "Abbot", "Prior", "Reeve", "Bailiff", "Watchman",
  "Constable", "Steward", "Sheriff", "Clerk", "Master", "Mistress", "Goodwife",
  "Goodman", "Widow", "Mother", "Father", "Brother", "Sister", "Uncle", "Aunt",
  /* Capitalised mid-sentence but never anyone's name. */
  "Him", "Himself", "Her", "Herself", "Them", "Themselves", "His", "Hers",
  "Old", "Man", "Woman", "Christian", "Latin", "English",
  /* Determiners and connectives that can follow a colon or dash mid-line and
     so escape the sentence-start test. A villager saying "There is more: The
     marriage would cancel four pennies" was being told The is nobody here. */
  "The", "This", "That", "These", "Those", "There", "Then", "Thus", "Their",
  "Such", "Some", "Any", "All", "Both", "Each", "Every", "Neither", "Either",
  /* Months and seasons. A villager dating a fever to "the month of April" was
     being told April is nobody who lives here. */
  "January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December",
  "Spring", "Summer", "Autumn", "Winter", "Harvest", "Michaelmastide"
]);

/* The people this villager may name, and nobody else.

   The parish is a closed population, so the surest way to stop the model
   inventing a neighbour is to hand it the actual cast before it writes a word.
   Each entry carries what a speaker would need in order not to contradict the
   record - sex, age, trade, and how they stand to the speaker - because the
   inventions that did most damage were the ones that got those wrong: a
   newborn girl spoken of as a grown man, a seven-year-old invented out of an
   infant.

   The departed appear only where this person is actually connected to them,
   which is what lets somebody speak of a buried husband or child by name
   without reaching for a stranger. */
/* The plain facts of a villager's family.
 *
 * Pressed to name his wife, a sixty-year-old widower with four grown children
 * and no spouse at all invented one, because nothing had told him he had none.
 * He then repeated the invention five times under questioning. A person knows
 * whether they are married; saying so removes the need to make anything up.
 */
function householdTruthLine(state, person) {
  const spouse = person.spouseId
    ? state.residents.find((resident) => resident.id === person.spouseId)
    : null;
  const late = person.widowedFromId
    ? state.residents.find((resident) => resident.id === person.widowedFromId)
    : null;
  const children = (person.childrenIds || [])
    .map((id) => state.residents.find((resident) => resident.id === id))
    .filter((child) => child && child.alive !== false);
  const parts = [];
  if (spouse) parts.push(`You are married to ${spouse.firstName}.`);
  else if (late) parts.push(`You are widowed. ${late.firstName} died, and you have no wife or husband now.`);
  else parts.push("You have no wife or husband. You are not married and never speak as though you were.");
  parts.push(children.length
    ? `Your children are ${children.map((child) => child.firstName).join(", ")}, and you have no others.`
    : "You have no children.");
  return `THE TRUTH OF YOUR HOUSEHOLD: ${parts.join(" ")}`;
}

/* What one villager is to another, derived from the parish record.
 *
 * The reviewer's point: identities, ages, kinship and trades should come from
 * state and never from free generation. This is that, for kinship. A woman was
 * asked what kin a neighbour was to her and answered "she is my neighbour" -
 * when the record had the woman down as her mother, in the same household.
 * The roster knew, but it labelled her "the person this matter concerns" and
 * the kinship was never mentioned, because the first label won.
 *
 * So the relation is computed rather than assigned, and it travels with the
 * name every time the name appears.
 */
export function kinshipTo(state, person, other) {
  if (!person || !other || person.id === other.id) return null;
  const female = other.sex === "female";
  const mineParents = new Set(person.parentIds || []);
  const mineChildren = new Set([...(person.childrenIds || []), ...(person.lostChildIds || [])]);
  /* Several kin links are stored on one side only, and it is rarely the side
     of the living villager doing the speaking: a buried parent keeps
     childrenIds while the surviving child's parentIds is never updated, and a
     villager widowed during play has spouseId cleared. Reading only the
     speaker's own fields had the roster assert that a widow's buried husband
     was merely "of your household" - and then reject her when she called him
     her husband. Both directions are consulted. */
  const otherParents = new Set(other.parentIds || []);
  const otherChildren = new Set([...(other.childrenIds || []), ...(other.lostChildIds || [])]);

  if (person.spouseId === other.id || other.spouseId === person.id) {
    return female ? "your wife" : "your husband";
  }
  if (person.widowedFromId === other.id || other.survivingSpouseId === person.id) {
    return female ? "your late wife" : "your late husband";
  }
  if (mineParents.has(other.id) || otherChildren.has(person.id)) {
    return female ? "your mother" : "your father";
  }
  if (mineChildren.has(other.id) || otherParents.has(person.id)) {
    return other.alive === false
      ? (female ? "your daughter, who died" : "your son, who died")
      : (female ? "your daughter" : "your son");
  }
  /* Sharing a parent makes them siblings, which the record never states
     directly but always implies. */
  if (mineParents.size && [...otherParents].some((id) => mineParents.has(id))) {
    return female ? "your sister" : "your brother";
  }
  /* A grandparent is a parent of a parent, and worth naming because a villager
     would never call one a neighbour. */
  const byId = (id) => (state.residents || []).find((resident) => resident.id === id);
  for (const parentId of mineParents) {
    const parent = byId(parentId);
    if (parent && parent.id !== person.id
      && ((parent.parentIds || []).includes(other.id) || otherChildren.has(parent.id))) {
      return female ? "your grandmother" : "your grandfather";
    }
  }
  for (const childId of mineChildren) {
    const child = byId(childId);
    if (child && child.id !== person.id
      && ([...(child.childrenIds || []), ...(child.lostChildIds || [])].includes(other.id)
        || otherParents.has(child.id))) {
      return female ? "your granddaughter" : "your grandson";
    }
  }
  /* Only the living share a household. A grave keeps the householdId of the
     family it was buried out of, which is not the same thing: a departed
     neighbour would otherwise read as kin. */
  if (other.alive !== false && person.householdId && other.householdId === person.householdId) {
    return "of your household";
  }
  if ((person.relationshipIds || []).includes(other.id)) {
    return other.alive === false ? "known to you, now dead" : "known to you";
  }
  return "not known to you personally";
}

/* Everything the record settles about a person, in one line.
   Sex, age, trade, whether they are alive, and what they are to the speaker -
   the fields the reviewer asked to be canonical rather than generated. */
export function identityLine(state, person, other, role = "") {
  const sex = other.sex === "female" ? "woman" : "man";
  const kind = other.age < 2 ? "infant"
    : other.age < 14 ? (other.sex === "female" ? "girl" : "boy")
      : sex;
  const kin = kinshipTo(state, person, other);
  const buried = other.alive === false
    ? `, buried${other.causeOfDeath ? ` (${other.causeOfDeath})` : ""}`
    : "";
  /* The matter-role and the kinship are both stated. One used to replace the
     other, which is how a mother came to be described as a neighbour. */
  const standing = [kin, role].filter(Boolean).join("; ");
  return `${other.name} — ${kind}, aged ${other.age}, ${other.occupation}${standing ? `, ${standing}` : ""}${buried}`;
}

export function nameablePeople(state, person, visit, limit = 22) {
  const seen = new Set([person.id]);
  const rows = [];
  const push = (resident, role) => {
    if (!resident || seen.has(resident.id) || rows.length >= limit) return;
    if (resident.alive !== false && resident.active === false) return;
    seen.add(resident.id);
    rows.push(identityLine(state, person, resident, role));
  };
  const byId = (id) => state.residents.find((resident) => resident.id === id);

  /* The matter they came about comes first: those people are certain to be
     discussed. */
  push(byId(visit?.issue?.relatedPersonId), "the person this matter concerns");
  const thread = state.issueThreads?.find((entry) => entry.id === visit?.issue?.threadId);
  for (const subjectId of thread?.subjectIds || []) push(byId(subjectId), "concerned in this matter");

  /* Their own household and immediate family, living and buried. The relation
     is no longer written out here: identityLine derives it from the record, so
     it is stated the same way wherever the person happens to appear. */
  if (person.spouseId) push(byId(person.spouseId));
  if (person.widowedFromId) push(byId(person.widowedFromId));
  for (const parentId of person.parentIds || []) push(byId(parentId));
  for (const childId of person.childrenIds || []) push(byId(childId));
  for (const lostId of person.lostChildIds || []) push(byId(lostId));
  for (const resident of state.residents) {
    if (resident.householdId === person.householdId) push(resident);
  }

  /* Everyone else they actually know, including the graves they carry. */
  for (const relatedId of person.relationshipIds || []) push(byId(relatedId));

  /* The officers, because counsel so often turns on sending for one. */
  for (const resident of state.residents) {
    if (rows.length >= limit) break;
    if (resident.alive !== false && ["reeve", "bailiff", "watchman", "clerk", "healer", "midwife"].includes(resident.occupation)) {
      push(resident, `the parish ${resident.occupation}`);
    }
  }
  return rows;
}

/* What the parish knows about anyone the priest has just named.
 *
 * A visitor cannot be expected to answer "do you know Jerimiah?" sensibly
 * unless somebody tells them whether Jerimiah exists. Left to itself the model
 * will oblige the question and invent him. So before the visitor answers, the
 * engine looks up every name in the priest's line and states plainly whether
 * that person is real, what they are, and whether this particular villager
 * would know them - because existing in the parish and being known to one
 * ferryman are different things.
 */
export function peopleThePriestNamed(state, person, playerText) {
  const speech = String(playerText || "");
  if (!speech.trim()) return [];
  const spoken = new Set();
  const usedLowercase = new Set(speech.match(/\b[a-z]{2,}\b/g) || []);
  /* A capital opening a sentence is ambiguous - "Tell me of him", "What of
     her" - so an unmatched word is only reported as a stranger when it appears
     inside a clause, where a capital is almost always a name. Words that do
     match a real villager are reported wherever they stand. */
  const midSentence = new Set();
  const pattern = /(^|[.!?]\s+|["'\u201c\u2018]\s*)?\b([A-Z][a-z]{2,})\b/g;
  let match = pattern.exec(speech);
  while (match !== null) {
    const word = match[2];
    if (!NON_NAME_CAPITALS.has(word) && !usedLowercase.has(word.toLowerCase())) {
      spoken.add(word);
      if (!(match[1] || match.index === 0)) midSentence.add(word);
    }
    match = pattern.exec(speech);
  }
  if (!spoken.size) return [];

  const knownToThem = new Set([
    ...(person?.relationshipIds || []),
    ...(state.residents || [])
      .filter((resident) => resident.householdId === person?.householdId)
      .map((resident) => resident.id)
  ]);
  const rows = [];
  const reported = new Set();
  for (const word of spoken) {
    const matches = (state.residents || []).filter((resident) => (
      resident.firstName === word || resident.surname === word || resident.name === word
    ));
    if (!matches.length) {
      if (word === state.town?.name || !midSentence.has(word)) continue;
      /* The priest naming himself is not a stranger. */
      if (String(state.priest?.name || "").split(/\s+/).includes(word)) {
        rows.push(`${word} is you — the priest of this parish.`);
        continue;
      }
      rows.push(`${word}: no person of that name lives in this parish, and none ever has. If the priest asks after them, say plainly that you know no such person.`);
      continue;
    }
    for (const resident of matches.slice(0, 3)) {
      if (reported.has(resident.id) || resident.id === person?.id) continue;
      reported.add(resident.id);
      const stage = resident.age < 2 ? "an infant"
        : resident.age < 14 ? (resident.sex === "female" ? "a girl" : "a boy")
          : (resident.sex === "female" ? "a woman" : "a man");
      const standing = resident.alive === false
        ? `is dead — buried${resident.causeOfDeath ? `, of ${resident.causeOfDeath}` : ""}`
        : `is ${stage}, aged ${resident.age}, and works as ${resident.occupation}`;
      /* What they are to this villager comes from the record too, so a priest
         asking what kin somebody is gets the answer the parish holds rather
         than one the model has to guess at. */
      const kin = kinshipTo(state, person, resident);
      const acquaintance = kin === "not known to you personally"
        ? " You do not know them personally, though you may have heard the name."
        : kin === "known to you"
          ? " You know them."
          : ` They are ${kin}.`;
      rows.push(`${resident.name} ${standing}.${acquaintance}`);
    }
  }
  return rows.slice(0, 8);
}

/* Kinship the record contradicts.
 *
 * A woman told the priest that a neighbour had claimed sanctuary, when the
 * record had that woman down as her own mother, in the same household. Kinship
 * is not decoration: the priest decides whom to summon, whom to believe and
 * where a duty lies on the strength of it. */
const KIN_WORDS = {
  mother: (kin) => kin === "your mother",
  father: (kin) => kin === "your father",
  wife: (kin) => kin === "your wife" || kin === "your late wife",
  husband: (kin) => kin === "your husband" || kin === "your late husband",
  son: (kin) => String(kin).startsWith("your son"),
  daughter: (kin) => String(kin).startsWith("your daughter"),
  brother: (kin) => kin === "your brother",
  sister: (kin) => kin === "your sister",
  neighbour: (kin) => ["known to you", "known to you, now dead", "not known to you personally"].includes(kin),
  neighbor: (kin) => ["known to you", "known to you, now dead", "not known to you personally"].includes(kin),
  stranger: (kin) => kin === "not known to you personally"
};

export function contradictedKinship(state, person, text) {
  const speech = String(text || "");
  if (!speech.trim() || !person) return [];
  const found = new Map();
  const words = Object.keys(KIN_WORDS).join("|");
  /* "Anwyn is my mother", "my mother, Anwyn" - both orders. The kin word must
     end there: "Janton is my mother's sister" is an in-law relation the record
     cannot express, and reading it as a claim about the mother would have the
     priest interrogate a truthful villager. */
  const patterns = [
    new RegExp(`\\b([A-Z][a-z]{2,})\\s+is\\s+my\\s+(${words})\\b(?!['\u2019]?s\\b)`, "g"),
    new RegExp(`\\bmy\\s+(${words})\\b(?!['\u2019]?s\\b)\\s*,\\s*([A-Z][a-z]{2,})\\b`, "g")
  ];
  for (const [index, pattern] of patterns.entries()) {
    let match = pattern.exec(speech);
    while (match !== null) {
      const name = index === 0 ? match[1] : match[2];
      const claimed = String(index === 0 ? match[2] : match[1]).toLowerCase();
      /* Somebody else's assertion, or a hypothetical, is not this villager
         claiming anything. */
      const lead = speech.slice(Math.max(0, match.index - 60), match.index);
      if (/\b(?:said|says|swore|told|tells|claimed|claims|insisted|if|whether|suppose|unless)\b[^.!?]*$/i.test(lead)) {
        match = pattern.exec(speech);
        continue;
      }
      /* First names are not unique in this parish, so a claim is only wrong
         when nobody of that name fits it - the same rule every other check in
         this file uses. Judging the first match would accuse a man of lying
         about his own brother because a stranger shares the name. */
      const bearers = (state.residents || []).filter((resident) => (
        resident.name === name || resident.firstName === name || resident.surname === name
      ));
      const test = KIN_WORDS[claimed];
      if (bearers.length && test && !bearers.some((other) => {
        const kin = kinshipTo(state, person, other);
        return kin && test(kin);
      })) {
        const other = bearers[0];
        /* Stated as what they said, not as its negation: the challenge and the
           retry note both quote this back, and quoting the opposite of what a
           villager said is no way to get them to correct it. */
        found.set(
          `${other.name} is your ${claimed}`,
          `${other.name} is ${kinshipTo(state, person, other)}`
        );
      }
      match = pattern.exec(speech);
    }
  }
  return [...found].map(([claim, truth]) => `${claim} (${truth})`);
}

export function unknownPersonNames(state, text) {
  const speech = String(text || "");
  if (!speech.trim()) return [];
  const known = new Set();
  const remember = (value) => {
    for (const part of String(value || "").split(/[^A-Za-z]+/)) {
      if (part) known.add(part.toLowerCase());
    }
  };
  for (const resident of state.residents || []) {
    remember(resident.name);
    remember(resident.firstName);
    remember(resident.surname);
    /* A household is spoken of in the plural - "the Winterings", "the
       Foxes" - which is ordinary English and not an invented family. */
    const surname = String(resident.surname || "");
    if (surname) {
      known.add(`${surname.toLowerCase()}s`);
      known.add(`${surname.toLowerCase()}es`);
      if (/y$/i.test(surname)) known.add(`${surname.slice(0, -1).toLowerCase()}ies`);
    }
  }
  for (const actor of state.externalActors || []) remember(actor.name);
  remember(state.town?.name);
  /* The priest himself. He is not one of the two hundred residents, so without
     this a villager saying "Father Benedict" was told no such person exists -
     and the strip turned him into "Father someone". */
  remember(state.priest?.name);
  for (const word of NON_NAME_CAPITALS) known.add(word.toLowerCase());

  /* Any word the writer also used in lowercase is an ordinary word that
     happened to start a sentence, not somebody's name. */
  const usedLowercase = new Set((speech.match(/\b[a-z]{2,}\b/g) || []));
  const found = new Map();
  /* Only words used inside a sentence are considered. A capital at the start
     of a sentence, after a full stop, a colon or a dash, or opening a
     quotation is ambiguous - "Did", "Forgive", "Nothing" - whereas a capital
     in the middle of a clause is almost always somebody's name. A genuine
     phantom is discussed enough that it appears mid-sentence at least once. */
  const pattern = /(^|[.!?:;]\s+|[\u2014\u2013]\s*|["'\u201c\u2018]\s*)?\b([A-Z][a-z]{2,})\b/g;
  let match = pattern.exec(speech);
  while (match !== null) {
    const sentenceInitial = Boolean(match[1]) || match.index === 0;
    const word = match[2];
    const lower = word.toLowerCase();
    if (!sentenceInitial && !known.has(lower) && !usedLowercase.has(lower)) {
      found.set(word, (found.get(word) || 0) + 1);
    }
    match = pattern.exec(speech);
  }
  return [...found.keys()];
}

/* Debts the ledger does not carry.

   In a watched run a woman whose household owed nothing announced that she
   owed twenty silver pennies. The sum, the creditor and the obligation were
   all invented, and the priest reasonably went to work on a debt that did not
   exist. A visitor may only speak of owing money when their household really
   is in debt, or when the matter they came about is itself about a debt and
   supplied the figure. */
const MONEY_WORDS = "(?:silver\\s+)?(?:pennies|penny|pence|shillings?|marks?|coins?|florins?|groats?)";

export function unsupportedDebtClaims(state, person, visit, text) {
  const speech = String(text || "");
  if (!speech.trim()) return [];
  const household = (state.households || []).find((entry) => entry.id === person?.householdId);
  const realDebt = Number(household?.debt) || 0;
  if (realDebt > 0.5) return [];

  /* A debt named by the scenario is genuine: the engine authored the sum and
     stores it among the visitor's facts. */
  const supplied = (visit?.scenarioFacts || [])
    .map((fact) => String(fact.text))
    .filter((fact) => /\bdebt|owes?|owed|unpaid|wages\b/i.test(fact));
  const suppliedSums = new Set();
  for (const fact of supplied) {
    for (const number of fact.match(/\b\d+\b/g) || []) suppliedSums.add(number);
  }

  const claims = [];
  /* Only first-person obligations count. Denials, and debts owed by other
     people, are not claims about this household's ledger. */
  const pattern = new RegExp(
    `\\b(?:I|we)\\s+(?:still\\s+|now\\s+)?(?:owe|owed)\\b(?![^.]*\\bnothing\\b)([^.!?]*)`,
    "gi"
  );
  let match = pattern.exec(speech);
  while (match !== null) {
    const clause = match[1] || "";
    const negated = /\bnot\b|\bno\b|\bnothing\b|\bnever\b/i.test(speech.slice(Math.max(0, match.index - 12), match.index));
    if (!negated) {
      const figure = clause.match(new RegExp(`\\b(\\d+)\\s+${MONEY_WORDS}`, "i"));
      const worded = new RegExp(
        `\\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)\\s+${MONEY_WORDS}`,
        "i"
      ).exec(clause);
      if (figure && !suppliedSums.has(figure[1])) claims.push(figure[0].trim());
      else if (worded && suppliedSums.size === 0) claims.push(worded[0].trim());
      else if (!figure && !worded && supplied.length === 0) claims.push(`a debt this household does not carry`);
    }
    match = pattern.exec(speech);
  }
  return [...new Set(claims)];
}

/* Offices and trades a villager is given that they do not hold.

   In a watched run the priest addressed "Bailiff Greymoor", who is a
   schoolteacher. The man was real, so the phantom-name check passed him, but
   the office was invented - and office is not decoration here. The priest can
   summon the bailiff, call the watch and petition the reeve, so a teacher
   wearing a bailiff's title is an authority that does not exist and counsel
   built on it cannot be carried out. */
const TITLE_OFFICES = {
  bailiff: ["bailiff"],
  reeve: ["reeve"],
  watchman: ["watchman"],
  constable: ["watchman", "bailiff"],
  magistrate: ["magistrate"],
  sheriff: ["bailiff", "reeve"],
  steward: ["steward"],
  clerk: ["clerk", "scribe"],
  sexton: ["sexton", "sacristan"],
  midwife: ["midwife"],
  healer: ["healer", "herbalist"],
  miller: ["miller"],
  smith: ["blacksmith"],
  blacksmith: ["blacksmith"],
  baker: ["baker"],
  brewer: ["brewer"],
  innkeeper: ["innkeeper"],
  merchant: ["merchant", "peddler"],
  mason: ["mason"],
  carpenter: ["carpenter"],
  tanner: ["tanner"],
  butcher: ["butcher"],
  shepherd: ["shepherd", "goatherd"],
  weaver: ["weaver"],
  tailor: ["tailor"],
  cobbler: ["cobbler"],
  potter: ["potter"],
  cooper: ["cooper"],
  teacher: ["teacher"],
  scribe: ["scribe", "clerk"],
  gravedigger: ["gravedigger"],
  ferryman: ["ferryman"],
  forester: ["forester"],
  hunter: ["hunter"]
};

export function misappliedTitles(state, text) {
  const speech = String(text || "");
  if (!speech.trim()) return [];
  const found = new Map();
  const titles = Object.keys(TITLE_OFFICES).join("|");
  const pattern = new RegExp(`\\b(${titles})\\s+([A-Z][a-z]{2,})\\b`, "gi");
  let match = pattern.exec(speech);
  while (match !== null) {
    const title = match[1].toLowerCase();
    const named = match[2];
    const allowed = TITLE_OFFICES[title] || [];
    /* Several people may share a surname, so the title is honest if anybody of
       that name holds the office. */
    const bearers = (state.residents || []).filter((person) => (
      person.alive !== false
      && (person.surname === named || person.firstName === named)
    ));
    if (bearers.length && !bearers.some((person) => allowed.includes(person.occupation))) {
      found.set(`${match[1]} ${named}`, bearers[0].occupation);
    }
    match = pattern.exec(speech);
  }
  return [...found].map(([phrase, occupation]) => `${phrase} (who is a ${occupation})`);
}

/* Facts about a person that dialogue is not allowed to redefine.

   A villager's age and sex are settled before the game begins. In a watched run
   a newborn girl, Baldanne Farmill, was spoken of on one day as the grown man a
   woman was in love with, and on the next as a seven-year-old orphan. The
   parish record never changed; the dialogue simply talked over it. The engine
   owns who these people are, so a line that contradicts the record is sent
   back rather than allowed to stand. */
const LIFE_STAGE_WORDS = {
  man: (person) => person.sex === "male" && person.age >= 16,
  woman: (person) => person.sex === "female" && person.age >= 16,
  lad: (person) => person.sex === "male" && person.age >= 8 && person.age < 25,
  lass: (person) => person.sex === "female" && person.age >= 8 && person.age < 25,
  boy: (person) => person.sex === "male" && person.age < 16,
  girl: (person) => person.sex === "female" && person.age < 16,
  child: (person) => person.age < 14,
  infant: (person) => person.age <= 2,
  babe: (person) => person.age <= 2,
  widow: (person) => person.sex === "female" && (person.maritalStatus === "widowed" || Boolean(person.widowedFromId)),
  widower: (person) => person.sex === "male" && (person.maritalStatus === "widowed" || Boolean(person.widowedFromId))
};

export function contradictedIdentities(state, text) {
  const speech = String(text || "");
  if (!speech.trim()) return [];
  const living = (state.residents || []).filter((person) => person.alive !== false);
  const bearersOf = (name) => living.filter((person) => (
    person.firstName === name || person.surname === name || person.name === name
  ));
  const problems = new Map();

  /* An age stated outright: "Baldanne is seven years old", "seven-year-old
     Baldanne". A year or two either way is ordinary vagueness, not a
     contradiction. */
  const WORD_NUMBERS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20
  };
  const toNumber = (raw) => (/^\d+$/.test(raw) ? Number(raw) : WORD_NUMBERS[String(raw).toLowerCase()]);
  const agePatterns = [
    /\b([A-Z][a-z]{2,})\s+is\s+(\w+)\s+years?\s+old\b/g,
    /\b(\w+)[-\s]year[-\s]old\s+([A-Z][a-z]{2,})\b/g
  ];
  for (const [index, pattern] of agePatterns.entries()) {
    let match = pattern.exec(speech);
    while (match !== null) {
      const name = index === 0 ? match[1] : match[2];
      const claimed = toNumber(index === 0 ? match[2] : match[1]);
      const bearers = bearersOf(name);
      if (Number.isFinite(claimed) && bearers.length
        && !bearers.some((person) => Math.abs(person.age - claimed) <= 2)) {
        problems.set(
          `${name} is ${claimed}`,
          `${name} is ${bearers.map((person) => person.age).join(" or ")}`
        );
      }
      match = pattern.exec(speech);
    }
  }

  /* A life stage that the record contradicts: calling an infant a man, a woman
     a boy, or somebody a widow who has never been married. */
  const stages = Object.keys(LIFE_STAGE_WORDS).join("|");
  const stagePattern = new RegExp(`\\b(?:the|that|young|old)\\s+(${stages})\\s+([A-Z][a-z]{2,})\\b`, "gi");
  let match = stagePattern.exec(speech);
  while (match !== null) {
    const stage = match[1].toLowerCase();
    const name = match[2];
    const bearers = bearersOf(name);
    if (bearers.length && !bearers.some((person) => LIFE_STAGE_WORDS[stage](person))) {
      const person = bearers[0];
      problems.set(
        `${name} is a ${stage}`,
        `${name} is ${person.sex === "female" ? "a female" : "a male"} aged ${person.age}`
      );
    }
    match = stagePattern.exec(speech);
  }

  return [...problems].map(([claim, truth]) => `${claim} (${truth})`);
}

/* Last resort when the model will not mend its own invention.

   Detecting a phantom and asking for the line again works most of the time,
   but not always: in one audited day the guard fired sixteen times and eleven
   lines still reached the player with an invented villager in them, because
   the retry reproduced the same name and the original was kept. Hoping for
   compliance is not a guarantee. This removes the name deterministically, so
   the invariant holds whatever the model does.

   The replacements are ordered from most graceful to most blunt: an appositive
   is simply dropped, a name attached to a trade gives way to the trade, and
   only a name with no surrounding context becomes a plain reference. */
export function stripInventedNames(state, text) {
  let result = String(text || "");
  for (const name of unknownPersonNames(state, result)) {
    const bare = name.replace(/[^A-Za-z]/g, "");
    if (!bare) continue;
    result = result
      /* "the child, Elara, is seven" -> "the child is seven" */
      .replace(new RegExp(`,\\s*${bare}\\s*,`, "g"), " ")
      /* "Old Man Hemlock" -> "the old man" */
      .replace(new RegExp(`\\b(?:Old\\s+)?(?:Man|Goodman)\\s+${bare}\\b`, "g"), "the old man")
      .replace(new RegExp(`\\b(?:Old\\s+)?(?:Woman|Goodwife)\\s+${bare}\\b`, "g"), "the old woman")
      /* "Elara the washerwoman" -> "the washerwoman" */
      .replace(new RegExp(`\\b${bare}\\s+(the\\s+[a-z]+)`, "g"), "$1")
      /* "Elara's household" -> "their household" */
      .replace(new RegExp(`\\b${bare}'s\\b`, "g"), "their")
      /* "young Agnes" -> "the young one" */
      .replace(new RegExp(`\\byoung\\s+${bare}\\b`, "g"), "the young one")
      .replace(new RegExp(`\\bold\\s+${bare}\\b`, "g"), "the old one")
      /* A naming construction must never survive as "my wife is someone",
         which is how a stripped invention wrecked an entire visit: the priest
         quite rightly kept objecting that "someone" is not a name, and the
         villager kept repeating it. Where the sentence exists in order to give
         a name, the whole claim goes rather than its subject. */
      .replace(
        new RegExp(`\\b(?:my|his|her|their|the)\\s+name\\s+(?:is|was)\\s+(?:called\\s+|named\\s+)?${bare}\\b`, "gi"),
        "I cannot give you a name"
      )
      .replace(
        new RegExp(`\\b(my|his|her|their|the)\\s+([a-z]+)\\s+(?:is|was)\\s+(?:called\\s+|named\\s+)?${bare}\\b`, "gi"),
        (whole, determiner, relation) => `I cannot give you a name for ${String(determiner).toLowerCase()} ${relation}`
      )
      .replace(new RegExp(`\\b(?:is|was)\\s+(?:called|named)\\s+${bare}\\b`, "gi"), "I cannot give you a name")
      /* A name is never replaced by a bare "someone". That reads as though the
         villager is naming a person called Someone, and a priest pressing for
         an identity gets "Renton's mother is someone" - which is not an answer
         and not even a refusal. Not knowing is a legitimate thing for a person
         to say, so the replacement says it. */
      .replace(new RegExp(`\\b${bare}\\b`, "g"), "someone whose name I do not know");
  }
  return result
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/,\s*,/g, ",")
    .trim();
}

function openThreadsForPrompt(visit, limit = 3) {
  const rows = [];
  for (const obligation of (visit.continuity?.obligationStack || [])) {
    if (obligation.kind === "player_decision" && obligation.status === "open" && obligation.prompt) {
      rows.push(`You are still waiting on the priest's counsel about: ${firstSentence(obligation.prompt, 90)}`);
    }
  }
  for (const question of (visit.continuity?.unresolvedQuestions || []).slice(-limit)) {
    if (question.status === "open") rows.push(`The priest asked and you have not answered: ${firstSentence(question.text, 90)}`);
  }
  for (const commitment of (visit.continuity?.semantic?.commitments || []).slice(-limit)) {
    rows.push(`You said you would: ${firstSentence(commitment.text, 90)}`);
  }
  return rows.slice(0, limit);
}

function resolveActionTarget(state, person, rawTarget) {
  const target = String(rawTarget || "").trim().toLowerCase();
  if (!target) return null;
  if (/^(?:the\s+)?priest$|^father$/.test(target)) return { id: "priest", name: "the priest" };
  const candidates = [...state.residents, ...state.externalActors].filter((entry) => entry.active !== false);
  const exact = candidates.find((entry) => String(entry.name || "").toLowerCase() === target);
  if (exact) return { id: exact.id, name: exact.name };
  const partial = candidates.filter((entry) => (
    target.includes(String(entry.firstName || "").toLowerCase())
    || target.includes(String(entry.name || "").toLowerCase())
    || String(entry.occupation || "").toLowerCase() === target
  ));
  if (partial.length === 1) return { id: partial[0].id, name: partial[0].name };
  if (person.id && target.includes("myself")) return { id: person.id, name: person.name };
  return null;
}

const DETERMINISTIC_SOCIAL_TYPES = new Set([
  "church_aid",
  "church_donation",
  "priest_intervention",
  "current_matter_help",
  "shared_prayer",
  "identity_check",
  "related_identity",
  "summon_request",
  "guarded_disclosure",
  "exact_decision",
  "first_step",
  "cooperation_authority",
  "strongest_risk",
  "departure_commitment",
  "voluntary_commitment",
  "full_name_request",
  "feasibility_people",
  "household_capacity",
  "expert_request",
  "investigation_people",
  "instruction_acknowledgment",
  "proposal_decision_answer",
  "unsupported_location",
  "answer_repair"
]);

const legacyConversationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "reply", "memory", "interpretation", "responsePlan",
    "claims", "answeredObligations", "newQuestions", "decisions"
  ],
  properties: {
    reply: { type: "string", maxLength: 600 },
    memory: { type: "string", maxLength: 180 },
    interpretation: {
      type: "object",
      additionalProperties: false,
      required: ["speechActs", "implicitMeaning", "tone", "mandatoryResponseNeeds"],
      properties: {
        speechActs: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["type", "meaning"],
            properties: {
              type: {
                type: "string",
                enum: [
                  "question", "implicit_question", "command", "request", "advice", "offer",
                  "permission", "refusal", "accusation", "reassurance", "moral_judgment",
                  "joke", "sarcasm", "accept_proposal", "reject_proposal", "modify_proposal",
                  "defer_proposal", "observation", "silence", "topic_change"
                ]
              },
              meaning: { type: "string", maxLength: 160 },
              referenceText: { type: ["string", "null"], maxLength: 100 },
              confidence: { type: "number", minimum: 0, maximum: 1 }
            }
          }
        },
        implicitMeaning: { type: "string", maxLength: 240 },
        tone: { type: "string", maxLength: 50 },
        mandatoryResponseNeeds: {
          type: "array",
          maxItems: 10,
          items: { type: "string", maxLength: 160 }
        }
      }
    },
    responsePlan: {
      type: "object",
      additionalProperties: false,
      required: [
        "primaryObligationId", "secondaryObligationIds", "knownFactIds",
        "unknowns", "proposalPositions", "desiredMovement", "endConversation"
      ],
      properties: {
        primaryObligationId: { type: ["string", "null"], maxLength: 100 },
        secondaryObligationIds: {
          type: "array",
          maxItems: 10,
          items: { type: "string", maxLength: 100 }
        },
        knownFactIds: {
          type: "array",
          maxItems: 16,
          items: { type: "string", maxLength: 80 }
        },
        unknowns: {
          type: "array",
          maxItems: 8,
          items: { type: "string", maxLength: 160 }
        },
        proposalPositions: {
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["proposalId", "status", "reason"],
            properties: {
              proposalId: { type: "string", maxLength: 80 },
              status: { type: "string", enum: ["accepted", "rejected", "modified", "deferred", "unknown"] },
              reason: { type: "string", maxLength: 120 }
            }
          }
        },
        desiredMovement: { type: "string", maxLength: 160 },
        endConversation: { type: "boolean" }
      }
    },
    claims: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "claimId", "sentenceIndex", "type", "text", "subjectId",
          "targetIds", "evidenceFactIds", "confidence"
        ],
        properties: {
          claimId: { type: "string", maxLength: 80 },
          sentenceIndex: { type: "integer", minimum: 0, maximum: 12 },
          type: {
            type: "string",
            enum: ["fact", "belief", "suspicion", "opinion", "proposal", "prediction", "promise", "rumor"]
          },
          text: { type: "string", maxLength: 220 },
          subjectId: { type: ["string", "null"], maxLength: 80 },
          targetIds: {
            type: "array",
            maxItems: 4,
            items: { type: "string", maxLength: 80 }
          },
          evidenceFactIds: {
            type: "array",
            maxItems: 8,
            items: { type: "string", maxLength: 80 }
          },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    },
    answeredObligations: {
      type: "array",
      maxItems: 12,
      items: { type: "string", maxLength: 100 }
    },
    newQuestions: {
      type: "array",
      maxItems: 6,
      items: { type: "string", maxLength: 180 }
    },
    decisions: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["proposalId", "status", "reason"],
        properties: {
          proposalId: { type: "string", maxLength: 80 },
          status: { type: "string", enum: ["accepted", "rejected", "deferred", "unknown"] },
          reason: { type: "string", maxLength: 120 }
        }
      }
    }
  }
};

const churchGiftProperty = {
  type: "array",
  maxItems: 4,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["resource", "amount"],
    properties: {
      resource: {
        type: "string",
        enum: ["coin", "grain", "bread", "beans", "onions", "saltedFish", "cheese", "firewood", "medicine"]
      },
      amount: { type: "integer", minimum: 1, maximum: 100 }
    }
  }
};

/* Whether the priest's own words contain an offer of anything at all.
   This is deliberately broad — it is not trying to recognise a phrasing, only
   to establish that something was offered before the stores are opened. A
   model listing the parish's whole stock back as a gift is the failure this
   prevents. */
/* Is the priest, in these words, actually handing something over?

   This used to ask whether a giving-ish word and a church-ish word both
   appeared somewhere in the sentence, which is not the same question at all.
   "What work have you lately done at the mill, and do you know of any flour
   missing?" contains "have" and "flour", and duly opened the stores and gave a
   man a loaf in the middle of an interrogation.

   The question is structural, so it is asked structurally. A gift lives in one
   clause: the thing given and the act of giving are in the same breath. A
   question is never a gift, however it is worded. And the giving has to be the
   priest's own - him handing over, not him asking what someone else has. */

const TRANSFER_VERBS = /\b(?:give|gives|giving|gave|given|offer|offers|offered|spare|spares|spared|share|shares|shared|provide|provides|lend|lends|grant|grants|granted|supply|supplies|deliver|delivers|distribute|allot|fetch|send|sends|sending|sent|bring|brings|brought|set aside|draw on|draw from)\b/;
/* Handing something across without naming the act: "take this bread", "here,
   two loaves for the children". */
const HANDING_OVER = /\b(?:take|here|you may have|you shall have|you to have|let me|i have .{0,20}for you|carry .{0,20}(?:home|with you))\b/;
/* The priest asking after someone else's means is the opposite of a gift. */
const ASKS_ABOUT_THEIRS = /\b(?:do you|did you|have you|has he|has she|do they|is there|are there|what work|how much do you|any .{0,12}(?:missing|left|taken|stolen))\b/;
/* Sending word is sending a message, not sending goods. "Send word that the
   flour must not be delayed" mentions flour and sends nothing. */
const SENDS_A_MESSAGE = /\bsend(?:s|ing)? (?:word|for|to|someone|him|her|them|a message|a letter)\b/;
/* A gift is something the priest does, here, now. Either he says he is doing it
   or he holds it out. Talk about a thing being shared, or about what somebody
   else did with it, is neither. */
const PRIEST_IS_THE_GIVER = /\b(?:(?:i|we|the parish|the church) (?:will |shall |can |could |would |am going to |must |may )?(?:give|gives|send|sends|spare|spares|share|shares|provide|provides|offer|offers|lend|lends|grant|grants|supply|supplies|deliver|delivers|fetch|bring|brings|have|has)|let me|you (?:may|shall|can) have|you to have|from the church|out of (?:our|the church) stores)\b/;
const HELD_OUT = /^(?:take|here|carry|keep)\b/;

/* Clause splitting lives in church.js as offerClauses, so that every gate
   agrees about where a sentence ends. Two gates disagreeing about that is how
   a refused resource gets handed over. */

/* The clauses in which the priest genuinely hands something over.
 *
 * Returning the clauses rather than a yes/no matters: one real offer in a turn
 * used to unlock every resource named anywhere in that turn, so "I cannot give
 * you medicine, but I will give you bread" licensed the medicine as well. Each
 * thing that leaves the stores has to have been offered in its own right, and
 * that can only be checked against the clause that offered it. */
export function givingClausesIn(text) {
  const qualifying = [];
  for (const clause of offerClauses(text)) {
    if (!mentionsChurchResource(clause)) continue;
    if (ASKS_ABOUT_THEIRS.test(clause)) continue;
    /* A refusal is not an offer. A priest who said "I do not think I may give
       alms today, though I am sorry to refuse you" was recorded as having
       offered, which licensed the model's account of a gift and emptied a dose
       of medicine from the stores. A player's stores are scarce and must never
       be spent by an act the player declined to make. */
    if (REFUSES_TO_GIVE.test(clause)) continue;
    if (MERELY_CONSIDERING.test(clause)) continue;
    if (SENDS_A_MESSAGE.test(clause) && !PRIEST_IS_THE_GIVER.test(clause.replace(SENDS_A_MESSAGE, ""))) continue;
    if (!PRIEST_IS_THE_GIVER.test(clause) && !HELD_OUT.test(clause)) continue;
    if (TRANSFER_VERBS.test(clause) || HANDING_OVER.test(clause)) qualifying.push(clause);
  }
  return qualifying;
}

export function mentionsGiving(text) {
  return givingClausesIn(text).length > 0;
}

const naturalConversationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["understoodPlayerAs", "reply", "npcIntent"],
  properties: {
    understoodPlayerAs: { type: "string", maxLength: 220 },
    reply: { type: "string", maxLength: 600 },
    npcIntent: { type: "string", maxLength: 160 },
    priestGivesFromChurch: churchGiftProperty,
    visitorGivesToChurch: churchGiftProperty,
    proposedActions: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "target"],
        properties: {
          action: { type: "string", maxLength: 80 },
          target: { type: "string", maxLength: 80 }
        }
      }
    }
  }
};

const naturalDecisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["understoodPlayerAs", "reply", "npcIntent", "decisions"],
  properties: {
    ...naturalConversationSchema.properties,
    decisions: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["proposalId", "status"],
        properties: {
          proposalId: { type: "string", maxLength: 80 },
          status: { type: "string", enum: ["accepted", "rejected", "deferred", "unknown"] }
        }
      }
    }
  }
};

const openingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["opening"],
  properties: {
    opening: { type: "string", maxLength: 800 }
  }
};

export function validateOpening(value, personName = "", {
  requireExplicitAdvice = false,
  forbidSelfDenial = false
} = {}) {
  const opening = boundedProse(value?.opening, 800);
  if (opening.length < 20) throw new Error("The visitor's opening was too short");
  if (personName && opening.toLowerCase().includes(personName.toLowerCase())) {
    throw new Error("The visitor narrated their own name instead of speaking naturally");
  }
  if (/\b(?:the matter came to a head|the decision is driven by|profitable choice difficult to refuse|i find myself troubled|i'?m hoping you might offer some guidance|how best to proceed|i need your advice on the choice itself|what course of action would you counsel|i understand a decision is expected)\b/i.test(opening)) {
    throw new Error("The visitor used scenario-template language");
  }
  if (requireExplicitAdvice
    && !/\?|(?:tell me|help me decide|i need your advice|i need your counsel|what should i|how should i|should i)\b/i.test(opening)) {
    throw new Error("The visitor did not clearly ask what advice they wanted");
  }
  if (forbidSelfDenial && deniesKnownSelfAction(opening)) {
    throw new Error("The visitor contradicted their established role in the scenario");
  }
  return { opening };
}

export function validateConversation(value) {
  const reply = boundedProse(stripControlSuffix(value?.reply), 600);
  if (!reply) throw new Error("The visitor gave no reply");
  const interpretation = value?.interpretation && typeof value.interpretation === "object"
    ? {
      speechActs: Array.isArray(value.interpretation.speechActs)
        ? value.interpretation.speechActs.slice(0, 8).map((act) => ({
          type: boundedString(act?.type, 40),
          meaning: boundedProse(act?.meaning, 160),
          referenceText: act?.referenceText == null ? null : boundedProse(act.referenceText, 100),
          confidence: Math.max(0, Math.min(1, Number(act?.confidence) || 0))
        })).filter((act) => act.type && act.meaning)
        : [],
      implicitMeaning: boundedProse(value.interpretation.implicitMeaning, 240),
      tone: boundedString(value.interpretation.tone, 50),
      mandatoryResponseNeeds: Array.isArray(value.interpretation.mandatoryResponseNeeds)
        ? value.interpretation.mandatoryResponseNeeds.map((need) => boundedProse(need, 160)).filter(Boolean).slice(0, 10)
        : []
    }
    : {
      speechActs: [],
      implicitMeaning: boundedProse(value?.interpretation, 220),
      tone: "",
      mandatoryResponseNeeds: []
    };

  const responsePlan = value?.responsePlan && typeof value.responsePlan === "object"
    ? {
      primaryObligationId: value.responsePlan.primaryObligationId == null
        ? null
        : boundedString(value.responsePlan.primaryObligationId, 100),
      secondaryObligationIds: Array.isArray(value.responsePlan.secondaryObligationIds)
        ? value.responsePlan.secondaryObligationIds.map((id) => boundedString(id, 100)).filter(Boolean).slice(0, 10)
        : [],
      knownFactIds: Array.isArray(value.responsePlan.knownFactIds)
        ? value.responsePlan.knownFactIds.map((id) => boundedString(id, 80)).filter(Boolean).slice(0, 16)
        : [],
      unknowns: Array.isArray(value.responsePlan.unknowns)
        ? value.responsePlan.unknowns.map((item) => boundedProse(item, 160)).filter(Boolean).slice(0, 8)
        : [],
      proposalPositions: Array.isArray(value.responsePlan.proposalPositions)
        ? value.responsePlan.proposalPositions.slice(0, 6).map((position) => ({
          proposalId: boundedString(position?.proposalId, 80),
          status: ["accepted", "rejected", "modified", "deferred", "unknown"].includes(position?.status)
            ? position.status
            : "unknown",
          reason: boundedProse(position?.reason, 120)
        })).filter((position) => position.proposalId)
        : [],
      desiredMovement: boundedProse(value.responsePlan.desiredMovement, 160),
      endConversation: Boolean(value.responsePlan.endConversation)
    }
    : null;
  const claims = Array.isArray(value?.claims)
    ? value.claims.slice(0, 12).map((claim, index) => ({
      claimId: boundedString(claim?.claimId, 80) || `claim-${index + 1}`,
      sentenceIndex: Math.max(0, Math.min(12, Number.isInteger(claim?.sentenceIndex) ? claim.sentenceIndex : 0)),
      type: ["fact", "belief", "suspicion", "opinion", "proposal", "prediction", "promise", "rumor"].includes(claim?.type)
        ? claim.type
        : "opinion",
      text: boundedProse(claim?.text, 220),
      subjectId: claim?.subjectId == null ? null : boundedString(claim.subjectId, 80),
      targetIds: Array.isArray(claim?.targetIds)
        ? claim.targetIds.map((id) => boundedString(id, 80)).filter(Boolean).slice(0, 4)
        : [],
      evidenceFactIds: Array.isArray(claim?.evidenceFactIds)
        ? claim.evidenceFactIds.map((id) => boundedString(id, 80)).filter(Boolean).slice(0, 8)
        : [],
      confidence: Math.max(0, Math.min(1, Number(claim?.confidence) || 0))
    })).filter((claim) => claim.text)
    : [];
  return {
    reply,
    memory: boundedProse(value.memory, 180),
    interpretation,
    responsePlan,
    claims,
    answeredObligations: Array.isArray(value?.answeredObligations)
      ? value.answeredObligations.map((id) => boundedString(id, 100)).filter(Boolean).slice(0, 12)
      : [],
    newQuestions: Array.isArray(value?.newQuestions)
      ? value.newQuestions.map((question) => boundedProse(question, 180)).filter(Boolean).slice(0, 6)
      : [],
    structuredProvided: Boolean(value?.interpretation && typeof value.interpretation === "object" && value?.responsePlan),
    referencedTurnIndexes: Array.isArray(value.referencedTurnIndexes)
      ? value.referencedTurnIndexes.filter((index) => Number.isInteger(index) && index >= 0 && index <= 24).slice(0, 6)
      : [],
    expressedReaction: REACTIONS.includes(value.expressedReaction) ? value.expressedReaction : "continue",
    boundaryProposal: BOUNDARY_TYPES.includes(value.boundaryProposal) ? value.boundaryProposal : null,
    segments: Array.isArray(value.segments) && value.segments.length
      ? value.segments.slice(0, 6).map((segment) => ({
        text: boundedProse(segment?.text, 600),
        issueId: boundedString(segment?.issueId, 80),
        answeredQuestionTurnIds: Array.isArray(segment?.answeredQuestionTurnIds)
          ? segment.answeredQuestionTurnIds.map((id) => boundedString(id, 80)).filter(Boolean).slice(0, 6)
          : [],
        referencedFactIds: Array.isArray(segment?.referencedFactIds)
          ? segment.referencedFactIds.map((id) => boundedString(id, 80)).filter(Boolean).slice(0, 12)
          : []
      })).filter((segment) => segment.text)
      : [{
        text: reply,
        issueId: "legacy",
        answeredQuestionTurnIds: [],
        referencedFactIds: []
      }],
    decisions: (Array.isArray(value.decisions) && value.decisions.length
      ? value.decisions
      : responsePlan?.proposalPositions || [])
      .slice(0, 6).map((decision) => ({
        proposalId: boundedString(decision?.proposalId, 80),
        status: ["accepted", "rejected", "modified", "deferred", "unknown"].includes(decision?.status)
          ? decision.status
          : "unknown",
        reason: boundedProse(decision?.reason, 120)
      })).filter((decision) => decision.proposalId)
  };
}

export function validateSermonResponse(value, attendeeIds) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The local model returned an invalid sermon response");
  }
  const allowedIds = new Set(attendeeIds);
  const metricNames = ["harmony", "faith", "prosperity", "health", "safety", "mercy"];
  if (!value.townDeltas || typeof value.townDeltas !== "object" || Array.isArray(value.townDeltas)) {
    throw new Error("The local model returned invalid sermon town effects");
  }
  const townDeltas = {};
  for (const metric of metricNames) {
    const delta = Number(value.townDeltas[metric]);
    if (!Number.isInteger(delta) || delta < -8 || delta > 8) {
      throw new Error(`The local model returned an invalid ${metric} sermon effect`);
    }
    townDeltas[metric] = delta;
  }
  if (!Array.isArray(value.responseTags) || value.responseTags.length < 1 || value.responseTags.length > 5) {
    throw new Error("The local model returned invalid sermon response tags");
  }
  const responseTags = value.responseTags.map((tag) => boundedString(tag, 30));
  if (responseTags.some((tag) => !tag)) {
    throw new Error("The local model returned blank sermon response tags");
  }
  if (!Array.isArray(value.notableEffects) || value.notableEffects.length > 16) {
    throw new Error("The local model returned invalid notable sermon effects");
  }
  const seenPeople = new Set();
  const notableEffects = value.notableEffects.map((effect) => {
    if (!effect || typeof effect !== "object" || !allowedIds.has(effect.personId)) {
      throw new Error("The local model targeted a non-attendee with a sermon effect");
    }
    if (seenPeople.has(effect.personId)) {
      throw new Error("The local model returned duplicate effects for one attendee");
    }
    seenPeople.add(effect.personId);
    const faithDelta = Number(effect.faithDelta);
    const moraleDelta = Number(effect.moraleDelta);
    const attendanceDelta = Number(effect.attendanceDelta);
    if (!Number.isInteger(faithDelta) || faithDelta < -6 || faithDelta > 6
      || !Number.isInteger(moraleDelta) || moraleDelta < -6 || moraleDelta > 6
      || !Number.isInteger(attendanceDelta) || attendanceDelta < -10 || attendanceDelta > 10) {
      throw new Error("The local model returned an out-of-range individual sermon effect");
    }
    return {
      personId: effect.personId,
      faithDelta,
      moraleDelta,
      attendanceDelta,
      memory: boundedProse(effect.memory, 180)
    };
  });
  return {
    summary: boundedProse(value.summary, 500),
    townDeltas,
    responseTags,
    notableEffects
  };
}

/* --------------------------------------------------------------- Gemini ----
   The whole game runs against a local model, which asks for a graphics card
   most people do not have. Google's free tier is the way round that: the player
   pastes their own key and the parish speaks through gemini-2.5-flash instead.

   The key belongs to the player, so it lives in their browser and nowhere else.
   It is deliberately never written into the game state, because saves are
   exported, shared as debug logs, and replayed. */
export const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ROOT = "https://generativelanguage.googleapis.com/v1beta";

/* Gemini accepts a cut-down OpenAPI schema rather than full JSON Schema, and
   rejects the whole request if it meets a keyword it does not know. The schemas
   in this file are written for the local model, so they are translated here
   rather than being weakened for everybody. */
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  const allowed = ["type", "description", "enum", "format", "nullable", "items", "properties", "required"];
  const converted = {};
  for (const key of allowed) {
    if (!(key in schema)) continue;
    if (key === "properties") {
      converted.properties = Object.fromEntries(
        Object.entries(schema.properties).map(([name, value]) => [name, toGeminiSchema(value)])
      );
    } else if (key === "items") {
      converted.items = toGeminiSchema(schema.items);
    } else {
      converted[key] = schema[key];
    }
  }
  /* A union with null is spelled as a nullable type here. */
  if (Array.isArray(converted.type)) {
    converted.nullable = converted.type.includes("null");
    converted.type = converted.type.find((entry) => entry !== "null") || "string";
  }
  return converted;
}

function geminiContent(payload) {
  const candidate = payload?.candidates?.[0];
  const text = (candidate?.content?.parts || [])
    .map((part) => part?.text)
    .filter((part) => typeof part === "string")
    .join("");
  if (!text) {
    const reason = candidate?.finishReason || payload?.promptFeedback?.blockReason;
    throw new Error(reason ? `Gemini returned no usable content (${reason})` : "Gemini returned no usable content");
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const salvaged = salvageJsonFields(text);
    if (salvaged) return salvaged;
    throw error;
  }
}

const letterReadingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "tone", "asks"],
  properties: {
    summary: { type: "string", maxLength: 240 },
    tone: { type: "string", enum: ["kind", "plain", "commanding", "threatening", "pleading"] },
    asks: { type: "string", enum: ["visit", "act", "explain", "nothing"] }
  }
};

/* A letter is the priest's own words, so what it amounts to is a question of
   reading rather than of rules. The model says what was written and what it
   asks for; the engine decides what that does, as it does everywhere else. */
export function validateLetterReading(value) {
  const tones = ["kind", "plain", "commanding", "threatening", "pleading"];
  const asks = ["visit", "act", "explain", "nothing"];
  return {
    summary: String(value?.summary || "").slice(0, 240),
    tone: tones.includes(value?.tone) ? value.tone : "plain",
    asks: asks.includes(value?.asks) ? value.asks : "nothing"
  };
}

/* Read without a model, so a letter still works when nothing is listening. */
export function fallbackLetterReading(text) {
  const speech = String(text || "").toLowerCase();
  const tone = /\b(?:damn|curse|wrath|ruin you|regret it|answer for|or else)\b/.test(speech) ? "threatening"
    : /\b(?:command|require|must|shall not|i order|see that you)\b/.test(speech) ? "commanding"
    : /\b(?:beg|beseech|implore|for the love of|i pray you|have mercy)\b/.test(speech) ? "pleading"
    : /\b(?:grieve|comfort|sorry|kindly|gently|you are welcome|god keep)\b/.test(speech) ? "kind"
    : "plain";
  const asks = /\b(?:come|call on me|visit|attend me|present yourself|sit with me)\b/.test(speech) ? "visit"
    : /\b(?:tell me|explain|account for|why did|let me know|answer)\b/.test(speech) ? "explain"
    : /\b(?:do|see to|settle|intervene|put right|act|remedy)\b/.test(speech) ? "act"
    : "nothing";
  const summary = String(text || "").split(/(?<=[.!?])\s+/)[0]?.slice(0, 240) || "";
  return { summary, tone, asks };
}

export class ParishAiClient extends EventTarget {
  constructor({
    endpoint = "/local-ai",
    model = "local-gemma",
    provider = "local",
    apiKey = "",
    splitSemantic = false,
    timeoutMs = 60000,
    fetchImpl = (...args) => globalThis.fetch(...args)
  } = {}) {
    super();
    this.endpoint = endpoint.replace(/\/+$/, "");
    this.model = model;
    this.provider = provider;
    this.apiKey = apiKey;
    this.splitSemantic = splitSemantic;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.inFlight = false;
  }

  async health() {
    if (this.provider === "gemini") {
      if (!this.apiKey) throw new Error("No Gemini API key has been entered");
      const response = await this.fetchImpl(
        `${GEMINI_ROOT}/models/${GEMINI_MODEL}?key=${encodeURIComponent(this.apiKey)}`,
        { headers: { Accept: "application/json" } }
      );
      if (response.status === 400 || response.status === 403) {
        throw new Error("Gemini rejected that API key");
      }
      if (!response.ok) throw new Error(`Gemini health check returned HTTP ${response.status}`);
      return { status: "ok", model: GEMINI_MODEL };
    }
    const response = await this.fetchImpl(`${this.endpoint}/health`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`AI health check returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.status !== "ok") throw new Error("The selected AI provider is unavailable");
    return payload;
  }

  async readLetter(state, recipient, text) {
    const prompt = [
      "A 16th-century parish priest has written a letter. Read it and report what it amounts to.",
      `The letter is addressed to ${recipient.name}${recipient.detail ? `, ${recipient.detail}` : ""}.`,
      "",
      "summary: one sentence, in plain words, saying what the priest has written and why.",
      "tone: kind, plain, commanding, threatening, or pleading. Judge how it would feel to receive, not how the priest would describe it.",
      "asks: visit if he wants them to come to him; act if he wants something done; explain if he wants an answer or account; nothing if he asks for neither.",
      "",
      "Report only what is actually in the letter. Do not invent an errand he did not set.",
      "",
      `LETTER=${JSON.stringify(String(text).slice(0, 1200))}`
    ].join("\n");
    const raw = await this.complete(prompt, letterReadingSchema, "parish_letter", 220);
    return validateLetterReading(raw);
  }

  async opening(state, person) {
    const visit = state.currentVisit;
    const mayDiscloseMatter = visit.issue.kind !== "confession" || visit.hiddenConcernDisclosed;
    const establishedSelfAction = mayDiscloseMatter ? selfActionFact(visit, person) : null;
    const context = {
      town: state.town.name,
      date: state.calendar,
      location: visit.location,
      /* The opening had no roster whatever, so the very first thing a villager
         said was free to invent whoever it liked. */
      peopleYouMayName: nameablePeople(state, person, visit),
      person: {
        name: person.name,
        age: person.age,
        occupation: person.occupation,
        personality: person.personality,
        publicBackstory: person.publicBackstory,
        faith: person.faith,
        stress: person.stress,
        trustPriest: person.trustPriest
      },
      meeting: {
        kind: visit.issue.kind,
        gravity: visit.issue.gravity,
        desiredOutcome: visit.intent.desiredOutcome,
        scene: visit.issue.openingContext || null,
        factualDraft: visit.issue.opening,
        permittedFacts: mayDiscloseMatter ? (visit.scenarioFacts || []).map((fact) => fact.text) : [],
        confessionIsGuarded: visit.issue.kind === "confession" && !visit.hiddenConcernDisclosed
      }
    };
    const prompt = [
      "Write the visitor's first spoken words upon sitting down with a parish priest in a 16th-century village.",
      "The simulation supplies the true situation; you supply only natural dialogue. Do not narrate, summarize a scenario, label emotions, or mention being an AI.",
      "Write in first person. Never refer to the speaker by their own name. Address the priest naturally if appropriate.",
      "Refer to other villagers by first name when familiar, or by an appropriate title and surname for officials and masters. Avoid repeatedly using full names unless the priest asks for one or two people share a name.",
      "Name only people supplied in the context. This village has a fixed population and every inhabitant is already named. If you need to mention anyone else - a neighbour, another worker, an apprentice, a child - describe them by their role or relationship instead, such as 'my neighbour', 'the other two workers', or 'my sister's boy'. Never invent a personal name.",
      "CONTEXT_JSON.peopleYouMayName is the complete list of people who exist and may be named. Nobody else exists. Each entry gives their sex, age and trade: never contradict those, and never state anyone's age.",
      "Use two to five varied sentences, usually 35 to 100 words. The visitor may hesitate, pause, begin indirectly, or reveal details in an emotionally believable order.",
      "Do not mechanically list every supplied fact. Choose the details this person would actually say first, while preserving all names, quantities, relationships, and events you do mention.",
      "Never turn a supplied fact into an unsupported rumor, uncertainty, or denial. If a permitted fact says the visitor committed or witnessed an act, the visitor must not claim ignorance or innocence.",
      "End simply with: 'What would you have me do, Father?' Do not list proposed solutions, alternatives, or a menu of choices in the opening question.",
      "Never use stock design phrases such as 'the matter came to a head', 'the decision is driven by', 'the profitable choice', 'I find myself troubled', 'I am hoping you might offer some guidance', 'how best to proceed', 'I need your advice on the choice itself', 'what course of action would you counsel', or 'I understand a decision is expected'.",
      "If confessionIsGuarded is true, do not reveal the hidden act or permitted facts yet. Give a specific but guarded opening shaped by the person's occupation, stress, and reason for seeking the priest.",
      "Return only the opening field required by the schema.",
      `CONTEXT_JSON=${JSON.stringify(context)}`
    ].join("\n");
    const rawGenerated = await this.complete(prompt, openingSchema, "parish_opening", 260);
    rawGenerated.opening = humanizeOpeningQuestion(rawGenerated.opening, visit, person);
    const generated = validateOpening(
      rawGenerated,
      person.name,
      { forbidSelfDenial: Boolean(establishedSelfAction) }
    );
    generated.opening = naturalizeDialogueNames(state, person, generated.opening);
    validateOpeningGrounding(generated.opening, context, state);
    if (visit.intent.desiredOutcome === "guidance") {
      generated.opening = generalizeOpeningQuestion(generated.opening).slice(0, 800);
    }
    return validateOpening(generated, person.name, {
      requireExplicitAdvice: visit.intent.desiredOutcome === "guidance",
      forbidSelfDenial: Boolean(establishedSelfAction)
    });
  }

  async complete(prompt, schema, name, maxTokens = 500, timeoutMs = this.timeoutMs, options = {}) {
    if (this.inFlight) throw new Error("The local model is already considering another matter");
    this.inFlight = true;
    this.dispatchEvent(new CustomEvent("status", { detail: "thinking" }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const system = options.system
      || "Return only valid JSON matching the supplied schema. Never add markdown or discuss being an AI.";
    try {
      if (this.provider === "gemini") {
        return await this.completeWithGemini(prompt, schema, system, maxTokens, controller);
      }
      const body = JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: system
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.82,
        top_p: 0.94,
        top_k: 64,
        max_tokens: maxTokens,
        response_format: {
          type: "json_schema",
          json_schema: { name, strict: true, schema }
        }
      });
      let lastParseError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await this.fetchImpl(`${this.endpoint}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          signal: controller.signal,
          body
        });
        if (!response.ok) {
          const detail = await response.text();
          throw new Error(`Local model returned HTTP ${response.status}: ${detail.slice(0, 180)}`);
        }
        try {
          const parsed = parseContent(await response.json());
          this.dispatchEvent(new CustomEvent("status", { detail: "ready" }));
          return parsed;
        } catch (error) {
          lastParseError = error;
          if (attempt > 0 || !(
            error instanceof SyntaxError
            || /no usable content|unterminated|unexpected.*json/i.test(error.message)
          )) throw error;
        }
      }
      throw lastParseError;
    } catch (error) {
      this.dispatchEvent(new CustomEvent("status", { detail: "unavailable" }));
      if (error?.name === "AbortError") throw new Error("The local model took too long to answer");
      throw error;
    } finally {
      clearTimeout(timeout);
      this.inFlight = false;
    }
  }

  async completeWithGemini(prompt, schema, system, maxTokens, controller) {
    if (!this.apiKey) throw new Error("No Gemini API key has been entered");
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.82,
        topP: 0.94,
        /* The reply is JSON of a known shape, so give it room for the answer
           and none for deliberation: 2.5-flash otherwise spends much of the
           budget thinking and can stop before it has written anything. */
        maxOutputTokens: Math.max(256, maxTokens),
        responseMimeType: "application/json",
        responseSchema: toGeminiSchema(schema),
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
    let lastParseError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.fetchImpl(
        `${GEMINI_ROOT}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          signal: controller.signal,
          body
        }
      );
      if (!response.ok) {
        const detail = await response.text();
        if (response.status === 429) {
          throw new Error("Gemini's free tier is rate limited just now; the parish rules will answer instead");
        }
        if (response.status === 400 || response.status === 403) {
          throw new Error(`Gemini rejected the request: ${detail.slice(0, 160)}`);
        }
        throw new Error(`Gemini returned HTTP ${response.status}: ${detail.slice(0, 160)}`);
      }
      try {
        const parsed = geminiContent(await response.json());
        this.dispatchEvent(new CustomEvent("status", { detail: "ready" }));
        return parsed;
      } catch (error) {
        lastParseError = error;
        if (attempt > 0) throw error;
      }
    }
    throw lastParseError;
  }

  buildNaturalPrompt(state, person, visit, playerText, {
    knowledgeLines,
    reactionPreview,
    turnAnalysis,
    stagedGifts = [],
    correction
  }) {
    const guarded = visit.issue.kind === "confession" && !visit.hiddenConcernDisclosed;
    const traits = (person.personality?.traits || []).slice(0, 4).join(", ");
    const people = nameablePeople(state, person, visit);
    const household = state.households.find((entry) => entry.id === person.householdId);
    /* A priest may ask his parishioners for help as well as give it. The
       visitor has to weigh that against what is actually in their house, so
       they are told plainly what they have before they are asked to answer. */
    const priestAsksForHelp = readDonationRequest(playerText);

    // Kept byte-stable across the visit so the model's prefix cache is reused.
    const system = [
      `You are ${person.firstName}, aged ${person.age}, a ${person.occupation} in the village of ${state.town.name} in the 1500s, speaking privately with your parish priest.`,
      traits ? `Your nature: ${traits}.` : "",
      person.publicBackstory
        ? `About you: ${firstSentence(guarded ? person.publicBackstory : (person.backstory || person.publicBackstory), 200)}`
        : "",
      people.length
        ? [
          "EVERY PERSON YOU MAY NAME — this is the whole of it, and there is nobody else:",
          ...people.map((row) => `  ${row}`),
          householdTruthLine(state, person),
          "Do not name any person who is not on that list. Not a neighbour, not a fellow worker, not an apprentice, not a child, not a healer, not an officer. If you must speak of someone who is not listed, describe them without a name: 'my neighbour', 'the other two workers', 'the old man at the end of the lane', 'a woman at the market'. Never contradict a listed person's sex or age, and never state an age for anyone.",
          "If the priest asks you to name somebody you do not have — a wife you never had, a child who was never born, a master you do not serve — say so plainly and hold to it. Never invent a name to satisfy him, however many times he asks."
        ].filter(Boolean).join("\n")
        : "",
      "",
      "How you speak:",
      "- Answer what the priest just said before anything else. If he changes the subject, follow him; never restart your original problem.",
      "- References like 'that', 'him', 'the other one' and 'why' point at things already said. Work out what they mean.",
      "- If he corrects you, take the correction and answer what he actually meant.",
      "- Speak aloud, in the first person. No narration, no asterisks, no stage directions, no lists.",
      "- Let the length follow the thought. A flat refusal or a hard admission can be four words. Explaining something difficult may take three sentences. Do not pad a short answer out to a comfortable length.",
      "- You are not only being questioned. Ask the priest something back when you would really want to know: whether he will come with you, what to tell your family, whether it is a sin, what happens if you refuse.",
      "- You may agree, disagree, refuse, hesitate, or admit you do not know. If his suggestion genuinely settles your worry and you trust it, simply accept it and say so. Never drag things out to fill time.",
      "- Only name people you know or who were already named. Never invent an official, expert, place, or institution; say plainly if no one suitable exists.",
      "- This also means ordinary villagers. Every soul in this parish is already named, and the names above are the only ones you have. Never make up a personal name for a neighbour, a fellow worker, an apprentice, a sick man, or a child. Speak of them by role or relation instead: 'my neighbour', 'the other two workers', 'the old man at the end of the lane', 'my sister's boy'. An invented name becomes a person who does not exist, and the priest will go looking for them.",
      "- Never invent money. Do not name a sum you owe, a sum owed to you, a loan, a creditor, or a price, unless it was given to you above. If your household owes nothing, do not hint that it does. The priest acts on what you tell him, and he will set about relieving a debt that was never real.",
      "- When the priest asks who somebody is and you have not been told, say plainly that you do not know: 'I never learned her name', 'I could not tell you', 'I only know him by sight'. Do not answer with a placeholder such as 'someone' or 'a person', which is not an answer, and do not reach for a name to fill the gap. Not knowing is an honest answer and the priest can work with it.",
      "- Your worry may turn out to be nothing. The matter that brought you here is what you believed when you set out, not a proven fact. If the priest's questions show that you were mistaken, that you feared more than the case warranted, that you misheard, or that no real harm was done at all, then say so and let it go. Do not hunt for a hidden wrong to justify having come. An honest 'I think I was wrong to fear it' is a good end to a visit.",
      "- Never give anyone an office or trade they do not hold. The people listed above are shown with their actual work; use it or use their plain name. Do not call a man Bailiff, Reeve, Watchman or Master of anything unless that is truly his office, because the priest can send for these people and will act on the authority you name.",
      "- The people above are listed with their sex and their age in years. Never contradict either. Do not call a woman he, do not speak of a child as a grown man or a suitor, do not give anyone an age, and do not describe an infant as able to work, court, marry or speak for themselves.",
      "- Each of them is also listed with what they are to you: your mother, your son, your husband, of your household, known to you, not known to you personally. That is the truth of it. Never call your own kin a neighbour or a stranger, and never claim a kinship the list does not give you.",
      "- The same holds for families and households. Surnames in this village are the ones listed above and no others: never speak of \"the Blackwood family\" or any house you have not been told exists. If you mean a household, name someone in it, or say \"the family up the lane\" without giving them a surname.",
      "- The priest does not leave his church. He cannot call on you at home, walk anywhere with you, or go to anyone himself. He can send for people to come to him, or send the watch. If he says he will come to you, you may gently say that you will come to him instead, or ask him to send someone.",
      "- Leave the priest something to take hold of: what you want, what you refuse, what would have to change, or a question he must answer.",
      "- Stay in character. You are not an assistant. Return only the JSON asked for."
    ].filter(Boolean).join("\n");

    const recentTurns = 6;
    const summary = compactHistorySummary(visit.history, recentTurns);
    const recent = visit.history.slice(-recentTurns).map((line) => (
      `${line.speaker === "priest" ? "Priest" : "You"}: ${line.text}`
    ));
    const speakableFacts = (visit.scenarioFacts || [])
      .filter((fact) => fact.speakable !== false && visit.revealedFactIds.includes(fact.id))
      .slice(-2)
      .map((fact) => `- ${spokenScenarioFact(fact.text, state, person)}`);
    const softGuidance = SOFT_REACTION_GUIDANCE[reactionPreview.requiredReaction];
    const openThreads = openThreadsForPrompt(visit);
    const lastOwnLine = [...visit.history].reverse().find((line) => line.speaker === "visitor")?.text || "";

    const user = [
      `How you feel right now: ${emotionalStateWords(visit).join(", ")}.`,
      `Play it exactly this hot, and no hotter: ${conversationIntensity(visit)}`,
      `What you came for: ${visit.intent.primaryMatter}. You want ${visit.intent.desiredOutcome}.`,
      softGuidance ? `Right now: ${softGuidance}` : "",
      /* A conversational objective must not outlive the facts that supported
         it. A reeve who came fearing to name a thief established, under
         questioning, that he did not know who the thief was - and then went on
         saying "I have no knowledge of who took it. I fear to speak of the
         thief" for the rest of the visit, because nothing had retired the fear
         when its subject disappeared. */
      visit.intent.retiredConcern
        ? `You have already told the priest, plainly, that you do not have this knowledge: ${visit.intent.retiredConcern} That matter is settled and you are no longer holding anything back about it. Do not return to fearing to reveal it, and do not hint that you know more than you have said.`
        : "",
      visit.intent.premiseDispelled
        ? "You have already admitted that the worry which brought you here was mistaken. That is settled. Do not go looking for some other hidden wrong to put in its place; speak plainly about what is actually left to do, or accept the priest's counsel and be at peace."
        : "",
      guarded && !visit.intent.retiredConcern
        ? "You have NOT yet told the priest your real secret. Do not blurt it out and do not invent one."
        : "",
      !guarded && visit.intent.hiddenConcern && !visit.intent.retiredConcern
        ? `You have already told the priest this, and may speak of it freely: ${visit.intent.hiddenConcern}`
        : "",
      knowledgeLines.length
        ? `True things you know, in your own words if they come up:\n${knowledgeLines.map((line) => `- ${line}`).join("\n")}`
        : "",
      speakableFacts.length ? `Your situation:\n${speakableFacts.join("\n")}` : "",
      /* What is actually in the house. Until now the visitor was told this only
         when the priest asked them for a donation, so in ordinary talk the model
         invented money freely - one woman with an empty ledger declared she owed
         twenty silver pennies. Stating the plain truth every turn, and saying so
         explicitly when there is no debt at all, removes the vacuum it was
         filling. */
      household ? householdMeansLine(household, visit) : "",
      openThreads.length ? `Still unsettled between you:\n${openThreads.map((line) => `- ${line}`).join("\n")}` : "",
      summary ? `Earlier in this conversation: ${summary}` : "",
      recent.length ? `The conversation just now:\n${recent.join("\n")}` : "",
      lastOwnLine
        ? `You ALREADY said: "${firstSentence(lastOwnLine, 160)}" — say something different from that, and answer what was actually just asked.`
        : "",
      /* What the church can help with, without its books.
         A villager pressed for exact numbers once recited the church's entire
         inventory as her own household's - twenty-three pennies, fourteen
         sacks of grain, sixteen bundles of onions - because those were the
         only precise figures anywhere in her context. She has no way of
         knowing what the church holds, and the engine already refuses a gift
         the stores cannot cover, so the quantities were never needed. */
      `What the church has in store, if the priest offers you any of it: ${churchResourceRows(state.churchResources)
        .filter((row) => row.amount > 0)
        .map((row) => `${row.label.toLowerCase()} [${row.key}]`)
        .join("; ") || "nothing at present"}. You do not know how much of any of it the church holds, and must never state a quantity from its stores.`,
      /* Their own stores, so that a question about their household has a
         truthful answer to reach for. */
      household
        ? `What is in your own house, roughly: ${Math.max(0, Math.round(household.wealth / 4))} pennies, `
          + `${Math.max(0, Math.round(household.food / 6))} measures of food in the larder, `
          + `${Math.max(0, Math.round((household.fuel || 0) / 3))} bundles of firewood. `
          + "You keep no written account, so give these as a countryman would - about, near enough, no more than - and say plainly when you do not know an exact number."
        : "",
      `THE PRIEST JUST SAID: "${boundedString(playerText, 600)}"`,
      /* Ground truth about anyone he named, so the visitor never has to guess
         whether a person the priest mentions is real. */
      (() => {
        const named = peopleThePriestNamed(state, person, playerText);
        return named.length
          ? `THE PARISH RECORD, on the people he just named:\n${named.map((line) => `- ${line}`).join("\n")}`
          : "";
      })(),
      stagedGifts.length
        ? `AS HE SPEAKS HE IS HANDING YOU: ${stagedGifts.map((gift) => {
          const row = churchResourceRows(state.churchResources).find((entry) => entry.key === gift.resource);
          return `${gift.amount} ${row?.unit || ""} of ${row?.label.toLowerCase() || gift.resource}`.replace(/\s+/g, " ");
        }).join(", ")}. React to being handed it, whether with thanks, embarrassment, or refusal.`
        : "",
      correction || "",
      "",
      "Reply in JSON.",
      "understoodPlayerAs: plainly, what the priest just meant. Write this first.",
      "reply: what you say aloud.",
      "npcIntent: what you are trying to do by saying it.",
      "priestGivesFromChurch: EVERY item the priest names in the words above, each as its own entry, for example [{\"resource\":\"bread\",\"amount\":2},{\"resource\":\"grain\",\"amount\":1},{\"resource\":\"beans\",\"amount\":1}]. If he says \"two loaves, a sack of grain and a bundle of firewood\", list all three. Only fill this in if he actually offered something just now, and never copy the amounts the church holds — those are what is left in store, not what he gave. Leave it empty if he offered nothing, only promised something later, or asked you to give.",
      "If he is giving you something, say so in your reply as a person would: thank him, or say what it will mean for your household, or refuse it if you would.",
      "visitorGivesToChurch: anything you are offering to the church out of your own household right now, in the same form. Leave it empty unless you are genuinely offering, and never offer more than your household could truly spare.",
      priestAsksForHelp.asked && household
        ? `HE IS ASKING YOU TO GIVE SOMETHING TO THE CHURCH. Your household has ${bandOfMeans(household.wealth)} in coin and ${bandOfMeans(household.food)} in the larder${household.debt > 0 ? ", and you owe money" : ""}. Decide as this person truly would: weigh what you can spare against what you think of this priest${priestAsksForHelp.manner === "threatening" ? ", and note that he is leaning on fear to get it, which you may resent even as you comply" : ""}. Answer him aloud either way, and fill in visitorGivesToChurch only if you are actually parting with something now.`
        : "",
      turnAnalysis.proposals.length
        ? `decisions: for each of these, say accepted, rejected, deferred or unknown: ${JSON.stringify(turnAnalysis.proposals.map((proposal) => ({ proposalId: proposal.proposalId, text: proposal.rawText })))}`
        : "proposedActions: anything you say you will actually do, as action plus target. Leave empty if none."
    ].filter(Boolean).join("\n");

    return { system, user };
  }

  async naturalConversation(state, person, visit, playerText, {
    obligation,
    reactionPreview,
    turnAnalysis,
    knowledgeLines,
    requiredFacts,
    issueId,
    currentQuestionTurnId,
    stagedGifts = []
  }) {
    const transformations = [];
    const useDecisions = turnAnalysis.proposals.length > 0;
    const schema = useDecisions ? naturalDecisionSchema : naturalConversationSchema;
    const buildPrompt = (correction) => this.buildNaturalPrompt(state, person, visit, playerText, {
      knowledgeLines,
      reactionPreview,
      turnAnalysis,
      stagedGifts,
      correction
    });

    let { system, user: prompt } = buildPrompt("");
    let raw = await this.complete(
      prompt,
      schema,
      useDecisions ? "parish_natural_conversation_decisions" : "parish_natural_conversation",
      320,
      Math.min(this.timeoutMs, 45000),
      { system }
    );
    const originalReply = trimToSentence(boundedProse(stripControlSuffix(raw.reply), 600));
    let reply = originalReply;
    if (!reply) throw new Error("The visitor gave no reply");

    const priorLines = (visit.lastVisitorReplies || []).slice(-3);
    const repetition = Math.max(0, ...priorLines.map((line) => repetitionScore(reply, line)));
    if (repetition >= 0.85 && priorLines.length) {
      transformations.push({
        type: "repetition_regeneration",
        detail: `overlap ${repetition.toFixed(2)} with an earlier line`,
        code: "naturalConversation:repetition"
      });
      try {
        const retryPrompt = buildPrompt("- You just repeated yourself. Say something genuinely new that moves this forward, or ask the priest a question.");
        prompt = retryPrompt.user;
        const retry = await this.complete(
          prompt,
          schema,
          "parish_natural_conversation_retry",
          200,
          Math.min(this.timeoutMs, 40000),
          { system: retryPrompt.system }
        );
        const retryReply = trimToSentence(boundedProse(stripControlSuffix(retry.reply), 600));
        if (retryReply) {
          raw = retry;
          reply = retryReply;
        }
      } catch (retryError) {
        transformations.push({
          type: "repetition_regeneration_failed",
          detail: retryError.message,
          code: "naturalConversation:repetition"
        });
      }
    }

    /* Villagers conjured out of nothing, and debts the ledger does not carry.
       The parish is a closed population of two hundred named souls, so a name
       belonging to none of them is a person who does not exist - and the priest
       will repeat it back, ask after them, and send the watch to find them. An
       invented debt is worse still, because the priest will set about relieving
       it. Ask once for the line again, grounded in what is true. */
    const priestSaid = String(playerText || "");
    /* Everything this visitor has already said in the visit. A name the priest
       uses is normally not the visitor's invention - but if the visitor put it
       in his mouth in the first place, it is, and exempting it would let a
       phantom become permanent the moment the priest repeated it once. */
    const visitorSaidEarlier = (visit.history || [])
      .filter((line) => line.speaker === "visitor")
      .map((line) => line.text)
      .join(" ");
    const invented = unknownPersonNames(state, reply).filter((name) => {
      const word = new RegExp(`\\b${name}\\b`);
      return !word.test(priestSaid) || word.test(visitorSaidEarlier);
    });
    const falseDebts = unsupportedDebtClaims(state, person, visit, reply);
    const wrongTitles = misappliedTitles(state, reply);
    const rewritten = contradictedIdentities(state, reply);
    const wrongKin = contradictedKinship(state, person, reply);
    if (invented.length || falseDebts.length || wrongTitles.length || rewritten.length || wrongKin.length) {
      const complaint = [
        invented.length ? `named nobody who exists: ${invented.join(", ")}` : "",
        falseDebts.length ? `claimed a debt not in the ledger: ${falseDebts.join(", ")}` : "",
        wrongTitles.length ? `gave an office nobody holds: ${wrongTitles.join(", ")}` : "",
        rewritten.length ? `contradicted the parish record: ${rewritten.join(", ")}` : "",
        wrongKin.length ? `mistook their own kin: ${wrongKin.join(", ")}` : ""
      ].filter(Boolean).join("; ");
      transformations.push({
        type: "ungrounded_detail_regeneration",
        detail: complaint,
        code: "naturalConversation:ungroundedDetail"
      });
      try {
        const notes = [
          invented.length
            ? `- You named ${invented.join(" and ")}, and no such person lives in this village. Refer to them by role or relation instead - 'my neighbour', 'the other two workers', 'the old man at the end of the lane' - or name someone from the people you actually know.`
            : "",
          falseDebts.length
            ? `- You spoke of owing ${falseDebts.join(" and ")}, but your household owes nothing. Do not invent a debt or a sum of money. Say what is actually true of your situation instead.`
            : "",
          wrongTitles.length
            ? `- You called ${wrongTitles.join(" and ")}. Do not give anyone an office they do not hold. Use their plain name, or name the person who really holds that office.`
            : "",
        wrongKin.length
          ? `- You said ${wrongKin.join(" and ")}. The list of people you may name says what each of them is to you. Use that, and never call your own kin a neighbour.`
          : ""
        ].filter(Boolean).join("\n");
        const retryPrompt = buildPrompt(notes);
        prompt = retryPrompt.user;
        const retry = await this.complete(
          prompt,
          schema,
          "parish_natural_conversation_grounding",
          200,
          Math.min(this.timeoutMs, 40000),
          { system: retryPrompt.system }
        );
        const retryReply = trimToSentence(boundedProse(stripControlSuffix(retry.reply), 600));
        /* Only take the retry if it actually mended the problem. */
        if (
          retryReply
          && unknownPersonNames(state, retryReply).length === 0
          && unsupportedDebtClaims(state, person, visit, retryReply).length === 0
          && misappliedTitles(state, retryReply).length === 0
        && contradictedKinship(state, person, retryReply).length === 0
        ) {
          raw = retry;
          reply = retryReply;
        } else if (retryReply
          && unknownPersonNames(state, retryReply).length < unknownPersonNames(state, reply).length) {
          /* Not perfect, but nearer the truth than what it replaced. */
          raw = retry;
          reply = retryReply;
        }
      } catch (retryError) {
        transformations.push({
          type: "ungrounded_detail_regeneration_failed",
          detail: retryError.message,
          code: "naturalConversation:ungroundedDetail"
        });
      }
      /* Whatever the model did or failed to do, no invented villager reaches
         the player. */
      const stubborn = unknownPersonNames(state, reply);
      if (stubborn.length) {
        const cleaned = stripInventedNames(state, reply);
        if (cleaned && cleaned !== reply) {
          transformations.push({
            type: "invented_villager_stripped",
            detail: `removed ${stubborn.join(", ")} after the retry kept them`,
            code: "naturalConversation:ungroundedDetail"
          });
          reply = cleaned;
        }
      }
    }

    const sentences = reply.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [reply];
    const keptSentences = [];
    for (const sentence of sentences) {
      const leaked = (visit.scenarioFacts || []).find((fact) => {
        if (fact.speakable !== false) return false;
        const normalizedFact = String(fact.text).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
        if (normalizedFact.length < 35) return false;
        return sentence.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").includes(normalizedFact);
      });
      if (leaked) {
        transformations.push({ type: "sentence_removed", detail: `framework fact leak (${leaked.id})`, code: "naturalConversation:factLeak" });
        continue;
      }
      keptSentences.push(sentence);
    }
    if (keptSentences.length && keptSentences.length !== sentences.length) {
      reply = boundedProse(keptSentences.join(" "), 600);
    }

    const institutionRepair = groundedInstitutionReply(state, person, visit, reply);
    if (institutionRepair) {
      const cleaned = (reply.match(/[^.!?]+[.!?]?/g) || [reply])
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence && !/\bvillage elder\b/i.test(sentence));
      reply = boundedProse([...cleaned, institutionRepair].join(" "), 600);
      transformations.push({ type: "sentence_repaired", detail: "referred to a village elder that does not exist", code: "groundedInstitutionReply" });
    }

    const namedReply = naturalizeDialogueNames(state, person, reply);
    if (namedReply !== reply) {
      transformations.push({ type: "names_naturalized", detail: "full names shortened to natural address", code: "naturalizeDialogueNames" });
      reply = namedReply;
    }

    const proposedActions = [];
    for (const action of (raw.proposedActions || []).slice(0, 3)) {
      const resolved = resolveActionTarget(state, person, action.target);
      if (!resolved) {
        transformations.push({ type: "action_dropped", detail: `unknown target "${action.target}"`, code: "resolveActionTarget" });
        continue;
      }
      proposedActions.push({ action: boundedString(action.action, 80), targetId: resolved.id, targetName: resolved.name });
    }

    // The model may notice that the priest handed something over, but the
    // engine decides whether the church can actually spare it. A priest who
    // offers grain, bread and firewood in one breath is giving three things.
    const churchGifts = [];
    const reportedGifts = Array.isArray(raw.priestGivesFromChurch)
      ? raw.priestGivesFromChurch
      : (raw.priestGivesFromChurch ? [raw.priestGivesFromChurch] : []);
    /* Gifts can arrive two ways: the priest says he is giving something, or he
       hands it over explicitly through the interface. They are merged by
       taking the larger of the two rather than adding them together, so
       pressing "give two loaves" and then also saying "take two loaves" hands
       over two loaves and not four. */
    const mergedGifts = new Map();
    for (const gift of [...reportedGifts, ...stagedGifts]) {
      const key = gift?.resource;
      if (!key) continue;
      const amount = Math.max(0, Math.min(100, Math.floor(Number(gift.amount) || 0)));
      mergedGifts.set(key, Math.max(mergedGifts.get(key) || 0, amount));
    }
    const requestedGifts = [...mergedGifts].map(([resource, amount]) => ({ resource, amount }));
    const remaining = Object.fromEntries(
      churchResourceRows(state.churchResources).map((row) => [row.key, row.amount])
    );
    /* The stores are listed in the prompt so the visitor cannot accept what the
       parish does not hold. A model will sometimes read that list straight back
       as a gift — handing over the whole stock of firewood during a
       conversation about letters. Nothing leaves the stores unless the priest
       actually offered something in the words he just spoke. */
    const givingClauses = givingClausesIn(playerText);
    const priestOffered = givingClauses.length > 0 || stagedGifts.length > 0;
    /* Offering one thing is not offering everything. Staging firewood licensed
       the visitor's account of a loaf of bread, because the gate asked only
       whether *something* had been offered. Each thing that leaves the stores
       has to have been offered in its own right, which means naming it in the
       clause that offered it: "I cannot give you medicine, but I will give you
       bread" hands over bread only. */
    const offeredResource = (key) => (
      stagedGifts.some((gift) => gift.resource === key)
      || givingClauses.some((clause) => namesChurchResource(clause, key))
    );
    if (requestedGifts.length && !priestOffered) {
      transformations.push({
        type: "gift_rejected",
        detail: "the priest offered nothing in this turn",
        code: "naturalConversation:noOfferMade"
      });
    }
    /* A priest confirming aid he has already promised is not giving it twice.
       Without this, "take two loaves" followed by "I shall have the two loaves
       brought to your house" emptied the bread twice over. Only the amount by
       which a restated offer exceeds what has already been handed over in this
       visit actually leaves the stores. */
    /* A working copy: the engine updates the visit's own ledger when the gift
       is actually granted. Mutating it here as well would count every gift
       twice and desynchronise a replay. */
    const ledger = { ...(visit.giftLedger || {}) };
    for (const requested of (priestOffered ? requestedGifts : []).slice(0, 4)) {
      const row = churchResourceRows(state.churchResources)
        .find((entry) => entry.key === requested?.resource);
      const amount = Math.max(0, Math.min(100, Math.floor(Number(requested?.amount) || 0)));
      if (!row) {
        transformations.push({
          type: "gift_rejected",
          detail: `unknown church resource "${requested?.resource}"`,
          code: "naturalConversation:churchGift"
        });
        continue;
      }
      if (!offeredResource(row.key)) {
        transformations.push({
          type: "gift_rejected",
          detail: `the priest offered no ${row.label.toLowerCase()} in this turn`,
          code: "naturalConversation:resourceNotOffered"
        });
        continue;
      }
      if (amount <= 0) {
        transformations.push({
          type: "gift_rejected",
          detail: "the amount given was not a positive number",
          code: "naturalConversation:churchGift"
        });
        continue;
      }
      const alreadyGiven = ledger[row.key] || 0;
      if (amount <= alreadyGiven) {
        transformations.push({
          type: "gift_already_made",
          detail: `${amount} ${row.unit} of ${row.label.toLowerCase()} was already given in this visit`,
          code: "naturalConversation:giftLedger"
        });
        continue;
      }
      const owed = amount - alreadyGiven;
      const available = remaining[row.key] ?? 0;
      if (available <= 0) {
        transformations.push({
          type: "gift_rejected",
          detail: `the church has no ${row.label.toLowerCase()} left`,
          code: "naturalConversation:churchGift"
        });
        continue;
      }
      if (available < owed) {
        transformations.push({
          type: "gift_reduced",
          detail: `the church holds only ${available} ${row.unit} of ${row.label.toLowerCase()}`,
          code: "naturalConversation:churchGift"
        });
        churchGifts.push({ resource: row.key, amount: available, shortfall: owed - available });
        ledger[row.key] = alreadyGiven + available;
        remaining[row.key] = 0;
        continue;
      }
      churchGifts.push({ resource: row.key, amount: owed });
      ledger[row.key] = alreadyGiven + owed;
      remaining[row.key] = available - owed;
    }

    /* A villager may also give to the church out of their own household. The
       engine decides what they can truly spare, not the model. */
    const visitorDonations = [];
    const offeredDonations = Array.isArray(raw.visitorGivesToChurch) ? raw.visitorGivesToChurch : [];
    for (const offer of offeredDonations.slice(0, 4)) {
      const row = churchResourceRows(state.churchResources).find((entry) => entry.key === offer?.resource);
      const amount = Math.max(0, Math.min(100, Math.floor(Number(offer?.amount) || 0)));
      if (!row || amount <= 0) {
        transformations.push({
          type: "donation_rejected",
          detail: `cannot donate "${offer?.resource}"`,
          code: "naturalConversation:donation"
        });
        continue;
      }
      const capacity = row.key === "coin"
        ? Math.floor(state.households.find((entry) => entry.id === person.householdId)?.wealth || 0)
        : churchDonationCapacity(state, person, row.key);
      if (capacity < amount) {
        transformations.push({
          type: "donation_reduced",
          detail: `the household can spare only ${Math.max(0, capacity)} ${row.unit}`,
          code: "naturalConversation:donation"
        });
        if (capacity > 0) visitorDonations.push({ resource: row.key, amount: capacity });
        continue;
      }
      visitorDonations.push({ resource: row.key, amount });
    }

    const claims = proposedActions.map((action, index) => ({
      claimId: `intent-${String(index + 1).padStart(2, "0")}`,
      sentenceIndex: 0,
      type: "promise",
      text: `${action.action} — ${action.targetName}`,
      subjectId: person.id,
      targetIds: [action.targetId],
      evidenceFactIds: [],
      confidence: 0.7
    }));

    const decisions = useDecisions
      ? turnAnalysis.proposals.map((proposal) => {
        const match = (raw.decisions || []).find((entry) => entry.proposalId === proposal.proposalId);
        return {
          proposalId: proposal.proposalId,
          status: match?.status || "unknown",
          reason: boundedProse(raw.npcIntent, 120)
        };
      })
      : [];

    const understood = boundedProse(raw.understoodPlayerAs, 220);
    const result = {
      reply,
      memory: boundedProse(raw.npcIntent || understood, 180),
      interpretation: {
        speechActs: [{
          type: turnAnalysis.actKinds[0] || "observation_or_open_dialogue",
          meaning: understood,
          referenceText: boundedString(playerText, 100),
          confidence: 0.9
        }],
        implicitMeaning: understood,
        tone: "natural",
        mandatoryResponseNeeds: understood ? [understood] : []
      },
      responsePlan: {
        primaryObligationId: obligation.obligationId,
        secondaryObligationIds: [],
        knownFactIds: requiredFacts.map((fact) => fact.id),
        unknowns: [],
        proposalPositions: decisions.map((decision) => ({
          proposalId: decision.proposalId,
          status: decision.status,
          reason: decision.reason
        })),
        desiredMovement: boundedProse(raw.npcIntent, 160),
        endConversation: false
      },
      claims,
      answeredObligations: [obligation.obligationId, ...obligation.requiredAnswerSlots],
      newQuestions: /\?\s*$/.test(reply) ? [firstSentence(reply.split(/(?<=[.!?])\s+/).at(-1) || reply, 180)] : [],
      decisions,
      structuredProvided: true,
      referencedTurnIndexes: [],
      expressedReaction: reactionPreview.requiredReaction,
      boundaryProposal: reactionPreview.nextState.boundary?.type || null,
      reactionPreview,
      stagnationCount: 0,
      conversationObligation: obligation,
      proposedActions,
      churchGifts,
      churchGift: churchGifts[0] || null,
      visitorDonations,
      understoodPlayerAs: understood,
      segments: [{
        text: reply,
        issueId,
        answeredQuestionTurnIds: playerText.includes("?") ? [currentQuestionTurnId] : [],
        referencedFactIds: requiredFacts.map((fact) => fact.id)
      }],
      endsConversation: HARD_MECHANICAL_REACTIONS.has(reactionPreview.requiredReaction)
    };
    result.promptTrace = boundedPromptTrace({
      obligation,
      prompt,
      includedFactIds: requiredFacts.map((fact) => fact.id),
      initialReply: originalReply,
      finalReply: reply,
      decisions,
      mandatoryAnswerPassed: true,
      retryUsed: transformations.some((entry) => entry.type === "repetition_regeneration"),
      route: "natural_conversation",
      responseSource: reply === originalReply
        ? (this.endpoint.includes("copilot") ? "copilot_dialogue" : "gemma_dialogue")
        : (this.endpoint.includes("copilot") ? "copilot_repaired" : "gemma_repaired"),
      gemmaCalled: true,
      repetitionDetected: repetition >= 0.85,
      semanticInterpretation: result.interpretation,
      responsePlan: result.responsePlan,
      claims,
      understoodPlayerAs: understood,
      suppliedKnowledge: knowledgeLines,
      transformations,
      rawModelReply: originalReply
    });
    return result;
  }

  async conversation(state, person, playerText, { stagedGifts = [] } = {}) {
    const visit = state.currentVisit;
    ensureConversationContinuity(visit);
    const reactionPreview = previewConversationReaction(state, person, visit, playerText);
    const mode = responseMode(state, person, visit);
    const turnAnalysis = analyzePlayerTurn(playerText, visit.turnsUsed + 1);
    const requiredFacts = clarificationFacts(visit, playerText);
    const issueId = visit.issue.threadId || visit.issue.scenarioId || visit.issue.kind;
    const currentQuestionTurnId = `priest-${visit.history.length}`;
    const socialRequirement = compoundTurnRequirement(state, person, turnAnalysis)
      || proposalDecisionQuestionRequirement(visit, playerText)
      || directSocialRequirement(state, person, visit, playerText, mode)
      || directiveRequirement(state, visit, playerText);
    const deterministicSocial = Boolean(socialRequirement && DETERMINISTIC_SOCIAL_TYPES.has(socialRequirement.type));
    const directAnswer = requiredFacts.length
      ? renderRequiredFactAnswer(state, person, visit, requiredFacts)
      : "";
    const mentionedFactIdsBefore = [...new Set([
      ...(visit.continuity.mentionedFactIds || []),
      ...factIdsMentionedInText(visit.scenarioFacts, visit.history[0]?.text || "")
    ])];
    const planningVisit = {
      ...visit,
      continuity: { ...visit.continuity, mentionedFactIds: mentionedFactIdsBefore }
    };
    const obligation = selectConversationObligation({
      visit: planningVisit,
      playerText,
      reactionPreview,
      socialRequirement,
      deterministicSocial,
      requiredFacts,
      directAnswer,
      scenarioFactIds: (visit.scenarioFacts || []).map((fact) => fact.id),
      turnAnalysis
    });

    if (HARD_MECHANICAL_REACTIONS.has(reactionPreview.requiredReaction)) {
      const reply = reactionFallbackReply(person, reactionPreview);
      return {
        reply,
        memory: "The visitor reacted to the priest and the meeting broke off.",
        interpretation: "",
        referencedTurnIndexes: [],
        expressedReaction: reactionPreview.requiredReaction,
        boundaryProposal: reactionPreview.nextState.boundary?.type || null,
        segments: [{
          text: reply,
          issueId,
          answeredQuestionTurnIds: playerText.includes("?") ? [currentQuestionTurnId] : [],
          referencedFactIds: []
        }],
        groundedFallback: true,
        stagnationCount: 0,
        reactionPreview,
        conversationObligation: obligation,
        decisions: [],
        endsConversation: true,
        promptTrace: boundedPromptTrace({
          obligation,
          prompt: "",
          includedFactIds: [],
          initialReply: reply,
          finalReply: reply,
          decisions: [],
          mandatoryAnswerPassed: true,
          retryUsed: false,
          route: "hard_mechanical_reaction",
          responseSource: "scripted_reaction",
          gemmaCalled: false,
          repetitionDetected: false,
          transformations: [{
            type: "deterministic_reaction",
            detail: `mechanical threshold: ${reactionPreview.requiredReaction}`,
            code: "conversation:hardMechanicalReaction"
          }]
        })
      };
    }

    const knowledgeLines = [];
    for (const fact of requiredFacts) {
      knowledgeLines.push(spokenScenarioFact(fact.text, state, person));
    }
    // A compound turn's fallback sentence is stitched together from the raw
    // wording of each clause ("I cannot promise yet to We must seek..."), so it
    // is not usable prose and must never be offered to the model as something
    // it knows. The clauses themselves are already listed for decision.
    if (socialRequirement?.fallbackReply
      && socialRequirement.type !== "compound_turn"
      && knowledgeLines.length < 4) {
      knowledgeLines.push(naturalizeDialogueNames(state, person, socialRequirement.fallbackReply));
    }

    return this.naturalConversation(state, person, visit, playerText, {
      obligation,
      reactionPreview,
      turnAnalysis,
      knowledgeLines: knowledgeLines.slice(0, 4),
      requiredFacts,
      issueId,
      currentQuestionTurnId,
      stagedGifts
    });
  }

  async departure(state, candidates) {
    const visit = state.currentVisit;
    const issueThread = state.issueThreads.find((thread) => thread.id === visit.issue.threadId);
    const boundedCandidates = candidates.slice(0, 12);
    const person = boundedCandidates.find((candidate) => candidate.id === visit.personId);
    const actorIds = boundedCandidates.map((candidate) => candidate.id);
    const targetIds = [...actorIds, "priest"];
    const stepSchema = {
      type: "object",
      additionalProperties: false,
      required: ["depth", "actorId", "targetId", "actionType", "intensity", "title", "description"],
      properties: {
        depth: { type: "integer", minimum: 1, maximum: 3 },
        parentStepIndex: { type: ["integer", "null"], minimum: 0, maximum: 1 },
        actorId: { type: "string", enum: actorIds },
        targetId: { type: ["string", "null"], enum: [...targetIds, null] },
        actionType: { type: "string", enum: AI_ALLOWED_ACTIONS },
        intensity: { type: "integer", minimum: 1, maximum: 5 },
        title: { type: "string", maxLength: 100 },
        description: { type: "string", maxLength: 240 },
        detail: { type: "string", maxLength: 120 },
        motive: {
          type: "string",
          enum: ["benevolent", "selfish", "cruel", "political", "absurd", "power_seeking", "fearful", "faithful", "practical"]
        },
        evidence: { type: "string", maxLength: 140 },
        composition: {
          type: ["object", "null"],
          additionalProperties: false,
          required: [
            "domain", "verb", "targetIds", "objectType", "resourceType",
            "quantity", "locationId", "method", "visibility", "timing",
            "condition", "evidenceTurnIds"
          ],
          properties: {
            domain: { type: "string", maxLength: 40 },
            verb: { type: "string", maxLength: 40 },
            targetIds: {
              type: "array",
              maxItems: 2,
              items: { type: "string", enum: targetIds }
            },
            objectType: { type: ["string", "null"], maxLength: 60 },
            resourceType: { type: ["string", "null"], maxLength: 40 },
            quantity: { type: ["integer", "null"], minimum: 0, maximum: 100 },
            locationId: { type: ["string", "null"], maxLength: 80 },
            method: { type: ["string", "null"], maxLength: 80 },
            visibility: { type: "string", enum: ["private", "household", "public"] },
            timing: { type: ["string", "null"], maxLength: 60 },
            condition: { type: ["string", "null"], maxLength: 120 },
            evidenceTurnIds: {
              type: "array",
              maxItems: 5,
              items: { type: "string", maxLength: 80 }
            }
          }
        },
        effects: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["scope", "key", "delta", "reason"],
            properties: {
              scope: {
                type: "string",
                enum: ["town", "material", "issue", "actor", "target"]
              },
              key: {
                type: "string",
                enum: [
                  "harmony", "faith", "prosperity", "health", "safety", "mercy",
                  "foodSecurity", "grainPrice", "diseasePressure", "crime", "infrastructure",
                  "pressure", "publicAwareness", "danger", "momentum",
                  "stress", "morale", "trustPriest"
                ]
              },
              delta: { type: "integer", minimum: -3, maximum: 3 },
              reason: { type: "string", maxLength: 80 }
            }
          }
        }
      }
    };
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["summary", "steps"],
      properties: {
        summary: { type: "string", maxLength: 240 },
        steps: { type: "array", minItems: 1, maxItems: 3, items: stepSchema }
      }
    };
    const band = (value) => {
      if (value >= 75) return "high";
      if (value >= 55) return "comfortable";
      if (value >= 35) return "strained";
      return "low";
    };
    const household = state.households.find((entry) => entry.id === person.householdId);
    const context = {
      town: {
        name: state.town.name,
        description: state.town.description,
        publicConditions: {
          harmony: band(state.town.metrics.harmony),
          prosperity: band(state.town.metrics.prosperity),
          health: band(state.town.metrics.health),
          safety: band(state.town.metrics.safety),
          faith: band(state.town.metrics.faith)
        }
      },
      priest: {
        publicTrust: band(state.priest.localTrust),
        moralAuthority: band(state.priest.moralAuthority),
        publicScandal: band(state.priest.scandal),
        visibleHealth: band(state.priest.health)
      },
      churchResources: churchResourceRows(state.churchResources),
      visitor: {
        id: person.id,
        name: person.name,
        occupation: person.occupation,
        personality: person.personality,
        backstory: visit.hiddenConcernDisclosed ? person.backstory : person.publicBackstory,
        memories: relevantMemories(state, person, visit, 10),
        issue: {
          kind: visit.issue.kind,
          gravity: visit.issue.gravity,
          relatedPersonId: visit.issue.relatedPersonId
        },
        issueThread: issueThread ? {
          id: issueThread.id,
          summary: issueThread.summary,
          status: issueThread.status,
          pressure: issueThread.pressure,
          publicAwareness: issueThread.publicAwareness,
          danger: issueThread.danger,
          deadlineDay: issueThread.deadlineDay,
          subjects: issueThread.subjectIds
        } : null,
        trustPriest: person.trustPriest
      },
      household: household ? {
        foodSecurity: band(household.food),
        means: band(household.wealth),
        debtPressure: band(Math.min(100, household.debt)),
        dwelling: household.dwelling,
        properties: household.properties
      } : null,
      counsel: visit.counsel,
      conversation: visit.history,
      proposalDecisions: (visit.continuity?.visitorDecisions || []).slice(-12),
      playerProposals: (visit.continuity?.proposals || []).slice(-12),
      suggestedActionTypes: departureActionHints(visit),
      finalMood: visit.mood,
      eventLicense: visit.eventLicense,
      activeRumors: state.rumors
        .filter((rumor) => rumor.active && rumor.heardByIds.includes(person.id))
        .slice(-5)
        .map((rumor) => ({
          claim: rumor.claim,
          intensity: rumor.intensity,
          personalConfidence: state.knowledge.find((entry) => (
            entry.holderId === person.id
            && entry.subjectId === rumor.subjectId
            && entry.topic === "rumor"
          ))?.confidence ?? 45
        })),
      knownFacts: state.knowledge
        .filter((entry) => entry.holderId === person.id)
        .slice(-12)
        .map((entry) => ({
          subjectId: entry.subjectId,
          topic: entry.topic,
          belief: entry.belief,
          confidence: entry.confidence,
          privateKnowledge: entry.privateKnowledge
        })),
      possiblePeople: boundedCandidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        age: candidate.age,
        occupation: candidate.occupation,
        relationshipFromVisitor: (() => {
          const relationship = state.relationships.find((entry) => (
            entry.actorId === person.id && entry.targetId === candidate.id
          ));
          if (!relationship) return "unfamiliar";
          return {
            familiarity: band(relationship.familiarity),
            trust: band(relationship.trust),
            affection: band(relationship.affection),
            fear: band(relationship.fear),
            resentment: band(relationship.resentment)
          };
        })()
      })).concat([{
        id: "priest",
        name: state.priest.name,
        role: "parish priest",
        publicReputation: {
          trust: band(state.priest.localTrust),
          authority: band(state.priest.moralAuthority),
          scandal: band(state.priest.scandal)
        }
      }])
    };
    const prompt = [
      "Simulate what happens after a 16th-century villager leaves counsel with the parish priest.",
      "Produce a causal chain of one to three actions. Step 1 must be performed by the visitor. A later step should respond to the prior interaction and may involve one further person.",
      "The plan may instead contain parallel visitor commitments. Use parentStepIndex null for each visitor root. Use a prior zero-based step index only when that prior step's target performs a response. If parentStepIndex is omitted, the simulation treats later steps as the legacy linear chain.",
      "Choose only listed IDs and allowed action types. Consequences may be helpful, harmful, mixed, mundane, or life-changing, but must follow from personality, circumstances, and the priest's actual words.",
      "Do not assume the priest is benevolent. Selfish, cruel, political, corrupt, absurd, faithful, merciful, and power-seeking counsel may all produce different feasible actions, refusals, reports, rumors, resistance, or compliance.",
      "If no precise actionType represents a plausible bounded social response, use improvise. Put the concrete act in detail and description. Improvise may create only modest social, emotional, reputational, or rumor effects; it cannot create deaths, marriages, arrests, migrations, property transfers, pregnancies, or unfunded resources.",
      "For an improvise step only, you may propose up to three small reversible effects in effects. The engine validates every scope, key, delta, target, and historical cause. Use composition instead for food, money, church stores, property, jobs, family status, migration, law, or violence; custom effects may not invent or destroy resources.",
      "offer_work means the actor offers a job to the target. If the actor offers their own labor, use work_harder, change_job, church work composition, or improvise. leave_village means permanent migration away from the parish, not merely leaving the church after counsel.",
      "Use composition when the action combines work, property, resources, family, law, communication, migration, violence, faith, or building work. Maximums: two targetIds, one object, one resource, one location, one condition, five evidenceTurnIds. The simulation maps supported compositions to real mechanics and rejects oversized or unsupported combinations.",
      "Use motive to describe why each actor chooses the step, and evidence to quote or summarize the specific counsel, promise, pressure, or relationship that supports it.",
      "The visitor's own explicit commitments in the conversation are major evidence. If the visitor said 'I will', 'I shall', or clearly promised a feasible action, prefer carrying out that action unless later words retract it or the supplied state makes it impossible. Do not replace a clear feasible promise with keep_silence.",
      "proposalDecisions are authoritative conversation outcomes. Prefer accepted proposals, omit rejected proposals, and treat deferred or unknown proposals cautiously. Up to three accepted proposals may become parallel visitor roots.",
      "Use suggestedActionTypes as the preferred vocabulary for step 1. Do not use seek_absolution unless the matter truly concerns the visitor's own confession or repentance. Do not use invite_migrant unless the conversation explicitly concerns inviting a newcomer and the actor has village authority.",
      "If step 1 has targetId null, return only that one step. Never add a later actor after a targetless action. Do not repeat the same targetless action across several steps.",
      "A visitor may donate to the church only by using actionType donate with targetId priest. Put the donated resource key and amount in detail, for example 'grain:2' or 'coin:4'. Church aid promised by the priest has already been transferred during the conversation and must not be transferred again.",
      `Intensity may not exceed ${visit.eventLicense === "outrageous" ? 5 : visit.eventLicense === "comic" ? 4 : 3} for this visit. Use targetId null for targetless actions such as keep_silence, seek_absolution, confess_publicly, repent, attend_church, invite_migrant, work_harder, steal, drink, or gamble. Only priest-specific actions and donate may target priest. If a later step exists, its actorId must equal the prior step's non-null targetId.`,
      `The event license is ${visit.eventLicense}. Ordinary means no farce or extraordinary behavior. Comic permits only a plausible minor misunderstanding. Outrageous permits consideration of an unusual response, but the current safe action list still governs.`,
      "Do not force births, marriages, violence, migration, or divorce without strong context. Write concrete chronicle descriptions without mentioning prompts or game mechanics.",
      "Keep the summary under 120 words, each description under 45 words, and each evidence field under 25 words so the complete JSON fits without truncation.",
      `CONTEXT_JSON=${JSON.stringify(context)}`
    ].join("\n");
    const result = await this.complete(prompt, schema, "departure_cascade", 750, 90000);
    if (!Array.isArray(result.steps) || result.steps.length < 1 || result.steps.length > 3) {
      const error = new Error("The local model returned an invalid departure chain length");
      error.rejectedProposal = {
        summary: boundedProse(result.summary, 400),
        submittedStepCount: Array.isArray(result.steps) ? result.steps.length : 0,
        steps: Array.isArray(result.steps) ? result.steps.slice(0, 10) : []
      };
      throw error;
    }
    return {
      summary: boundedProse(result.summary, 400),
      steps: result.steps
    };
  }

  async sermon(state, theme, text, attendees) {
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["summary", "townDeltas", "responseTags", "notableEffects"],
      properties: {
        summary: { type: "string", maxLength: 500 },
        townDeltas: {
          type: "object",
          additionalProperties: false,
          required: ["harmony", "faith", "prosperity", "health", "safety", "mercy"],
          properties: Object.fromEntries(["harmony", "faith", "prosperity", "health", "safety", "mercy"].map((key) => [
            key, { type: "integer", minimum: -8, maximum: 8 }
          ]))
        },
        responseTags: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", maxLength: 30 } },
        notableEffects: {
          type: "array",
          maxItems: 16,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["personId", "faithDelta", "moraleDelta", "attendanceDelta", "memory"],
            properties: {
              personId: { type: "string", enum: attendees.map((person) => person.id) },
              faithDelta: { type: "integer", minimum: -6, maximum: 6 },
              moraleDelta: { type: "integer", minimum: -6, maximum: 6 },
              attendanceDelta: { type: "integer", minimum: -10, maximum: 10 },
              memory: { type: "string", maxLength: 180 }
            }
          }
        }
      }
    };
    const notable = attendees
      .filter((person) => person.materialized || person.profileRevealed)
      .sort((a, b) => b.visitCount - a.visitCount)
      .slice(0, 36)
      .map((person) => ({
        id: person.id,
        name: person.name,
        occupation: person.occupation,
        faith: person.faith,
        morale: person.morale,
        traits: person.personality?.traits,
        memories: person.memories.filter((memory) => !memory.privateMemory).slice(-2)
      }));
    const prompt = [
      "Evaluate a Sunday sermon delivered to a 16th-century village parish.",
      "The whole attending congregation is affected through the town deltas and response tags. Add notable individual effects only for listed people.",
      "Use response tags confession, protest, disruption, or procession only when the sermon and parish conditions plausibly propose that public outcome; deterministic rules will independently decide whether it occurs.",
      "The sermon may comfort some and provoke others. Judge its actual wording, theme, town tensions, current metrics, attendance, and known personalities.",
      "Do not mention AI, prompts, tokens, or game mechanics.",
      `CONTEXT_JSON=${JSON.stringify({
        town: state.town,
        population: state.residents.filter((person) => person.active).length,
        attendance: attendees.length,
        theme,
        sermon: boundedString(text, 900),
        knownAttendees: notable
      })}`
    ].join("\n");
    const result = await this.complete(prompt, schema, "sunday_sermon", 900, 120000);
    return validateSermonResponse(result, attendees.map((person) => person.id));
  }
}

