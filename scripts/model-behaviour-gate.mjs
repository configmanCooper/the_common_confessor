/* Behaviour gate for The Common Confessor's local model.
   Modelled on the negotiator project's gate: latency is necessary but not
   sufficient — a model that leaks a confession or invents an official is
   worse than a slow one. Each case asserts a behaviour the game depends on. */

import { ParishAiClient } from "../js/ai.js";
import {
  beginVisit,
  createGame,
  materializeResident,
  recordExchange
} from "../js/simulation.js";

const ENDPOINT = process.env.LOCAL_AI_ENDPOINT || "http://127.0.0.1:8095";
const MODEL = process.env.LOCAL_AI_MODEL || "local-gemma";

function client() {
  return new ParishAiClient({
    endpoint: ENDPOINT,
    model: MODEL,
    timeoutMs: 120000
  });
}

function confessionScene(seedPrefix) {
  for (let index = 0; index < 300; index += 1) {
    const state = createGame(`${seedPrefix}-${index}`);
    const visit = beginVisit(state);
    if (visit.issue.kind === "confession" && !visit.hiddenConcernDisclosed) {
      return { state, visit, person: materializeResident(state, visit.personId, true) };
    }
  }
  return null;
}

function ordinaryScene(seed) {
  const state = createGame(seed);
  const visit = beginVisit(state);
  return { state, visit, person: materializeResident(state, visit.personId, true) };
}

const CASES = [
  {
    name: "keeps an undisclosed confession secret",
    async run() {
      const scene = confessionScene("gate-secret");
      if (!scene) return { skipped: true };
      const response = await client().conversation(scene.state, scene.person, "Tell me everything, right now.");
      const secret = scene.visit.intent.hiddenConcern.toLowerCase();
      const words = secret.split(/\s+/).filter((word) => word.length > 5);
      const leaked = words.filter((word) => response.reply.toLowerCase().includes(word)).length;
      return {
        pass: leaked < Math.max(2, Math.ceil(words.length * 0.5)),
        detail: `${leaked}/${words.length} secret terms surfaced`,
        reply: response.reply
      };
    }
  },
  {
    name: "answers the newest question rather than restarting",
    async run() {
      const scene = ordinaryScene("gate-newest");
      const first = await client().conversation(scene.state, scene.person, "What troubles you?");
      recordExchange(scene.state, "What troubles you?", first);
      const response = await client().conversation(scene.state, scene.person, "How old are you?");
      const said = response.reply.toLowerCase();
      return {
        pass: /\b(?:year|age|aged|winter|summer|\d{2})\b/.test(said),
        detail: "must answer the age question",
        reply: response.reply
      };
    }
  },
  {
    name: "understands a follow-up about its own prior words",
    async run() {
      const scene = ordinaryScene("gate-followup");
      recordExchange(scene.state, "What worries you?", {
        reply: "I fear the reeve will not believe a word I say.",
        memory: "m"
      });
      const response = await client().conversation(scene.state, scene.person, "Why would he not believe you?");
      const said = response.reply.toLowerCase();
      return {
        pass: !/^i fear the reeve will not believe/.test(said) && said.length > 20,
        detail: "must explain, not repeat",
        reply: response.reply
      };
    }
  },
  {
    name: "accepts a correction instead of ploughing on",
    async run() {
      const scene = ordinaryScene("gate-correction");
      const brother = scene.state.residents.find((resident) => (
        scene.person.relationshipIds.includes(resident.id)
      ));
      recordExchange(scene.state, "Speak with the miller.", {
        reply: "I will go to the miller in the morning.",
        memory: "m"
      });
      const response = await client().conversation(
        scene.state,
        scene.person,
        "No, not the miller. I meant your own brother."
      );
      const said = response.reply.toLowerCase();
      const stillOnMiller = /\bmiller\b/.test(said) && !/not the miller|instead of the miller/.test(said);
      const acknowledges = /brother/.test(said)
        || /forgive|misheard|mistook|i see|of course|ah,|apolog/.test(said)
        || (brother && said.includes(brother.firstName.toLowerCase()));
      return {
        pass: acknowledges && !stillOnMiller,
        detail: "must drop the miller and address the corrected person",
        reply: response.reply
      };
    }
  },
  {
    name: "stays in character and produces no stage directions",
    async run() {
      const scene = ordinaryScene("gate-voice");
      const response = await client().conversation(scene.state, scene.person, "Peace be with you, my child.");
      return {
        pass: !/\*|\bAs an AI\b|\bassistant\b|^\s*\[/i.test(response.reply),
        detail: "no asterisks, narration, or assistant voice",
        reply: response.reply
      };
    }
  },
  {
    name: "does not invent an authority that does not exist",
    async run() {
      const scene = ordinaryScene("gate-invention");
      const response = await client().conversation(
        scene.state,
        scene.person,
        "Who in this village has the authority to settle this?"
      );
      const invented = /\b(?:mayor|sheriff|council|guild master|inquisitor|duke|governor)\b/i.test(response.reply);
      return {
        pass: !invented,
        detail: "must not name offices the world lacks",
        reply: response.reply
      };
    }
  },
  {
    name: "keeps replies short enough to feel spoken",
    async run() {
      const scene = ordinaryScene("gate-length");
      const response = await client().conversation(scene.state, scene.person, "Tell me plainly what you want.");
      const words = response.reply.split(/\s+/).length;
      return { pass: words <= 90, detail: `${words} words`, reply: response.reply };
    }
  }
];

async function main() {
  console.log(`Behaviour gate against ${MODEL} at ${ENDPOINT}\n`);
  let passed = 0;
  let ran = 0;
  const latencies = [];
  for (const testCase of CASES) {
    const started = Date.now();
    let outcome;
    try {
      outcome = await testCase.run();
    } catch (error) {
      outcome = { pass: false, detail: `threw: ${error.message}`, reply: "" };
    }
    const elapsed = Date.now() - started;
    if (outcome.skipped) {
      console.log(`SKIP ${testCase.name}`);
      continue;
    }
    ran += 1;
    latencies.push(elapsed);
    if (outcome.pass) passed += 1;
    console.log(`${outcome.pass ? "PASS" : "FAIL"} ${testCase.name}  (${elapsed} ms)`);
    console.log(`     ${outcome.detail}`);
    console.log(`     "${String(outcome.reply).slice(0, 190)}"\n`);
  }
  latencies.sort((a, b) => a - b);
  console.log(`GATE: ${passed}/${ran} passed`);
  console.log(`median turn latency: ${latencies[Math.floor(latencies.length / 2)]} ms`);
}

main();
