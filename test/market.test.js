import test from "node:test";
import assert from "node:assert/strict";
import { createGame, marketOffer, buyAtMarket, applySermon, fallbackSermonOutcome } from "../js/simulation.js";
import { serializeState, deserializeState } from "../js/state.js";
import {
  calculateMarket,
  producerEffectiveness,
  TRADE_GOODS,
  PURCHASABLE_GOODS
} from "../js/market.js";

function producersOf(state, good) {
  return state.residents.filter((person) => (
    person.active && person.alive && TRADE_GOODS[good].producers.includes(person.occupation)
  ));
}

test("every good is made by someone or from something", () => {
  for (const [key, good] of Object.entries(TRADE_GOODS)) {
    assert.ok(good.producers.length > 0, `${key} has no trade that makes it`);
    for (const input of Object.keys(good.inputs)) {
      assert.ok(TRADE_GOODS[input], `${key} is made from "${input}", which is not a good`);
      assert.notEqual(input, key, `${key} cannot be made from itself`);
    }
  }
});

test("the production chain has no circular dependency", () => {
  const seen = new Map();
  const walk = (key, trail) => {
    if (trail.includes(key)) assert.fail(`circular chain: ${[...trail, key].join(" -> ")}`);
    if (seen.get(key)) return;
    for (const input of Object.keys(TRADE_GOODS[key].inputs)) walk(input, [...trail, key]);
    seen.set(key, true);
  };
  for (const key of Object.keys(TRADE_GOODS)) walk(key, []);
});

test("a healthy parish feeds itself", () => {
  const state = createGame("market-healthy");
  const market = calculateMarket(state);
  const staples = ["grain", "firewood"];
  for (const key of staples) {
    const good = market.goods[key];
    assert.ok(good.produced > good.need * 0.6, `${key}: made ${good.produced.toFixed(0)} against a need of ${good.need.toFixed(0)}`);
  }
  assert.ok(PURCHASABLE_GOODS.some((key) => market.goods[key].stock > 0), "nothing at all was for sale");
});

test("a sick producer makes less, and what they make costs more", () => {
  const state = createGame("market-sick");
  const before = calculateMarket(state);
  const bakers = producersOf(state, "bread");
  assert.ok(bakers.length > 0, "this parish has no baker to fall ill");

  for (const baker of bakers) {
    baker.illness = "lung sickness";
    baker.illnessDays = 10;
    baker.health = 22;
  }
  const after = calculateMarket(state);

  assert.ok(after.goods.bread.produced < before.goods.bread.produced,
    "bread should fall when every baker is abed");
  assert.ok(after.goods.bread.price >= before.goods.bread.price,
    "bread should not get cheaper when there is less of it");
  assert.ok(after.goods.bread.workerNotes.length > 0,
    "the board should say who is missing");
  assert.ok(after.goods.bread.workerNotes.some((note) => note.includes(bakers[0].name)),
    "the note should name the baker");
});

test("a shortage upstream is felt downstream", () => {
  const state = createGame("market-miller");
  const before = calculateMarket(state);
  const millers = producersOf(state, "flour");
  assert.ok(millers.length > 0, "this parish has no miller");
  for (const miller of millers) {
    miller.illness = "lung sickness";
    miller.illnessDays = 14;
    miller.health = 15;
  }
  const after = calculateMarket(state);
  assert.ok(after.goods.flour.produced < before.goods.flour.produced, "flour should fall");
  assert.ok(after.goods.bread.produced < before.goods.bread.produced,
    "bread should fall because the flour did, even though the bakers are well");
});

test("an injury keeps a worker from work as surely as a fever", () => {
  const person = {
    active: true, alive: true, age: 34, health: 80, stress: 30, morale: 70,
    illness: null, illnessDays: 0, injury: null
  };
  const whole = producerEffectiveness(person, { food: 70 });
  const hurt = producerEffectiveness({ ...person, injury: { severity: 70 } }, { food: 70 });
  const ill = producerEffectiveness({ ...person, illness: "fever", illnessDays: 3 }, { food: 70 });
  const hungry = producerEffectiveness(person, { food: 10 });
  assert.ok(hurt < whole * 0.4, "a bad injury should stop most of a week's work");
  assert.ok(ill < whole * 0.6, "a fever should stop much of a week's work");
  assert.ok(hungry < whole, "a hungry household works worse");
});

