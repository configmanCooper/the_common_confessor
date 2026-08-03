import assert from "node:assert/strict";
import test from "node:test";
import { ParishAiClient, validateSermonResponse } from "../js/ai.js";
import {
  beginVisit,
  createGame,
  departureCandidates,
  materializeResident,
  recordExchange
} from "../js/simulation.js";
import { addKnowledge, createRumor } from "../js/population.js";
import { addStructuredMemory } from "../js/conversation.js";

const validResponse = {
  summary: "The congregation listens with mixed feeling.",
  townDeltas: {
    harmony: 1,
    faith: 2,
    prosperity: 0,
    health: 0,
    safety: -1,
    mercy: 2
  },
  responseTags: ["mercy"],
  notableEffects: [{
    personId: "person-001",
    faithDelta: 2,
    moraleDelta: 1,
    attendanceDelta: 1,
    memory: "Heard a sermon on mercy."
  }]
};

test("sermon responses require arrays and can target only attendees", () => {
  assert.equal(validateSermonResponse(validResponse, ["person-001"]).notableEffects.length, 1);
  assert.throws(
    () => validateSermonResponse({ ...validResponse, notableEffects: {} }, ["person-001"]),
    /invalid notable sermon effects/
  );
  assert.throws(
    () => validateSermonResponse(validResponse, ["person-002"]),
    /non-attendee/
  );
  assert.throws(
    () => validateSermonResponse({
      ...validResponse,
      notableEffects: [validResponse.notableEffects[0], validResponse.notableEffects[0]]
    }, ["person-001"]),
    /duplicate effects/
  );
  assert.throws(
    () => validateSermonResponse({ ...validResponse, responseTags: ["   "] }, ["person-001"]),
    /blank sermon response tags/
  );
});

