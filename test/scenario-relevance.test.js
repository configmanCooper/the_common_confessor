import assert from "node:assert/strict";
import test from "node:test";
import { ParishAiClient } from "../js/ai.js";
import { semanticClient } from "./semantic-test-client.js";
import { buildGeneratedScenarioArchetypes } from "../js/scenario_catalog.js";
import {
  beginVisit,
  createGame,
  fallbackDeparturePlan,
  finishVisit,
  materializeResident,
  recordExchange
} from "../js/simulation.js";
import { compactReplayHistory, deserializeState, serializeState } from "../js/state.js";

const BASE_CONTEXT = {
  town: "Alderwick",
  person: "Radel Roseham",
  relation: "Anias Applecombe",
  victim: "Renth Foxridge",
  official: "Oswyn Page",
  resource: "the common well",
  sum: 8,
  creditor: "Cedhard Foxridge",
  debtSum: 20,
  deadlineDays: 6,
  age: 30,
  relationOccupation: "peddler"
};

function repeatingClient(reply = "Renth dumped tanning waste nearby but denies responsibility.") {
  return new ParishAiClient({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply,
            memory: "The visitor repeated an earlier fact."
          })
        }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
}

function wellState(seed) {
  const state = createGame(seed);
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  visit.issue.kind = "village concern";
  visit.issue.scenarioId = "contaminated_well_1";
  visit.scenarioFacts = [
    {
      id: "concrete_matter",
      issueId: visit.issue.threadId,
      text: "Several households became ill after drawing from the common well.",
      anchors: ["households", "ill", "common", "well"],
      provenance: "witnessed",
      confidence: 90,
      visibility: { scope: "public", authorizedPersonIds: [person.id, "priest"] },
      allowedSpeakers: [person.id]
    },
    {
      id: "mechanism",
      issueId: visit.issue.threadId,
      text: "Renth Foxridge dumped tanning waste nearby but denies responsibility.",
      anchors: ["renth", "tanning", "waste", "denies"],
      provenance: "witnessed",
      confidence: 75,
      visibility: { scope: "public", authorizedPersonIds: [person.id, "priest"] },
      allowedSpeakers: [person.id]
    },
    {
      id: "stakes",
      issueId: visit.issue.threadId,
      text: "The village has no confirmed second clean well.",
      anchors: ["village", "confirmed", "second", "clean", "well"],
      provenance: "state",
      confidence: 100,
      visibility: { scope: "public", authorizedPersonIds: [person.id, "priest"] },
      allowedSpeakers: [person.id]
    },
    {
      id: "alternative",
      issueId: visit.issue.threadId,
      text: "Close access, carry clean water, and inspect the runoff.",
      anchors: ["close", "carry", "water", "inspect", "runoff"],
      provenance: "state",
      confidence: 100,
      visibility: { scope: "public", authorizedPersonIds: [person.id, "priest"] },
      allowedSpeakers: [person.id]
    }
  ];
  return { state, visit, person };
}

test("manor grain scenarios require plausible occupational or relational access", () => {
  const peddler = buildGeneratedScenarioArchetypes({ ...BASE_CONTEXT, occupation: "peddler" });
  assert.equal(peddler.some((scenario) => scenario.id.startsWith("embezzled_grain")), false);
  const stablehand = buildGeneratedScenarioArchetypes({ ...BASE_CONTEXT, occupation: "stablehand" });
  assert.equal(stablehand.some((scenario) => scenario.id.startsWith("embezzled_grain")), true);
});

test("shared well scenarios produce occupation-specific perspectives", () => {
  const healer = buildGeneratedScenarioArchetypes({ ...BASE_CONTEXT, occupation: "healer" })
    .find((scenario) => scenario.id === "contaminated_well_1");
  const peddler = buildGeneratedScenarioArchetypes({ ...BASE_CONTEXT, occupation: "peddler" })
    .find((scenario) => scenario.id === "contaminated_well_1");
  assert.match(healer.opening, /same sickness among people drawing from that water/i);
  assert.match(peddler.opening, /people along my route/i);
  assert.notEqual(healer.opening, peddler.opening);
});

test("generic scenario variants no longer fuse an unrelated debt into a well problem", () => {
  const scenarios = buildGeneratedScenarioArchetypes({ ...BASE_CONTEXT, occupation: "healer" })
    .filter((scenario) => scenario.id.startsWith("contaminated_well"));
  assert.ok(scenarios.length >= 3);
  for (const scenario of scenarios) {
    assert.doesNotMatch(scenario.opening, /debt|creditor|Foxridge regarding a debt/i);
    assert.doesNotMatch(scenario.facts.join(" "), /owes \d+ silver pennies/i);
  }
});






