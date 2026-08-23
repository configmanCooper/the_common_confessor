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
  parseChurchTransferIntent
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
  if (typeof content === "string") return JSON.parse(content);
  if (content && typeof content === "object") return content;
  throw new Error("The local model returned no usable content");
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
  return title ? `${title} ${resident.surname}` : resident.firstName;
}

function naturalizeDialogueNames(state, speaker, text) {
  let result = String(text || "");
  for (const resident of state.residents) {
    if (resident.id === speaker?.id || !result.toLowerCase().includes(resident.name.toLowerCase())) continue;
    result = result.replace(
      new RegExp(`\\b${resident.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
      naturalReference(state, resident)
    );
  }
  return result;
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

function knownPeopleForPrompt(state, person, visit, limit = 10) {
  const seen = new Set([person.id]);
  const rows = [];
  const push = (resident) => {
    if (!resident || seen.has(resident.id) || !resident.active || !resident.alive) return;
    seen.add(resident.id);
    rows.push(`${naturalReference(state, resident)} (${resident.occupation})`);
  };
  push(state.residents.find((resident) => resident.id === visit.issue.relatedPersonId));
  const thread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
  for (const subjectId of thread?.subjectIds || []) {
    push(state.residents.find((resident) => resident.id === subjectId));
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
  type: ["object", "null"],
  additionalProperties: false,
  required: ["resource", "amount"],
  properties: {
    resource: {
      type: "string",
      enum: ["coin", "grain", "bread", "beans", "onions", "saltedFish", "cheese", "firewood", "medicine"]
    },
    amount: { type: "integer", minimum: 1, maximum: 100 }
  }
};

const naturalConversationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["understoodPlayerAs", "reply", "npcIntent"],
  properties: {
    understoodPlayerAs: { type: "string", maxLength: 220 },
    reply: { type: "string", maxLength: 600 },
    npcIntent: { type: "string", maxLength: 160 },
    priestGivesFromChurch: churchGiftProperty,
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

export class ParishAiClient extends EventTarget {
  constructor({
    endpoint = "/local-ai",
    model = "local-gemma",
    splitSemantic = false,
    timeoutMs = 60000,
    fetchImpl = (...args) => globalThis.fetch(...args)
  } = {}) {
    super();
    this.endpoint = endpoint.replace(/\/+$/, "");
    this.model = model;
    this.splitSemantic = splitSemantic;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.inFlight = false;
  }

  async health() {
    const response = await this.fetchImpl(`${this.endpoint}/health`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`AI health check returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.status !== "ok") throw new Error("The selected AI provider is unavailable");
    return payload;
  }

  async opening(state, person) {
    const visit = state.currentVisit;
    const mayDiscloseMatter = visit.issue.kind !== "confession" || visit.hiddenConcernDisclosed;
    const establishedSelfAction = mayDiscloseMatter ? selfActionFact(visit, person) : null;
    const context = {
      town: state.town.name,
      date: state.calendar,
      location: visit.location,
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
    try {
      const body = JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: options.system
              || "Return only valid JSON matching the supplied schema. Never add markdown or discuss being an AI."
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

  buildNaturalPrompt(state, person, visit, playerText, {
    knowledgeLines,
    reactionPreview,
    turnAnalysis,
    correction
  }) {
    const guarded = visit.issue.kind === "confession" && !visit.hiddenConcernDisclosed;
    const traits = (person.personality?.traits || []).slice(0, 4).join(", ");
    const people = knownPeopleForPrompt(state, person, visit);

    // Kept byte-stable across the visit so the model's prefix cache is reused.
    const system = [
      `You are ${person.firstName}, aged ${person.age}, a ${person.occupation} in the village of ${state.town.name} in the 1500s, speaking privately with your parish priest.`,
      traits ? `Your nature: ${traits}.` : "",
      person.publicBackstory
        ? `About you: ${firstSentence(guarded ? person.publicBackstory : (person.backstory || person.publicBackstory), 200)}`
        : "",
      people.length ? `People you know: ${people.join("; ")}.` : "",
      "",
      "How you speak:",
      "- Answer what the priest just said before anything else. If he changes the subject, follow him; never restart your original problem.",
      "- References like 'that', 'him', 'the other one' and 'why' point at things already said. Work out what they mean.",
      "- If he corrects you, take the correction and answer what he actually meant.",
      "- 1 to 3 short sentences, spoken aloud, first person. No narration, no asterisks, no stage directions, no lists.",
      "- You may agree, disagree, refuse, hesitate, ask a question, or admit you do not know. If his suggestion genuinely settles your worry and you trust it, simply accept it and say so. Never drag things out to fill time.",
      "- Only name people you know or who were already named. Never invent an official, expert, place, or institution; say plainly if no one suitable exists.",
      "- End on something the priest can actually act on: what you want, what you refuse, or what would have to change.",
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
      guarded ? "You have NOT yet told the priest your real secret. Do not blurt it out and do not invent one." : "",
      !guarded && visit.intent.hiddenConcern
        ? `You have already told the priest this, and may speak of it freely: ${visit.intent.hiddenConcern}`
        : "",
      knowledgeLines.length
        ? `True things you know, in your own words if they come up:\n${knowledgeLines.map((line) => `- ${line}`).join("\n")}`
        : "",
      speakableFacts.length ? `Your situation:\n${speakableFacts.join("\n")}` : "",
      openThreads.length ? `Still unsettled between you:\n${openThreads.map((line) => `- ${line}`).join("\n")}` : "",
      summary ? `Earlier in this conversation: ${summary}` : "",
      recent.length ? `The conversation just now:\n${recent.join("\n")}` : "",
      lastOwnLine
        ? `You ALREADY said: "${firstSentence(lastOwnLine, 160)}" — say something different from that, and answer what was actually just asked.`
        : "",
      `What the church has in store, if the priest offers you any of it: ${churchResourceRows(state.churchResources)
        .filter((row) => row.amount > 0)
        .map((row) => `${row.amount} ${row.unit} of ${row.label.toLowerCase()} [${row.key}]`)
        .join(", ") || "nothing at present"}.`,
      `THE PRIEST JUST SAID: "${boundedString(playerText, 600)}"`,
      correction || "",
      "",
      "Reply in JSON.",
      "understoodPlayerAs: plainly, what the priest just meant. Write this first.",
      "reply: what you say aloud.",
      "npcIntent: what you are trying to do by saying it.",
      "priestGivesFromChurch: if the priest is handing you something from the church's stores right now, give its resource key and amount, for example {\"resource\":\"coin\",\"amount\":4}. Use null if he is not giving you anything, is only promising something later, or is asking you to give something.",
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
    currentQuestionTurnId
  }) {
    const transformations = [];
    const useDecisions = turnAnalysis.proposals.length > 0;
    const schema = useDecisions ? naturalDecisionSchema : naturalConversationSchema;
    const buildPrompt = (correction) => this.buildNaturalPrompt(state, person, visit, playerText, {
      knowledgeLines,
      reactionPreview,
      turnAnalysis,
      correction
    });

    let { system, user: prompt } = buildPrompt("");
    let raw = await this.complete(
      prompt,
      schema,
      useDecisions ? "parish_natural_conversation_decisions" : "parish_natural_conversation",
      200,
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
    // engine decides whether the church can actually spare it.
    let churchGift = null;
    if (raw.priestGivesFromChurch && typeof raw.priestGivesFromChurch === "object") {
      const requested = raw.priestGivesFromChurch;
      const row = churchResourceRows(state.churchResources)
        .find((entry) => entry.key === requested.resource);
      const amount = Math.max(0, Math.min(100, Math.floor(Number(requested.amount) || 0)));
      if (!row) {
        transformations.push({
          type: "gift_rejected",
          detail: `unknown church resource "${requested.resource}"`,
          code: "naturalConversation:churchGift"
        });
      } else if (amount <= 0) {
        transformations.push({
          type: "gift_rejected",
          detail: "the amount given was not a positive number",
          code: "naturalConversation:churchGift"
        });
      } else if (row.amount < amount) {
        transformations.push({
          type: "gift_reduced",
          detail: `the church holds only ${row.amount} ${row.unit} of ${row.label.toLowerCase()}`,
          code: "naturalConversation:churchGift"
        });
        if (row.amount > 0) churchGift = { resource: row.key, amount: row.amount, shortfall: amount - row.amount };
      } else {
        churchGift = { resource: row.key, amount };
      }
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
      churchGift,
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

  async conversation(state, person, playerText) {
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
      currentQuestionTurnId
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
