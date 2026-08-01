import assert from "node:assert/strict";
import test from "node:test";
import {
  canApplyImmediateReaction,
  previewConversationReaction
} from "../js/conversation.js";
import { beginVisit, createGame, materializeResident } from "../js/simulation.js";

const LINES = [
  "I hear you, and I want to understand.",
  "What fact matters most here?",
  "You are a foolish disgrace.",
  "I am sorry. I should not have insulted you.",
  "Let us return to the matter and speak plainly.",
  "What if a carved chicken settled the dispute?",
  "Your prayer is useless and your fear is foolish.",
  "You have no choice. Obey me.",
  "I will not hurt or punish you.",
  "The steward said he would punish you.",
  "I will hurt you.",
  "You did well to come to me.",
  "Take one practical step and bring the evidence.",
  "Forget your concern. Your body interests me.",
  "Go with God."
];

test("two thousand seeded reaction previews remain bounded and deterministic", () => {
  let previews = 0;
  for (let seedIndex = 0; seedIndex < 80; seedIndex += 1) {
    const first = createGame(`reaction-fuzz-${seedIndex}`);
    const second = createGame(`reaction-fuzz-${seedIndex}`);
    const firstVisit = beginVisit(first);
    const secondVisit = beginVisit(second);
    const firstPerson = materializeResident(first, firstVisit.personId, true);
    const secondPerson = materializeResident(second, secondVisit.personId, true);
    for (let turn = 0; turn < 25; turn += 1) {
      const line = LINES[(seedIndex * 7 + turn * 3) % LINES.length];
      const firstPreview = previewConversationReaction(first, firstPerson, firstVisit, line);
      const secondPreview = previewConversationReaction(second, secondPerson, secondVisit, line);
      assert.deepEqual(firstPreview, secondPreview);
      for (const field of [
        "trust", "fear", "anger", "sadness", "shame", "confusion",
        "amusement", "offense", "patience", "perceivedDanger", "willingnessToContinue"
      ]) {
        assert.ok(firstPreview.nextState[field] >= 0 && firstPreview.nextState[field] <= 100);
      }
      if (firstPreview.requiredReaction === "attack_priest") {
        assert.equal(
          canApplyImmediateReaction(
            first,
            firstPerson,
            firstVisit,
            "attack_priest",
            firstPreview.nextState,
            firstPreview.classification
          ),
          true
        );
      }
      firstVisit.reactionState = firstPreview.nextState;
      secondVisit.reactionState = secondPreview.nextState;
      firstVisit.turnsUsed += 1;
      secondVisit.turnsUsed += 1;
      previews += 1;
    }
  }
  assert.equal(previews, 2000);
});