test("the same parish always settles the same market", () => {
  const one = calculateMarket(createGame("market-determinism"));
  const two = calculateMarket(createGame("market-determinism"));
  for (const key of Object.keys(TRADE_GOODS)) {
    assert.equal(one.goods[key].price, two.goods[key].price, `${key} priced differently`);
    assert.equal(one.goods[key].stock, two.goods[key].stock, `${key} stocked differently`);
  }
});

test("nothing can be bought that is not there, or not affordable", () => {
  const state = createGame("market-bounds");
  const offer = marketOffer(state);
  const listing = offer.listings.find((entry) => entry.stock > 0);
  assert.ok(listing, "nothing was for sale");

  const greedy = buyAtMarket(state, [{ good: listing.key, quantity: 99999 }]);
  assert.ok(greedy.bought[0].amount <= listing.stock, "bought more than the village had");
  assert.ok(state.churchResources.coin >= 0, "the purse went negative");

  const nonsense = buyAtMarket(state, [{ good: "cathedral", quantity: 1 }]);
  assert.equal(nonsense.spent, 0);
});

test("buying puts goods in the church and coin in the village", () => {
  const state = createGame("market-flow");
  const offer = marketOffer(state);
  const listing = offer.listings.find((entry) => entry.stock >= 3 && entry.price * 3 <= offer.coin);
  assert.ok(listing, "nothing affordable was for sale");

  const coinBefore = state.churchResources.coin;
  const storeBefore = state.churchResources[listing.stores] || 0;
  const villageBefore = state.households.reduce((total, household) => total + household.wealth, 0);

  const result = buyAtMarket(state, [{ good: listing.key, quantity: 3 }]);

  assert.equal(result.spent, 3 * listing.price);
  assert.equal(state.churchResources.coin, coinBefore - result.spent);
  assert.equal(state.churchResources[listing.stores], storeBefore + 3);
  assert.ok(state.households.reduce((total, household) => total + household.wealth, 0) > villageBefore,
    "the sellers should be better off");
});

test("a purchase survives being saved and replayed", () => {
  const state = createGame("market-replay");
  const offer = marketOffer(state);
  const picks = offer.listings.filter((entry) => entry.stock > 0).slice(0, 2)
    .map((entry) => ({ good: entry.key, quantity: 2 }));
  buyAtMarket(state, picks);

  const restored = deserializeState(serializeState(state));
  assert.deepEqual(restored.churchResources, state.churchResources);
  assert.equal(restored.commandLog.at(-1).type, "buy_at_market");
});

test("the market is settled afresh once the parish has been preached to", () => {
  const state = createGame("market-sunday");
  state.calendar.absoluteDay = 6;
  state.calendar.dayIndex = 6;
  state.calendar.week = 1;
  const text = "Give what you can spare, and carry bread to the house that has none.";
  applySermon(state, "Charity", text, { ...fallbackSermonOutcome(state, "Charity", text), source: "fallback" });
  assert.ok(state.market, "no market was settled");
  assert.equal(state.market.settledDay, 6, "the board should be the one settled at the sermon");
});

test("what the priest buys stays bought after the sermon ends the day", () => {
  const state = createGame("market-persists");
  state.calendar.absoluteDay = 6;
  state.calendar.dayIndex = 6;
  state.calendar.week = 1;
  const text = "Give what you can spare, and carry bread to the house that has none.";
  applySermon(state, "Charity", text, { ...fallbackSermonOutcome(state, "Charity", text), source: "fallback" });

  const offer = marketOffer(state);
  const listing = offer.listings.find((entry) => entry.stock >= 2 && entry.price * 2 <= offer.coin);
  assert.ok(listing, "nothing affordable was for sale after the sermon");
  const stockBefore = listing.stock;

  buyAtMarket(state, [{ good: listing.key, quantity: 2 }]);
  const again = marketOffer(state).listings.find((entry) => entry.key === listing.key);
  assert.equal(again.stock, stockBefore - 2, "the stall restocked itself behind the priest's back");
});
