import assert from "node:assert/strict";
import test from "node:test";
import { ParishAiClient } from "../js/ai.js";
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

test("repetitive model output is replaced by concrete clarification answers", async () => {
  const { state, visit, person } = groundedDecisionState("clarification-quality");
  const client = repeatingClient();
  const reply = await client.conversation(state, person, "What is the trade, and exactly how does it harm Hemlock?");
  assert.match(reply.reply, /wool dyeing/i);
  assert.match(reply.reply, /alum supply contract/i);
  assert.doesNotMatch(reply.reply, /I do not know which path is right\.$/i);
  recordExchange(state, "What is the trade, and exactly how does it harm Hemlock?", reply);
  assert.ok(visit.revealedFactIds.includes("trade"));
  assert.ok(visit.revealedFactIds.includes("mechanism"));
});

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
  assert.match(response.opening, /should I return the grain and clear Anias Applecombe of blame\?/i);
});

test("the model cannot deny a concrete act assigned to the visitor", async () => {
  const { state, visit, person } = groundedDecisionState("self-action-denial");
  visit.scenarioFacts[0] = {
    id: "concrete_matter",
    text: `${person.name} diverted 8 sacks of grain from the manor reserve.`,
    anchors: ["diverted", "grain", "reserve"]
  };
  const client = new ParishAiClient({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "I did not take the grain myself, Father. I only heard whispers.",
            memory: "The visitor denied involvement."
          })
        }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  const response = await client.conversation(state, person, "Please continue.");
  assert.match(response.reply, /I diverted 8 sacks of grain/i);
  assert.doesNotMatch(response.reply, /did not take/i);
});

test("requests for help state the concrete advice the visitor wants", async () => {
  const { state, visit, person } = groundedDecisionState("explicit-help-request");
  visit.scenarioFacts[3].text = "Refuse Thomas's offer and ask Hemlock to form an honest partnership.";
  const client = repeatingClient();
  const response = await client.conversation(state, person, "So how can I help?");
  assert.match(response.reply, /I need your advice|should I/i);
  assert.match(response.reply, /refuse Thomas|Hemlock|partnership/i);
  assert.doesNotMatch(response.reply, /prefer to discuss this in private/i);
});

test("offers and practical advice receive direct, different answers", async () => {
  const { state, person } = groundedDecisionState("social-quality");
  const client = repeatingClient();
  const cheese = await client.conversation(state, person, "Would you like some cheese?");
  assert.match(cheese.reply, /\b(?:yes|no)\b/i);
  assert.match(cheese.reply, /cheese/i);
  recordExchange(state, "Would you like some cheese?", cheese);

  const trade = await client.conversation(state, person, "You should start your own trade.");
  assert.match(trade.reply, /\b(?:own|trade|workshop)\b/i);
  assert.match(trade.reply, /\b(?:tools|coin|customers|could)\b/i);
  assert.notEqual(trade.reply, cheese.reply);
  assert.doesNotMatch(trade.reply, /Thomas offers me a share.*which path is right/i);
});

test("anything-else questions introduce a new concern or close the meeting", async () => {
  const outcomes = new Set();
  for (let index = 0; index < 16; index += 1) {
    const { state, person } = groundedDecisionState(`anything-else-${index}`);
    const client = repeatingClient();
    const response = await client.conversation(
      state,
      person,
      "Is there any other way I can help, my child? Anything else you wish to discuss?"
    );
    assert.match(response.reply, /\b(?:no|nothing else|that is all|there is|one other|another matter|another concern|yes)\b/i);
    assert.doesNotMatch(response.reply, /offers me a share.*which path is right/i);
    outcomes.add(/\b(?:no|nothing else|that is all)\b/i.test(response.reply) ? "close" : "new_topic");
  }
  assert.deepEqual(outcomes, new Set(["close", "new_topic"]));
});

test("farewells close naturally instead of reopening or apologizing for repetition", async () => {
  const { state, person } = groundedDecisionState("farewell-quality");
  const client = repeatingClient();
  const response = await client.conversation(state, person, "Ok, my child. Go with God.");
  assert.match(response.reply, /\b(?:god|thank you|farewell|peace|goodbye)\b/i);
  assert.doesNotMatch(response.reply, /repeating myself|which path is right|Thomas offers/i);
  assert.equal(response.endsConversation, true);
});

