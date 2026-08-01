import assert from "node:assert/strict";
import test from "node:test";
import { ParishAiClient } from "../js/ai.js";
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

test("generated scenarios expose a compact investigative fact web", async () => {
  const state = createGame("investigative-fact-web");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  visit.issue.kind = "village concern";
  const facts = new Map(visit.scenarioFacts.map((fact) => [fact.id, fact]));
  for (const id of [
    "participants", "timeline", "place", "witnesses", "evidence",
    "authority", "capacity", "constraints", "unknowns", "counterclaim"
  ]) {
    assert.ok(facts.has(id), `missing ${id}`);
  }
  const client = repeatingClient("I cannot answer those details.");
  const circumstances = await client.conversation(
    state,
    person,
    "When and where did this happen, and who witnessed any part of it?"
  );
  assert.match(circumstances.reply, new RegExp(facts.get("timeline").text.split(" ").slice(0, 4).join("\\s+"), "i"));
  assert.match(circumstances.reply, new RegExp(facts.get("place").anchors.at(-1), "i"));
  assert.doesNotMatch(circumstances.reply, /cannot answer those details/i);

  const feasibility = await client.conversation(
    state,
    person,
    "Who has lawful authority, and what resources or work can you actually provide?"
  );
  assert.match(feasibility.reply, /\b(?:reeve|steward|magistrate|watch|priest)\b/i);
  assert.match(feasibility.reply, new RegExp(person.occupation, "i"));

  const skeptical = await Promise.all([
    client.conversation(state, person, "Why should I believe this account? What proves it?"),
    client.conversation(state, person, "What might you be mistaken about, and what do you still not know?"),
    client.conversation(state, person, "What would the accused person say in their own defense?"),
    client.conversation(state, person, "What observation, witness, or record could test the claim fairly?"),
    client.conversation(state, person, "Until that test is made, what temporary action prevents harm without pretending certainty?")
  ]);
  assert.match(skeptical[0].reply, /\b(?:evidence|witness|record|symptoms|injuries|account)\b/i);
  assert.match(skeptical[1].reply, /\bunknown\b/i);
  assert.match(skeptical[2].reply, /\b(?:deny|dispute|claim|defense|no specific accused)\b/i);
  assert.match(skeptical[3].reply, /\b(?:evidence|witness|record|symptoms|injuries|account)\b/i);
  assert.match(skeptical[4].reply, /\b(?:first|safety|consent|authority|plan|immediate)\b/i);
});

test("household assets, children, and work questions answer every requested part", async () => {
  const { state, visit, person } = wellState("household-capacity-answer");
  const child = state.residents.find((resident) => resident.householdId === person.householdId && resident.id !== person.id);
  if (child) {
    child.age = 12;
    if (!person.childrenIds.includes(child.id)) person.childrenIds.push(child.id);
  }
  const client = repeatingClient();
  const response = await client.conversation(
    state,
    person,
    "What do you have at home? Do you have children who can work for him? Can you work for him to pay the debt?"
  );
  assert.match(response.reply, /household has|ready coin|food stores/i);
  assert.match(response.reply, /child|no child/i);
  assert.match(response.reply, /work|labor/i);
  assert.doesNotMatch(response.reply, /^Renth dumped/i);
});

test("expert questions name a real eligible villager", async () => {
  const { state, person } = wellState("real-water-expert");
  const expert = state.residents
    .filter((resident) => ["healer", "herbalist", "midwife", "reeve", "miller", "tanner"].includes(resident.occupation))
    .sort((left, right) => {
      const rank = { healer: 0, herbalist: 1, midwife: 2, reeve: 3, miller: 4, tanner: 5 };
      return rank[left.occupation] - rank[right.occupation] || left.id.localeCompare(right.id);
    })[0];
  const client = repeatingClient();
  const response = await client.conversation(
    state,
    person,
    "Do you know someone with the expertise to determine whether the well is causing the illness?"
  );
  assert.ok(expert);
  assert.match(response.reply, new RegExp(expert.firstName, "i"));
  assert.match(response.reply, new RegExp(expert.occupation, "i"));
});