test("investigator questions fill investigator and interviewer slots instead of repeating the well premise", async () => {
  const { state, visit, person } = wellState("investigator-obligation");
  const renth = state.residents.find((resident) => resident.id !== person.id && resident.occupation === "tanner");
  assert.ok(renth);
  visit.issue.relatedPersonId = renth.id;
  visit.issue.relatedName = renth.name;
  const client = semanticClient();
  const response = await client.conversation(
    state,
    person,
    `Yes, speak with the reeve. Who also will investigate and talk to ${renth.firstName}?`
  );
  assert.match(response.reply, new RegExp(renth.firstName, "i"));
  assert.match(response.reply, /\b(?:reeve|bailiff|watchman)\b/i);
  assert.match(response.reply, /\b(?:healer|herbalist|midwife|miller|tanner)\b/i);
  assert.doesNotMatch(response.reply, /^Several households became ill/i);
  assert.equal(response.conversationObligation.kind, "investigation_people");
  assert.deepEqual(
    response.conversationObligation.requiredAnswerSlots,
    ["investigator", "person_who_questions_related_person"]
  );
  assert.equal(response.promptTrace.responseSource, "gemma_dialogue");
});

test("compound investigator questions also preserve the temporary safe-water obligation", async () => {
  const { state, visit, person } = wellState("compound-investigator-obligation");
  const renth = state.residents.find((resident) => resident.id !== person.id && resident.occupation === "tanner");
  visit.issue.relatedPersonId = renth.id;
  const client = semanticClient();
  const response = await client.conversation(
    state,
    person,
    `Who will investigate and talk to ${renth.firstName}, and can your family avoid the well meanwhile?`
  );
  assert.match(response.reply, /carried water/i);
  assert.match(response.reply, /do not know|known to be clean|should not invent/i);
  assert.ok(response.conversationObligation.requiredAnswerSlots.includes("temporary_safe_water"));
});

test("multi-step contact instructions are acknowledged and schedule the promised return", async () => {
  const { state, visit, person } = wellState("instruction-obligation");
  const renth = state.residents.find((resident) => resident.id !== person.id && resident.occupation === "tanner");
  visit.issue.relatedPersonId = renth.id;
  const client = semanticClient();
  const response = await client.conversation(
    state,
    person,
    `Speak to ${renth.firstName}, then return tomorrow.`
  );
  assert.match(response.reply, new RegExp(renth.firstName, "i"));
  assert.match(response.reply, /return tomorrow/i);
  assert.equal(response.conversationObligation.kind, "instruction_acknowledgment");
  assert.equal(response.conversationObligation.followupRequested, true);
  recordExchange(state, `Speak to ${renth.firstName}, then return tomorrow.`, response);
  assert.ok(state.eventQueue.some((event) => (
    event.type === "resident_followup" && event.sourcePersonId === person.id
  )));
});


test("AI-planned continuity and prompt traces survive canonical mid-visit replay", async () => {
  const state = createGame("planner-mid-visit-replay");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const client = new ParishAiClient({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "I need time to consider that carefully, Father.",
            memory: "The visitor considered the priest's words."
          })
        }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  const response = await client.conversation(state, person, "I wonder what you make of all this.");
  recordExchange(state, "I wonder what you make of all this.", response);
  const restored = deserializeState(serializeState(state));
  assert.deepEqual(restored.currentVisit.continuity, state.currentVisit.continuity);
  assert.deepEqual(restored.currentVisit.promptTraces, state.currentVisit.promptTraces);
});


test("contaminated-well scenarios assign the runoff source to an actual tanner", () => {
  let found = 0;
  for (let index = 0; index < 500 && found < 5; index += 1) {
    const state = createGame(`well-source-role-${index}`);
    const visit = beginVisit(state);
    if (!String(visit.issue.scenarioId).includes("contaminated_well")) continue;
    const related = state.residents.find((resident) => resident.id === visit.issue.relatedPersonId);
    assert.equal(related?.occupation, "tanner");
    assert.ok(visit.scenarioFacts.some((fact) => fact.id === "affected_people"));
    found += 1;
  }
  assert.ok(found >= 3);
});

/* ---- Grounding under the natural-conversation architecture ----
   The framework no longer speaks for the visitor. What it must still
   guarantee is that authoritative knowledge REACHES the model, that the
   world's real people are offered, and that ungrounded inventions are
   repaired at sentence level rather than by discarding the reply. */

test("investigative scenarios carry a complete fact web for the model to draw on", () => {
  const state = createGame("investigative-fact-web");
  const visit = beginVisit(state);
  materializeResident(state, visit.personId, true);
  visit.issue.kind = "village concern";
  const facts = new Map(visit.scenarioFacts.map((fact) => [fact.id, fact]));
  for (const id of [
    "participants", "timeline", "place", "witnesses", "evidence",
    "authority", "capacity", "constraints", "unknowns", "counterclaim"
  ]) {
    assert.ok(facts.has(id), `missing ${id}`);
  }
});