test("advice relevance is validated against the actual proposed action", async () => {
  const { state, person } = groundedDecisionState("advice-relevance");
  const client = new ParishAiClient({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        reply: "The rain has been heavy this week.",
        memory: "The visitor mentioned the weather."
      }) } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });

  test("complex advice is summarized naturally instead of quoted back", async () => {
    const { state, person } = groundedDecisionState("natural-advice-summary");
    const client = repeatingClient();
    const response = await client.conversation(
      state,
      person,
      "My child, if it is lawful, unless it is a direct sin, you must obey. However, perhaps the church can help those already hungry."
    );
    assert.doesNotMatch(response.reply, /"obey|you make "/i);
    assert.doesNotMatch(response.reply, /while ask/i);
    assert.match(response.reply, /obey the lawful order/i);
    assert.match(response.reply, /church.*hungry|hungry.*church/i);
    assert.ok(response.reply.split(/\s+/).length < 55);
  });

  test("why-not suggestions are treated as advice, not overwritten clarification", async () => {
    const { state, person } = groundedDecisionState("why-not-advice");
    const client = new ParishAiClient({
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          reply: "I could ask Hemlock to join me, though I fear he will distrust the proposal.",
          memory: "The priest suggested a partnership."
        }) } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    });
    const response = await client.conversation(state, person, "Why not ask Hemlock to join you?");
    assert.match(response.reply, /ask Hemlock to join/i);
    assert.doesNotMatch(response.reply, /alum supply contract/i);
  });

  test("short advice words still require relevant answers", async () => {
    const { state, person } = groundedDecisionState("short-advice");
    const client = new ParishAiClient({
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          reply: "The rain has been heavy.",
          memory: "The visitor discussed weather."
        }) } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    });
    const response = await client.conversation(state, person, "You should pray.");
    assert.match(response.reply, /pray/i);
    assert.doesNotMatch(response.reply, /^The rain/);
  });
  const response = await client.conversation(state, person, "You should refuse the offer and speak to Hemlock.");
  assert.match(response.reply, /refuse|offer|hemlock/i);
  assert.doesNotMatch(response.reply, /^The rain/);
});

test("normal, resistant, humorous, and outrageous modes create varied forward motion", async () => {
  const captured = [];
  const { state, visit, person } = groundedDecisionState("mode-variety");
  visit.eventLicense = "outrageous";
  const client = repeatingClient(captured);
  const playerLines = [
    "You should start your own trade.",
    "Would you like some bread?",
    "What tools would you need?",
    "Why not ask Hemlock to join you?",
    "You must refuse Thomas.",
    "Could the church lend you coin?",
    "What would your wife say?",
    "Tell me the greatest obstacle."
  ];
  const replies = [];
  for (const line of playerLines) {
    const response = await client.conversation(state, person, line);
    replies.push(response.reply);
    recordExchange(state, line, response);
  }
  assert.ok(new Set(replies).size >= 6);
  assert.ok(replies.some((reply) => /tools|coin|contract|workshop/i.test(reply)));
  const modes = captured.map((prompt) => JSON.parse(prompt.split("CONTEXT_JSON=")[1]).responseMode);
  assert.ok(new Set(modes).size >= 3);
});

