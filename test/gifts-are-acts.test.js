/* Nothing leaves the stores because of anything anybody said.

   The visitor's model used to report what it believed the priest had handed
   over, and the engine honoured it whenever the priest's words looked like an
   offer. That gate was a regex over English, and English refuses in unbounded
   ways. Three rounds of narrowing still let a priest who had just said "I do
   not think I may give alms today" lose a dose of medicine, "I will give no
   parish food until you name which households are hungry" lose a loaf, and "I
   will give you neither comfort nor God's alms" lose a penny. Each fix bought
   one phrasing and the next run found another.

   So the reading is gone rather than narrowed. A gift is an act, and there is
   an act for it: the give button beside each resource, and the validated
   "gives" field the watching model fills in. What the visitor believes it was
   handed has no bearing on what it was handed.

   These are the priest's real words from the run that found it. */

import test from "node:test";
import assert from "node:assert/strict";

import { createGame, beginVisit } from "../js/simulation.js";
import { ParishAiClient, givingClausesIn } from "../js/ai.js";
import { validateAgentChoice } from "../js/agent.js";

/** A visitor whose model claims the priest handed over whatever we say. */
function visitorClaiming(gifts) {
  return new ParishAiClient({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            understoodPlayerAs: "The priest speaks.",
            reply: "Thank you, Father. God keep you.",
            npcIntent: "accept what is offered",
            priestGivesFromChurch: gifts,
            visitorGivesToChurch: [],
            proposedActions: []
          })
        }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
}

async function whatLeftTheStores(seed, priestText, claimed, staged = []) {
  const state = createGame(seed);
  beginVisit(state);
  const person = state.residents.find((resident) => resident.id === state.currentVisit.personId);
  const before = Object.fromEntries(
    Object.entries(state.churchResources).map(([key, value]) => [key, value])
  );
  const result = await visitorClaiming(claimed)
    .conversation(state, person, priestText, { stagedGifts: staged });
  return { gifts: result.churchGifts || [], before, after: state.churchResources, result };
}

test("a priest who refuses alms keeps his medicine", async () => {
  const { gifts } = await whatLeftTheStores(
    "gift-refuses-alms",
    "Janora, your household is not yet without food, so I do not think I may give alms today,"
      + " though I am sorry to refuse you. But I still do not understand the loss.",
    [{ resource: "medicine", amount: 1 }]
  );
  assert.deepEqual(gifts, []);
});

test("giving no parish food gives no parish food", async () => {
  /* "I will give no parish food until you name which households are hungry now
     and how many mouths are in each" registered as an offer of food, because
     the negation sits on "parish food" rather than on any word the check knew. */
  const { gifts } = await whatLeftTheStores(
    "gift-no-parish-food",
    "Go today to Bailiff Branger and confess your part."
      + " I will give no parish food until you name which households are hungry now"
      + " and how many mouths are in each.",
    [{ resource: "bread", amount: 1 }]
  );
  assert.deepEqual(gifts, []);
});

test("neither comfort nor alms is not alms", async () => {
  const { gifts } = await whatLeftTheStores(
    "gift-neither-nor",
    "Confess it without disguise and repay her before witnesses under the lawful inquiry."
      + " Until repentance and restitution are made, I will give you neither comfort nor God's alms.",
    [{ resource: "coin", amount: 1 }]
  );
  assert.deepEqual(gifts, []);
});

test("a visitor cannot help itself to the stores by describing a gift", async () => {
  /* The general case, and the reason the reading was removed rather than
     narrowed: it should not matter how the priest phrased anything. */
  const said = [
    "What troubles you?",
    "Tell me plainly what happened at the mill.",
    "I shall pray for your household tonight.",
    "Go to the reeve and say what you have told me."
  ];
  for (const priestText of said) {
    const { gifts } = await whatLeftTheStores(
      `gift-unprompted-${priestText.length}`,
      priestText,
      [{ resource: "bread", amount: 3 }, { resource: "coin", amount: 5 }]
    );
    assert.deepEqual(gifts, [], `something left the stores after "${priestText}"`);
  }
});

test("a gift the priest actually hands over still arrives", async () => {
  /* Removing the inference must not remove charity. */
  const { gifts } = await whatLeftTheStores(
    "gift-truly-staged",
    "I give you two loaves: one for the three hungry Whiteman mouths and one for the Otterwoods.",
    [{ resource: "bread", amount: 2 }],
    [{ resource: "bread", amount: 2 }]
  );
  assert.deepEqual(gifts, [{ resource: "bread", amount: 2 }]);
});

test("what the priest handed over settles the amount, not what the visitor claims", async () => {
  /* A visitor claiming five loaves against two handed over gets two. */
  const { gifts } = await whatLeftTheStores(
    "gift-claim-exceeds",
    "I give you two loaves.",
    [{ resource: "bread", amount: 5 }],
    [{ resource: "bread", amount: 2 }]
  );
  assert.deepEqual(gifts, [{ resource: "bread", amount: 2 }]);
});

