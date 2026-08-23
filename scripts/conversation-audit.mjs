import { ParishAiClient } from "../js/ai.js";
import { beginVisit, createGame, materializeResident, recordExchange } from "../js/simulation.js";

const ENDPOINT = process.env.LOCAL_AI_ENDPOINT || "http://127.0.0.1:8095";

const SCRIPTS = [
  [
    "What troubles you today?",
    "Who else knows about this?",
    "Why do you believe that?",
    "Then go and speak with him yourself, and come back to me tomorrow.",
    "No, that is not what I meant. I meant the other man."
  ],
  [
    "Tell me plainly what you want from me.",
    "That sounds heavy. How are you bearing it?",
    "Perhaps a neighbour could help you with the work.",
    "You said he was angry. Why was he angry?",
    "I agree with the first part, but not the second."
  ]
];

function tokens(text) {
  return Math.round(String(text || "").length / 3.6);
}

async function main() {
  const rows = [];
  for (const [index, script] of SCRIPTS.entries()) {
    const state = createGame(`live-audit-${index}`);
    const visit = beginVisit(state);
    const person = materializeResident(state, visit.personId, true);
    const client = new ParishAiClient({
      endpoint: ENDPOINT,
      model: "local-gemma",
      splitSemantic: true,
      timeoutMs: 120000
    });
    for (const line of script) {
      if (visit.turnsUsed >= visit.maxTurns) break;
      const started = Date.now();
      let response;
      try {
        response = await client.conversation(state, person, line);
      } catch (error) {
        rows.push({ scenario: index, player: line, error: error.message, ms: Date.now() - started });
        continue;
      }
      const trace = response.promptTrace || {};
      rows.push({
        scenario: index,
        player: line,
        ms: Date.now() - started,
        promptTokens: tokens(trace.prompt),
        route: trace.route || response.conversationObligation?.kind,
        source: trace.responseSource,
        replaced: Boolean(response.groundedFallback),
        modelDraft: String(trace.initialReply || "").slice(0, 220),
        shown: String(response.reply || "").slice(0, 220),
        defects: (trace.semanticValidation?.defects || []).map((defect) => defect.code)
      });
      recordExchange(state, line, response);
    }
  }

  for (const row of rows) {
    console.log(`\n--- scenario ${row.scenario} | ${row.ms} ms | prompt≈${row.promptTokens} tok | route=${row.route} | source=${row.source}`);
    console.log(`PLAYER : ${row.player}`);
    if (row.error) {
      console.log(`ERROR  : ${row.error}`);
      continue;
    }
    console.log(`DRAFT  : ${row.modelDraft}`);
    console.log(`SHOWN  : ${row.shown}`);
    console.log(`REPLACED: ${row.replaced}  defects=${row.defects.join(",") || "none"}`);
  }

  const usable = rows.filter((row) => !row.error);
  const replaced = usable.filter((row) => row.replaced);
  console.log("\n==== SUMMARY ====");
  console.log(`turns=${rows.length} errors=${rows.length - usable.length} replaced=${replaced.length}`);
  console.log(`median latency=${usable.map((row) => row.ms).sort((a, b) => a - b)[Math.floor(usable.length / 2)]} ms`);
  console.log(`max prompt tokens=${Math.max(0, ...usable.map((row) => row.promptTokens))}`);
  const defectCounts = {};
  for (const row of usable) {
    for (const defect of row.defects) defectCounts[defect] = (defectCounts[defect] || 0) + 1;
  }
  console.log(`defects=${JSON.stringify(defectCounts)}`);
}

main();
