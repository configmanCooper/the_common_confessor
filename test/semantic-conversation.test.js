import assert from "node:assert/strict";
import test from "node:test";
import { ParishAiClient } from "../js/ai.js";
import {
  beginVisit,
  createGame,
  materializeResident,
  recordExchange
} from "../js/simulation.js";
import { deserializeState, serializeState } from "../js/state.js";

function responseBody(content) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function semanticReply(plan, overrides = {}) {
  const required = plan.requiredAnswerSlots.length ? plan.requiredAnswerSlots : [plan.obligationId];
  return {
    reply: "I have not seen proof myself, Father, but I can tell you exactly what I heard and what remains uncertain.",
    memory: "The visitor distinguished evidence from uncertainty.",
    interpretation: {
      speechActs: [{ type: "question", meaning: "The priest asks what evidence exists.", referenceText: null, confidence: 0.96 }],
      implicitMeaning: "The priest wants evidence rather than repetition.",
      tone: "skeptical",
      mandatoryResponseNeeds: ["Answer the evidence question and state uncertainty."]
    },
    responsePlan: {
      primaryObligationId: required[0],
      secondaryObligationIds: required.slice(1),
      knownFactIds: plan.requiredFactIds,
      unknowns: ["The full truth has not been independently confirmed."],
      proposalPositions: [],
      desiredMovement: "Clarify evidence without forcing a decision.",
      endConversation: false
    },
    claims: plan.requiredFactIds.length ? [{
      claimId: "claim-evidence",
      sentenceIndex: 0,
      type: "fact",
      text: "The visitor has only the supplied evidence.",
      subjectId: null,
      targetIds: [],
      evidenceFactIds: [plan.requiredFactIds[0]],
      confidence: 0.85
    }] : [],
    answeredObligations: required,
    newQuestions: [],
    decisions: [],
    ...overrides
  };
}

function fastSemanticReply(prompt, reply) {
  return {
    reply,
    meaning: "The priest asks the visitor to explain their preceding remark.",
    claimType: "belief"
  };
}

test("follow-ups to the visitor's own remark use one compact semantic call", async () => {
  const state = createGame("semantic-fast-prior-reply");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  recordExchange(state, "Ask the watch what they know.", {
    reply: "I will speak with the watch, Father, though I fear they may offer little comfort.",
    memory: "The visitor agreed to consult the watch."
  });
  let calls = 0;
  let schemaName = "";
  let prompt = "";
  const client = new ParishAiClient({
    splitSemantic: true,
    fetchImpl: async (_url, options) => {
      calls += 1;
      const payload = JSON.parse(options.body);
      schemaName = payload.response_format.json_schema.name;
      prompt = payload.messages[1].content;
      return responseBody(fastSemanticReply(
        prompt,
        "Because they have heard the same rumors and seen no soldiers themselves. I meant that they may know no more than we do."
      ));
    }
  });
  const response = await client.conversation(state, person, "Why would the watch offer little comfort?");
  assert.equal(calls, 1);
  assert.equal(schemaName, "parish_fast_conversation");
  assert.equal(response.promptTrace.responseSource, "gemma_dialogue");
  assert.match(response.reply, /heard the same rumors/i);
  assert.ok(response.answeredObligations.includes(response.conversationObligation.obligationId));
  assert.match(prompt, /FULL_ACTIVE_TRANSCRIPT=/);
  assert.doesNotMatch(prompt, /WORLD_CONTEXT_JSON=/);
  assert.deepEqual(response.promptTrace.includedFactIds, []);
  recordExchange(state, "Why would the watch offer little comfort?", response);
  assert.equal(visit.continuity.semantic.topics.at(-1).speechAct, "follow_up");
  assert.match(visit.continuity.semantic.npcGoals.at(-1).text, /preceding remark/i);
});

test("compound proposals still use the full semantic pipeline after prior exchanges", async () => {
  const state = createGame("semantic-fast-route-guard");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  recordExchange(state, "We should learn more.", {
    reply: "Then we must decide who can be trusted.",
    memory: "The visitor wanted trustworthy help."
  });
  const schemaNames = [];
  const client = new ParishAiClient({
    splitSemantic: true,
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      const schemaName = payload.response_format.json_schema.name;
      schemaNames.push(schemaName);
      if (schemaName === "parish_turn_interpretation") {
        return responseBody({
          speechActs: [{
            type: "request",
            meaning: "The priest asks for two coordinated actions.",
            referenceText: null,
            confidence: 0.98
          }],
          implicitMeaning: "The watch and scouts should both gather evidence.",
          tone: "practical",
          mandatoryResponseNeeds: ["Respond to both proposed actions."]
        });
      }
      const prompt = payload.messages[1].content;
      const plan = JSON.parse(prompt.split("RESPONSE_PLAN_JSON=")[1].split("\nCONVERSATIONAL PRIORITY:")[0]);
      return responseBody(semanticReply(plan));
    }
  });
  await client.conversation(state, person, "Ask the watch and send two trusted people to inspect the road.");
  assert.deepEqual(schemaNames, ["parish_turn_interpretation", "parish_conversation_render"]);
});

