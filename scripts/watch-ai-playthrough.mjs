/* Watch a Copilot model play the priest for a stretch of parish life.
 *
 * The model never touches state. Each turn the engine enumerates the legal
 * moves, the model returns one index plus a sentence of reasoning, and the
 * engine executes it through the same functions the interface calls. Every
 * turn — board, prompt, raw reply, chosen move, and what the visitor said back
 * — is written out, so the run can be reviewed afterwards for the things that
 * only show up over weeks: repetition, dead ends, systems nobody touches.
 *
 *   node scripts/watch-ai-playthrough.mjs --days 14 --model gpt-5.6-sol
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applySermon,
  beginVisit,
  buyAtMarket,
  createGame,
  fallbackConversation,
  fallbackDeparturePlan,
  fallbackSermonOutcome,
  finishVisit,
  petitionAuthority,
  recordExchange,
  requestVisits,
  summonOfficer
} from "../js/simulation.js";
import { compactReplayHistory, deserializeState, serializeState } from "../js/state.js";
import { ParishAiClient } from "../js/ai.js";
import {
  buildAgentPrompt,
  describeBoard,
  legalMoves,
  parseAgentReply,
  validateAgentChoice
} from "../js/agent.js";
import { copilotComplete } from "./copilot-provider.mjs";
import { personaById, personaIds } from "../js/priest_personas.js";
import { WEEK_DAYS } from "../js/data.js";

function dayLabel(day, week) {
  return `${WEEK_DAYS[day % 7]}, week ${week}`;
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const DAYS = Number(option("days", 14));
const MODEL = option("model", "gpt-5.6-sol");
const SEED = option("seed", `watch-ai-${Date.now()}`);
const STEER = option("steer", "");
const PERSONA_ID = option("persona", "");
const RUN_NAME = option("name", PERSONA_ID ? `run-${PERSONA_ID}` : `watch-ai-${Date.now()}`);
const PERSONA = PERSONA_ID ? personaById(PERSONA_ID) : null;
if (PERSONA_ID && !PERSONA) {
  console.error(`unknown persona "${PERSONA_ID}". choose one of: ${personaIds().join(", ")}`);
  process.exit(1);
}
const OUT_DIR = option("out", join(root, "exports"));
const VOICE_ENDPOINT = option("voice", "http://127.0.0.1:8095");

const log = [];
const snapshots = [];
let agentCalls = 0;
let agentFailures = 0;
let refusedMoves = 0;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
let savePath = "";
let logPath = "";
let transcriptPath = "";
let startedAt = Date.now();

/* A fortnight takes hours, and a run that is interrupted at day five should
   still leave five days of evidence behind rather than nothing. Everything is
   flushed after each visit. */
/* Averages hide the thing that matters: whether the individual people the
   priest actually dealt with were changed by it, and whether the third
   parties they named felt anything at all. Both are tracked by id. */
const trackedPeople = new Map();

function trackPerson(state, personId, why) {
  if (!personId || trackedPeople.has(personId)) return;
  const person = state.residents.find((entry) => entry.id === personId);
  if (!person) return;
  const household = state.households.find((entry) => entry.id === person.householdId);
  trackedPeople.set(personId, {
    id: personId,
    name: person.name,
    occupation: person.occupation,
    why,
    start: {
      stress: person.stress,
      health: person.health,
      faith: person.faith,
      trustPriest: person.trustPriest,
      memories: person.memories?.length || 0,
      relationships: state.relationships.filter((entry) => entry.actorId === personId).length,
      wealth: household?.wealth ?? null,
      food: household?.food ?? null
    }
  });
}

function personNow(state, personId) {
  const person = state.residents.find((entry) => entry.id === personId);
  if (!person) return null;
  const household = state.households.find((entry) => entry.id === person.householdId);
  return {
    stress: person.stress,
    health: person.health,
    faith: person.faith,
    trustPriest: person.trustPriest,
    memories: person.memories?.length || 0,
    relationships: state.relationships.filter((entry) => entry.actorId === personId).length,
    wealth: household?.wealth ?? null,
    food: household?.food ?? null
  };
}

