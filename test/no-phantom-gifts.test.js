import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  createGame,
  finishVisit,
  materializeResident,
  recordExchange
} from "../js/simulation.js";
import { givingClausesIn, mentionsGiving, stripInventedNames } from "../js/ai.js";
import { namesChurchResource, parseChurchTransferIntent } from "../js/church.js";

/* Three faults a reviewer found in a watched run.
 *
 * The worst by far is the first: a priest who had refused alms in as many
 * words watched a dose of medicine leave his stores anyway. A player's stores
 * are scarce, and nothing may be spent by an act the player declined to make.
 */

/* ---- a refusal is not an offer ---- */

/* Verbatim from the run. The priest declines, and the engine gave medicine. */
const REFUSALS = [
  "Janora, your household is not yet without food, so I do not think I may give alms today, though I am sorry to refuse you.",
  "I cannot give you bread today.",
  "I will not give from the stores until you tell me the truth.",
  "I have nothing to give.",
  "The church stores are empty; I can spare none.",
  "I am unable to give you medicine.",
  "I refuse to give anything until the matter is settled."
];

const REAL_OFFERS = [
  "Take these 4 silver pennies.",
  "I will give you bread for your household.",
  "I shall send bread to your household.",
  "Take this bread home with you.",
  "Take these two loaves from the church stores.",
  "Tell me what you did at the mill, and take this bread home with you."
];

test("a refusal never opens the church stores", () => {
  for (const line of REFUSALS) {
    assert.equal(mentionsGiving(line), false, `a refusal was read as an offer: ${line}`);
    const intent = parseChurchTransferIntent(line);
    assert.notEqual(
      intent?.direction,
      "outgoing",
      `a refusal was parsed as a transfer out of the stores: ${line}`
    );
  }
});

test("a genuine offer still opens them", () => {
  for (const line of REAL_OFFERS) {
    assert.equal(mentionsGiving(line), true, `a real offer was refused: ${line}`);
  }
});

/* A question is an enquiry, and a condition is a discussion. Neither hands
   anything over. */
test("asking about giving, or offering conditionally, gives nothing", () => {
  for (const line of [
    "Shall I give you bread?",
    "Should I give from the stores?",
    "If you are truly in need, I can give you bread.",
    "Unless you tell me the truth, I will give nothing."
  ]) {
    assert.equal(mentionsGiving(line), false, `a question or condition gave something away: ${line}`);
  }
});

/* The negation has to attach to the giving. A bare "not" anywhere in the
   sentence is too blunt a test: this line is a gift, and its "not" is about
   obligation rather than refusal. */
test("a negation about something else does not veto a gift", () => {
  assert.equal(
    mentionsGiving("Take these two loaves from the church stores. They are given freely, not owed."),
    true,
    "a gift was blocked by a negation that had nothing to do with giving"
  );
});

/* ---- not knowing is said, not papered over ---- */

test("a stripped name leaves an admission of not knowing, never a placeholder", () => {
  const state = createGame("placeholder-names");
  for (const line of [
    "Renton's mother is Elara.",
    "At market, Elara told me the tale.",
    "I spoke with Elara about the herbs."
  ]) {
    const cleaned = stripInventedNames(state, line);
    /* "Renton's mother is someone" is not an answer and not a refusal; it
       reads as though the mother is called Someone. */
    assert.doesNotMatch(
      cleaned,
      /\bis someone\s*[.,]/i,
      `a placeholder was left standing as though it were a name: ${cleaned}`
    );
    if (/someone/.test(cleaned)) {
      assert.match(
        cleaned,
        /someone whose name I do not know/,
        `a bare placeholder survived: ${cleaned}`
      );
    }
  }
});

/* ---- a worry may turn out to be nothing ---- */

function confessionVisit(seed) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = createGame(`${seed}-${attempt}`);
    for (let index = 0; index < 4; index += 1) {
      const visit = beginVisit(state);
      if (!visit) break;
      materializeResident(state, visit.personId, true);
      if (visit.issue.kind === "confession") return { state, visit };
      finishVisit(state);
    }
  }
  return null;
}

/* A villager convinced that a harmless rhyme carried hidden danger kept
   hunting for a secret wrongdoing long after establishing that nobody had been
   in peril, because his encounter was seeded with "something I did may cause
   another person to suffer" and nothing was allowed to conclude otherwise. */