test("ordinary factual questions are rendered by Gemma from supplied knowledge", async () => {
  const state = createGame("semantic-factual-render");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  let calls = 0;
  const client = new ParishAiClient({
    fetchImpl: async (_url, options) => {
      calls += 1;
      const prompt = JSON.parse(options.body).messages[1].content;
      const plan = JSON.parse(prompt.split("RESPONSE_PLAN_JSON=")[1].split("\nCONVERSATIONAL PRIORITY:")[0]);
      return responseBody(semanticReply(plan));
    }
  });
  const response = await client.conversation(state, person, "Whose eyes will be on the channel, then");
  assert.equal(calls, 1);
  assert.equal(response.structuredProvided, true);
  assert.equal(response.groundedFallback, undefined);
  assert.match(response.reply, /not seen proof myself/i);
  assert.equal(response.promptTrace.responseSource, "gemma_dialogue");
});

test("implicit questions without punctuation can satisfy semantic obligations", async () => {
  const state = createGame("semantic-implicit-question");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const client = new ParishAiClient({
    fetchImpl: async (_url, options) => {
      const prompt = JSON.parse(options.body).messages[1].content;
      const plan = JSON.parse(prompt.split("RESPONSE_PLAN_JSON=")[1].split("\nCONVERSATIONAL PRIORITY:")[0]);
      return responseBody(semanticReply(plan, {
        interpretation: {
          speechActs: [{ type: "implicit_question", meaning: "The priest implicitly asks who can inspect.", referenceText: "whose eyes", confidence: 0.92 }],
          implicitMeaning: "An investigator is still needed.",
          tone: "practical",
          mandatoryResponseNeeds: ["Propose or admit uncertainty about an investigator."]
        },
        answeredObligations: [plan.obligationId]
      }));
    }
  });
  const response = await client.conversation(state, person, "Someone still needs to see whether the runoff reaches the well");
  assert.equal(response.structuredProvided, true);
  assert.ok(response.answeredObligations.includes(response.conversationObligation.obligationId));
});

test("invalid claim sentences are repaired without replacing valid sentences", async () => {
  const state = createGame("semantic-claim-repair");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const knownTarget = state.residents.find((resident) => person.relationshipIds.includes(resident.id));
  let calls = 0;
  const client = new ParishAiClient({
    fetchImpl: async (_url, options) => {
      calls += 1;
      const payload = JSON.parse(options.body);
      const schemaName = payload.response_format.json_schema.name;
      if (schemaName === "parish_conversation_claim_repair") {
        return responseBody({
          replacements: [{
            sentenceIndex: 1,
            text: `Perhaps ${knownTarget.firstName} could look at it, though I have not asked yet.`,
            claims: [{
              claimId: "claim-repaired",
              sentenceIndex: 1,
              type: "proposal",
              text: `${knownTarget.name} could inspect it.`,
              subjectId: person.id,
              targetIds: [knownTarget.id],
              evidenceFactIds: [],
              confidence: 0.55
            }]
          }],
          answeredObligations: [],
          newQuestions: []
        });
      }
      const prompt = payload.messages[1].content;
      const plan = JSON.parse(prompt.split("RESPONSE_PLAN_JSON=")[1].split("\nCONVERSATIONAL PRIORITY:")[0]);
      const base = semanticReply(plan);
      base.reply = "I am frightened, Father. King Nobody has already ordered the arrest.";
      base.claims = [
        {
          claimId: "claim-valid",
          sentenceIndex: 0,
          type: "opinion",
          text: "The visitor is frightened.",
          subjectId: person.id,
          targetIds: [],
          evidenceFactIds: [],
          confidence: 1
        },
        {
          claimId: "claim-invalid",
          sentenceIndex: 1,
          type: "fact",
          text: "King Nobody ordered an arrest.",
          subjectId: "person-does-not-exist",
          targetIds: [],
          evidenceFactIds: ["fact-does-not-exist"],
          confidence: 1
        }
      ];
      return responseBody(base);
    }
  });
  const response = await client.conversation(state, person, "What do you think we should do?");
  assert.equal(calls, 2);
  assert.match(response.reply, /^I am frightened, Father\./);
  assert.match(response.reply, new RegExp(knownTarget.firstName));
  assert.doesNotMatch(response.reply, /King Nobody/);
  assert.equal(response.promptTrace.responseSource, "gemma_repaired");
});

test("model promises create persistent intentions without immediate mechanics", async () => {
  const state = createGame("semantic-promise-commitment");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const target = state.residents.find((resident) => person.relationshipIds.includes(resident.id));
  const targetStress = target.stress;
  const client = new ParishAiClient({
    fetchImpl: async (_url, options) => {
      const prompt = JSON.parse(options.body).messages[1].content;
      const plan = JSON.parse(prompt.split("RESPONSE_PLAN_JSON=")[1].split("\nCONVERSATIONAL PRIORITY:")[0]);
      return responseBody(semanticReply(plan, {
        reply: `I will speak with ${target.firstName} tomorrow, Father, if they will hear me.`,
        claims: [{
          claimId: "promise-speak",
          sentenceIndex: 0,
          type: "promise",
          text: `Speak with ${target.name} tomorrow.`,
          subjectId: person.id,
          targetIds: [target.id],
          evidenceFactIds: [],
          confidence: 0.72
        }]
      }));
    }
  });
  const response = await client.conversation(state, person, "Could you speak with them tomorrow");
  recordExchange(state, "Could you speak with them tomorrow", response);
  const commitment = state.commitments.find((entry) => entry.type === "npc_intention" && entry.actorId === person.id);
  assert.ok(commitment);
  assert.equal(commitment.status, "open");
  assert.equal(target.stress, targetStress);
  assert.ok(visit.continuity.semantic.commitments.length >= 1);
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});
