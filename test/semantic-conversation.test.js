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
import { clarificationFacts } from "../js/conversation.js";
import { naturalClient } from "./semantic-test-client.js";

function scene(seed) {
  const state = createGame(seed);
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  return { state, visit, person };
}

function withSchemaSpy(client, sink) {
  const original = client.fetchImpl;
  client.fetchImpl = async (url, options) => {
    sink.schema = JSON.parse(options.body).response_format.json_schema;
    return original(url, options);
  };
  return client;
}

test("an ordinary turn costs exactly one model call with a compact prompt", async () => {
  const { state, person } = scene("natural-single-call");
  let calls = 0;
  let promptChars = 0;
  const sink = {};
  const client = withSchemaSpy(naturalClient((_parsed, prompt) => {
    calls += 1;
    promptChars = prompt.length;
    return {
      understoodPlayerAs: "The priest asks what is troubling me.",
      reply: "The rent is owed by Sunday and I have not the coin, Father.",
      npcIntent: "Explain the immediate pressure.",
      proposedActions: []
    };
  }), sink);
  const response = await client.conversation(state, person, "What troubles you today?");
  assert.equal(calls, 1);
  assert.equal(sink.schema.name, "parish_natural_conversation");
  assert.ok(promptChars < 6000, `prompt was ${promptChars} characters`);
  assert.equal(response.promptTrace.route, "natural_conversation");
  assert.equal(response.promptTrace.responseSource, "gemma_dialogue");
  assert.match(response.reply, /rent is owed by Sunday/);
  assert.doesNotMatch(
    response.promptTrace.prompt,
    /BACKGROUND_CONTEXT_JSON|RESPONSE_PLAN_JSON|APPROVED_TURN_INTERPRETATION/
  );
  recordExchange(state, "What troubles you today?", response);
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("the prompt sends recent turns and a summary rather than the whole transcript", async () => {
  const { state, person } = scene("natural-compact-history");
  for (let index = 0; index < 6; index += 1) {
    recordExchange(state, `Priest line number ${index} about the matter.`, {
      reply: `Visitor answer number ${index} about the matter.`,
      memory: "m"
    });
  }
  let parsed = null;
  const client = naturalClient((entry) => {
    parsed = entry;
    return {
      understoodPlayerAs: "The priest asks again.",
      reply: "I will answer something new, Father.",
      npcIntent: "Move forward.",
      proposedActions: []
    };
  });
  await client.conversation(state, person, "And what will you do now?");
  assert.equal(parsed.playerText, "And what will you do now?");
  assert.ok(parsed.recent.length <= 6, `sent ${parsed.recent.length} verbatim turns`);
  assert.match(parsed.prompt, /Earlier in this conversation:/);
  assert.equal(parsed.recent.join("\n").includes("number 0 about the matter"), false);
  assert.equal(parsed.recent.join("\n").includes("number 5 about the matter"), true);
  assert.ok(parsed.prompt.length < 4000, `turn prompt was ${parsed.prompt.length} characters`);
});

test("the prompt budget holds across parishes, not just one", async () => {
  /* The budget was being sampled on a single seed, and passing by luck. When
     the hour of a matter was added to every turn it sat at 4015 on the pinned
     seed and would have failed - but on other seeds the same addition left
     zero or negative margin while the pinned one still passed. A budget that
     only one parish has to meet is not a budget. */
  const lengths = [];
  for (const seed of ["budget-a", "budget-b", "budget-c", "budget-d", "budget-e", "budget-f"]) {
    const { state, person } = scene(seed);
    for (let index = 0; index < 6; index += 1) {
      recordExchange(state, `Priest line number ${index} about the matter.`, {
        reply: `Visitor answer number ${index} about the matter.`,
        memory: "m"
      });
    }
    let length = 0;
    const client = naturalClient((entry) => {
      length = entry.prompt.length;
      return {
        understoodPlayerAs: "u",
        reply: "I will answer something new, Father.",
        npcIntent: "n",
        proposedActions: []
      };
    });
    await client.conversation(state, person, "And what will you do now?");
    lengths.push({ seed, length });
  }
  const over = lengths.filter((entry) => entry.length >= 4000);
  assert.deepEqual(
    over.map((entry) => `${entry.seed}: ${entry.length}`),
    [],
    "these parishes exceeded the turn prompt budget"
  );
});

test("the newest player text is presented last and verbatim", async () => {
  const { state, person } = scene("natural-newest-priority");
  let prompt = "";
  const client = naturalClient((_entry, raw) => {
    prompt = raw;
    return { understoodPlayerAs: "u", reply: "I understand, Father.", npcIntent: "n", proposedActions: [] };
  });
  await client.conversation(state, person, "No, that is not what I meant. I meant the other man.");
  const said = prompt.indexOf("THE PRIEST JUST SAID:");
  assert.ok(said > 0);
  assert.match(prompt.slice(said), /No, that is not what I meant\. I meant the other man\./);
});

test("supplied knowledge reaches the model as knowledge, not as canned dialogue", async () => {
  const { state, visit, person } = scene("natural-knowledge-supplied");
  const question = "What exactly happened, and how does it harm you?";
  const expected = clarificationFacts(visit, question);
  let parsed = null;
  const client = naturalClient((entry) => {
    parsed = entry;
    return {
      understoodPlayerAs: "The priest wants the specifics.",
      reply: "In my own words: it went up without our consent and we cannot graze there now.",
      npcIntent: "Give the specifics naturally.",
      proposedActions: []
    };
  });
  const response = await client.conversation(state, person, question);
  assert.equal(parsed.knowledge.length, expected.length);
  assert.match(response.reply, /In my own words/);
  assert.ok(!response.groundedFallback);
  assert.deepEqual(response.promptTrace.suppliedKnowledge, parsed.knowledge);
  for (const line of parsed.knowledge) {
    assert.doesNotMatch(response.reply, new RegExp(line.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("a model reply survives even when it uses none of the expected wording", async () => {
  const { state, person } = scene("natural-no-keyword-replacement");
  const client = naturalClient({
    understoodPlayerAs: "The priest offers bread from the church stores.",
    reply: "That would ease things more than you know. I would be grateful.",
    npcIntent: "Accept the offer warmly.",
    proposedActions: []
  });
  const response = await client.conversation(state, person, "Would some bread from the church help?");
  assert.match(response.reply, /I would be grateful/);
  assert.ok(!response.groundedFallback);
  assert.deepEqual(response.promptTrace.transformations, []);
});

test("promises become simulated commitments rather than immediate mechanics", async () => {
  const { state, person } = scene("natural-promise-commitment");
  const target = state.residents.find((resident) => person.relationshipIds.includes(resident.id));
  const targetStress = target.stress;
  const client = naturalClient({
    understoodPlayerAs: "The priest asks me to speak with him.",
    reply: `I will speak with ${target.firstName} tomorrow, Father, if he will hear me.`,
    npcIntent: "Commit to approaching him.",
    proposedActions: [{ action: "speak_to", target: target.name }]
  });
  const response = await client.conversation(state, person, "Could you speak with them tomorrow?");
  assert.equal(response.proposedActions.length, 1);
  assert.equal(response.proposedActions[0].targetId, target.id);
  recordExchange(state, "Could you speak with them tomorrow?", response);
  const commitment = state.commitments.find((entry) => (
    entry.type === "npc_intention" && entry.actorId === person.id
  ));
  assert.ok(commitment, "the promise did not become a commitment");
  assert.equal(commitment.status, "open");
  assert.equal(target.stress, targetStress, "the promise changed world state immediately");
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("actions aimed at people who do not exist are dropped without discarding the reply", async () => {
  const { state, person } = scene("natural-invalid-action");
  const client = naturalClient({
    understoodPlayerAs: "The priest asks who could help.",
    reply: "I could ask someone I trust, though I am not certain they would agree.",
    npcIntent: "Offer a tentative path.",
    proposedActions: [{ action: "speak_to", target: "Lord Nobody of Nowhere" }]
  });
  const response = await client.conversation(state, person, "Is there anyone who could help you?");
  assert.match(response.reply, /someone I trust/);
  assert.equal(response.proposedActions.length, 0);
  assert.ok(response.promptTrace.transformations.some((entry) => entry.type === "action_dropped"));
});

test("an invented village elder is repaired at sentence level, keeping the rest", async () => {
  const { state, person } = scene("natural-elder-repair");
  const client = naturalClient({
    understoodPlayerAs: "The priest asks who can settle it.",
    reply: "I am frightened of what comes next, Father. The village elder has already ruled against us.",
    npcIntent: "Explain who decides.",
    proposedActions: []
  });
  const response = await client.conversation(state, person, "Who has the authority to settle this?");
  assert.match(response.reply, /I am frightened of what comes next, Father\./);
  assert.doesNotMatch(response.reply, /village elder has already ruled/);
  assert.ok(response.promptTrace.transformations.some((entry) => entry.type === "sentence_repaired"));
  assert.equal(response.promptTrace.responseSource, "gemma_repaired");
});

test("a repeated reply triggers one regeneration instead of canned stagnation prose", async () => {
  const { state, person } = scene("natural-repetition-retry");
  const repeated = "I simply do not know what to do about the debt and the winter coming.";
  recordExchange(state, "Tell me more.", { reply: repeated, memory: "m" });
  let calls = 0;
  const client = naturalClient(() => {
    calls += 1;
    return calls === 1
      ? { understoodPlayerAs: "u", reply: repeated, npcIntent: "n", proposedActions: [] }
      : {
        understoodPlayerAs: "u",
        reply: "Perhaps I could sell the good plough and settle part of it.",
        npcIntent: "n",
        proposedActions: []
      };
  });
  const response = await client.conversation(state, person, "And what might you actually do?");
  assert.equal(calls, 2);
  assert.match(response.reply, /sell the good plough/);
  assert.ok(response.promptTrace.transformations.some((entry) => entry.type === "repetition_regeneration"));
});

test("compound proposals request decisions and record each one", async () => {
  const { state, person } = scene("natural-compound-decisions");
  let parsed = null;
  const sink = {};
  const client = withSchemaSpy(naturalClient((entry) => {
    parsed = entry;
    return {
      understoodPlayerAs: "The priest wants two things done.",
      reply: "I will ask the watch, but I cannot spare anyone for the road tonight.",
      npcIntent: "Accept one part and refuse the other.",
      proposedActions: [],
      decisions: entry.proposals.map((proposal, index) => ({
        proposalId: proposal.proposalId,
        status: index === 0 ? "accepted" : "rejected"
      }))
    };
  }), sink);
  const response = await client.conversation(
    state,
    person,
    "Ask the watch what they know, and send two trusted men to inspect the road."
  );
  assert.equal(sink.schema.name, "parish_natural_conversation_decisions");
  assert.ok(parsed.proposals.length >= 2);
  assert.equal(response.decisions.length, parsed.proposals.length);
  assert.equal(response.decisions[0].status, "accepted");
  assert.equal(response.decisions[1].status, "rejected");
  assert.match(response.reply, /I cannot spare anyone/);
});

test("soft emotional reactions keep the model's own wording", async () => {
  const { state, visit, person } = scene("natural-soft-reaction");
  visit.reactionState.anger = 72;
  visit.reactionState.offense = 68;
  visit.reactionState.trust = 12;
  const client = naturalClient({
    understoodPlayerAs: "The priest mocked me again.",
    reply: "You go too far, Father. I came here for help, not to be laughed at.",
    npcIntent: "Push back at the priest.",
    proposedActions: []
  });
  const response = await client.conversation(state, person, "You are being a fool about all this.");
  assert.match(response.reply, /You go too far, Father/);
  assert.notEqual(response.promptTrace.responseSource, "scripted_reaction");
});

test("hard mechanical thresholds end the meeting without consulting the model", async () => {
  const { state, visit, person } = scene("natural-hard-threshold");
  visit.reactionState.anger = 96;
  visit.reactionState.offense = 95;
  visit.reactionState.fear = 92;
  visit.reactionState.perceivedDanger = 95;
  visit.reactionState.willingnessToContinue = 4;
  visit.reactionState.harmfulTurnCount = 5;
  visit.reactionState.harmEvidence = 12;
  let called = false;
  const client = naturalClient(() => {
    called = true;
    return { understoodPlayerAs: "u", reply: "Nothing at all.", npcIntent: "n", proposedActions: [] };
  });
  const response = await client.conversation(state, person, "Get out before I have you whipped, you worthless liar.");
  if (response.endsConversation) {
    assert.equal(called, false, "the model was consulted for a mechanical break-off");
    assert.equal(response.promptTrace.responseSource, "scripted_reaction");
    assert.ok(response.promptTrace.transformations.some((entry) => entry.type === "deterministic_reaction"));
  } else {
    assert.ok(called);
  }
});

test("telemetry distinguishes model understanding from framework transformation", async () => {
  const { state, person } = scene("natural-telemetry");
  const client = naturalClient({
    understoodPlayerAs: "The priest is asking why I distrust the watch.",
    reply: "Because they answer to the manor before they answer to us, Father.",
    npcIntent: "Explain my distrust.",
    proposedActions: []
  });
  const response = await client.conversation(state, person, "Why would the watch offer little comfort?");
  const trace = response.promptTrace;
  assert.equal(trace.understoodPlayerAs, "The priest is asking why I distrust the watch.");
  assert.equal(trace.rawModelReply, "Because they answer to the manor before they answer to us, Father.");
  assert.equal(trace.finalReply, trace.rawModelReply);
  assert.deepEqual(trace.transformations, []);
  assert.equal(trace.gemmaCalled, true);
  assert.ok(trace.prompt.includes("THE PRIEST JUST SAID"));
});

test("the model is never asked to satisfy claim, obligation, or response-plan schemas", async () => {
  const { state, person } = scene("natural-simple-schema");
  let schema = null;
  const client = new ParishAiClient({
    fetchImpl: async (_url, options) => {
      schema = JSON.parse(options.body).response_format.json_schema.schema;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          understoodPlayerAs: "u", reply: "Plainly said, Father.", npcIntent: "n", proposedActions: []
        }) } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  await client.conversation(state, person, "I am listening.");
  const fields = Object.keys(schema.properties).sort();
  assert.deepEqual(
    fields,
    ["npcIntent", "priestGivesFromChurch", "proposedActions", "reply", "understoodPlayerAs", "visitorGivesToChurch"]
  );
  for (const heavyField of ["claims", "responsePlan", "answeredObligations", "interpretation", "newQuestions"]) {
    assert.equal(fields.includes(heavyField), false, `the model was asked for ${heavyField}`);
  }
});
