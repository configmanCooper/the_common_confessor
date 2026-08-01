import fs from "node:fs";
import {
  applySermon,
  applyVisitOpening,
  beginVisit,
  createGame,
  departureCandidates,
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
    return course
      ? { category: "advice", text: `You should ${course}.`, expected: keywords(course).slice(0, 5) }
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
  if (overlap(reply, previous) >= 0.72) issues.push("repeats_previous_reply");
  if (overlap(reply, visit.history[0]?.text || "") >= 0.72 && visit.turnsUsed > 1) issues.push("repeats_opening");
  if (exchange.expected.length && expectedMatches === 0 && !categoryAnswer) issues.push("misses_expected_subject");
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
  try {
    const generated = await client.opening(state, person);
    applyVisitOpening(state, generated.opening, "ai");
    visitReport.opening = generated.opening;
  } catch (error) {
    visitReport.openingFallback = true;
    report.errors.push({ phase: "opening", person: person.name, message: error.message });
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
        endsConversation: Boolean(response.endsConversation)
      };
      recordExchange(state, prompt.text, { ...response, source: "ai" });
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
      report.errors.push({
        phase: "conversation",
        person: person.name,
        category: prompt.category,
        message: error.message
      });
      break;
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
  const sermonText = "Let truth be joined with mercy, and let those with plenty sustain neighbors in need. Courage without charity becomes pride; charity without honesty cannot endure.";
  const attendees = sundayAttendance(state);
  try {
    const outcome = await client.sermon(state, "Charity", sermonText, attendees);
    report.sermon = { source: "ai", summary: outcome.summary, attendance: attendees.length };
    applySermon(state, "Charity", sermonText, { ...outcome, source: "ai" });
  } catch (error) {
    const fallback = fallbackSermonOutcome(state, "Charity", sermonText);
    report.sermon = { source: "fallback", summary: fallback.summary, attendance: attendees.length, error: error.message };
    applySermon(state, "Charity", sermonText, { ...fallback, source: "fallback" });
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

const serialized = JSON.stringify(report, null, 2);
if (outputPath) {
  fs.writeFileSync(outputPath, serialized);
  fs.writeFileSync(outputPath.replace(/\.json$/i, ".save.json"), serializeState(state));
}
console.log(serialized);
