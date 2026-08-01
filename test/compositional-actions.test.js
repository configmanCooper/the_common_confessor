import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  createGame,
  finishVisit,
  materializeResident,
  recordExchange
} from "../js/simulation.js";
import { deserializeState, serializeState } from "../js/state.js";

function composition(overrides) {
  return {
    domain: "work",
    verb: "change",
    targetIds: [],
    objectType: "soldier",
    resourceType: null,
    quantity: null,
    locationId: null,
    method: null,
    visibility: "household",
    timing: null,
    condition: null,
    evidenceTurnIds: [],
    ...overrides
  };
}

function finishComposed(state, visit, step) {
  finishVisit(state, {
    source: "ai",
    summary: "A composed action.",
    steps: [{
      actorId: visit.personId,
      targetId: null,
      actionType: "improvise",
      intensity: 2,
      title: "Composed action",
      description: "The visitor acts on a concrete composed plan.",
      detail: "composed action",
      motive: "practical",
      evidence: "The priest's counsel supported the action.",
      composition: step
    }]
  });
}

test("work compositions can change a villager into a soldier", () => {
  const state = createGame("composition-soldier");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  person.age = 30;
  recordExchange(state, "You may change your work and become a soldier.", {
    reply: "I will seek soldier's work.",
    memory: "The priest supported a change of work."
  });
  finishComposed(state, visit, composition({ domain: "work", verb: "change", objectType: "soldier" }));
  assert.equal(person.occupation, "soldier");
});

test("work compositions can begin service at the church", () => {
  const state = createGame("composition-church-work");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  person.age = 30;
  recordExchange(state, "Begin work at the church as a sacristan.", {
    reply: "I will begin church work.",
    memory: "The priest offered church service."
  });
  finishComposed(state, visit, composition({
    domain: "work",
    verb: "start",
    objectType: "sacristan",
    locationId: "church"
  }));
  assert.equal(person.occupation, "sacristan");
});

test("property compositions buy, lease, and sell real household property", () => {
  const state = createGame("composition-property");
  let visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const household = state.households.find((entry) => entry.id === person.householdId);
  const initialProperties = household.properties.length;
  recordExchange(state, "Buy a small cottage if the price is fair.", {
    reply: "I will try to buy the cottage.",
    memory: "The priest supported a property purchase."
  });
  finishComposed(state, visit, composition({ domain: "property", verb: "buy", objectType: "cottage" }));
  assert.equal(household.properties.length, initialProperties + 1);
  assert.equal(household.properties.at(-1).status, "owned");

  state.calendar.dayIndex = state.calendar.absoluteDay % 7;
  visit = beginVisit(state);
  const nextPerson = materializeResident(state, visit.personId, true);
  const nextHousehold = state.households.find((entry) => entry.id === nextPerson.householdId);
  recordExchange(state, "Lease a market stall for your trade.", {
    reply: "I will lease the stall.",
    memory: "The priest supported a lease."
  });
  finishComposed(state, visit, composition({ domain: "property", verb: "lease", objectType: "market stall" }));
  assert.ok(nextHousehold.properties.some((property) => property.type === "market stall" && property.status === "leased"));

  visit = beginVisit(state);
  const seller = materializeResident(state, visit.personId, true);
  const sellerHousehold = state.households.find((entry) => entry.id === seller.householdId);
  const wealthBefore = sellerHousehold.wealth;
  recordExchange(state, "Sell property you no longer need.", {
    reply: "I will sell it.",
    memory: "The priest supported a sale."
  });
  finishComposed(state, visit, composition({ domain: "property", verb: "sell", objectType: "cottage" }));
  assert.ok(sellerHousehold.wealth >= wealthBefore);
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("oversized composition targets are rejected", () => {
  const state = createGame("composition-target-cap");
  const visit = beginVisit(state);
  finishComposed(state, visit, composition({
    domain: "communication",
    verb: "visit",
    targetIds: state.residents.slice(0, 3).map((resident) => resident.id)
  }));
  const command = state.commandLog.at(-1);
  assert.equal(command.payload.evaluation.submittedRejection.gate, "composition_bounds");
});
