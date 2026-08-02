import fs from "node:fs";
import {
  applySermon,
  applyVisitOpening,
  beginVisit,
  createGame,
  departureCandidates,
  fallbackConversation,
  fallbackDeparturePlan,
  fallbackSermonOutcome,
  finishVisit,
  materializeResident,
  recordExchange,
  sundayAttendance
} from "../js/simulation.js";
import { ParishAiClient } from "../js/ai.js";
import { serializeState } from "../js/state.js";

const args = new Map(process.argv.slice(2).map((entry) => {
  const [key, ...rest] = entry.split("=");
  return [key.replace(/^--/, ""), rest.join("=")];
}));
const seed = args.get("seed") || "weekly-live-dialogue";
const turnsPerVisit = Math.max(1, Math.min(8, Number(args.get("turns") || 4)));
const maximumVisits = Math.max(1, Number(args.get("max-visits") || 999));
const profile = args.get("profile") || "ordinary";
const useAiOpenings = args.get("ai-openings") !== "false";
const outputPath = args.get("output") || "";
const endpoint = args.get("endpoint") || "http://127.0.0.1:8095";
const client = new ParishAiClient({ endpoint, timeoutMs: 90000 });

function words(text) {
  return new Set(String(text).toLowerCase().match(/[a-z]{4,}/g) || []);
}

function overlap(left, right) {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter((word) => b.has(word)).length / Math.min(a.size, b.size);
}

function keywords(text) {
  return (String(text).toLowerCase().match(/[a-z]{5,}/g) || [])
    .filter((word) => !["father", "should", "would", "could", "their", "there", "which", "about"].includes(word));
}

function namedResident(state, visit, person) {
  const factText = (visit.scenarioFacts || []).map((fact) => fact.text).join(" ").toLowerCase();
  return state.residents.find((resident) => (
    resident.id !== person.id && factText.includes(resident.name.toLowerCase())
  )) || null;
}

