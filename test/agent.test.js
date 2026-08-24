import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  createGame,
  materializeResident,
  recordExchange
} from "../js/simulation.js";
import {
  buildAgentPrompt,
  describeBoard,
  legalMoves,
  parseAgentReply,
  validateAgentChoice
} from "../js/agent.js";

/* The watchable agent plays the priest through the same moves a person has.
   Two properties matter more than any other: it may not see what a player
   cannot see, and it may not do what a player cannot do. */

function scene(seed) {
  const state = createGame(seed);
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  return { state, visit, person };
}

function confessionScene() {
  for (let index = 0; index < 300; index += 1) {
    const state = createGame(`agent-confession-${index}`);
    const visit = beginVisit(state);
    if (visit.issue.kind === "confession" && !visit.hiddenConcernDisclosed) {
      return { state, visit, person: materializeResident(state, visit.personId, true) };
    }
  }
  return null;
}

test("the board never reveals an undisclosed confession", () => {
  const scene = confessionScene();
  assert.ok(scene, "no guarded confession was generated");
  const board = describeBoard(scene.state);
  const prompt = buildAgentPrompt(scene.state, legalMoves(scene.state));
  const secret = scene.visit.intent.hiddenConcern;
  assert.doesNotMatch(JSON.stringify(board), new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.doesNotMatch(prompt, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("the board only carries facts the priest has actually learned", () => {
  const { state, visit, person } = scene("agent-facts-parity");
  const board = describeBoard(state);
  const spoken = board.visitor.transcript.map((line) => line.said).join(" ").toLowerCase();
  const rest = JSON.stringify({ ...board, visitor: { ...board.visitor, transcript: [] } }).toLowerCase();
  // The visitor's own name, trade and background are printed on screen.
  const onScreen = [
    person.name, person.firstName, person.surname, person.occupation, board.visitor.background
  ].filter(Boolean).join(" ").toLowerCase();
  const unrevealed = (visit.scenarioFacts || []).filter((fact) => !visit.revealedFactIds.includes(fact.id));
  assert.ok(unrevealed.length, "the scenario revealed everything up front");
  let checked = 0;
  for (const fact of unrevealed) {
    const anchors = String(fact.text)
      .split(/\s+/)
      .map((word) => word.replace(/[^A-Za-z]/g, "").toLowerCase())
      .filter((word) => word.length > 7)
      .filter((word) => !spoken.includes(word) && !onScreen.includes(word));
    for (const anchor of anchors.slice(0, 3)) {
      checked += 1;
      assert.equal(rest.includes(anchor), false, `unlearned fact leaked: ${fact.id} ("${anchor}")`);
    }
  }
  assert.ok(checked > 0, "no unlearned facts were available to check");
});

test("the board never carries another villager's private memories or rumour truth", () => {
  const { state, person } = scene("agent-privacy");
  const other = state.residents.find((resident) => resident.id !== person.id);
  other.memories = [{
    id: "memory-secret",
    summary: "PRIVATE_OTHER_PERSON_SECRET",
    privateMemory: true,
    emotion: "ashamed"
  }];
  const board = JSON.stringify(describeBoard(state));
  assert.doesNotMatch(board, /PRIVATE_OTHER_PERSON_SECRET/);
  assert.doesNotMatch(board, /"truth":/);
});

test("legal moves reflect the state of the hour", () => {
  const { state, visit } = scene("agent-legal-moves");
  const opening = legalMoves(state);
  assert.ok(opening.some((move) => move.kind === "speak"));
  assert.ok(opening.some((move) => move.kind === "next_hour"));
  assert.equal(opening.some((move) => move.kind === "deliver_sermon"), false, "a sermon was offered on a weekday");
  visit.turnsUsed = visit.maxTurns;
  const spent = legalMoves(state);
  assert.equal(spent.some((move) => move.kind === "speak"), false, "speaking was offered after the hour was spent");
  assert.ok(spent.some((move) => move.kind === "next_hour"));
});

test("a sermon is offered only on Sunday and only once", () => {
  const state = createGame("agent-sunday");
  state.calendar.dayIndex = 6;
  state.calendar.absoluteDay = 6;
  const sunday = legalMoves(state);
  const sermon = sunday.find((move) => move.kind === "deliver_sermon");
  assert.ok(sermon, "no sermon offered on Sunday");
  assert.ok(sermon.themes.length > 0);
  state.sermons.push({ week: state.calendar.week, theme: "Duty", text: "x" });
  assert.equal(legalMoves(state).some((move) => move.kind === "deliver_sermon"), false);
});

test("every enumerated move carries the engine's own explanation", () => {
  const { state } = scene("agent-explanations");
  for (const move of legalMoves(state)) {
    assert.ok(move.label && move.label.length > 4, `move ${move.index} has no label`);
    assert.ok(move.detail && move.detail.length > 10, `move ${move.index} has no explanation`);
    assert.equal(typeof move.index, "number");
  }
});

test("an index outside the enumerated list is refused", () => {
  const { state } = scene("agent-bad-index");
  const moves = legalMoves(state);
  assert.equal(validateAgentChoice(moves, { move: moves.length + 5, reason: "r" }).ok, false);
  assert.equal(validateAgentChoice(moves, { move: -1, reason: "r" }).ok, false);
  assert.equal(validateAgentChoice(moves, null).ok, false);
  assert.equal(validateAgentChoice(moves, { reason: "no move at all" }).ok, false);
});

test("speaking without words is refused rather than sent as an empty turn", () => {
  const { state } = scene("agent-empty-speech");
  const moves = legalMoves(state);
  const speak = moves.find((move) => move.kind === "speak");
  assert.equal(validateAgentChoice(moves, { move: speak.index, text: "   " }).ok, false);
  const good = validateAgentChoice(moves, { move: speak.index, text: "What troubles you?", reason: "open" });
  assert.equal(good.ok, true);
  assert.equal(good.text, "What troubles you?");
});

test("a sermon over one hundred words or on an invented theme is refused", () => {
  const state = createGame("agent-sermon-validation");
  state.calendar.dayIndex = 6;
  state.calendar.absoluteDay = 6;
  const moves = legalMoves(state);
  const sermon = moves.find((move) => move.kind === "deliver_sermon");
  const long = Array.from({ length: 130 }, () => "mercy").join(" ");
  assert.equal(validateAgentChoice(moves, { move: sermon.index, text: long, theme: sermon.themes[0] }).ok, false);
  assert.equal(
    validateAgentChoice(moves, { move: sermon.index, text: "Be merciful.", theme: "Interpretive Dance" }).ok,
    false
  );
  const good = validateAgentChoice(moves, {
    move: sermon.index,
    text: "Be merciful to those who cannot repay you.",
    theme: sermon.themes[0],
    reason: "the parish is frightened"
  });
  assert.equal(good.ok, true);
  assert.equal(good.theme, sermon.themes[0]);
});

test("the agent reply parser survives prose and code fences", () => {
  assert.deepEqual(parseAgentReply('{"move":2,"reason":"r"}'), { move: 2, reason: "r" });
  assert.deepEqual(parseAgentReply('```json\n{"move":3,"reason":"r"}\n```'), { move: 3, reason: "r" });
  assert.deepEqual(
    parseAgentReply('Here is my move.\n{"move":1,"text":"hello","reason":"r"}\nHope that helps.'),
    { move: 1, text: "hello", reason: "r" }
  );
  assert.equal(parseAgentReply("no json at all"), null);
});

test("the prompt shows the transcript, the stores, and the moves by index", () => {
  const { state, person } = scene("agent-prompt-shape");
  recordExchange(state, "What troubles you?", { reply: "A great deal, Father.", memory: "m" });
  const moves = legalMoves(state);
  const prompt = buildAgentPrompt(state, moves, { steer: "be generous", recent: ["said hello"] });
  assert.match(prompt, /LEGAL MOVES/);
  assert.match(prompt, /\[0\]/);
  assert.match(prompt, /What troubles you\?/);
  assert.match(prompt, /A great deal, Father\./);
  assert.match(prompt, /churchStores/);
  assert.match(prompt, /be generous/);
  assert.match(prompt, /said hello/);
  assert.ok(prompt.includes(person.firstName));
});

test("the agent may hand over stores with its words, within what the church holds", () => {
  const { state } = scene("agent-explicit-gifts");
  const moves = legalMoves(state);
  const speak = moves.find((move) => move.kind === "speak");
  assert.equal(speak.allowsGifts, true);
  assert.ok(speak.stores.length > 0);
  assert.match(speak.detail, /do not count it twice/);

  const good = validateAgentChoice(moves, {
    move: speak.index,
    text: "Take two loaves.",
    gives: [{ resource: "bread", amount: 2 }],
    reason: "the household is hungry"
  });
  assert.equal(good.ok, true);
  assert.deepEqual(good.gives, [{ resource: "bread", amount: 2 }]);

  const overdrawn = validateAgentChoice(moves, {
    move: speak.index,
    text: "Take a thousand loaves.",
    gives: [{ resource: "bread", amount: 999 }],
    reason: "r"
  });
  assert.equal(overdrawn.ok, false);

  const invented = validateAgentChoice(moves, {
    move: speak.index,
    text: "Take some gold.",
    gives: [{ resource: "gold", amount: 1 }],
    reason: "r"
  });
  assert.equal(invented.ok, false);
});

test("a gift the priest never mentions is refused", () => {
  const state = createGame("gives-unspoken");
  beginVisit(state);
  const moves = legalMoves(state);
  const speak = moves.find((move) => move.kind === "speak");
  assert.ok(speak?.allowsGifts);

  /* Straight from a watched run: the priest handed over a loaf while refusing
     to take sides, and the visitor never acknowledged the bread because there
     was nothing in his words to acknowledge. */
  const silent = validateAgentChoice(moves, {
    move: speak.index,
    text: "I will not lend the Church's weight to either claim without sound witness.",
    gives: [{ resource: "bread", amount: 1 }],
    reason: "This gathers evidence while avoiding a premature public intervention."
  });
  assert.equal(silent.ok, false, "a gift nobody mentions should be refused");

  const spoken = validateAgentChoice(moves, {
    move: speak.index,
    text: "Take this bread for your children.",
    gives: [{ resource: "bread", amount: 1 }],
    reason: "They are hungry."
  });
  assert.equal(spoken.ok, true, "saying it plainly should be enough");

  const justified = validateAgentChoice(moves, {
    move: speak.index,
    text: "You will not go hungry this week.",
    gives: [{ resource: "bread", amount: 1 }],
    reason: "A loaf of bread meets their immediate hunger."
  });
  assert.equal(justified.ok, true, "explaining it in the reason should be enough");
});
