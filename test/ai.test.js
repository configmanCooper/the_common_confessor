import assert from "node:assert/strict";
import test from "node:test";
import { validateSermonResponse } from "../js/ai.js";

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
});