test("a good direct model response is preserved instead of overwritten", async () => {
  const { state, person } = groundedDecisionState("good-response-quality");
  const client = new ParishAiClient({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "Yes, Father, I would like some cheese, thank you.",
            memory: "The priest offered cheese."
          })
        }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });

  test("correct tool answers are not replaced by unrelated scenario facts", async () => {
    const { state, person } = groundedDecisionState("tool-answer-quality");
    const client = new ParishAiClient({
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              reply: "I would need dye vats, drying racks, alum, wool, and enough coin to rent a room.",
              memory: "The visitor listed the needed tools."
            })
          }
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    });

    test("ordinary personal questions are not mistaken for scenario clarification", async () => {
      const { state, person } = groundedDecisionState("personal-question-quality");
      const client = new ParishAiClient({
        fetchImpl: async () => new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            reply: "I am frightened and ashamed today.",
            memory: "The visitor described the present feeling."
          }) } }]
        }), { status: 200, headers: { "Content-Type": "application/json" } })
      });

      test("unrelated names do not trigger scenario clarification", async () => {
        const { state, visit, person } = groundedDecisionState("unrelated-name-question");
        visit.scenarioFacts = [{
          id: "mechanism",
          text: "Alice plans to take Robert's cart contract.",
          anchors: ["alice", "robert", "cart"]
        }];
        const client = new ParishAiClient({
          fetchImpl: async () => new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              reply: "I have not seen Thomas today, Father.",
              memory: "The priest asked about Thomas."
            }) } }]
          }), { status: 200, headers: { "Content-Type": "application/json" } })
        });
        const response = await client.conversation(state, person, "Why is Thomas absent today?");
        assert.equal(response.reply, "I have not seen Thomas today, Father.");
        assert.doesNotMatch(response.reply, /Alice|Robert|cart contract/);
      });
      const response = await client.conversation(state, person, "How are you feeling today?");
      assert.equal(response.reply, "I am frightened and ashamed today.");
    });
    const response = await client.conversation(state, person, "What tools would you need?");
    assert.match(response.reply, /dye vats/);
    assert.doesNotMatch(response.reply, /^The trade is/);
  });

  test("repeated stagnation backstops progress instead of repeating one canned apology", async () => {
    const { state, person } = groundedDecisionState("progressive-stagnation");
    const client = repeatingClient();
    const replies = [];
    for (const line of ["Go on.", "Say more.", "Continue.", "You are repeating yourself."]) {
      const response = await client.conversation(state, person, line);
      replies.push(response.reply);
      recordExchange(state, line, response);
    }
    assert.ok(new Set(replies).size >= 3);
    assert.ok(state.currentVisit.stagnationCount >= 2);
  });

  test("extended stagnation continues producing varied forward responses", async () => {
    const { state, person } = groundedDecisionState("extended-stagnation");
    const client = repeatingClient();
    const replies = [];
    for (let index = 0; index < 10; index += 1) {
      const response = await client.conversation(state, person, `Continue ${index}.`);
      replies.push(response.reply);
      recordExchange(state, `Continue ${index}.`, response);
    }
    assert.ok(new Set(replies).size >= 7);
  });

  test("stagnation fallbacks do not leak undisclosed confession facts", async () => {
    const state = createGame("secret-safe-stagnation");
    const visit = beginVisit(state);
    const person = materializeResident(state, visit.personId, true);
    visit.issue.kind = "confession";
    visit.hiddenConcernDisclosed = false;
    visit.scenarioFacts = [{
      id: "concrete_matter",
      text: "PRIVATE_LEDGER_SECRET was stolen.",
      anchors: ["ledger"]
    }];
    visit.lastVisitorReplies = ["I cannot say it."];
    const client = repeatingClient();
    const replies = [];
    for (const line of ["Go on.", "Please continue.", "You are repeating yourself."]) {
      const response = await client.conversation(state, person, line);
      replies.push(response.reply);
      assert.doesNotMatch(response.reply, /PRIVATE_LEDGER_SECRET/);
      recordExchange(state, line, response);
    }
    assert.ok(!replies.some((reply) => /bargain|household cost/i.test(reply)));
  });

  test("issue-specific stagnation remains varied outside decision visits", async () => {
    for (const kind of ["grief", "faith", "outside authority"]) {
      const { state, visit, person } = groundedDecisionState(`stagnation-${kind}`);
      visit.issue.kind = kind;
      visit.lastVisitorReplies = ["The same repeated line."];
      const client = repeatingClient();
      const replies = [];
      for (let index = 0; index < 4; index += 1) {
        const response = await client.conversation(state, person, `Continue ${index}.`);
        replies.push(response.reply);
        recordExchange(state, `Continue ${index}.`, response);
      }
      assert.equal(new Set(replies).size, 4, kind);
    }
  });
  const response = await client.conversation(state, person, "Would you like some cheese?");
  assert.equal(response.reply, "Yes, Father, I would like some cheese, thank you.");
  assert.equal(response.groundedFallback, undefined);
});

test("offline fallback remains available if the local model is unavailable", () => {
  const { state } = groundedDecisionState("offline-quality");
  const clarification = fallbackConversation(state, "What trade is Thomas offering?");
  assert.match(clarification.reply, /wool dyeing/i);
  const cheese = fallbackConversation(state, "Would you like some cheese?");
  assert.match(cheese.reply, /cheese/i);
  const trade = fallbackConversation(state, "You should start your own trade.");
  assert.match(trade.reply, /tools|coin|customers/i);
});