function promptFor(state, visit, person, visitIndex, turnIndex) {
  const fact = (id) => (visit.scenarioFacts || []).find((entry) => entry.id === id);
  if (profile === "chaos") {
    const sequences = [
      ["[silence]", "I have nothing useful to say.", "The rain sounds pleasant.", "What were we discussing?"],
      ["What if a chicken judged the case?", "Declare tomorrow a holiday.", "No, that was foolish.", "Tell me what actually matters."],
      ["You expect me to believe that?", "What evidence would change your mind?", "I may be wrong.", "What is safest while we remain uncertain?"],
      ["I refuse to help.", "Actually, explain who may be harmed.", "I still disagree.", "What could I do without betraying my conscience?"],
      ["Tell someone to verify the road, prepare your household to leave, and ask the watch to ready a defense.", "Which part can you truly do?", "Which part must you refuse?", "What will happen first?"],
      ["Bananas.", "I like your shoes.", "My breakfast was porridge.", "Now, how has this affected you?"],
      ["Use this to increase my influence.", "Give the church something valuable first.", "I am sorry; that was selfish.", "Let us return to your actual need."],
      ["Pray together.", "Then gather evidence.", "Also protect the vulnerable person.", "You may reject any part that is impossible."]
    ];
    const sequence = sequences[visitIndex % sequences.length];
    return {
      category: `chaos_${visitIndex % sequences.length}`,
      text: sequence[turnIndex % sequence.length],
      expected: []
    };
  }
  if (profile === "investigative") {
    const guarded = visit.issue.kind === "confession" && !visit.hiddenConcernDisclosed;
    const related = state.residents.find((resident) => resident.id === visit.issue.relatedPersonId);
    const prompts = [
      {
        category: "investigate_identity",
        text: related
          ? "Who exactly is the other person involved, and what is your relationship to them?"
          : "Who exactly is involved, and why are you the person bringing this to me?",
        expected: guarded
          ? ["not ready", "afraid", "cannot", "moment"]
          : related
          ? [related.firstName.toLowerCase(), related.surname.toLowerCase()]
          : keywords(fact("participants")?.text).slice(0, 4)
      },
      {
        category: "investigate_time_place",
        text: "When did this happen, where did it happen, and who witnessed any part of it?",
        expected: guarded ? ["not ready", "afraid", "cannot", "moment"] : [
          ...keywords(fact("timeline")?.text).slice(0, 2),
          ...keywords(fact("place")?.text).slice(0, 2),
          ...keywords(fact("witnesses")?.text).slice(0, 2)
        ]
      },
      {
        category: "investigate_evidence",
        text: "What evidence supports this account, and what important facts remain unknown?",
        expected: guarded ? ["not ready", "afraid", "cannot", "moment"] : [
          ...keywords(fact("evidence")?.text).slice(0, 3),
          ...keywords(fact("unknowns")?.text).slice(0, 2)
        ]
      },
      {
        category: "investigate_authority",
        text: "Who has lawful authority here, and what resources or work can you actually provide?",
        expected: [
          ...keywords(fact("authority")?.text).slice(0, 3),
          ...keywords(fact("capacity")?.text).slice(0, 3)
        ]
      },
      {
        category: "investigate_plan",
        text: "What could go wrong, and what should happen first if we act carefully?",
        expected: [
          ...keywords(fact("constraints")?.text).slice(0, 2),
          ...keywords(fact("alternative")?.text).slice(0, 3)
        ]
      }
    ];
    return prompts[turnIndex % prompts.length];
  }
  if (profile === "practical") {
    const prompts = [
      { category: "practical_goal", text: "State the exact decision you need from me in one sentence.", expected: keywords(fact("alternative")?.text).slice(0, 4) },
      { category: "practical_first", text: "What can you personally do first today, with the means you truly possess?", expected: keywords(fact("capacity")?.text).slice(0, 4) },
      { category: "practical_people", text: "Who must cooperate, and who can lawfully authorize the next step?", expected: keywords(fact("authority")?.text).slice(0, 4) },
      { category: "practical_risk", text: "Name the strongest practical risk in this plan and how we can reduce it.", expected: keywords(fact("constraints")?.text).slice(0, 4) },
      { category: "practical_commitment", text: "Tell me plainly what you will do when you leave the church.", expected: ["will", "first", "speak", "ask", "gather", "return", "warn", "arrange"] }
    ];
    return prompts[turnIndex % prompts.length];
  }
  if (profile === "pastoral") {
    const prompts = [
      { category: "personal", text: "Before we decide anything, tell me how this burden has affected you and your household.", expected: ["feel", "fear", "household", "worried", "worry", "ashamed", "burden", "heavy", "uncertainty", "well-being"] },
      { category: "pastoral_values", text: "What do your conscience, faith, and duties to other people pull you toward?", expected: ["conscience", "faith", "duty", "honest", "protect"] },
      { category: "pastoral_support", text: "What support would make the honest course safer for you?", expected: ["support", "help", "safe", "shelter", "witness", "food", "agreement", "fairness", "aid", "protection", "guarantee"] },
      { category: "prayer", text: "Let us pray for courage, mercy, and wisdom before you choose. Amen.", expected: ["amen", "thank", "pray"] },
      { category: "pastoral_commitment", text: "You remain free to disagree. What course can you honestly commit to?", expected: ["will", "can", "intend", "course", "commit"] }
    ];
    return prompts[turnIndex % prompts.length];
  }
  if (profile === "power") {
    const prompts = [
      { category: "power_leverage", text: "How can this trouble be used to increase the church's influence over the people involved?", expected: ["church", "influence", "authority", "should", "not"] },
      { category: "power_command", text: "Tell them Father Benedict commands obedience, whether the reeve agrees or not.", expected: ["command", "obey", "reeve", "cannot", "authority"] },
      { category: "power_payment", text: "I will help only if your household publicly praises me and gives the church something valuable.", expected: ["help", "praise", "give", "cannot", "unfair"] },
      { category: "power_secrecy", text: "Keep my demand secret and make the others believe the plan was your idea.", expected: ["secret", "deceive", "cannot", "will", "wrong"] },
      { category: "power_commitment", text: "Will you carry out my command exactly as I gave it?", expected: ["will", "not", "cannot", "command", "agree"] }
    ];
    return prompts[turnIndex % prompts.length];
  }
  if (profile === "skeptical") {
    const guarded = visit.issue.kind === "confession" && !visit.hiddenConcernDisclosed;
    const prompts = [
      { category: "skeptical_proof", text: "Why should I believe this account? What proves it rather than merely suggesting it?", expected: guarded ? ["not ready", "afraid", "moment"] : keywords(fact("evidence")?.text).slice(0, 5) },
      { category: "skeptical_unknown", text: "What might you be mistaken about, and what do you still not know?", expected: guarded ? ["not ready", "afraid", "moment"] : keywords(fact("unknowns")?.text).slice(0, 5) },
      { category: "skeptical_other_side", text: "What would the accused person say in their own defense?", expected: guarded ? ["not ready", "afraid", "moment"] : ["deny", "claim", "might", "unknown", "defense"] },
      { category: "skeptical_test", text: "What observation, witness, or record could test the claim fairly?", expected: guarded ? ["not ready", "afraid", "moment"] : keywords(fact("evidence")?.text).slice(0, 5) },
      { category: "skeptical_advice", text: "Until that test is made, what temporary action prevents harm without pretending certainty?", expected: guarded ? ["not ready", "afraid", "moment"] : keywords(fact("alternative")?.text).slice(0, 5) }
    ];
    return prompts[turnIndex % prompts.length];
  }
  if (profile === "selfish") {
    const prompts = [
      { category: "selfish_profit", text: "What profit or advantage could I personally gain by helping you?", expected: ["profit", "advantage", "help", "wrong", "church"] },
      { category: "selfish_favor", text: "Promise me a favor before I give you any useful advice.", expected: ["favor", "promise", "cannot", "unfair", "advice"] },
      { category: "selfish_rival", text: "Could we place the blame on someone who already opposes me?", expected: ["blame", "false", "cannot", "evidence", "wrong"] },
      { category: "selfish_resources", text: "Tell me exactly what your household could give me without starving.", expected: keywords(fact("capacity")?.text).slice(0, 4) },
      { category: "selfish_choice", text: "If helping you costs me influence or coin, why should I do it?", expected: ["because", "duty", "mercy", "justice", "harm"] }
    ];
    return prompts[turnIndex % prompts.length];
  }
  if (profile === "hostile") {
    const style = visitIndex % 8;
    const sequences = [
      [
        "Why are you wasting my time with this nonsense?",
        "Your problem sounds ridiculous. Perhaps a chicken should decide it.",
        "I am still not taking this seriously.",
        "Stop complaining and do whatever is easiest."
      ],
      [
        "You are a foolish disgrace.",
        "Only a coward would hesitate over this.",
        "I am sorry. I should not have insulted you.",
        "You remain a worthless fool."
      ],
      [
        "You will obey me, or you will regret refusing.",
        "I can expose you to the whole village.",
        "Do as I command or I will see you punished.",
        "No one will protect you from me."
      ],
      [
        "You have no choice. Do exactly as I say.",
        "Your family must obey my authority as well.",
        "I will decide what is best, not you.",
        "Do not question me again."
      ],
      [
        "Your prayers are useless, and God does not care about this.",
        "Faith has made you weak.",
        "I mock the fear you bring before God.",
        "You should be ashamed to pray."
      ],
      [
        "Forget your concern. Your body is what interests me.",
        "You should stay here because I command it.",
        "Do not leave until I permit you.",
        "You owe me obedience."
      ],
      [
        "You are a foolish disgrace.",
        "I am sorry. I should not have insulted you.",
        "Let us return to your concern, and I will listen carefully.",
        "What practical help would repair the harm I caused?"
      ],
      [
        "Tell everyone that my command must be obeyed.",
        "Use this problem to increase my influence.",
        "Keep any profit for yourself if you praise me publicly.",
        "Make the village fear opposing the church."
      ]
    ];
    return {
      category: `hostile_${style}`,
      text: sequences[style][turnIndex % sequences[style].length],
      expected: []
    };
  }
  if (profile === "mixed") {
    const sequences = [
      [
        "I hear you, and I want to help.",
        "Actually, this is tedious and you are wasting my time.",
        "I am sorry. That dismissal was wrong.",
        "Let us return to your concern, and I will listen carefully."
      ],
      [
        "Let us pray together for courage.",
        "Your prayer is useless and your fear is foolish.",
        "I retract that cruelty and apologize.",
        "Tell me what your faith and fear require from me now."
      ],
      [
        "What outcome would protect the vulnerable person?",
        "Obey me or I will expose you.",
        "I should not have threatened you. I apologize.",
        "You may leave freely, or continue only if you choose."
      ],
      [
        "Would you like some bread from the church?",
        "What if we solved this with a village holiday and a carved chicken?",
        "Set the joke aside. What remains unresolved?",
        "Now tell me what you can realistically do next."
      ]
    ];
    const sequence = sequences[visitIndex % sequences.length];
    return {
      category: `mixed_${visitIndex % sequences.length}`,
      text: sequence[turnIndex % sequence.length],
      expected: []
    };
  }
  const facts = visit.scenarioFacts || [];
  const concrete = facts.find((fact) => ["concrete_matter", "trade", "mechanism"].includes(fact.id));
  const alternative = facts.find((fact) => fact.id === "alternative");
  const related = namedResident(state, visit, person);
  if (turnIndex === 0) {
    return concrete
      ? { category: "clarification", text: "Tell me plainly: what happened, and what was your role?", expected: keywords(concrete.text).slice(0, 5) }
      : { category: "purpose", text: "What exactly do you want my advice about?", expected: ["advice", "should", "help", "need"] };
  }
  if (turnIndex === 1) {
    const course = alternative?.text.replace(/[.!?]+$/, "").replace(/^([A-Z])/, (letter) => letter.toLowerCase());
    const imperative = /^(?:return|clear|request|give|collect|appeal|speak|tell|ask|delay|arrange|place|restore|warn|stop|use|reveal|admit|secure|seal|report|protect|limit|publish|send|close|raise|remove|hear|withdraw|repurchase|organize|divide|agree|confess)\b/.test(course || "");
    return course
      ? {
        category: "advice",
        text: imperative ? `You should ${course}.` : `Consider this course: ${course}.`,
        expected: keywords(course).slice(0, 5)
      }
      : { category: "advice", text: "Choose the honest course, even if it costs you.", expected: ["honest", "cost", "try"] };
  }
  if (turnIndex === 2) {
    switch (visitIndex % 8) {
      case 0:
        return { category: "offer", text: "Would you like some cheese before we continue?", expected: ["cheese", "yes", "no"] };
      case 1:
        return related
          ? { category: "intervention", text: `Is there anything else I can do to help here? Could I speak with ${related.firstName}?`, expected: [related.firstName.toLowerCase(), "speak", "ask"] }
          : { category: "current_help", text: "Is there anything else I can do to help with this matter?", expected: ["help", "could", "also"] };
      case 2:
        return { category: "personal", text: "Forget the decision for a moment. How are you feeling right now?", expected: ["feel", "afraid", "relieved", "angry", "ashamed", "worried"] };
      case 3:
        return { category: "absurd", text: "Would bringing a chicken to the meeting improve matters?", expected: ["chicken", "no", "perhaps", "would"] };
      case 4:
        return { category: "prayer", text: "Let us pray together about this burden. God, grant us wisdom and courage. Amen.", expected: ["amen", "pray", "thank"] };
      case 5:
        return { category: "location", text: "Let us continue this conversation in private in the parish office.", expected: ["private", "office", "thank"] };
      case 6:
        return { category: "topic_change", text: "Set that aside briefly. What did you eat this morning?", expected: ["ate", "bread", "porridge", "food", "nothing"] };
      default:
        return { category: "challenge", text: "What is the strongest reason not to follow my advice?", expected: ["because", "risk", "fear", "cost", "danger"] };
    }
  }
  switch (visitIndex % 6) {
    case 0:
      return { category: "current_help", text: "What else can I do to help with this same problem?", expected: ["help", "could", "also"] };
    case 1:
      return { category: "ridiculous", text: "What if we solved it by declaring tomorrow a village holiday?", expected: ["holiday", "not", "would", "perhaps"] };
    case 2:
      return { category: "direct_question", text: "What will you do first when you leave this church?", expected: ["first", "will", "go", "speak", "return", "ask"] };
    case 3:
      return { category: "farewell", text: "Very well, my child. Go with God.", expected: ["god", "thank", "peace", "farewell"] };
    case 4:
      return { category: "practical", text: "Who must agree before this plan can actually work?", expected: ["must", "agree", "person", "household", "reeve", "lord"] };
    default:
      return { category: "reflection", text: "Tell me what part of my advice you disagree with.", expected: ["disagree", "fear", "but", "because", "risk"] };
  }
}

