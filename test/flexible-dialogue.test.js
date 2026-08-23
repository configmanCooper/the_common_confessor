import assert from "node:assert/strict";
import test from "node:test";
import { ParishAiClient } from "../js/ai.js";
import { semanticClient } from "./semantic-test-client.js";
import { semanticResponse } from "./semantic-test-client.js";
import { analyzePlayerTurn } from "../js/dialogue_clauses.js";
import {
  beginVisit,
  createGame,
  fallbackConversation,
  fallbackDeparturePlan,
  finishVisit,
  materializeResident,
  recordExchange,
  validateDeparturePlan
} from "../js/simulation.js";
import { compactReplayHistory, deserializeState, serializeState } from "../js/state.js";

function modelClient(render) {
  return new ParishAiClient({
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      const prompt = payload.messages[1].content;
      const result = render(prompt);
      const completed = result.interpretation ? result : semanticResponse(prompt, result);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(completed) } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
}

test("compound crisis counsel becomes three prioritized actionable proposals", () => {
  const analysis = analyzePlayerTurn(
    "Tell someone you trust to verify the roads, and at the same time get people to prepare to leave quickly. Have some men prepare to defend if possible. But the main priority is to send quick scouts to the road.",
    2
  );
  assert.equal(analysis.isCompound, true);
  assert.deepEqual(
    analysis.proposals.map((proposal) => proposal.actionHint),
    ["verify_route", "prepare_evacuation", "organize_defense"]
  );
  assert.equal(analysis.proposals[0].priority, 100);
});

test("panic-rumor questions preserve uncertainty instead of inventing an army", async () => {
  let state;
  let visit;
  let person;
  for (let index = 0; index < 800; index += 1) {
    const candidate = createGame(`panic-rumor-grounding-${index}`);
    const candidateVisit = beginVisit(candidate);
    if (!String(candidateVisit.issue.scenarioId).includes("panic_rumor")) continue;
    state = candidate;
    visit = candidateVisit;
    person = materializeResident(state, visit.personId, true);
    break;
  }
  assert.ok(state);
  const client = semanticClient();
  const response = await client.conversation(
    state,
    person,
    "Are we currently at war with someone? What soldiers are supposedly coming, and from where?"
  );
  assert.match(response.reply, /no (?:declared )?war|not.*declared|not.*verified|no one.*seen an army|either danger is real/i);
  assert.match(response.reply, /no (?:reliable|trustworthy) witness|no one i trust|witness has identified|not.*identified|unknown|confirmed a pestilence/i);
  assert.doesNotMatch(response.reply, /king's forces|from the south|plague-carrying company/i);
  assert.doesNotMatch(response.reply, /the visitor|concrete facts|present evidence consists/i);
});

test("compound dialogue records partial acceptance, refusal, and deferral", async () => {
  const state = createGame("compound-dialogue-decisions");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  let calls = 0;
  const client = semanticClient((parsed) => {
    calls += 1;
    return {
      understoodPlayerAs: "The priest asks for scouting, preparation, and armed defence.",
      reply: "I will send scouts and ready my household, Father, but the reeve must decide whether armed men are gathered.",
      npcIntent: "Take what I can and leave armed defence to lawful authority.",
      proposedActions: [],
      decisions: parsed.proposals.map((proposal) => ({
        proposalId: proposal.proposalId,
        status: /defend|men/i.test(proposal.text) ? "deferred" : "accepted"
      }))
    };
  });
  const priest = "Send quick scouts to verify the road. At the same time prepare your household to leave. Have men prepare to defend, but scouting is the priority.";
  const response = await client.conversation(state, person, priest);
  assert.equal(calls, 1);
  assert.equal(response.decisions.length, 3);
  assert.match(response.reply, /the reeve must decide/);
  recordExchange(state, priest, response);
  assert.deepEqual(
    visit.continuity.visitorDecisions.map((decision) => decision.status).sort(),
    ["accepted", "accepted", "deferred"]
  );
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("decisions the model omits default to unknown without discarding its words", async () => {
  const state = createGame("compound-dialogue-fallback");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  let calls = 0;
  const client = semanticClient(() => {
    calls += 1;
    return {
      understoodPlayerAs: "The priest listed several things to do.",
      reply: "I will think about what you said, Father.",
      npcIntent: "Buy myself a moment.",
      proposedActions: [],
      decisions: []
    };
  });
  const response = await client.conversation(
    state,
    person,
    "Verify the road, prepare your household to leave, and organize men to defend the village."
  );
  assert.equal(calls, 1, "the model was called more than once for an ordinary turn");
  assert.equal(response.reply, "I will think about what you said, Father.");
  assert.ok(!response.groundedFallback, "the model's own words were discarded");
  assert.equal(response.decisions.length, 3);
  assert.ok(response.decisions.every((decision) => decision.status === "unknown"));
});

test("accepted compound proposals become parallel visitor action roots", () => {
  const state = createGame("parallel-action-roots");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  person.age = 30;
  person.ageDays = 30 * 365;
  person.health = 80;
  state.residents.find((resident) => resident.id !== person.id).occupation = "watchman";
  visit.continuity.proposals = [
    { proposalId: "p1", turn: 1, rawText: "Send scouts to verify the road", actionHint: "verify_route", priority: 100, status: "accepted" },
    { proposalId: "p2", turn: 1, rawText: "Prepare the household to leave", actionHint: "prepare_evacuation", priority: 80, status: "accepted" },
    { proposalId: "p3", turn: 1, rawText: "Prepare a limited defense", actionHint: "organize_defense", priority: 70, status: "accepted" }
  ];
  visit.continuity.visitorDecisions = visit.continuity.proposals.map((proposal) => ({
    proposalId: proposal.proposalId,
    turn: 1,
    status: "accepted",
    reason: "Accepted for testing."
  }));
  const plan = fallbackDeparturePlan(state);
  assert.equal(plan.steps.length, 3);
  assert.ok(plan.steps.every((step) => step.parentStepIndex === null && step.actorId === person.id));
  finishVisit(state, { ...plan, source: "fallback" });
  const actionEvents = state.events.filter((event) => (
    event.type === "person_action"
    && ["verify_route", "prepare_evacuation", "organize_defense"].includes(event.facts.actionType)
  ));
  assert.equal(actionEvents.length, 3);
  assert.equal(new Set(actionEvents.map((event) => event.parentId)).size, 1);
  assert.ok(person.flags.some((flag) => flag.startsWith("scouting_route_until_day_")));
  assert.ok(state.residents.some((resident) => resident.flags.some((flag) => flag.startsWith("evacuation_ready_until_day_"))));
  assert.ok(state.residents.some((resident) => resident.flags.some((flag) => flag.startsWith("defense_ready_until_day_"))));
  compactReplayHistory(state);
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("parallel graph shape replays from recorded finish commands", () => {
  let state;
  let visit;
  let person;
  for (let index = 0; index < 100; index += 1) {
    const candidate = createGame(`parallel-graph-replay-${index}`);
    const candidateVisit = beginVisit(candidate);
    const candidatePerson = materializeResident(candidate, candidateVisit.personId, true);
    if (candidatePerson.age >= 18 && candidatePerson.health >= 35) {
      state = candidate;
      visit = candidateVisit;
      person = candidatePerson;
      break;
    }
  }
  assert.ok(state);
  finishVisit(state, {
    source: "fallback",
    summary: "The visitor takes two parallel precautions.",
    steps: [
      {
        parentStepIndex: null,
        actorId: person.id,
        targetId: null,
        actionType: "verify_route",
        intensity: 2,
        title: "Scout the road",
        description: `${person.name} sends scouts to verify the road.`
      },
      {
        parentStepIndex: null,
        actorId: person.id,
        targetId: null,
        actionType: "prepare_evacuation",
        intensity: 2,
        title: "Prepare the household",
        description: `${person.name} prepares the household to leave if danger is confirmed.`
      }
    ]
  });

  test("accepted proposal roots replace an incomplete AI departure draft", () => {
    const state = createGame("accepted-roots-augment-ai");
    const visit = beginVisit(state);
    const person = materializeResident(state, visit.personId, true);
    person.age = 30;
    person.ageDays = 30 * 365;
    person.health = 80;
    person.occupation = "soldier";
    visit.continuity.proposals = [
      { proposalId: "p1", turn: 1, rawText: "Scout the road", actionHint: "verify_route", priority: 100, status: "accepted" },
      { proposalId: "p2", turn: 1, rawText: "Prepare to leave", actionHint: "prepare_evacuation", priority: 80, status: "accepted" },
      { proposalId: "p3", turn: 1, rawText: "Prepare a defense", actionHint: "organize_defense", priority: 70, status: "accepted" }
    ];
    visit.continuity.visitorDecisions = visit.continuity.proposals.map((proposal) => ({
      proposalId: proposal.proposalId,
      turn: 1,
      status: "accepted",
      reason: "Accepted."
    }));
    finishVisit(state, {
      source: "ai",
      summary: "The visitor scouts the road.",
      steps: [{
        actorId: person.id,
        targetId: null,
        actionType: "verify_route",
        intensity: 2,
        title: "Scout",
        description: "Scout the road."
      }]
    });
    const command = state.commandLog.at(-1);
    assert.deepEqual(
      command.payload.plan.steps.map((step) => step.actionType),
      ["verify_route", "prepare_evacuation", "organize_defense"]
    );
    assert.ok(command.payload.evaluation.normalizations.some((entry) => entry.reason === "accepted_proposal_roots"));
  });
  const restored = deserializeState(serializeState(state));
  const command = restored.commandLog.find((entry) => entry.type === "finish_visit");
  assert.deepEqual(command.payload.plan.steps.map((step) => step.parentStepIndex), [null, null]);
});

test("parallel roots use cumulative household affordability", () => {
  const state = createGame("parallel-resource-ledger");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const household = state.households.find((entry) => entry.id === person.householdId);
  household.wealth = 3;
  const plan = validateDeparturePlan(state, {
    summary: "Two parallel price subsidies.",
    steps: [
      {
        parentStepIndex: null,
        actorId: person.id,
        targetId: null,
        actionType: "lower_prices",
        intensity: 2,
        title: "Lower prices once",
        description: "Subsidize lower prices."
      },
      {
        parentStepIndex: null,
        actorId: person.id,
        targetId: null,
        actionType: "lower_prices",
        intensity: 2,
        title: "Lower prices twice",
        description: "Subsidize lower prices again."
      }
    ]
  });
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.rejection.gate, "affordability");
});

test("silence is a valid turn and receives a human response", () => {
  const state = createGame("deliberate-silence");
  const visit = beginVisit(state);
  const fallback = fallbackConversation(state, "[silence]");
  assert.match(fallback.reply, /silence|wait|nothing to say/i);
  recordExchange(state, "[silence]", fallback);
  assert.ok(visit.turnAudits[0].classification.categories.includes("silent"));
});

test("unrelated, absurd, emotional, and non-solution speech remains open dialogue", () => {
  const samples = [
    "I had porridge this morning.",
    "What if a chicken were elected reeve?",
    "I do not know what to tell you.",
    "That cloud looks like a boot.",
    "You have beautiful shoes.",
    "Perhaps nothing should be done.",
    "I am angry and I refuse to help.",
    "Bananas.",
    "Why would the moon care?",
    "..."
  ];
  for (const [index, sample] of samples.entries()) {
    const analysis = analyzePlayerTurn(sample, index + 1);
    assert.ok(Array.isArray(analysis.actKinds));
    assert.ok(analysis.proposals.length <= 6);
  }
});

test("supportive predictions after a group instruction are not parsed as extra commands", async () => {
  const state = createGame("group-mourning-instruction");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const text = "Speak to others who mourn Branias. Talk of him, memories, and how he affected you and your family. You will find that your burden gets lighter, and you lighten the burden of others.";
  const analysis = analyzePlayerTurn(text, 1);
  assert.equal(analysis.proposals.length, 1);
  const client = semanticClient();
  const response = await client.conversation(state, person, text);
  assert.match(response.reply, /speak with others who mourn Branias/i);
  assert.doesNotMatch(response.reply, /cannot promise yet|possible, lawful|within our actual means/i);
});

test("hundreds of speaking styles stay bounded and parse without throwing", () => {
  const openings = [
    "", "...", "Please", "I think", "Perhaps", "What if", "You must", "Tell them",
    "I refuse", "Honestly", "This is absurd", "God help us", "Ha!", "Listen"
  ];
  const subjects = [
    "scout the road", "prepare to leave", "defend the bridge", "do nothing",
    "pray together", "give away the grain", "speak to Renth", "dance in the nave",
    "hide the evidence", "ask a witness", "repair the mill", "ignore me"
  ];
  const connectors = ["", ".", " and then ", "; also ", ", but the main priority is to "];
  let count = 0;
  for (const opening of openings) {
    for (const subject of subjects) {
      for (const connector of connectors) {
        const text = `${opening} ${subject}${connector}${connector ? subjects[(count + 3) % subjects.length] : ""}`.trim();
        const analysis = analyzePlayerTurn(text, (count % 10) + 1);
        assert.ok(analysis.proposals.length <= 6);
        assert.ok(analysis.proposals.every((proposal) => proposal.rawText.length <= 180));
        count += 1;
      }
    }
  }
  assert.ok(count >= 800);
});
