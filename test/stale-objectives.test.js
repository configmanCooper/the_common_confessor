import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  createGame,
  finishVisit,
  materializeResident,
  recordExchange,
  replayGame
} from "../js/simulation.js";
import { deserializeState, serializeState } from "../js/state.js";

/* An objective must not outlive the facts that supported it.
 *
 * A reeve came to the church guarding the name of a thief. Questioned, he
 * established that he had no idea who the thief was - and then went on saying
 * "I have no knowledge of who took it. I fear to speak of the thief" for the
 * rest of the visit, and again the turn after that. The fear was part of his
 * opening intent and nothing ever retired it, so the conversation read as
 * madness rather than reticence.
 */

function visitWithAWithheldName(seed) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const state = createGame(`${seed}-${attempt}`);
    for (let index = 0; index < 4; index += 1) {
      const visit = beginVisit(state);
      if (!visit) break;
      const person = materializeResident(state, visit.personId, true);
      const withheld = (visit.scenarioFacts || []).find((fact) => (
        /\bknows\s+who\s+actually\b/i.test(String(fact.text))
      ));
      if (withheld) return { state, visit, person, withheld };
      finishVisit(state);
    }
  }
  return null;
}

test("a secret the visitor disclaims is retired rather than kept alive", () => {
  const scene = visitWithAWithheldName("retire-secret");
  assert.ok(scene, "no scenario in sixty parishes withheld a name, so nothing was proved");
  const { state, visit, withheld } = scene;
  assert.equal(Boolean(visit.intent.retiredConcern), false, "the secret was retired before anything was said");
  recordExchange(state, "Name the thief plainly.", {
    reply: "Father, I have no knowledge of who took it.",
    memory: "m"
  });
  assert.ok(visit.intent.retiredConcern, "the visitor disclaimed the knowledge and kept the secret anyway");
  assert.match(visit.intent.retiredConcern, /knows who actually/i);
  assert.equal(withheld.retired, true, "the fact asserting they knew was left standing");
  assert.equal(withheld.speakable, false, "a retired fact is still offered as speakable");
});

test("ordinary speech retires nothing", () => {
  const scene = visitWithAWithheldName("retire-control");
  assert.ok(scene);
  const { state, visit } = scene;
  recordExchange(state, "Tell me what happened.", {
    reply: "It was near dusk, Father, after the alehouse had closed.",
    memory: "m"
  });
  assert.equal(
    Boolean(visit.intent.retiredConcern),
    false,
    "an ordinary answer retired the visitor's secret"
  );
});

/* The framework's own uncertainty facts read very like a withheld secret - "I
   still do not know whether every accused person will admit the claim" - and
   retiring one would quote gibberish back to the visitor as their settled
   position. */
test("the framework's uncertainty facts are not mistaken for a secret", () => {
  const scene = visitWithAWithheldName("retire-uncertainty");
  assert.ok(scene);
  const { state, visit } = scene;
  recordExchange(state, "Name the thief plainly.", {
    reply: "Father, I have no knowledge of who took it.",
    memory: "m"
  });
  for (const fact of visit.scenarioFacts || []) {
    if (!fact.retired) continue;
    assert.doesNotMatch(
      String(fact.text),
      /I still do not know whether/i,
      `an uncertainty fact was retired as though it were a secret: ${fact.text}`
    );
  }
});

test("a retired secret survives saving and replay", () => {
  const scene = visitWithAWithheldName("retire-replay");
  assert.ok(scene);
  const { state, visit } = scene;
  recordExchange(state, "Name the thief plainly.", {
    reply: "Father, I have no knowledge of who took it.",
    memory: "m"
  });
  assert.ok(visit.intent.retiredConcern);
  const restored = deserializeState(serializeState(state));
  assert.ok(restored.currentVisit?.intent?.retiredConcern, "the retirement was lost on reload");
  const replayed = replayGame(state.seed, state.commandLog, state.replayBase);
  assert.ok(replayed.currentVisit?.intent?.retiredConcern, "the retirement did not replay");
});