test("the visitor does not invent another clean well", async () => {
  const { state, person } = wellState("no-invented-second-well");
  const client = repeatingClient();
  const response = await client.conversation(
    state,
    person,
    "Tell people near the well to use another nearby well."
  );
  assert.match(response.reply, /do not know of another nearby well|no other/i);
  assert.doesNotMatch(response.reply, /I will send them to the other well/i);
});

test("saying that a reply failed repairs the unanswered household question", async () => {
  const { state, visit, person } = wellState("answer-repair-household");
  const client = repeatingClient();
  const question = "What can you sell, and can you work for the creditor?";
  const first = await client.conversation(state, person, question);
  recordExchange(state, question, { ...first, source: "ai" });
  const repaired = await client.conversation(state, person, "That did not answer my question.");
  assert.match(repaired.reply, /household|tools|work|labor/i);
  assert.doesNotMatch(repaired.reply, /^Renth dumped/i);
  assert.ok(visit.continuity.unresolvedQuestions.some((entry) => entry.text === question));
});

test("investigator questions fill investigator and interviewer slots instead of repeating the well premise", async () => {
  const { state, visit, person } = wellState("investigator-obligation");
  const renth = state.residents.find((resident) => resident.id !== person.id && resident.occupation === "tanner");
  assert.ok(renth);
  visit.issue.relatedPersonId = renth.id;
  visit.issue.relatedName = renth.name;
  const client = new ParishAiClient({
    fetchImpl: async () => {
      throw new Error("A direct investigator question should not call Gemma.");
    }
  });
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
  assert.equal(response.promptTrace.responseSource, "framework_static");
});

test("compound investigator questions also preserve the temporary safe-water obligation", async () => {
  const { state, visit, person } = wellState("compound-investigator-obligation");
  const renth = state.residents.find((resident) => resident.id !== person.id && resident.occupation === "tanner");
  visit.issue.relatedPersonId = renth.id;
  const client = new ParishAiClient({
    fetchImpl: async () => {
      throw new Error("A direct compound fact question should not call Gemma.");
    }
  });
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
  const client = new ParishAiClient({
    fetchImpl: async () => {
      throw new Error("A direct instruction acknowledgment should not call Gemma.");
    }
  });
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

test("unsupported village elders are replaced with named parish authority and traced through compaction", async () => {
  const { state, person } = wellState("unsupported-elder-grounding");
  let calls = 0;
  const client = new ParishAiClient({
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              reply: "Perhaps the village elder can influence the steward before anyone else acts.",
              memory: "The visitor suggested a village elder."
            })
          }
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  const priestText = "Have the steward investigate the workplace while we arrange safe water.";
  const response = await client.conversation(state, person, priestText);
  assert.ok(calls >= 1);
  assert.match(response.reply, /do not know of a separate village elder/i);
  assert.match(response.reply, /\b(?:reeve|bailiff)\b/i);
  assert.match(response.promptTrace.prompt, /RESPONSE_PLAN_JSON=/);
  assert.match(response.promptTrace.prompt, /CONVERSATIONAL PRIORITY:/);
  assert.match(response.promptTrace.prompt, /LATEST_PRIEST_STATEMENT=/);
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

test("a mandatory social answer gets one Gemma regeneration before deterministic fallback", async () => {
  const { state, person } = wellState("mandatory-answer-regeneration");
  let calls = 0;
  const client = new ParishAiClient({
    fetchImpl: async () => {
      calls += 1;
      const reply = calls === 1
        ? "Several households became ill after drawing from the common well."
        : "No thank you, Father. I should keep my thoughts on the well for now.";
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ reply, memory: "The visitor answered an offer." }) } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  const response = await client.conversation(state, person, "Would you like some cheese?");
  assert.equal(calls, 2);
  assert.match(response.reply, /no thank you|cheese/i);
  assert.equal(response.promptTrace.retryUsed, true);
  assert.equal(response.promptTrace.responseSource, "gemma_regeneration");
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