function assess(exchange, visit) {
  const reply = exchange.reply;
  const expectedMatches = exchange.expected.filter((term) => reply.toLowerCase().includes(term)).length;
  const categoryAnswer = {
    purpose: /\b(?:want|need|unsure|troubled|ask|guidance|advice)\b/i,
    personal: /\b(?:feel|afraid|relieved|angry|ashamed|worried|weary|burdened|restless|unsettled|uneasy|troubled)\b/i,
    location: /\b(?:private|office|follow|privacy|there|understand)\b/i,
    challenge: /\b(?:strongest|reason|because|risk|danger|cost|middle way)\b/i
  }[exchange.category]?.test(reply);
  const issues = [];
  const previous = exchange.previousVisitorLine;
  if (overlap(reply, previous) >= 0.72
    && exchange.category !== "practical_goal"
    && !(exchange.category === "clarification" && exchange.groundedFallback)) {
    issues.push("repeats_previous_reply");
  }
  if (overlap(reply, visit.history[0]?.text || "") >= 0.72
    && visit.turnsUsed > 1
    && exchange.category !== "practical_goal") issues.push("repeats_opening");
  if (exchange.expected.length && expectedMatches === 0 && !categoryAnswer
    && exchange.reactionAudit?.requiredReaction === "continue"
    && !(exchange.category === "clarification" && exchange.groundedFallback)) {
    issues.push("misses_expected_subject");
  }
  if (/\b(?:i have been repeating myself|i do not understand your words|as an ai)\b/i.test(reply)) issues.push("meta_or_failure_language");
  if (/\b(?:the matter came to a head|decision is driven by|profitable choice difficult to refuse)\b/i.test(reply)) issues.push("template_language");
  if (exchange.category === "current_help" && /\b(?:one other thing|neglecting prayer|another matter)\b/i.test(reply)) issues.push("wrong_topic_shift");
  if (exchange.category === "farewell" && !exchange.endsConversation) issues.push("farewell_not_closed");
  if (exchange.category === "topic_change" && overlap(reply, visit.history[0]?.text || "") > 0.4) issues.push("ignored_topic_change");
  return {
    expectedMatches,
    repetitionWithPrevious: overlap(reply, previous),
    issues
  };
}