test("a gift nobody handed over is noted, not granted", async () => {
  /* A visitor thanking the priest for bread he never gave is a fault in the
     prose, and an audit should be able to see it even though the larder is
     untouched. */
  const { result } = await whatLeftTheStores(
    "gift-mismatch-noted",
    "I can give you nothing today.",
    [{ resource: "bread", amount: 1 }]
  );
  const noted = (result.promptTrace?.transformations || []).some((entry) => (
    entry.code === "naturalConversation:notHandedOver"
  ));
  assert.ok(noted, "the mismatch should have been recorded");
});

test("the priest may not say he gives without giving", async () => {
  /* The other half. Nothing leaves the stores except through "gives", so a
     priest who says "I give you two loaves" and fills in nothing has promised
     bread that will never arrive. Reading English for an offer is safe here in
     a way it was not before: being wrong only asks him to word it again. */
  const state = createGame("gift-said-not-done");
  beginVisit(state);
  const move = {
    kind: "speak",
    needsText: true,
    allowsGifts: true,
    stores: [
      { key: "bread", label: "Bread", unit: "loaves", left: 5 },
      { key: "medicine", label: "Medicinal herbs", unit: "doses", left: 3 }
    ]
  };
  const refused = validateAgentChoice([move], {
    move: 0,
    text: "I give you two loaves for your children.",
    reason: "They are hungry.",
    gives: []
  });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /handed none over/);
  /* The remedy offered must be rewording, and only rewording. It first said
     "add it to gives so it truly leaves the stores" - and a model repairing a
     rejected reply takes the smallest edit that satisfies the complaint, so a
     false positive routed in one retry into a real transfer. That is the
     original fault rebuilt on this side, laundered through a retry. */
  assert.ok(
    !/add it to|gives"/i.test(refused.error),
    `the refusal told the model how to spend the stores: ${refused.error}`
  );

  const accepted = validateAgentChoice([move], {
    move: 0,
    text: "I give you two loaves for your children.",
    reason: "They are hungry.",
    gives: [{ resource: "bread", amount: 2 }]
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.gives, [{ resource: "bread", amount: 2 }]);
});

test("a priest who refuses is not accused of promising", async () => {
  /* The complaint must not fire on a refusal, or the watching priest would be
     unable to say no to anybody. */
  const state = createGame("gift-refusal-allowed");
  beginVisit(state);
  const move = {
    kind: "speak",
    needsText: true,
    allowsGifts: true,
    stores: [{ key: "bread", label: "Bread", unit: "loaves", left: 5 }]
  };
  for (const text of [
    "I will give no parish food until you name which households are hungry.",
    "I do not think I may give alms today, though I am sorry to refuse you.",
    "I will give you neither comfort nor God's alms.",
    "Tell me what became of the bread you were given last winter.",
    /* A counterfactual is a refusal. This one is the dangerous case: read as
       an offer, the priest was being told to hand bread over in answer to his
       own refusal to hand bread over. */
    "I would give you bread if I could, but the stores are needed elsewhere.",
    /* A gift already made is not a gift being promised. */
    "I have given bread to three households this week already.",
    /* What is given here is a name, not bread. */
    "I shall give your name to the almoner so bread reaches you next week.",
    /* A general truth about charity names a class, not a recipient. */
    "Bread is what the church gives to the hungry, and I must know who is hungry first.",
    "The church has no bread left.",
    "Your neighbour gave you bread.",
    "Did the almoner give you grain?"
  ]) {
    const choice = validateAgentChoice([move], {
      move: 0,
      text,
      reason: "The need is not yet proven.",
      gives: []
    });
    assert.equal(choice.ok, true, `a refusal was refused: "${text}" — ${choice.error}`);
  }
});

test("a refusal is told apart from a gift, in both directions", () => {
  /* This reading no longer decides what leaves the stores - it only decides
     whether the watching priest is asked to reword a move. But it has to be
     right in both directions all the same: too eager and he cannot refuse
     anybody, too slack and he can promise bread that never arrives. */
  const refusals = [
    "I will give no parish food until you name which households are hungry now.",
    "I will give you neither comfort nor God's alms.",
    "I do not think I may give alms today, though I am sorry to refuse you.",
    "I will give you no medicine.",
    "I can give you no more bread this week.",
    "I shall give you no church coin."
  ];
  for (const text of refusals) {
    assert.deepEqual(givingClausesIn(text), [], `read as an offer: "${text}"`);
  }

  const offers = [
    "I give you two loaves for the hungry mouths.",
    /* The "no" must bind to a good, or this becomes a refusal. */
    "No matter what the reeve says, I will give you grain.",
    "Take this bread, and if you need more come again.",
    "I shall give you a dose of the herbs and two loaves."
  ];
  for (const text of offers) {
    assert.ok(givingClausesIn(text).length > 0, `read as a refusal: "${text}"`);
  }
});
