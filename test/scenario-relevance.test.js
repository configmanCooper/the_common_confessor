import assert from "node:assert/strict";
import test from "node:test";
import { ParishAiClient } from "../js/ai.js";
import { buildGeneratedScenarioArchetypes } from "../js/scenario_catalog.js";
import { beginVisit, createGame, materializeResident, recordExchange } from "../js/simulation.js";

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
