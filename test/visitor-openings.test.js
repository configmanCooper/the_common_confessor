import assert from "node:assert/strict";
import test from "node:test";
import { ParishAiClient } from "../js/ai.js";
import { semanticClient } from "./semantic-test-client.js";
import {
  beginVisit,
  createGame,
  fallbackConversation,
  materializeResident,
  recordExchange
} from "../js/simulation.js";

function repeatingClient(capturedPrompts = []) {
  return new ParishAiClient({
    fetchImpl: async (_url, options) => {
      capturedPrompts.push(JSON.parse(options.body).messages[1].content);
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              reply: "Thomas offers me a share in his trade, but it would mean taking from Old Man Hemlock's livelihood. I do not know which path is right.",
              memory: "The visitor repeated the dilemma."
            })
          }
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
}

function groundedDecisionState(seed = "conversation-quality-seed") {
  const state = createGame(seed);
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  visit.issue.kind = "decision";
  visit.scenarioFacts = [
    {
      id: "trade",
      text: "The trade is wool dyeing in Thomas Hale's workshop.",
      anchors: ["wool", "dyeing", "thomas"]
    },
    {
      id: "mechanism",
      text: "Thomas plans to take the only alum supply contract from Hemlock, forcing Hemlock's workshop to close.",
      anchors: ["alum", "contract", "workshop"]
    },
    {
      id: "stakes",
      text: `${person.firstName} would earn steady coin, while Hemlock would lose the income that feeds his household.`,
      anchors: ["coin", "income", "household"]
    },
    {
      id: "alternative",
      text: "A smaller independent workshop would avoid the theft, but it requires tools, coin, and customers.",
      anchors: ["independent", "tools", "customers"]
    }
  ];
  visit.revealedFactIds = [];
  visit.lastVisitorReplies = [visit.history[0].text];
  return { state, visit, person };
}

test("the model writes a natural grounded first line instead of exposing scenario templates", async () => {
  const { state, visit, person } = groundedDecisionState("generated-opening");
  visit.issue.opening = "Father, I need your counsel. A factual scenario draft follows.";
  visit.issue.openingContext = {
    timing: "before Sunday worship",
    place: "at the manor storehouse",
    witness: "Two households are already whispering about it."
  };
  const captured = [];
  const client = new ParishAiClient({
    fetchImpl: async (_url, options) => {
      captured.push(JSON.parse(options.body));
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              opening: "Father, I kept eight sacks aside when the manor called for them. Anias is carrying the blame, and if I speak now my own household may lose the only coin keeping us fed. Tell me plainly: should I confess and return them?"
            })
          }
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  const response = await client.opening(state, person);
  assert.match(response.opening, /I kept eight sacks/i);
  assert.doesNotMatch(response.opening, /matter came to a head|decision is driven by/i);
  assert.equal(captured[0].response_format.json_schema.name, "parish_opening");
  assert.match(captured[0].messages[1].content, /Do not mechanically list every supplied fact/i);
});

test("a natural opening receives an explicit advice question when Gemma omits one", async () => {
  const { state, visit, person } = groundedDecisionState("opening-advice-question");
  visit.intent.desiredOutcome = "guidance";
  visit.scenarioFacts[3].text = "Return the grain and clear Anias Applecombe of blame.";
  const client = new ParishAiClient({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            opening: "Father, I set grain aside when my household had almost nothing. Anias now carries the blame, and I have scarcely slept since."
          })
        }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });

  const response = await client.opening(state, person);
  assert.match(response.opening, /What would you have me do, Father\?$/);
  assert.doesNotMatch(response.opening, /return the grain and clear Anias Applecombe of blame/i);
});

test("formulaic advice-question openings are rewritten in the visitor's voice", async () => {
  const { state, person } = groundedDecisionState("humanized-opening-question");
  const client = new ParishAiClient({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            opening: "Father, this problem troubles my household. I understand a decision is expected within the next six days. I need your advice on the choice itself, Father: should I accept the offer?"
          })
        }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  const response = await client.opening(state, person);
  assert.doesNotMatch(response.opening, /advice on the choice itself|decision is expected/i);
  assert.match(response.opening, /\?/);
});

test("noun-phrase alternatives produce grammatical opening questions", async () => {
  const { state, visit, person } = groundedDecisionState("noun-alternative-question");
  visit.intent.desiredOutcome = "guidance";
  visit.scenarioFacts[3].text = "The immediate need is permission to grieve without pretending certainty.";
  const client = new ParishAiClient({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            opening: "Father, grief has made prayer feel hollow, and I am ashamed of my anger."
          })
        }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  const response = await client.opening(state, person);
  assert.match(response.opening, /What would you have me do, Father\?$/);
  assert.doesNotMatch(response.opening, /should I|would it be wrong/i);
  assert.doesNotMatch(response.opening, /should I the immediate need/i);
});

test("ordinary dialogue uses first names while full-name questions remain explicit", async () => {
  const { state, person } = groundedDecisionState("natural-name-reference");
  const oswyn = state.residents.find((resident) => resident.id !== person.id);
  oswyn.firstName = "Oswyn";
  oswyn.surname = "Page";
  oswyn.name = "Oswyn Page";
  /* An office holder is referred to by his office - "Bailiff Page" - which is
     correct but is not what this test is about. It is about ordinary
     villagers, so make sure he is one. */
  oswyn.occupation = "weaver";
  for (const resident of state.residents) {
    if (resident.id !== oswyn.id && resident.firstName === "Oswyn") {
      resident.firstName = `Other${resident.id}`;
      resident.name = `${resident.firstName} ${resident.surname}`;
    }
  }
  const client = new ParishAiClient({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "I will speak with Oswyn Page tomorrow, Father.",
            memory: "The visitor plans to speak with Oswyn Page."
          })
        }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  const response = await client.conversation(state, person, "What will you do next?");
  assert.match(response.reply, /speak with Oswyn tomorrow/i);
  assert.doesNotMatch(response.reply, /Oswyn Page/);
});