test("a premise the visitor abandons stops driving the visit", () => {
  const scene = confessionVisit("premise-dispelled");
  assert.ok(scene, "no confession was generated, so nothing was proved");
  const { state, visit } = scene;
  assert.equal(Boolean(visit.intent.premiseDispelled), false);
  recordExchange(state, "Was anyone actually harmed by it?", {
    reply: "Father, I was mistaken. There was no harm in it, and nobody was in danger.",
    memory: "m"
  });
  assert.equal(visit.intent.premiseDispelled, true, "the visitor admitted a mistake and kept the premise");
  for (const fact of visit.scenarioFacts || []) {
    if (["premise", "harm"].includes(fact.category)) {
      assert.equal(fact.speakable, false, `a dispelled premise is still offered as speakable: ${fact.text}`);
    }
  }
});

test("an ordinary answer does not dispel the premise", () => {
  const scene = confessionVisit("premise-control");
  assert.ok(scene);
  const { state, visit } = scene;
  recordExchange(state, "Tell me more.", {
    reply: "It happened near the mill, Father, after dusk had fallen.",
    memory: "m"
  });
  assert.equal(
    Boolean(visit.intent.premiseDispelled),
    false,
    "an ordinary answer threw away the matter the visitor came about"
  );
});

/* ---- every case the reviewer found, kept honest ---- */

/* "no" is the commonest way to refuse in English and was missed entirely, so
   the priest could say he had no medicine and watch a dose leave the stores. */
test("a refusal using the plain determiner 'no' gives nothing", () => {
  for (const line of [
    "I will give you no medicine.",
    "There is no bread I can give you.",
    "I have no bread to give you.",
    "I have no medicine to spare.",
    "We have no grain to give this week."
  ]) {
    assert.equal(mentionsGiving(line), false, `a refusal was read as an offer: ${line}`);
    assert.notEqual(parseChurchTransferIntent(line)?.direction, "outgoing", `stores opened by: ${line}`);
  }
});

/* The resource has to be named in the clause that offers it. Scanning the
   whole sentence let the longest alias win regardless of which clause it sat
   in, so this handed over the medicine and no bread. */
test("offering one thing while refusing another gives only the offered thing", () => {
  const intent = parseChurchTransferIntent("I shall give you bread, but not medicine.");
  assert.equal(intent?.direction, "outgoing");
  assert.equal(intent?.resource, "bread", "the refused resource was handed over instead");
});

test("a resource refused in one clause is not licensed by an offer in another", () => {
  const clauses = givingClausesIn("I cannot give you medicine, but I will give you bread.");
  assert.ok(clauses.length, "the genuine offer of bread was lost");
  assert.ok(
    clauses.some((clause) => namesChurchResource(clause, "bread")),
    "bread was offered and should be licensed"
  );
  assert.ok(
    !clauses.some((clause) => namesChurchResource(clause, "medicine")),
    "medicine was refused in as many words and must not be licensed"
  );
});

/* An enumeration is one act of giving. Cutting it at the "and" orphaned the
   firewood from the verb that handed it over. */
test("a list of things given in one breath licenses all of them", () => {
  const clauses = givingClausesIn("Take two sacks of grain, four loaves, and a bundle of firewood.");
  for (const resource of ["grain", "bread", "firewood"]) {
    assert.ok(
      clauses.some((clause) => namesChurchResource(clause, resource)),
      `${resource} was named in the same breath and should be licensed`
    );
  }
});

/* The old splitter consumed the question mark before testing for one, so its
   question guard could never fire. */
test("asking whether to give, in any phrasing, gives nothing", () => {
  for (const line of [
    "Would you have me give you bread from the church?",
    "Is it bread you would have me give you from the church?",
    "You have not eaten. Shall the church give you bread?"
  ]) {
    assert.equal(mentionsGiving(line), false, `a question opened the stores: ${line}`);
  }
});

/* A gift plainly worded must not be blocked by a condition mentioned later in
   the same sentence, or by a colon. */
test("a plainly worded gift is not blocked by nearby conditions", () => {
  for (const line of [
    "You shall not go hungry: I will give you bread from the church.",
    "Take this bread from the church, and if you need more, come again.",
    "I can give you bread from the church, and I might give more tomorrow.",
    "Tell me what you did at the mill, and take this bread home with you."
  ]) {
    assert.equal(mentionsGiving(line), true, `a genuine gift was blocked: ${line}`);
  }
});

/* Mistaking a confession for a retraction would silently erase a wrongdoing
   from the record, which is worse than the inertia the retraction fixes. */
