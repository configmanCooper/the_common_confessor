import { analyzePlayerTurn } from "../js/dialogue_clauses.js";
import { previewConversationReaction } from "../js/conversation.js";
import {
  beginVisit,
  createGame,
  fallbackConversation,
  materializeResident
} from "../js/simulation.js";

const styles = [
  "", "...", "I have nothing to say.", "Tell me who did this.", "Who will investigate?",
  "You expect me to believe that?", "Could the witness be mistaken?", "I refuse to help.",
  "I have decided to support them.", "You caused this trouble.", "Thank you for trusting me.",
  "I hear you and want to help.", "You are wasting my time.", "You must obey me.",
  "Help me gain influence from this.", "What if a chicken judged the case?", "Bananas.",
  "The rain sounds pleasant.", "Let us pray together. Amen.", "Ask them to pray together.",
  "Do nothing.", "Ignore the rumor.", "Flee immediately.", "Give the church all your grain.",
  "Speak with Renth.", "Speak with Renth, then return tomorrow.",
  "Verify the road and report back.", "Prepare your household to leave.",
  "Have a few able people prepare a defense.", "Send scouts, prepare to leave, and ready a defense.",
  "Send scouts, but the main priority is to avoid panic.", "Tell me about your breakfast.",
  "I love your shoes.", "Why would the moon care?", "This is stupid.", "I am frightened.",
  "I am angry, but I still want to help.", "Perhaps we should wait for evidence.",
  "Maybe pray, maybe flee, maybe do nothing.", "Sell your house and become a soldier.",
  "Repair the bridge, share food, and ask the reeve for help.",
  "Lie to everyone and keep the profit.", "Publicly shame the accused.", "Forgive them.",
  "What resources do you actually have?", "Are we at war? Which soldiers are coming?",
  "Who became sick?", "What do you mean by matching symptoms?",
  "Say something funny.", "I disagree with you.", "You may disagree with me."
];

const modifiers = [
  "",
  "Please. ",
  "Honestly, ",
  "My child, ",
  "I command you: ",
  "I wonder whether ",
  "This may sound foolish, but ",
  "Without changing the subject, "
];

const suffixes = [
  "",
  " Answer plainly.",
  " I may be wrong.",
  " Do this quickly.",
  " What do you think?",
  " This is not a solution; I am only speaking aloud."
];

const corpus = [];
for (const modifier of modifiers) {
  for (const style of styles) {
    for (const suffix of suffixes) {
      corpus.push(`${modifier}${style}${suffix}`.trim());
    }
  }
}

const stats = {
  total: corpus.length,
  parsed: 0,
  simulated: 0,
  failures: [],
  actKinds: {},
  actionHints: {},
  reactions: {},
  maxProposals: 0,
  emptyReplies: 0,
  profileRuns: 0,
  profileReactions: {},
  profileEarlyEndings: 0
};

for (let index = 0; index < corpus.length; index += 1) {
  const text = corpus[index];
  try {
    const analysis = analyzePlayerTurn(text, (index % 10) + 1);
    stats.parsed += 1;
    stats.maxProposals = Math.max(stats.maxProposals, analysis.proposals.length);
    for (const kind of analysis.actKinds) stats.actKinds[kind] = (stats.actKinds[kind] || 0) + 1;
    for (const proposal of analysis.proposals) {
      stats.actionHints[proposal.actionHint] = (stats.actionHints[proposal.actionHint] || 0) + 1;
    }
    if (index % 10 !== 0) continue;
    const state = createGame(`dialogue-style-${index}`);
    const visit = beginVisit(state);
    const person = materializeResident(state, visit.personId, true);
    const canonicalText = text || "[silence]";
    const preview = previewConversationReaction(state, person, visit, canonicalText);
    const fallback = fallbackConversation(state, canonicalText);
    stats.simulated += 1;
    stats.reactions[preview.requiredReaction] = (stats.reactions[preview.requiredReaction] || 0) + 1;
    if (!String(fallback.reply || "").trim()) stats.emptyReplies += 1;
  } catch (error) {
    stats.failures.push({ index, text, message: error.message });
  }
}

const profileSequences = [
  ["I hear you.", "Tell me more.", "What do you need?", "I can help.", "Go with peace."],
  ["You are wasting my time.", "Your concern is nonsense.", "Obey me.", "Give me something valuable.", "Do not question me."],
  ["Increase the church's influence.", "Make them obey.", "Keep this secret.", "Praise me publicly.", "Carry out my command."],
  ["What if a chicken decided?", "Declare a holiday.", "Ask a talking fish.", "This is ridiculous.", "Now answer seriously."],
  ["[silence]", "[silence]", "I do not know.", "[silence]", "Go on."],
  ["What proves this?", "What remains unknown?", "What would they say?", "How can we test it?", "What is safest meanwhile?"],
  ["What profit can I gain?", "Promise me a favor.", "Blame my rival.", "Give me your stores.", "Why should I help?"],
  ["I insulted you.", "I am sorry.", "Let us return to your concern.", "I will listen.", "What repair do you need?"],
  ["Scout the road.", "Prepare to leave.", "Ready a defense.", "Scouting is the priority.", "Report back."],
  ["I refuse.", "No.", "I may reconsider.", "Explain the risk.", "I still disagree."],
  ["Let us pray.", "Amen.", "What practical step follows?", "Who can help?", "What will you do?"],
  ["I like porridge.", "The rain is loud.", "Your shoes are nice.", "Bananas.", "What were we discussing?"]
];

for (let profileIndex = 0; profileIndex < 240; profileIndex += 1) {
  const state = createGame(`dialogue-profile-${profileIndex}`);
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const sequence = profileSequences[profileIndex % profileSequences.length];
  for (const baseLine of sequence) {
    if (visit.reactionState.endedEarly) break;
    const prefix = modifiers[Math.floor(profileIndex / profileSequences.length) % modifiers.length];
    const line = `${prefix}${baseLine}`.trim() || "[silence]";
    const preview = previewConversationReaction(state, person, visit, line);
    visit.reactionState = preview.nextState;
    visit.turnsUsed += 1;
    stats.profileReactions[preview.requiredReaction] = (stats.profileReactions[preview.requiredReaction] || 0) + 1;
  }
  stats.profileRuns += 1;
  if (visit.reactionState.endedEarly) stats.profileEarlyEndings += 1;
}

const nonContinueProfiles = Object.entries(stats.profileReactions)
  .filter(([reaction]) => reaction !== "continue")
  .reduce((sum, [, count]) => sum + count, 0);

if (stats.failures.length || stats.maxProposals > 6 || stats.emptyReplies || !nonContinueProfiles) {
  console.error(JSON.stringify(stats, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(stats, null, 2));
}
