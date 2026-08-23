import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  fallbackDeparturePlan,
  finishVisit,
  createGame,
  materializeResident,
  recordExchange
} from "../js/simulation.js";
import { compactReplayHistory, deserializeState, serializeState } from "../js/state.js";
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
    priestGivesFromChurch: gift ? [gift] : [],
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

test("a priest who names several things in one breath gives all of them", async () => {
  const { state, person } = scene("gift-multiple-items");
  const before = { ...state.churchResources };
  const client = naturalClient((parsed) => ({
    understoodPlayerAs: `The priest said: ${parsed.playerText}`,
    reply: "Bless you, Father. This will carry us through the week.",
    npcIntent: "Accept all of it gratefully.",
    proposedActions: [],
    priestGivesFromChurch: [
      { resource: "grain", amount: 2 },
      { resource: "bread", amount: 4 },
      { resource: "firewood", amount: 1 }
    ]
  }));
  const line = "Take two sacks of grain, four loaves, and a bundle of firewood.";
  const response = await client.conversation(state, person, line);
  assert.equal(response.churchGifts.length, 3);
  recordExchange(state, line, response);
  assert.equal(state.churchResources.grain, before.grain - 2);
  assert.equal(state.churchResources.bread, before.bread - 4);
  assert.equal(state.churchResources.firewood, before.firewood - 1);
  assert.equal(response.churchAidsApplied.length, 3);
  assert.equal(state.events.filter((event) => event.type === "church_aid_given").length, 3);
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("one impossible item does not prevent the possible ones", async () => {
  const { state, person } = scene("gift-partial-possible");
  state.churchResources.medicine = 0;
  const before = { ...state.churchResources };
  const client = naturalClient({
    understoodPlayerAs: "u",
    reply: "Thank you for what you can spare, Father.",
    npcIntent: "n",
    proposedActions: [],
    priestGivesFromChurch: [
      { resource: "medicine", amount: 2 },
      { resource: "bread", amount: 3 }
    ]
  });
  const line = "Take medicine and three loaves.";
  const response = await client.conversation(state, person, line);
  assert.equal(response.churchGifts.length, 1);
  assert.equal(response.churchGifts[0].resource, "bread");
  recordExchange(state, line, response);
  assert.equal(state.churchResources.bread, before.bread - 3);
  assert.equal(state.churchResources.medicine, 0);
});

test("nothing leaves the stores when the priest offered nothing", async () => {
  const { state, person } = scene("gift-no-offer");
  const before = { ...state.churchResources };
  const client = naturalClient({
    understoodPlayerAs: "The priest asks about the letters.",
    reply: "They were letters from a merchant, Father.",
    npcIntent: "Answer the question.",
    proposedActions: [],
    priestGivesFromChurch: [
      { resource: "firewood", amount: before.firewood },
      { resource: "beans", amount: before.beans }
    ]
  });
  const line = "Whose names did you read in those letters?";
  const response = await client.conversation(state, person, line);
  assert.equal(response.churchGifts.length, 0);
  assert.ok(response.promptTrace.transformations.some((entry) => (
    entry.code === "naturalConversation:noOfferMade"
  )));
  recordExchange(state, line, response);
  assert.equal(state.churchResources.firewood, before.firewood);
  assert.equal(state.churchResources.beans, before.beans);
});

test("a gift the priest really offered is recorded and survives compaction", async () => {
  const { state, person } = scene("gift-survives-compaction");
  const before = state.churchResources.medicine;
  const client = naturalClient({
    understoodPlayerAs: "The priest sends herbs for the child.",
    reply: "Bless you, Father. I will take them to her tonight.",
    npcIntent: "Accept the herbs.",
    proposedActions: [],
    priestGivesFromChurch: [{ resource: "medicine", amount: 2 }]
  });
  const line = "I shall send medicinal herbs from the church stores for the child.";
  const response = await client.conversation(state, person, line);
  recordExchange(state, line, response);
  assert.equal(state.churchResources.medicine, before - 2);
  finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
  compactReplayHistory(state);
  assert.equal(state.events.filter((event) => event.type === "church_aid_given").length, 1);
  assert.ok(person.memories.some((memory) => /gave my household/i.test(memory.summary)));
});

test("a villager can give to the church out of their own household", async () => {
  const { state, person } = scene("donation-natural-0");
  const household = state.households.find((entry) => entry.id === person.householdId);
  const beforeChurch = state.churchResources.coin;
  const beforeHousehold = household.wealth;
  const client = naturalClient({
    understoodPlayerAs: "The priest says the poor box is empty.",
    reply: "Then take two pennies for it, Father. We can spare that much.",
    npcIntent: "Give what little I can.",
    proposedActions: [],
    visitorGivesToChurch: [{ resource: "coin", amount: 2 }]
  });
  const line = "The parish poor box is empty.";
  const response = await client.conversation(state, person, line);
  assert.equal(response.visitorDonations.length, 1);
  recordExchange(state, line, response);
  assert.equal(state.churchResources.coin, beforeChurch + 2);
  assert.equal(household.wealth, beforeHousehold - 2);
  assert.equal(state.events.filter((event) => event.type === "church_donation_received").length, 1);
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("a villager cannot donate more than their household holds", async () => {
  const { state, person } = scene("donation-beyond-means");
  const household = state.households.find((entry) => entry.id === person.householdId);
  household.wealth = 1;
  const beforeChurch = state.churchResources.coin;
  const client = naturalClient({
    understoodPlayerAs: "u",
    reply: "I would give all I have, Father.",
    npcIntent: "n",
    proposedActions: [],
    visitorGivesToChurch: [{ resource: "coin", amount: 90 }]
  });
  const response = await client.conversation(state, person, "Give what you can to the poor box.");
  assert.ok(response.visitorDonations.every((gift) => gift.amount <= 1));
  assert.ok(response.promptTrace.transformations.some((entry) => entry.type === "donation_reduced"));
  recordExchange(state, "Give what you can to the poor box.", response);
  assert.ok(state.churchResources.coin <= beforeChurch + 1);
});



test("confirming aid already promised does not give it twice", async () => {
  const { state, person } = scene("gift-ledger-restatement");
  const before = state.churchResources.bread;
  const client = naturalClient({
    understoodPlayerAs: "The priest offers bread.",
    reply: "Thank you, Father. That will keep us.",
    npcIntent: "Accept.",
    proposedActions: [],
    priestGivesFromChurch: [{ resource: "bread", amount: 2 }]
  });
  const offer = "Take two loaves from the church stores.";
  recordExchange(state, offer, await client.conversation(state, person, offer));
  assert.equal(state.churchResources.bread, before - 2);
  const restated = "I shall have the two loaves brought to your door.";
  const second = await client.conversation(state, person, restated);
  assert.equal(second.churchGifts.length, 0);
  assert.ok(second.promptTrace.transformations.some((entry) => entry.type === "gift_already_made"));
  recordExchange(state, restated, second);
  assert.equal(state.churchResources.bread, before - 2, "the same promise was honoured twice");
  assert.deepEqual(state.currentVisit.giftLedger, { bread: 2 });
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("raising an earlier offer gives only the difference", async () => {
  const { state, person } = scene("gift-ledger-topup");
  const before = state.churchResources.bread;
  const two = naturalClient({
    understoodPlayerAs: "u", reply: "Thank you.", npcIntent: "n", proposedActions: [],
    priestGivesFromChurch: [{ resource: "bread", amount: 2 }]
  });
  const first = "Take two loaves.";
  recordExchange(state, first, await two.conversation(state, person, first));
  const four = naturalClient({
    understoodPlayerAs: "u", reply: "Bless you.", npcIntent: "n", proposedActions: [],
    priestGivesFromChurch: [{ resource: "bread", amount: 4 }]
  });
  const second = "Take four loaves in all, then.";
  const response = await four.conversation(state, person, second);
  assert.equal(response.churchGifts[0].amount, 2, "the top-up should be the difference only");
  recordExchange(state, second, response);
  assert.equal(state.churchResources.bread, before - 4);
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("ordinary speech containing a giving word opens nothing", async () => {
  const ordinary = [
    "I will go to her myself and see she is protected.",
    "Bring him to me tomorrow and we shall speak.",
    "Take care that you do not repeat this talk.",
    "You have my word this stays between us.",
    "Tell me who else shared your meals these three days."
  ];
  for (const [index, line] of ordinary.entries()) {
    const { state, person } = scene(`gift-ordinary-${index}`);
    const before = { ...state.churchResources };
    const client = naturalClient({
      understoodPlayerAs: "u", reply: "Yes, Father.", npcIntent: "n", proposedActions: [],
      priestGivesFromChurch: [{ resource: "bread", amount: 1 }]
    });
    const response = await client.conversation(state, person, line);
    recordExchange(state, line, response);
    assert.equal(state.churchResources.bread, before.bread, `"${line}" opened the stores`);
  }
});

test("a real offer still opens the stores however it is phrased", async () => {
  const offers = [
    "Take two loaves from the church stores.",
    "I shall send medicinal herbs for the child.",
    "Here are four silver pennies.",
    "The parish can spare a sack of grain."
  ];
  for (const [index, line] of offers.entries()) {
    const { state, person } = scene(`gift-real-offer-${index}`);
    const before = { ...state.churchResources };
    const client = naturalClient({
      understoodPlayerAs: "u", reply: "Thank you, Father.", npcIntent: "n", proposedActions: [],
      priestGivesFromChurch: [{ resource: "bread", amount: 1 }]
    });
    const response = await client.conversation(state, person, line);
    recordExchange(state, line, response);
    assert.equal(state.churchResources.bread, before.bread - 1, `"${line}" gave nothing`);
  }
});

test("the priest can hand something over without saying so", async () => {
  const { state, person } = scene("staged-only");
  const before = state.churchResources.bread;
  const client = naturalClient({
    understoodPlayerAs: "The priest hands me bread without a word about it.",
    reply: "Bless you, Father. I did not like to ask.",
    npcIntent: "Accept what is put into my hands.",
    proposedActions: [],
    priestGivesFromChurch: []
  });
  const line = "Go home and rest now.";
  const response = await client.conversation(state, person, line, {
    stagedGifts: [{ resource: "bread", amount: 2 }]
  });
  assert.equal(response.churchGifts.length, 1);
  recordExchange(state, line, response);
  assert.equal(state.churchResources.bread, before - 2);
});

test("handing something over and also saying so gives it once", async () => {
  const { state, person } = scene("staged-plus-speech");
  const before = state.churchResources.bread;
  const client = naturalClient({
    understoodPlayerAs: "The priest gives me two loaves.",
    reply: "Thank you, Father.",
    npcIntent: "Accept.",
    proposedActions: [],
    priestGivesFromChurch: [{ resource: "bread", amount: 2 }]
  });
  const line = "Take two loaves from the church stores.";
  const response = await client.conversation(state, person, line, {
    stagedGifts: [{ resource: "bread", amount: 2 }]
  });
  recordExchange(state, line, response);
  assert.equal(state.churchResources.bread, before - 2, "the same loaves were given twice");
});

test("what is handed over is described to the visitor so they can react", async () => {
  const { state, person } = scene("staged-described");
  let prompt = "";
  const client = naturalClient((entry, raw) => {
    prompt = raw;
    return {
      understoodPlayerAs: "u", reply: "Thank you, Father.", npcIntent: "n",
      proposedActions: [], priestGivesFromChurch: []
    };
  });
  await client.conversation(state, person, "Go home and rest.", {
    stagedGifts: [{ resource: "firewood", amount: 1 }]
  });
  assert.match(prompt, /HANDING YOU/);
  assert.match(prompt, /firewood/i);
  assert.match(prompt, /React to being handed it/);
});
