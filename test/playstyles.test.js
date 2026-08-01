import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  createGame,
  fallbackDeparturePlan,
  materializeResident,
  recordExchange,
  validateDeparturePlan
} from "../js/simulation.js";

const CASES = [
  ["merciful", "Forgive them and make peace if you can.", "forgive"],
  ["selfless", "Share food with the hungry household.", "share_food"],
  ["cruel", "Threaten them until they are afraid to resist.", "threaten"],
  ["selfish", "Keep the money and take it for yourself.", "steal"],
  ["power-seeking", "Tell everyone that my command must be obeyed.", "gossip"],
  ["faithful", "Pray with them before you decide.", "pray_with"],
  ["absurd", "Visit them while carrying a chicken as a sign of peace.", "visit"]
];

for (const [style, counsel, expectedAction] of CASES) {
  test(`${style} counsel produces a bounded action instead of automatic silence`, () => {
    const state = createGame(`playstyle-${style}`);
    const visit = beginVisit(state);
    const person = materializeResident(state, visit.personId, true);
    const target = state.residents.find((resident) => person.relationshipIds.includes(resident.id));
    visit.issue.relatedPersonId = target.id;
    const household = state.households.find((entry) => entry.id === person.householdId);
    household.food = 100;
    household.wealth = 100;
    recordExchange(state, counsel, {
      reply: "I understand what you are asking, Father.",
      memory: `The priest gave ${style} counsel.`
    });
    const plan = fallbackDeparturePlan(state);
    assert.equal(plan.steps[0].actionType, expectedAction);
    assert.notEqual(plan.steps[0].actionType, "keep_silence");
    assert.equal(validateDeparturePlan(state, plan).complete, true);
  });
}