test("an admitted deed is never mistaken for a withdrawn worry", () => {
  for (const line of [
    "I was wrong to take the flour, Father. I have carried it a fortnight.",
    "I was wrong. I struck him and he fell.",
    "I should not have come. I am too ashamed to say it aloud.",
    "I did it because I feared it would be found out.",
    "He swore to me there was no harm in it, but I saw the boy after.",
    "My wife says it was nothing, Father, but the child has not woken since.",
    "No harm was done to the mill, but I did take the grain."
  ]) {
    const scene = confessionVisit(`kept-${line.length}`);
    if (!scene) continue;
    recordExchange(scene.state, "Tell me plainly.", { reply: line, memory: "m" });
    assert.equal(
      Boolean(scene.visit.intent.premiseDispelled),
      false,
      `a real confession was discarded as a mistaken worry: ${line}`
    );
  }
});

test("a genuine withdrawal is still honoured", () => {
  for (const line of [
    "Father, I was mistaken. There was no harm in it, and nobody was in danger.",
    "I was wrong to fear it. No one was hurt.",
    "My fears were unfounded, Father."
  ]) {
    const scene = confessionVisit(`withdrawn-${line.length}`);
    if (!scene) continue;
    recordExchange(scene.state, "Was anyone harmed?", { reply: line, memory: "m" });
    assert.equal(
      scene.visit.intent.premiseDispelled,
      true,
      `a genuine withdrawal was not honoured: ${line}`
    );
  }
});

/* Nothing was actually disclosed by withdrawing a fear, and setting the
   disclosure flag would suppress the real disclosure path for the rest of the
   visit while recording no secret. */
test("withdrawing a worry does not count as disclosing a secret", () => {
  const scene = confessionVisit("no-false-disclosure");
  assert.ok(scene);
  scene.visit.hiddenConcernDisclosed = false;
  recordExchange(scene.state, "Was anyone harmed?", {
    reply: "Father, I was mistaken. There was no harm in it, and nobody was in danger.",
    memory: "m"
  });
  assert.equal(scene.visit.intent.premiseDispelled, true);
  assert.equal(
    scene.visit.hiddenConcernDisclosed,
    false,
    "withdrawing a fear was recorded as having disclosed a secret"
  );
});

/* ---- second review: narrowing the narrowings ---- */

/* A "no" that refuses nothing must not block a gift. Bound to an actual good,
   so "no questions asked" and "no matter what the reeve says" are left alone. */
test("a 'no' that is not about the goods does not block a gift", () => {
  for (const line of [
    "I will give you bread, no questions asked.",
    "I will give you grain, no matter what the reeve says.",
    "No matter what they say, I will give you grain from the church.",
    "I give you bread and no one need know of it.",
    "It is no trouble to give you bread from the church."
  ]) {
    assert.equal(mentionsGiving(line), true, `a genuine gift was blocked by a harmless 'no': ${line}`);
  }
});

/* A hedge concedes nothing, and correcting a detail is not withdrawing the
   matter. Either used to silence the whole confession from a subordinate
   clause, and nothing ever cleared it again. */
test("a hedge or a corrected detail does not withdraw the matter", () => {
  for (const line of [
    "Perhaps I am mistaken, Father, but I heard him at the mill that night.",
    "I was mistaken about the day, Father. It was Tuesday, not Monday.",
    "Maybe I am mistaken about the hour, but the grain was gone."
  ]) {
    const scene = confessionVisit(`hedge-${line.length}`);
    if (!scene) continue;
    recordExchange(scene.state, "Tell me plainly.", { reply: line, memory: "m" });
    assert.equal(
      Boolean(scene.visit.intent.premiseDispelled),
      false,
      `a hedge or detail correction discarded the whole matter: ${line}`
    );
  }
});

/* "I did nothing wrong" is a denial, and the most natural way of all to
   withdraw a worry. Reading it as an admission brought back the inertia. */
test("a denial beside a retraction still withdraws the worry", () => {
  for (const line of [
    "I was mistaken, Father. I did nothing wrong.",
    "I was wrong to fear it. I did not harm the child.",
    "I took fright over nothing, Father; I was mistaken."
  ]) {
    const scene = confessionVisit(`denial-${line.length}`);
    if (!scene) continue;
    recordExchange(scene.state, "Was anyone harmed?", { reply: line, memory: "m" });
    assert.equal(
      scene.visit.intent.premiseDispelled,
      true,
      `a denial was mistaken for an admission and the worry was kept alive: ${line}`
    );
  }
});