test("circumstance and capacity questions supply the matching facts to the model", async () => {
  const state = createGame("investigative-fact-web");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  visit.issue.kind = "village concern";
  const supplied = [];
  const client = semanticClient((parsed) => {
    supplied.push(parsed.knowledge.join(" "));
    return {
      understoodPlayerAs: "The priest asks about the circumstances.",
      reply: "I will tell you what little I know for certain, Father.",
      npcIntent: "Answer the question.",
      proposedActions: []
    };
  });
  await client.conversation(state, person, "When and where did this happen, and who witnessed any part of it?");
  assert.ok(supplied[0].length > 0, "no authoritative knowledge was supplied for a circumstance question");
});

test("the real eligible expert is offered to the model rather than invented", async () => {
  const { state, person, visit } = wellState("real-water-expert");
  let parsed = null;
  const client = semanticClient((entry) => {
    parsed = entry;
    return {
      understoodPlayerAs: "The priest asks who could judge the well.",
      reply: "There is someone who might know, Father.",
      npcIntent: "Offer a name.",
      proposedActions: []
    };
  });
  await client.conversation(
    state,
    person,
    "Do you know someone with the expertise to determine whether the well is causing the illness?"
  );
  const offered = `${parsed.people.join("; ")} ${parsed.knowledge.join(" ")}`;
  assert.ok(offered.trim().length > 0, "no real people were offered to the model");
  assert.ok(
    state.residents.some((resident) => (
      resident.active && resident.id !== person.id && offered.includes(resident.firstName)
    )),
    "the offered people are not real residents"
  );
  assert.ok(visit.scenarioFacts.length > 0);
});

test("a weak model reply is kept rather than replaced by framework prose", async () => {
  const { state, person } = wellState("weak-reply-preserved");
  let calls = 0;
  const client = semanticClient(() => {
    calls += 1;
    return {
      understoodPlayerAs: "The priest offered me cheese.",
      reply: "No thank you, Father.",
      npcIntent: "Decline politely.",
      proposedActions: []
    };
  });
  const response = await client.conversation(state, person, "Would you like some cheese?");
  assert.equal(calls, 1);
  assert.equal(response.reply, "No thank you, Father.");
  assert.ok(!response.groundedFallback);
  assert.equal(response.promptTrace.responseSource, "gemma_dialogue");
});

test("unsupported village elders are repaired and traced through compaction", async () => {
  const { state, person } = wellState("unsupported-elder-grounding");
  const client = semanticClient({
    understoodPlayerAs: "The priest wants the steward to investigate.",
    reply: "Perhaps the village elder can influence the steward before anyone else acts.",
    npcIntent: "Suggest a route to the steward.",
    proposedActions: []
  });
  const priestText = "Have the steward investigate the workplace while we arrange safe water.";
  const response = await client.conversation(state, person, priestText);
  assert.doesNotMatch(response.reply, /village elder can influence/i);
  assert.match(response.reply, /\b(?:reeve|bailiff|no named reeve)\b/i);
  assert.ok(response.promptTrace.transformations.some((entry) => entry.type === "sentence_repaired"));
  recordExchange(state, priestText, response);
  finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
  compactReplayHistory(state);
  const restored = deserializeState(serializeState(state));
  assert.equal(restored.aiDiagnostics.lastCompletedVisit.promptTraces.length, 1);
  assert.equal(
    restored.aiDiagnostics.lastCompletedVisit.promptTraces[0].responseSource,
    response.promptTrace.responseSource
  );
});

test("an unanswered question stays open across turns", async () => {
  const { state, visit, person } = wellState("answer-repair-household");
  const question = "What can you sell, and can you work for the creditor?";
  const client = semanticClient({
    understoodPlayerAs: "The priest asks about my means.",
    reply: "I would rather not speak of that yet, Father.",
    npcIntent: "Deflect.",
    proposedActions: []
  });
  const first = await client.conversation(state, person, question);
  recordExchange(state, question, { ...first, source: "ai" });
  assert.ok(visit.continuity.unresolvedQuestions.some((entry) => entry.text === question));
  let parsed = null;
  const second = semanticClient((entry) => {
    parsed = entry;
    return {
      understoodPlayerAs: "The priest says I dodged the question.",
      reply: "You are right. We have the plough and little else, and I could work his fields.",
      npcIntent: "Answer properly this time.",
      proposedActions: []
    };
  });
  const repaired = await second.conversation(state, person, "That did not answer my question.");
  assert.match(parsed.prompt, /not answered|still unsettled|unsettled between you/i);
  assert.match(repaired.reply, /plough/);
  assert.ok(!repaired.groundedFallback);
});
