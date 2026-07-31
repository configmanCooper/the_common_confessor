import assert from "node:assert/strict";
import test from "node:test";
import { ParishAiClient, validateSermonResponse } from "../js/ai.js";
import { beginVisit, createGame, departureCandidates } from "../js/simulation.js";

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

  test("AI conversation rejects fractional deltas and unknown moods before mutation", async () => {
    const state = createGame("invalid-conversation-client-seed");
    const visit = beginVisit(state);
    const person = state.residents.find((resident) => resident.id === visit.personId);
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
    await assert.rejects(
      () => client.conversation(state, person, "Speak plainly."),
      /invalid mood|invalid emotional changes/
    );
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
