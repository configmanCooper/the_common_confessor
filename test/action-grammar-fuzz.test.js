import assert from "node:assert/strict";
import test from "node:test";
import { AI_ALLOWED_ACTIONS } from "../js/data.js";
import { actionFromComposition } from "../js/simulation.js";

const PAIRS = [
  ["work", "quit", "laborer"],
  ["work", "change", "soldier"],
  ["work", "start", "sacristan"],
  ["work", "join", "watchman"],
  ["work", "help", "carpenter"],
  ["property", "buy", "cottage"],
  ["property", "sell", "field"],
  ["property", "lease", "market stall"],
  ["resource", "donate", null],
  ["resource", "share", null],
  ["building", "repair", "bridge"],
  ["family", "marry", null],
  ["family", "separate", null],
  ["law", "appeal", null],
  ["law", "testify", null],
  ["communication", "summon", null],
  ["communication", "visit", null],
  ["migration", "leave", null],
  ["migration", "move", "room"],
  ["violence", "threaten", null],
  ["violence", "attack", null],
  ["violence", "kill", null],
  ["crime", "steal", null],
  ["crime", "vandalize", null],
  ["faith", "pray", null],
  ["faith", "attend", null]
];

test("one thousand compositional action variants map deterministically into bounded mechanics", () => {
  const mappedActions = new Set();
  for (let index = 0; index < 1000; index += 1) {
    const [domain, verb, objectType] = PAIRS[index % PAIRS.length];
    const raw = {
      actorId: "person-001",
      targetId: index % 3 === 0 ? "person-002" : null,
      actionType: "improvise",
      intensity: 1 + (index % 5),
      detail: `variant-${index}`,
      composition: {
        domain,
        verb,
        targetIds: index % 3 === 0 ? ["person-002"] : [],
        objectType,
        resourceType: domain === "resource" ? ["grain", "bread", "coin"][index % 3] : null,
        quantity: domain === "resource" ? 1 + (index % 5) : null,
        locationId: index % 2 === 0 ? "village" : null,
        method: `method-${index % 7}`,
        visibility: ["private", "household", "public"][index % 3],
        timing: `day-${index % 9}`,
        condition: index % 4 === 0 ? "if consent is given" : null,
        evidenceTurnIds: [`priest-${index % 10}`]
      }
    };
    const first = actionFromComposition(raw);
    const second = actionFromComposition(raw);
    assert.deepEqual(first, second);
    assert.ok(AI_ALLOWED_ACTIONS.includes(first.actionType));
    assert.ok((first.composition.targetIds || []).length <= 2);
    assert.ok(first.composition.evidenceTurnIds.length <= 5);
    mappedActions.add(first.actionType);
  }
  assert.ok(mappedActions.size >= 20, mappedActions.size);
});