/* Every number the simulation is supposed to move, sampled after each visit.
   A value that never changes across a fortnight is either a system nobody can
   reach or one that is quietly broken, and both are worth knowing about. */
function snapshot(state, label) {
  const alive = state.residents.filter((person) => person.active && person.alive);
  const average = (pick) => (alive.length
    ? Number((alive.reduce((sum, person) => sum + (Number(pick(person)) || 0), 0) / alive.length).toFixed(2))
    : 0);
  snapshots.push({
    label,
    day: state.calendar.absoluteDay,
    week: state.calendar.week,
    churchStores: { ...state.churchResources },
    priest: {
      standing: state.priest.standing,
      scandal: state.priest.scandal,
      bishopFavor: state.priest.bishopFavor,
      alive: state.priest.alive
    },
    town: { ...state.town.metrics },
    population: {
      alive: alive.length,
      materialized: state.residents.filter((person) => person.profileGenerated).length,
      averageStress: average((person) => person.stress),
      averageHealth: average((person) => person.health),
      averageFaith: average((person) => person.faith),
      averageTrustPriest: average((person) => person.trustPriest),
      averageWealth: Number((state.households.reduce((sum, house) => sum + (house.wealth || 0), 0)
        / Math.max(1, state.households.length)).toFixed(2)),
      averageFood: Number((state.households.reduce((sum, house) => sum + (house.food || 0), 0)
        / Math.max(1, state.households.length)).toFixed(2))
    },
    counts: {
      events: state.events.length,
      issueThreads: state.issueThreads.length,
      openThreads: state.issueThreads.filter((thread) => thread.status === "open").length,
      rumors: state.rumors.length,
      knowledge: state.knowledge.length,
      relationships: state.relationships.length,
      commitments: state.commitments.length,
      openCommitments: state.commitments.filter((entry) => entry.status === "open").length,
      fulfilledCommitments: state.commitments.filter((entry) => entry.status === "fulfilled").length,
      visitRequests: state.visitRequests.length,
      priestReports: state.priestReports.length,
      sermons: state.sermons.length,
      memories: state.residents.reduce((sum, person) => sum + (person.memories?.length || 0), 0)
    },
    people: [...trackedPeople.values()].map((entry) => ({
      id: entry.id,
      name: entry.name,
      why: entry.why,
      now: personNow(state, entry.id)
    }))
  });
}

/* A readable transcript beside the machine-readable log. The JSON is for the
   analyser; this is for a person to actually read a week of parish life. */
function writeTranscript(state) {
  const lines = [
    `THE COMMON CONFESSOR — a watched playthrough`,
    `Priest played by: ${MODEL}${PERSONA ? ` as "${PERSONA.name}"` : ""}`,
    PERSONA ? `\n${PERSONA.description}\n` : "",
    `Parish: ${state.town.name}`,
    `Seed: ${SEED}`,
    `Days played: ${state.calendar.absoluteDay} of ${DAYS}`,
    STEER ? `Instructed to: ${STEER}` : "",
    "",
    "=".repeat(78),
    ""
  ].filter(Boolean);

  for (const entry of log) {
    if (entry.kind === "sermon") {
      lines.push(
        `--- ${dayLabel(entry.day, entry.week).toUpperCase()} — THE SERMON, on ${entry.theme} ---`,
        "",
        entry.text,
        "",
        `[why: ${entry.reason}]`,
        ""
      );
      continue;
    }
    lines.push(
      `--- ${dayLabel(entry.day, entry.week).toUpperCase()} — ${entry.visitor}, ${entry.occupation}, aged ${entry.age} ---`,
      `    ${entry.issue}, in the ${entry.location}`,
      ""
    );
    if (entry.opening) lines.push(`${entry.visitor}: ${entry.opening}`, "");
    for (const exchange of entry.exchanges || []) {
      if (exchange.error) {
        lines.push(`  [the turn failed: ${exchange.error}]`, "");
        continue;
      }
      if (exchange.requestedVisit) {
        lines.push(`  [the priest sends for ${exchange.requestedVisit}: ${exchange.reason}]`, "");
        continue;
      }
      lines.push(`PRIEST: ${exchange.priest}`);
      if (exchange.priestReason) lines.push(`        [why: ${exchange.priestReason}]`);
      lines.push(`${entry.visitor}: ${exchange.visitor}`);
      if (exchange.churchGift) {
        lines.push(`        >>> gave ${exchange.churchGift.amount} ${exchange.churchGift.unit} of ${exchange.churchGift.label.toLowerCase()} from the church stores`);
      }
      lines.push("");
    }
    if (entry.endedBecause) lines.push(`  [the priest closed the hour: ${entry.endedBecause}]`, "");
    lines.push("");
  }
  writeFileSync(transcriptPath, lines.join("\n"), "utf8");
}

