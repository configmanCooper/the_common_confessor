import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  createGame,
  materializeResident,
  recordExchange
} from "../js/simulation.js";
import { deserializeState, serializeState } from "../js/state.js";
import { naturalClient } from "./semantic-test-client.js";

/* Giving from the church stores must work from ordinary speech.
   The wording below is taken from a real save in which "Take these 4 silver
   pennies" deducted nothing, because the old parser only recognised phrases
   like "I will give" or "from the church". The model now reports the gift and
   the engine decides whether it is possible. */

function scene(seed) {
  const state = createGame(seed);
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  return { state, visit, person };
}

function givingClient(gift, reply = "Thank you, Father. It is a kindness.") {
  return naturalClient((parsed) => ({
    understoodPlayerAs: `The priest said: ${parsed.playerText}`,
    reply,
    npcIntent: "Accept what the priest is handing me.",
    priestGivesFromChurch: gift,
    proposedActions: []
  }));
}

test("the church stores are offered to the model so a gift can be recognised", async () => {
  const { state, person } = scene("gift-context");
  let parsed = null;
  const client = naturalClient((entry) => {
    parsed = entry;
    return {
      understoodPlayerAs: "u",
      reply: "Thank you, Father.",
      npcIntent: "n",
      priestGivesFromChurch: null,
      proposedActions: []
    };
  });
  await client.conversation(state, person, "Take these 4 silver pennies.");
  assert.match(parsed.prompt, /What the church has in store/);
  assert.match(parsed.prompt, /\[coin\]/);
  assert.match(parsed.prompt, /priestGivesFromChurch/);
});

test("'Take these 4 silver pennies' deducts coin and reaches the household", async () => {
  const { state, person } = scene("gift-pennies");
  const household = state.households.find((entry) => entry.id === person.householdId);
  const coinBefore = state.churchResources.coin;
  const wealthBefore = household.wealth;
  const client = givingClient({ resource: "coin", amount: 4 });
  const response = await client.conversation(state, person, "Take these 4 silver pennies. Find a way forward my child.");
  assert.deepEqual(response.churchGift, { resource: "coin", amount: 4 });
  recordExchange(state, "Take these 4 silver pennies. Find a way forward my child.", response);
  assert.equal(state.churchResources.coin, coinBefore - 4, "the church stores did not change");
  assert.ok(household.wealth > wealthBefore, "the household received nothing");
  assert.equal(response.churchAidApplied.amount, 4);
  assert.equal(response.churchAidApplied.remaining, coinBefore - 4);
  assert.ok(state.events.some((event) => event.type === "church_aid_given"));
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("varied phrasings all transfer without a phrase-specific rule", async () => {
  const phrasings = [
    ["Take these 4 silver pennies.", { resource: "coin", amount: 4 }],
    ["Here, two loaves for your children.", { resource: "bread", amount: 2 }],
    ["I want you to have some firewood, three bundles.", { resource: "firewood", amount: 3 }],
    ["The parish can spare a sack of grain for you.", { resource: "grain", amount: 1 }]
  ];
  for (const [index, [line, gift]] of phrasings.entries()) {
    const { state, person } = scene(`gift-phrasing-${index}`);
    const before = state.churchResources[gift.resource];
    const client = givingClient(gift);
    const response = await client.conversation(state, person, line);
    recordExchange(state, line, response);
    assert.equal(
      state.churchResources[gift.resource],
      before - gift.amount,
      `"${line}" did not transfer ${gift.resource}`
    );
  }
});

test("a gift larger than the stores is reduced to what the church actually holds", async () => {
  const { state, person } = scene("gift-too-large");
  state.churchResources.coin = 3;
  const client = givingClient({ resource: "coin", amount: 40 });
  const response = await client.conversation(state, person, "Take forty pennies from the box.");
  assert.equal(response.churchGift.amount, 3);
  assert.equal(response.churchGift.shortfall, 37);
  assert.ok(response.promptTrace.transformations.some((entry) => entry.type === "gift_reduced"));
  recordExchange(state, "Take forty pennies from the box.", response);
  assert.equal(state.churchResources.coin, 0);
});

test("an empty store yields no transfer and no phantom event", async () => {
  const { state, person } = scene("gift-empty-store");
  state.churchResources.medicine = 0;
  const client = givingClient({ resource: "medicine", amount: 2 });
  const response = await client.conversation(state, person, "Take some medicine for the child.");
  assert.equal(response.churchGift, null);
  recordExchange(state, "Take some medicine for the child.", response);
  assert.equal(state.churchResources.medicine, 0);
  assert.equal(response.churchAidApplied, undefined);
  assert.ok(!state.events.some((event) => event.type === "church_aid_given"));
});

test("an invented resource is rejected without disturbing the stores", async () => {
  const { state, person } = scene("gift-invented");
  const before = JSON.stringify(state.churchResources);
  const client = givingClient({ resource: "gold_crowns", amount: 5 });
  const response = await client.conversation(state, person, "Take five gold crowns.");
  assert.equal(response.churchGift, null);
  recordExchange(state, "Take five gold crowns.", response);
  assert.equal(JSON.stringify(state.churchResources), before);
});

test("merely discussing or promising aid transfers nothing", async () => {
  const { state, person } = scene("gift-not-given");
  const before = state.churchResources.coin;
  const client = givingClient(null, "That would help, Father, if the parish could spare it.");
  const response = await client.conversation(state, person, "Perhaps the church could help you with some coin one day.");
  assert.equal(response.churchGift, null);
  recordExchange(state, "Perhaps the church could help you with some coin one day.", response);
  assert.equal(state.churchResources.coin, before);
});

test("the older phrase parser still works when the model reports no gift", async () => {
  const { state, person } = scene("gift-legacy-parser");
  const before = state.churchResources.bread;
  const client = givingClient(null, "Thank you, Father.");
  const line = "The church will give you 2 loaves of bread.";
  const response = await client.conversation(state, person, line);
  recordExchange(state, line, response);
  assert.equal(state.churchResources.bread, before - 2);
});
