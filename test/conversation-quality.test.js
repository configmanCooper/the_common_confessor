import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  createGame,
  fallbackConversation,
  materializeResident,
  recordExchange
} from "../js/simulation.js";
import { naturalClient } from "./semantic-test-client.js";

/* These tests judge MEANING and pipeline behaviour, not exact wording.
   A semantically correct natural reply must survive even when it contains
   none of the words the old deterministic routes used to require. */

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

/** Run one player line and return what the player would actually see. */
async function say(scene, playerText, modelReply, extra = {}) {
  const client = naturalClient((parsed) => ({
    understoodPlayerAs: `The priest said: ${parsed.playerText}`,
    reply: modelReply,
    npcIntent: "Answer the priest.",
    proposedActions: [],
    ...(parsed.proposals.length
      ? { decisions: parsed.proposals.map((proposal) => ({ proposalId: proposal.proposalId, status: "accepted" })) }
      : {}),
    ...extra
  }));
  const response = await client.conversation(scene.state, scene.person, playerText);
  return response;
}

/* ----------------------------------------------------- understanding ---- */

test("a follow-up about the visitor's own previous sentence is answered, not restarted", async () => {
  const scene = groundedDecisionState("semantic-followup");
  recordExchange(scene.state, "What worries you most?", {
    reply: "I fear Hemlock will lose everything if I take the contract.",
    memory: "m"
  });
  let parsed = null;
  const client = naturalClient((entry) => {
    parsed = entry;
    return {
      understoodPlayerAs: "The priest asks why I believe Hemlock would lose everything.",
      reply: "Because the alum is the whole of his trade. Without it there is nothing left to dye with.",
      npcIntent: "Explain the reasoning behind my fear.",
      proposedActions: []
    };
  });
  const response = await client.conversation(scene.state, scene.person, "Why would he lose everything?");
  assert.match(parsed.recent.join("\n"), /Hemlock will lose everything/);
  assert.match(response.reply, /alum is the whole of his trade/);
  assert.ok(!response.groundedFallback);
  assert.deepEqual(response.promptTrace.transformations, []);
});

test("a correction is delivered to the model instead of being pattern-matched away", async () => {
  const scene = groundedDecisionState("semantic-correction");
  /* Both names must belong to real villagers. An invented one is stripped
     before it reaches the player, which is the point of the grounding guard,
     and a fixture that leans on a phantom is testing a conversation that could
     never happen. */
  const [first, second] = scene.state.residents
    .filter((person) => person.alive !== false && person.id !== scene.person.id)
    .slice(0, 2);
  recordExchange(scene.state, `Speak to ${first.firstName}.`, {
    reply: `I will speak to ${first.firstName} then.`,
    memory: "m"
  });
  let parsed = null;
  const client = naturalClient((entry) => {
    parsed = entry;
    return {
      understoodPlayerAs: `The priest did not mean ${first.firstName}; he meant ${second.firstName}.`,
      reply: `Forgive me, I misheard. You mean ${second.firstName}. I will go to him instead.`,
      npcIntent: "Accept the correction.",
      proposedActions: []
    };
  });
  const response = await client.conversation(
    scene.state,
    scene.person,
    "No, that is not what I meant. I meant the other man."
  );
  assert.equal(parsed.playerText, "No, that is not what I meant. I meant the other man.");
  assert.match(response.reply, new RegExp(`You mean ${second.firstName}`));
  assert.equal(
    response.promptTrace.understoodPlayerAs,
    `The priest did not mean ${first.firstName}; he meant ${second.firstName}.`
  );
});

test("an indirect question without a question mark still reaches the model intact", async () => {
  const scene = groundedDecisionState("semantic-indirect");
  let parsed = null;
  const client = naturalClient((entry) => {
    parsed = entry;
    return {
      understoodPlayerAs: "The priest is asking who could look into the contract.",
      reply: "No one I trust has the standing to ask after it, Father.",
      npcIntent: "Admit there is no obvious person.",
      proposedActions: []
    };
  });
  const response = await client.conversation(
    scene.state,
    scene.person,
    "Someone still needs to find out whether that contract was ever signed."
  );
  assert.match(parsed.playerText, /whether that contract was ever signed/);
  assert.match(response.reply, /No one I trust/);
  assert.ok(!response.groundedFallback);
});

test("partial agreement is preserved rather than flattened into acceptance", async () => {
  const scene = groundedDecisionState("semantic-partial");
  let parsed = null;
  const client = naturalClient((entry) => {
    parsed = entry;
    return {
      understoodPlayerAs: "The priest accepts one part of my plan and rejects the other.",
      reply: "Then I will speak to Hemlock, but I will not give up the contract yet.",
      npcIntent: "Take half the counsel.",
      proposedActions: [],
      ...(entry.proposals.length
        ? {
          decisions: entry.proposals.map((proposal, index) => ({
            proposalId: proposal.proposalId,
            status: index === 0 ? "accepted" : "rejected"
          }))
        }
        : {})
    };
  });
  const response = await client.conversation(
    scene.state,
    scene.person,
    "Speak to Hemlock, and give up the contract entirely."
  );
  assert.ok(parsed.proposals.length >= 2, "compound counsel was not split into parts");
  assert.equal(response.decisions.filter((entry) => entry.status === "accepted").length, 1);
  assert.equal(response.decisions.filter((entry) => entry.status === "rejected").length, 1);
  assert.match(response.reply, /will not give up the contract/);
});

