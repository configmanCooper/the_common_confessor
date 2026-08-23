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

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applySermon,
  beginVisit,
  createGame,
  fallbackConversation,
  fallbackDeparturePlan,
  fallbackSermonOutcome,
  finishVisit,
  recordExchange,
  requestVisits
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

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const DAYS = Number(option("days", 14));
const MODEL = option("model", "gpt-5.6-sol");
const SEED = option("seed", `watch-ai-${Date.now()}`);
const STEER = option("steer", "");
const OUT_DIR = option("out", join(root, "exports"));
const VOICE_ENDPOINT = option("voice", "http://127.0.0.1:8095");

const log = [];
let agentCalls = 0;
let agentFailures = 0;
let refusedMoves = 0;

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
  let prompt = buildAgentPrompt(state, moves, { steer: STEER, recent });
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
  const state = createGame(SEED);
  const voice = new ParishAiClient({ endpoint: VOICE_ENDPOINT, model: "local-gemma", timeoutMs: 120000 });
  const recent = [];
  const started = Date.now();
  let turns = 0;

  console.log(`Priest: ${MODEL}   visitors voiced by the local model`);
  console.log(`seed ${SEED}, ${DAYS} days\n`);

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
        console.log(`[day ${dayBefore}] SERMON on ${theme}: ${String(text).slice(0, 90)}...`);
      } else {
        applySermon(state, "Duty", "Hold to what is right.", {
          ...fallbackSermonOutcome(state, "Duty", "Hold to what is right."),
          source: "fallback"
        });
      }
      compactReplayHistory(state);
      continue;
    }

    const visit = beginVisit(state);
    const visitor = visitorFor(state, visit);
    console.log(`[day ${dayBefore}] ${visitor?.name} (${visitor?.occupation}) — ${visit.issue.kind} in the ${visit.location}`);
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
        response = await voice.conversation(state, visitorFor(state, state.currentVisit), priestText);
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
  }

  const serialized = serializeState(state);
  deserializeState(serialized);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const savePath = join(OUT_DIR, `watch-ai-${stamp}.save.json`);
  const logPath = join(OUT_DIR, `watch-ai-${stamp}.log.json`);
  writeFileSync(savePath, serialized);
  writeFileSync(logPath, JSON.stringify({
    model: MODEL,
    seed: SEED,
    days: DAYS,
    steer: STEER,
    elapsedMs: Date.now() - started,
    agentCalls,
    agentFailures,
    refusedMoves,
    turns,
    finalBoard: describeBoard(state),
    log
  }, null, 2));

  console.log(`\nplayed ${DAYS} days in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log(`agent calls ${agentCalls}, refused moves ${refusedMoves}, failures ${agentFailures}`);
  console.log(`save: ${savePath}`);
  console.log(`log : ${logPath}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
