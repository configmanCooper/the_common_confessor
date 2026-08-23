import assert from "node:assert/strict";
import test from "node:test";
import { ParishAiClient } from "../js/ai.js";
import { semanticClient } from "./semantic-test-client.js";
import {
  beginVisit,
  createGame,
  fallbackConversation,
  fallbackDeparturePlan,
  finishVisit,
  materializeResident,
  recordExchange,
  rewindLastConversationTurn,
  setGameMode
} from "../js/simulation.js";
import { deserializeState, serializeState } from "../js/state.js";

test("meta pause and resume are zero-time replayable commands", () => {
  const state = createGame("meta-mode-replay");
  beginVisit(state);
  const day = state.calendar.absoluteDay;
  const slot = state.calendar.slot;
  for (let index = 0; index < 5; index += 1) {
    setGameMode(state, "META_PAUSED");
    assert.equal(state.mode.type, "META_PAUSED");
    setGameMode(state, "IN_WORLD");
  }
  assert.equal(state.calendar.absoluteDay, day);
  assert.equal(state.calendar.slot, slot);
  assert.equal(state.currentVisit.turnsUsed, 0);
  const restored = deserializeState(serializeState(state));
  assert.equal(restored.mode.type, "IN_WORLD");
  assert.equal(restored.calendar.absoluteDay, day);
});

test("rewind removes the latest uncompacted exchange and preserves an audit record", () => {
  let state = createGame("rewind-current-visit");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  recordExchange(state, "Tell me more.", fallbackConversation(state, "Tell me more."));
  const trustAfterFirst = person.trustPriest;
  recordExchange(state, "You are wasting my time.", fallbackConversation(state, "You are wasting my time."));
  assert.equal(state.currentVisit.turnsUsed, 2);
  state = rewindLastConversationTurn(state, "I did not mean to submit that");
  const restoredPerson = state.residents.find((resident) => resident.id === person.id);
  assert.equal(state.currentVisit.turnsUsed, 1);
  assert.equal(state.currentVisit.history.length, 3);
  assert.equal(restoredPerson.trustPriest, trustAfterFirst);
  assert.equal(state.statistics.conversations, 1);
  assert.equal(state.supersededTurns.length, 1);
  assert.equal(state.commandLog.at(-1).type, "rewind_turn");
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("rewind is intentionally unavailable after visit compaction boundaries", () => {
  const state = createGame("rewind-boundary");
  beginVisit(state);
  recordExchange(state, "Tell me more.", fallbackConversation(state, "Tell me more."));
  finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
  assert.throws(() => rewindLastConversationTurn(state), /active appointment/);
});

test("factual interruptions preserve the pending player decision", async () => {
  let state;
  let visit;
  for (let index = 0; index < 100; index += 1) {
    const candidate = createGame(`obligation-interruption-${index}`);
    const candidateVisit = beginVisit(candidate);
    if (candidateVisit.issue.kind !== "confession") {
      state = candidate;
      visit = candidateVisit;
      break;
    }
  }
  assert.ok(state);
  const person = materializeResident(state, visit.personId, true);
  const initialDecision = visit.continuity.obligationStack[0];
  assert.equal(initialDecision.kind, "player_decision");
  assert.equal(initialDecision.status, "open");
  let parsed = null;
  const client = semanticClient((entry) => {
    parsed = entry;
    return {
      understoodPlayerAs: "The priest asks when this happened.",
      reply: "It was the night before last, Father.",
      npcIntent: "Answer the question of timing.",
      proposedActions: []
    };
  });
  const response = await client.conversation(state, person, "When did this happen?");
  recordExchange(state, "When did this happen?", response);
  assert.equal(initialDecision.status, "open");
  assert.ok(visit.continuity.obligationStack.some((obligation) => (
    obligation.kind === "answer_player_question" && obligation.status === "resolved"
  )));
  assert.match(parsed.prompt, /still waiting on the priest's counsel about/i);
  assert.equal(response.reply, "It was the night before last, Father.");
});
