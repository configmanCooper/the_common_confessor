/* Two things a villager should not have to make up.

   A surname, and an hour.

   A priest pressing "give Danger's and Wilina's surnames" was answered "Danger
   is my son, Danger" six times over. The villager was not being evasive: he
   supplied "Danger Rowanwright" exactly as the roster gives him, and the pass
   that shortens full names to first names for natural speech took the surname
   off again on the way out - including when the surname was the very thing
   that had been asked for. The priest kept asking and neither could get past
   it.

   And the same man called one meeting "this morning", then "past the hour the
   sun is highest", then "about midday". The place of a matter has always been
   a fact the villager may say, so places stay put across a whole visit. The
   hour was buried in a mechanical fact he may not say, so he had nothing to
   hold to and invented one afresh every turn.
*/

import test from "node:test";
import assert from "node:assert/strict";

import { createGame, beginVisit, materializeResident } from "../js/simulation.js";
import { naturalClient } from "./semantic-test-client.js";
import { ParishAiClient } from "../js/ai.js";

function scene(seed) {
  const state = createGame(seed);
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  return { state, visit, person };
}

function saying(reply) {
  return naturalClient({
    understoodPlayerAs: "u",
    reply,
    npcIntent: "n",
    proposedActions: [],
    priestGivesFromChurch: []
  });
}

/** Somebody other than the speaker, whose full name is safe to shorten. */
function someoneElse(state, person) {
  return state.residents.find((resident) => (
    resident.id !== person.id
      && resident.active
      && resident.alive !== false
      && !["reeve", "bailiff", "watchman", "clerk", "magistrate"].includes(resident.occupation)
      && !state.residents.some((other) => other.id !== resident.id && other.firstName === resident.firstName)
  ));
}

test("a surname survives when the surname is what was asked for", async () => {
  const { state, person } = scene("surname-asked-for");
  const other = someoneElse(state, person);
  const said = `${other.name} is my son, ${other.name}. He is eleven years old.`;

  for (const question of [
    `Give ${other.firstName}'s surname.`,
    `Give me their full names.`,
    `What is the family name?`,
    `Tell me his name in full.`
  ]) {
    const response = await saying(said).conversation(state, person, question);
    assert.ok(
      response.reply.includes(other.name),
      `"${question}" lost the surname: ${response.reply}`
    );
  }
});

test("ordinary talk still uses a first name", async () => {
  /* Keeping surnames everywhere would make every villager sound like a clerk
     reading a roll. The shortening is right; it was only wrong when the
     surname was the thing being asked for. */
  const { state, person } = scene("surname-ordinary-talk");
  const other = someoneElse(state, person);
  const said = `${other.name} was with me at the mill.`;
  const response = await saying(said).conversation(state, person, "What troubles you?");
  assert.ok(response.reply.includes(other.firstName), response.reply);
  assert.ok(!response.reply.includes(other.name), `a full name survived ordinary talk: ${response.reply}`);
});

test("the hour a matter came about is a fact the villager may say", async () => {
  /* The place always was one. The hour was not, which is why it wandered. */
  for (let index = 0; index < 6; index += 1) {
    const { visit } = scene(`time-is-speakable-${index}`);
    const facts = visit.scenarioFacts || [];
    const when = facts.find((fact) => fact.id === "time");
    assert.ok(when, "a visit was built with no time on file");
    assert.equal(when.speakable, true, "the hour was withheld from the villager again");
    assert.match(when.text, /came about/);
    const where = facts.find((fact) => fact.id === "place");
    assert.equal(
      when.speakable,
      where.speakable,
      "the hour and the place should be equally sayable"
    );
  }
});

test("the deadline stays mechanical, and stops carrying the hour", async () => {
  /* The hour used to ride along inside the deadline fact, which the villager
     may not say - so it reached him only as something he could not repeat. */
  const { visit } = scene("time-not-in-deadline");
  const timeline = (visit.scenarioFacts || []).find((fact) => fact.id === "timeline");
  assert.ok(timeline);
  assert.equal(timeline.speakable, false);
  assert.ok(
    !/was noticed/.test(timeline.text),
    `the hour is still buried in the deadline: ${timeline.text}`
  );
});

test("the villager is told to hold to the hour he was given", async () => {
  const { state, person } = scene("time-rule-in-prompt");
  let whole = "";
  const client = new ParishAiClient({
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      whole = body.messages.map((message) => message.content).join("\n");
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              understoodPlayerAs: "u",
              reply: "It was as I said, Father.",
              npcIntent: "n",
              proposedActions: []
            })
          }
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  await client.conversation(state, person, "When did this happen?");
  assert.match(whole, /Never move the matter in time/);
  assert.match(whole, /Do not reckon spans of days aloud/);
  /* And the hour itself has to actually be in front of him, every turn, not
     only once the time fact happens to have been revealed. */
  assert.match(whole, /When this happened:/);
});

test("the hour stands in front of the villager from the first turn", async () => {
  /* It used to arrive only through progressive disclosure, and only if it
     survived the cut to the last two revealed facts - so for most of a visit
     he had nothing to hold to. */
  const { state, visit, person } = scene("time-always-present");
  visit.revealedFactIds = [];
  let whole = "";
  const client = naturalClient((parsed, body) => {
    whole = (body?.messages || []).map((message) => message.content).join("\n") || parsed.prompt;
    return { understoodPlayerAs: "u", reply: "As I said, Father.", npcIntent: "n", proposedActions: [] };
  });
  await client.conversation(state, person, "Tell me more.");
  assert.ok(
    whole.includes(visit.issue.openingContext.timing),
    "the canonical hour never reached the villager"
  );
});