test("AI departure responses reject oversized chains instead of truncating", async () => {
  const state = createGame("oversized-ai-client-seed");
  const visit = beginVisit(state);
  const steps = Array.from({ length: 4 }, (_, index) => ({
    depth: index + 1,
    actorId: visit.personId,
    targetId: null,
    actionType: "keep_silence",
    intensity: 1,
    title: "Silence",
    description: "Nothing is said."
  }));
  const client = new ParishAiClient({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ summary: "Too long.", steps }) } }]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  });

  test("AI conversation rejects unknown moods and cannot author mechanical deltas", async () => {
    const state = createGame("invalid-conversation-client-seed");
    const visit = beginVisit(state);
    const person = state.residents.find((resident) => resident.id === visit.personId);
    addStructuredMemory(state, person, {
      summary: visit.intent.hiddenConcern,
      privateMemory: true,
      emotion: "ashamed"
    });
    const client = new ParishAiClient({
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              reply: "A malformed answer.",
              mood: "ecstatic",
              trustDelta: 1.5,
              stressDelta: 0,
              memory: "Malformed."
            })
          }
        }]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    });

    test("AI conversation prompt hides the concern until deterministic disclosure", async () => {
      let state;
      let visit;
      for (let index = 0; index < 200; index += 1) {
        const candidate = createGame(`hidden-concern-prompt-seed-${index}`);
        const candidateVisit = beginVisit(candidate);
        if (candidateVisit.issue.kind === "confession" && !candidateVisit.hiddenConcernDisclosed) {
          state = candidate;
          visit = candidateVisit;
          break;
        }
      }
      assert.ok(state);
      const person = state.residents.find((resident) => resident.id === visit.personId);
      let prompt = "";
      const client = new ParishAiClient({
        fetchImpl: async (_url, options) => {
          const body = JSON.parse(options.body);
          prompt = body.messages[1].content;
          return new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ reply: "I am not ready.", memory: "The priest asked." }) } }]
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
      });
      await client.conversation(state, person, "What troubles you?");
      assert.doesNotMatch(prompt, new RegExp(visit.intent.hiddenConcern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
      visit.hiddenConcernDisclosed = true;
      await client.conversation(state, person, "Now speak plainly.");
      assert.match(prompt, new RegExp(visit.intent.hiddenConcern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    });

    test("AI departure context exposes only heard rumor beliefs, never objective truth", async () => {
      const state = createGame("rumor-prompt-privacy-seed");
      const visit = beginVisit(state);
      state.priest.bishopFavor = 13;
      state.households.find((household) => household.id === state.residents.find((person) => person.id === visit.personId).householdId).debt = 37;
      const heard = createRumor(state, {
        originatorId: visit.personId,
        subjectId: state.residents[1].id,
        claim: "The miller hides grain.",
        truth: 99,
        intensity: 3
      });

      test("Sunday sermon prompts never expose private memories", async () => {
        const state = createGame("sermon-private-memory-seed");
        state.calendar.absoluteDay = 6;
        state.calendar.dayIndex = 6;
        state.calendar.week = 1;
        const attendee = state.residents[0];
        materializeResident(state, attendee.id, true);
        addStructuredMemory(state, attendee, {
          summary: "PRIVATE_CHALICE_SECRET",
          privateMemory: true,
          emotion: "ashamed"
        });

        test("office disclosure remains private through Sunday sermon context", async () => {
          const state = createGame("office-disclosure-sermon-privacy");
          const visit = beginVisit(state);
          visit.location = "office";
          visit.intent.hiddenConcern = "PRIVATE_WORSENING_ILLNESS";
          visit.intent.disclosureThreshold = 0;
          recordExchange(state, "I hear you.", {
            reply: "I must admit it.",
            memory: "PRIVATE_WORSENING_ILLNESS"
          });
          const person = state.residents.find((resident) => resident.id === visit.personId);
          assert.ok(person.memories.some((memory) => memory.summary.includes("PRIVATE_WORSENING_ILLNESS") && memory.privateMemory));
          state.currentVisit = null;
          state.calendar.absoluteDay = 6;
          state.calendar.dayIndex = 6;
          state.calendar.week = 1;
          state.calendar.slot = 0;
          let prompt = "";
          const client = new ParishAiClient({
            fetchImpl: async (_url, options) => {
              prompt = JSON.parse(options.body).messages[1].content;
              return new Response(JSON.stringify({
                choices: [{
                  message: {
                    content: JSON.stringify({
                      summary: "The sermon is heard.",
                      townDeltas: { harmony: 0, faith: 1, prosperity: 0, health: 0, safety: 0, mercy: 1 },
                      responseTags: ["mercy"],
                      notableEffects: []
                    })
                  }
                }]
              }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
          });
          await client.sermon(state, "Mercy", "Let mercy guide us.", [person]);
          assert.doesNotMatch(prompt, /PRIVATE_WORSENING_ILLNESS/);
        });
        let prompt = "";
        const client = new ParishAiClient({
          fetchImpl: async (_url, options) => {
            prompt = JSON.parse(options.body).messages[1].content;
            return new Response(JSON.stringify({
              choices: [{
                message: {
                  content: JSON.stringify({
                    summary: "The sermon is heard.",
                    townDeltas: { harmony: 0, faith: 1, prosperity: 0, health: 0, safety: 0, mercy: 1 },
                    responseTags: ["mercy"],
                    notableEffects: []
                  })
                }
              }]
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
        });
        const attendees = state.residents.filter((person) => person.active).slice(0, 20);
        await client.sermon(state, "Mercy", "Let mercy guide us.", attendees);
        assert.doesNotMatch(prompt, /PRIVATE_CHALICE_SECRET/);
      });
      addKnowledge(state, {
        holderId: visit.personId,
        subjectId: heard.subjectId,
        topic: "rumor",
        belief: heard.claim,
        confidence: 61,
        isTrue: true
      });
      createRumor(state, {
        originatorId: state.residents[2].id,
        subjectId: visit.personId,
        claim: "UNHEARD_PRIVATE_RUMOR",
        truth: 3,
        intensity: 4
      });
      let prompt = "";
      const client = new ParishAiClient({
        fetchImpl: async (_url, options) => {
          const body = JSON.parse(options.body);
          prompt = body.messages[1].content;
          return new Response(JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  summary: "The visitor keeps quiet.",
                  steps: [{
                    depth: 1,
                    actorId: visit.personId,
                    targetId: null,
                    actionType: "keep_silence",
                    intensity: 1,
                    title: "Silence",
                    description: "The visitor says nothing."
                  }]
                })
              }
            }]
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
      });
      await client.departure(state, departureCandidates(state));
      assert.match(prompt, /The miller hides grain/);
      assert.match(prompt, /"personalConfidence":61/);
      assert.doesNotMatch(prompt, /"truth":99|UNHEARD_PRIVATE_RUMOR/);
      assert.doesNotMatch(prompt, /rumor-prompt-privacy-seed|"bishopFavor":13|"debt":37/);
    });
    const ignoredMechanicalFields = await client.conversation(state, person, "Speak plainly.");
    assert.equal(ignoredMechanicalFields.mood, undefined);
    assert.equal(ignoredMechanicalFields.trustDelta, undefined);

    const proseOnly = new ParishAiClient({
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              reply: "A valid prose answer.",
              mood: "resolved",
              trustDelta: 5,
              stressDelta: -5,
              memory: "The priest spoke."
            })
          }
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    });
    const response = await proseOnly.conversation(state, person, "Speak plainly.");
    assert.equal(response.trustDelta, undefined);
    assert.equal(response.stressDelta, undefined);
  });
  await assert.rejects(
    () => client.departure(state, departureCandidates(state)),
    (error) => {
      assert.match(error.message, /invalid departure chain length/);
      assert.equal(error.rejectedProposal.submittedStepCount, 4);
      assert.equal(error.rejectedProposal.steps.length, 4);
      return true;
    }
  );
});
