import { ParishAiClient } from "../js/ai.js";

const KNOWLEDGE_HEADER = "True things you know, in your own words if they come up:";
const DECISION_PREFIX = "decisions: for each of these, say accepted, rejected, deferred or unknown: ";

export function parseNaturalPrompt(prompt) {
  const text = String(prompt || "");
  const saidMatch = text.match(/THE PRIEST JUST SAID: "([\s\S]*?)"\n/);
  const playerText = saidMatch ? saidMatch[1] : "";
  const knowledge = [];
  const knowledgeIndex = text.indexOf(KNOWLEDGE_HEADER);
  if (knowledgeIndex >= 0) {
    const block = text.slice(knowledgeIndex + KNOWLEDGE_HEADER.length).split("\n").slice(1);
    for (const line of block) {
      if (!line.startsWith("- ")) break;
      knowledge.push(line.slice(2).trim());
    }
  }
  let proposals = [];
  const decisionIndex = text.indexOf(DECISION_PREFIX);
  if (decisionIndex >= 0) {
    const raw = text.slice(decisionIndex + DECISION_PREFIX.length).split("\n")[0];
    try {
      proposals = JSON.parse(raw);
    } catch {
      proposals = [];
    }
  }
  const recentMatch = text.match(/The conversation just now:\n([\s\S]*?)\n(?:You ALREADY said:|THE PRIEST JUST SAID:)/);
  const recent = recentMatch ? recentMatch[1].split("\n") : [];
  const peopleMatch = text.match(/People you know: ([\s\S]*?)\.\n/);
  return {
    playerText,
    knowledge,
    proposals,
    recent,
    people: peopleMatch ? peopleMatch[1].split("; ") : [],
    prompt: text
  };
}

export function naturalResponse(prompt, overrides = {}) {
  const { playerText, knowledge, proposals } = parseNaturalPrompt(prompt);
  const reply = knowledge.length
    ? knowledge.join(" ").slice(0, 560)
    : "I hear what you are asking, Father, and I will answer it plainly rather than repeat myself.";
  const base = {
    understoodPlayerAs: `The priest said: ${playerText}`.slice(0, 220),
    reply,
    npcIntent: "Answer the priest's newest words directly.",
    proposedActions: []
  };
  if (proposals.length) {
    base.decisions = proposals.map((proposal) => ({ proposalId: proposal.proposalId, status: "accepted" }));
  }
  return { ...base, ...overrides };
}

export function naturalClient(overrides = {}, options = {}) {
  return new ParishAiClient({
    ...options,
    fetchImpl: async (_url, requestOptions) => {
      const payload = JSON.parse(requestOptions.body);
      const prompt = payload.messages[1].content;
      const body = typeof overrides === "function"
        ? overrides(parseNaturalPrompt(prompt), prompt)
        : naturalResponse(prompt, overrides);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(body) } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
}

export const semanticResponse = naturalResponse;
export const semanticClient = naturalClient;