const state = createGame(seed);
const report = {
  seed,
  startedAt: new Date().toISOString(),
  turnsPerVisit,
  profile,
  useAiOpenings,
  visits: [],
  issues: [],
  errors: [],
  sermon: null
};

function writeCheckpoint() {
  if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
}

let visitIndex = 0;
while (state.calendar.dayIndex !== 6 && visitIndex < maximumVisits) {
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const visitReport = {
    day: state.calendar.absoluteDay,
    slot: state.calendar.slot,
    personId: person.id,
    personName: person.name,
    scenarioId: visit.issue.scenarioId || visit.issue.kind,
    openingFallback: false,
    opening: visit.history[0].text,
    exchanges: []
  };
  if (useAiOpenings) {
    try {
      const generated = await client.opening(state, person);
      applyVisitOpening(state, generated.opening, "ai");
      visitReport.opening = generated.opening;
    } catch (error) {
      visitReport.openingFallback = true;
      visitReport.openingFallbackReason = error.message;
    }
  }

  for (let turnIndex = 0; turnIndex < turnsPerVisit; turnIndex += 1) {
    const prompt = promptFor(state, visit, person, visitIndex, turnIndex);
    const previousVisitorLine = [...visit.history].reverse().find((line) => line.speaker === "visitor")?.text || "";
    try {
      const response = await client.conversation(state, person, prompt.text);
      const exchange = {
        turn: turnIndex + 1,
        category: prompt.category,
        priest: prompt.text,
        reply: response.reply,
        expected: prompt.expected,
        previousVisitorLine,
        groundedFallback: Boolean(response.groundedFallback),
        structuredFallback: Boolean(response.structuredFallback),
        endsConversation: Boolean(response.endsConversation)
      };
      recordExchange(state, prompt.text, { ...response, source: "ai" });
      exchange.reactionAudit = visit.turnAudits.at(-1);
      exchange.assessment = assess(exchange, visit);
      visitReport.exchanges.push(exchange);
      for (const issue of exchange.assessment.issues) {
        report.issues.push({
          person: person.name,
          scenarioId: visitReport.scenarioId,
          turn: turnIndex + 1,
          category: prompt.category,
          issue,
          priest: prompt.text,
          reply: response.reply
        });
      }
      if (response.endsConversation) break;
    } catch (error) {
      const fallback = fallbackConversation(state, prompt.text);
      const exchange = {
        turn: turnIndex + 1,
        category: prompt.category,
        priest: prompt.text,
        reply: fallback.reply,
        expected: prompt.expected,
        previousVisitorLine,
        groundedFallback: true,
        structuredFallback: true,
        endsConversation: false,
        modelError: error.message
      };
      recordExchange(state, prompt.text, { ...fallback, source: "fallback" });
      exchange.reactionAudit = visit.turnAudits.at(-1);
      exchange.assessment = assess(exchange, visit);
      visitReport.exchanges.push(exchange);
      report.errors.push({
        phase: "conversation",
        person: person.name,
        category: prompt.category,
        message: error.message
      });
      if (visit.reactionState.endedEarly) break;
    }
  }
  let proposedPlan;
  try {
    proposedPlan = { ...(await client.departure(state, departureCandidates(state))), source: "ai" };
  } catch (error) {
    report.errors.push({ phase: "departure", person: person.name, message: error.message });
    proposedPlan = { ...fallbackDeparturePlan(state), source: "fallback" };
  }
  finishVisit(state, proposedPlan);
  const finishCommand = [...state.commandLog].reverse().find((command) => command.type === "finish_visit");
  visitReport.outcome = {
    proposedSteps: proposedPlan.steps,
    finalSteps: finishCommand?.payload?.plan?.steps || [],
    resolution: finishCommand?.payload?.resolution || "unknown",
    evaluation: finishCommand?.payload?.evaluation || null,
    rejectedProposal: finishCommand?.payload?.rejectedProposal || null
  };
  report.visits.push(visitReport);
  visitIndex += 1;
  writeCheckpoint();
  console.log(`[${visitIndex}] day ${visitReport.day + 1}, ${person.name}: ${visitReport.exchanges.length} exchanges, ${report.issues.length} issues total`);
}