test("a suggestion is not treated as a command the visitor must obey", async () => {
  const scene = groundedDecisionState("semantic-suggestion");
  const response = await say(
    scene,
    "Perhaps a neighbour could lend you the tools.",
    "I doubt any of them has tools to spare this near the winter, Father."
  );
  assert.match(response.reply, /tools to spare/);
  assert.ok(!response.groundedFallback);
  assert.deepEqual(response.promptTrace.transformations, []);
});

test("a novel solution the scenario never listed is allowed to stand", async () => {
  const scene = groundedDecisionState("semantic-novel");
  const response = await say(
    scene,
    "What if you and Hemlock shared the contract between you?",
    "Sharing it never crossed my mind. He might accept that, if I put it to him gently."
  );
  assert.match(response.reply, /Sharing it never crossed my mind/);
  assert.ok(!response.groundedFallback);
});

test("bizarre or irrelevant counsel receives a natural human answer", async () => {
  const scene = groundedDecisionState("semantic-bizarre");
  const response = await say(
    scene,
    "Have you considered that the moon is made of good cheese?",
    "I cannot tell whether you are teasing me, Father. My trouble is still here either way."
  );
  assert.match(response.reply, /teasing me/);
  assert.ok(!response.groundedFallback);
});

test("an emotionally sensitive reply is not overwritten by a scripted reaction", async () => {
  const scene = groundedDecisionState("semantic-emotional");
  scene.visit.reactionState.sadness = 62;
  const response = await say(
    scene,
    "That must be a heavy thing to carry alone.",
    "It is. I have not said any of this aloud until now."
  );
  assert.match(response.reply, /not said any of this aloud/);
  assert.notEqual(response.promptTrace.responseSource, "scripted_reaction");
});

test("an instruction involving another villager becomes a validated commitment", async () => {
  const scene = groundedDecisionState("semantic-instruction");
  const target = scene.state.residents.find((resident) => (
    scene.person.relationshipIds.includes(resident.id)
  ));
  const client = naturalClient({
    understoodPlayerAs: "The priest wants me to go and speak with him.",
    reply: `Very well. I will find ${target.firstName} before dark and put it to him.`,
    npcIntent: "Agree to carry the message.",
    proposedActions: [{ action: "speak_to", target: target.name }]
  });
  const response = await client.conversation(
    scene.state,
    scene.person,
    `Go and speak with ${target.firstName} yourself, and come back tomorrow.`
  );
  assert.equal(response.proposedActions[0].targetId, target.id);
  recordExchange(scene.state, "Go and speak with him.", response);
  assert.ok(scene.state.commitments.some((entry) => (
    entry.type === "npc_intention" && entry.actorId === scene.person.id
  )));
});

test("ordinary language without expected keywords is never replaced", async () => {
  const scene = groundedDecisionState("semantic-plain-language");
  const lines = [
    ["Would some bread from the church help?", "That would carry us a few days. Thank you, Father."],
    ["Anything else I can help with?", "Nothing more today. You have given me enough to think on."],
    ["Let us pray together.", "Amen. I needed that more than I knew."],
    ["Go with God, my child.", "And with you, Father."]
  ];
  for (const [player, reply] of lines) {
    if (scene.visit.turnsUsed >= scene.visit.maxTurns) break;
    const response = await say(scene, player, reply);
    assert.equal(response.reply, reply, `"${player}" was rewritten by the framework`);
    assert.ok(!response.groundedFallback, `"${player}" fell back to canned prose`);
    recordExchange(scene.state, player, response);
  }
});

test("repeating the same question does not force a canned stagnation line", async () => {
  const scene = groundedDecisionState("semantic-repeat-question");
  const first = await say(scene, "Who else knows?", "Only my wife knows any of it.");
  recordExchange(scene.state, "Who else knows?", first);
  const second = await say(
    scene,
    "Who else knows?",
    "As I said, only my wife — though I fear the dyer's boy may have guessed."
  );
  assert.match(second.reply, /dyer's boy may have guessed/);
  assert.ok(!second.groundedFallback);
});

/* ------------------------------------------------------- guardrails ----- */

test("a good direct model response is preserved instead of overwritten", async () => {
  const scene = groundedDecisionState("preserve-good-response");
  const reply = "Thomas offered me the contract on Tuesday, and I have not yet answered him.";
  const response = await say(scene, "What exactly did Thomas offer, and when?", reply);
  assert.equal(response.reply, reply);
  assert.equal(response.promptTrace.rawModelReply, reply);
  assert.equal(response.promptTrace.finalReply, reply);
  assert.equal(response.promptTrace.responseSource, "gemma_dialogue");
});

test("authoritative facts are supplied to the model rather than spoken by the framework", async () => {
  const scene = groundedDecisionState("facts-as-knowledge");
  let parsed = null;
  const client = naturalClient((entry) => {
    parsed = entry;
    return {
      understoodPlayerAs: "The priest wants to know what the trade is.",
      reply: "It is dyeing work, Father, in his workshop.",
      npcIntent: "Say what the trade is.",
      proposedActions: []
    };
  });
  const response = await client.conversation(
    scene.state,
    scene.person,
    "What is the trade, and exactly how does it harm Hemlock?"
  );
  assert.ok(parsed.knowledge.length > 0, "no authoritative knowledge was supplied to the model");
  assert.match(response.reply, /dyeing work/);
  assert.ok(!response.groundedFallback);
});

test("the framework never invents an authority the world does not contain", async () => {
  const scene = groundedDecisionState("no-invented-authority");
  const response = await say(
    scene,
    "Who can settle this dispute?",
    "The village elder will decide it for us."
  );
  assert.doesNotMatch(response.reply, /village elder will decide/);
  assert.ok(response.promptTrace.transformations.some((entry) => entry.type === "sentence_repaired"));
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