function flush(state, { final = false } = {}) {
  try {
    writeFileSync(logPath, JSON.stringify({
      model: MODEL,
      seed: SEED,
      days: DAYS,
      steer: STEER,
      complete: final,
      daysPlayed: state.calendar.absoluteDay,
      elapsedMs: Date.now() - startedAt,
      agentCalls,
      agentFailures,
      refusedMoves,
      turns: log.reduce((total, entry) => total + (entry.exchanges?.length || 0), 0),
      finalBoard: describeBoard(state),
      trackedPeople: [...trackedPeople.values()].map((entry) => ({
        ...entry,
        end: personNow(state, entry.id)
      })),
      snapshots,
      log
    }, null, 2));
    writeFileSync(savePath, serializeState(state));
    writeTranscript(state);
  } catch (error) {
    console.error(`could not flush progress: ${error.message}`);
  }
}

async function askAgent(prompt) {
  agentCalls += 1;
  const response = await copilotComplete({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    timeout_ms: 180000
  });
  return response.choices[0].message.content;
}

/** Ask for a move, and give the model one chance to correct an illegal one. */
async function chooseMove(state, moves, recent) {
  let prompt = buildAgentPrompt(state, moves, { steer: STEER, recent, persona: PERSONA });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw;
    try {
      raw = await askAgent(prompt);
    } catch (error) {
      agentFailures += 1;
      return { ok: false, error: `model unreachable: ${error.message}` };
    }
    const parsed = parseAgentReply(raw);
    const validated = validateAgentChoice(moves, parsed);
    if (validated.ok) return { ...validated, raw };
    refusedMoves += 1;
    prompt = `${prompt}\n\nYour previous reply was refused: ${validated.error}\nReply again with JSON only, choosing a legal index.`;
  }
  return { ok: false, error: "the model did not choose a legal move" };
}