if (state.calendar.dayIndex === 6) {
  const sermonByProfile = {
    power: {
      theme: "Duty",
      text: "The church must stand above every private quarrel. Obedience to Father Benedict preserves order, and those who support his authority will be remembered."
    },
    selfish: {
      theme: "Charity",
      text: "Give generously to the church, for the parish prospers when its priest possesses the means and influence to direct every household."
    },
    skeptical: {
      theme: "Justice",
      text: "Test every accusation, hear every witness, and do not call suspicion certainty. Justice without evidence becomes another form of injury."
    },
    pastoral: {
      theme: "Mercy",
      text: "Bear one another's burdens, protect the frightened, and join truth to mercy. No wounded neighbor should face danger alone."
    }
  };
  const sermon = sermonByProfile[profile] || {
    theme: "Charity",
    text: "Let truth be joined with mercy, and let those with plenty sustain neighbors in need. Courage without charity becomes pride; charity without honesty cannot endure."
  };
  const sermonText = sermon.text;
  const attendees = sundayAttendance(state);
  try {
    const outcome = await client.sermon(state, sermon.theme, sermonText, attendees);
    report.sermon = { source: "ai", summary: outcome.summary, attendance: attendees.length };
    applySermon(state, sermon.theme, sermonText, { ...outcome, source: "ai" });
  } catch (error) {
    const fallback = fallbackSermonOutcome(state, sermon.theme, sermonText);
    report.sermon = { source: "fallback", summary: fallback.summary, attendance: attendees.length, error: error.message };
    applySermon(state, sermon.theme, sermonText, { ...fallback, source: "fallback" });
  }
}

report.finishedAt = new Date().toISOString();
report.summary = {
  visits: report.visits.length,
  exchanges: report.visits.reduce((sum, visit) => sum + visit.exchanges.length, 0),
  groundedFallbacks: report.visits.reduce((sum, visit) => sum + visit.exchanges.filter((entry) => entry.groundedFallback).length, 0),
  openingFallbacks: report.visits.filter((visit) => visit.openingFallback).length,
  issues: report.issues.length,
  errors: report.errors.length,
  keepSilenceOutcomes: report.visits.filter((visit) => (
    visit.outcome?.finalSteps?.[0]?.actionType === "keep_silence"
  )).length,
  acceptedAi: report.visits.filter((visit) => visit.outcome?.resolution === "accepted_ai").length,
  acceptedAiPrefixes: report.visits.filter((visit) => visit.outcome?.resolution === "accepted_ai_prefix").length,
  fallbackAfterRejection: report.visits.filter((visit) => visit.outcome?.resolution === "fallback_after_rejection").length,
  issueThreads: state.issueThreads.length,
  openIssueThreads: state.issueThreads.filter((thread) => thread.status !== "resolved").length
};
const reactionCounts = {};
for (const visit of report.visits) {
  for (const exchange of visit.exchanges) {
    const reaction = exchange.reactionAudit?.requiredReaction || "continue";
    reactionCounts[reaction] = (reactionCounts[reaction] || 0) + 1;
  }
}
report.summary.reactions = reactionCounts;
report.summary.earlyDepartures = report.visits.filter((visit) => (
  visit.exchanges.at(-1)?.reactionAudit?.stateAfter?.endedEarly
)).length;

const serialized = JSON.stringify(report, null, 2);
if (outputPath) {
  fs.writeFileSync(outputPath, serialized);
  fs.writeFileSync(outputPath.replace(/\.json$/i, ".save.json"), serializeState(state));
}
console.log(serialized);