function visitorFor(state, visit) {
  return [...state.residents, ...state.externalActors].find((person) => person.id === visit.personId);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  savePath = join(OUT_DIR, `${RUN_NAME}.save.json`);
  logPath = join(OUT_DIR, `${RUN_NAME}.log.json`);
  transcriptPath = join(OUT_DIR, `${RUN_NAME}.transcript.txt`);
  const state = createGame(SEED);
  const voice = new ParishAiClient({ endpoint: VOICE_ENDPOINT, model: "local-gemma", timeoutMs: 120000 });
  const recent = [];
  startedAt = Date.now();
  const started = startedAt;
  let turns = 0;

  console.log(`Priest: ${MODEL}${PERSONA ? ` playing "${PERSONA.name}"` : ""}   visitors voiced by the local model`);
  console.log(`seed ${SEED}, ${DAYS} days\n`);
  snapshot(state, "start");

  while (state.calendar.absoluteDay < DAYS) {
    const dayBefore = state.calendar.absoluteDay;

    if (state.calendar.dayIndex === 6) {
      const moves = legalMoves(state);
      const sermonMove = moves.find((move) => move.kind === "deliver_sermon");
      if (sermonMove) {
        const decision = await chooseMove(state, [sermonMove, ...moves.filter((m) => m !== sermonMove)], recent);
        const theme = decision.ok && decision.move.kind === "deliver_sermon" ? decision.theme : "Duty";
        const text = decision.ok && decision.move.kind === "deliver_sermon"
          ? decision.text
          : "Speak truth without panic and protect those who cannot protect themselves.";
        applySermon(state, theme, text, { ...fallbackSermonOutcome(state, theme, text), source: "fallback" });
        log.push({
          kind: "sermon",
          day: dayBefore,
          week: state.calendar.week,
          theme,
          text,
          reason: decision.ok ? decision.reason : `fallback: ${decision.error}`
        });
        recent.push(`Preached on ${theme}`);
        console.log(`[${dayLabel(dayBefore, state.calendar.week)}] SERMON on ${theme}: ${String(text).slice(0, 90)}...`);
        /* What his own words did, so the next thing he says is informed by it. */
        const aftermath = state.lastSermonAftermath;
        if (aftermath) {
          const moved = aftermath.affected.filter((entry) => entry.direction === "moved").length;
          log.push({ kind: "sermon_aftermath", day: dayBefore, week: state.calendar.week, aftermath });
          recent.push(
            `${aftermath.offering.givers.length} households gave ${aftermath.offering.coin}d; `
            + `${moved} were moved by the sermon and ${aftermath.affected.length - moved} hardened`
          );
          console.log(`    offering: ${aftermath.offering.coin}d from ${aftermath.offering.givers.length} households; `
            + `${aftermath.affected.length} of ${aftermath.attendance} affected (${moved} moved)`);
        }
        /* The stalls are up. Let him spend the collection if he wants to. */
        const marketMoves = legalMoves(state);
        const marketMove = marketMoves.find((move) => move.kind === "buy_at_market");
        if (marketMove) {
          const marketDecision = await chooseMove(state, [marketMove, ...marketMoves.filter((m) => m !== marketMove)], recent);
          if (marketDecision.ok && marketDecision.move.kind === "buy_at_market") {
            const result = buyAtMarket(state, marketDecision.purchases);
            if (result.spent) {
              const bought = result.bought.map((item) => `${item.amount} ${item.unit} of ${item.label.toLowerCase()}`).join(", ");
              log.push({ kind: "market", day: dayBefore, week: state.calendar.week, bought: result.bought, spent: result.spent, reason: marketDecision.reason });
              recent.push(`Bought ${bought} for ${result.spent}d`);
              console.log(`    MARKET: ${bought} for ${result.spent}d — ${marketDecision.reason}`);
            }
          }
        }
        /* The stalls come down for the week. */
        state.lastSermonAftermath = null;
      } else {
        applySermon(state, "Duty", "Hold to what is right.", {
          ...fallbackSermonOutcome(state, "Duty", "Hold to what is right."),
          source: "fallback"
        });
      }
      compactReplayHistory(state);
      snapshot(state, `after the Sunday sermon`);
      flush(state);
      continue;
    }

    const visit = beginVisit(state);
    const visitor = visitorFor(state, visit);
    trackPerson(state, visit.personId, "visited the priest");
    trackPerson(state, visit.issue.relatedPersonId, "named in a visitor's matter");
    for (const subjectId of state.issueThreads.find((thread) => thread.id === visit.issue.threadId)?.subjectIds || []) {
      trackPerson(state, subjectId, "involved in the matter discussed");
    }
    console.log(`[${dayLabel(dayBefore, state.calendar.week)}] ${visitor?.name} (${visitor?.occupation}) — ${visit.issue.kind} in the ${visit.location}`);
    const visitLog = {
      kind: "visit",
      day: dayBefore,
      week: state.calendar.week,
      visitor: visitor?.name,
      occupation: visitor?.occupation,
      age: visitor?.age,
      issue: visit.issue.kind,
      location: visit.location,
      opening: visit.history[0]?.text || "",
      exchanges: []
    };

    let guard = 0;
    while (guard < 14) {
      guard += 1;
      const moves = legalMoves(state);
      if (!moves.length) break;
      const decision = await chooseMove(state, moves, recent);
      if (!decision.ok) {
        console.log(`   ! ${decision.error} — ending the hour`);
        visitLog.exchanges.push({ error: decision.error });
        break;
      }
      if (decision.move.kind === "next_hour") {
        visitLog.endedBecause = decision.reason;
        break;
      }
      if (decision.move.kind === "summon_officer") {
        const result = summonOfficer(state, {
          officerId: decision.move.officerId,
          subjectId: decision.move.subjectId,
          purpose: decision.move.purpose,
          reason: decision.reason
        });
        visitLog.exchanges.push({ summonedOfficer: result ? result.officer.name : null, purpose: decision.move.purpose, reason: decision.reason });
        console.log(`   * sent ${result ? result.officer.name : "no one"} to ${decision.move.purpose} ${result?.subject?.name || ""}`);
        recent.push(`Sent the watch to ${decision.move.purpose}`);
        continue;
      }
      if (decision.move.kind === "petition_authority") {
        const result = petitionAuthority(state, {
          role: decision.move.role,
          subjectId: state.currentVisit?.personId || null,
          matter: decision.text
        });
        visitLog.exchanges.push({ petitioned: decision.move.role, matter: decision.text, reason: decision.reason });
        console.log(`   * sent word to the ${result?.title || decision.move.role}: ${String(decision.text).slice(0, 70)}`);
        recent.push(`Sent word to the ${decision.move.role}`);
        continue;
      }
      if (decision.move.kind === "request_visit") {
        requestVisits(state, [decision.move.personId], decision.reason);
        visitLog.exchanges.push({ requestedVisit: decision.move.personId, reason: decision.reason });
        recent.push(`Asked ${decision.move.personId} to come`);
        continue;
      }
      if (decision.move.kind !== "speak") break;

      turns += 1;
      const priestText = decision.text;
      let response;
      try {
        response = await voice.conversation(state, visitorFor(state, state.currentVisit), priestText, {
          stagedGifts: decision.gives || []
        });
      } catch (error) {
        response = { ...fallbackConversation(state, priestText), source: "fallback", voiceError: error.message };
      }
      recordExchange(state, priestText, response);
      const exchange = {
        priest: priestText,
        priestReason: decision.reason,
        visitor: response.reply,
        source: response.promptTrace?.responseSource || response.source || "unknown",
        transformations: (response.promptTrace?.transformations || []).map((entry) => entry.type),
        churchGift: response.churchAidApplied || null,
        churchGifts: response.churchAidsApplied || [],
        understoodAs: response.promptTrace?.understoodPlayerAs || ""
      };
      visitLog.exchanges.push(exchange);
      recent.push(`Told ${visitor?.firstName}: ${priestText.slice(0, 70)}`);
      console.log(`   YOU: ${priestText.slice(0, 100)}`);
      console.log(`   ${visitor?.firstName}: ${String(response.reply).slice(0, 100)}`);
      if (exchange.churchGift) {
        console.log(`   * gave ${exchange.churchGift.amount} ${exchange.churchGift.amount === 1
          ? String(exchange.churchGift.unit).replace(/ies$/, "y").replace(/ves$/, "f").replace(/s$/, "")
          : exchange.churchGift.unit}`);
      }
      if (response.endsConversation || state.currentVisit.reactionState?.endedEarly) break;
      if (state.currentVisit.turnsUsed >= state.currentVisit.maxTurns) break;
    }

    finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
    compactReplayHistory(state);
    log.push(visitLog);
    snapshot(state, `after ${visitor?.name || "visit"}`);
    flush(state);
  }

  flush(state, { final: true });
  deserializeState(readFileSync(savePath, "utf8"));

  console.log(`\nplayed ${state.calendar.absoluteDay} days in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log(`agent calls ${agentCalls}, refused moves ${refusedMoves}, failures ${agentFailures}, turns ${turns}`);
  console.log(`save: ${savePath}`);
  console.log(`log : ${logPath}`);
  console.log(`text: ${transcriptPath}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);

