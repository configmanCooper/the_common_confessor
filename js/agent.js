/* The watchable priest agent.
 *
 * Division of authority, borrowed from the same rule the rest of this game
 * follows: the model never touches game state. The engine enumerates the moves
 * that are legal right now, the model returns the INDEX of one plus a reason,
 * and the engine executes it through exactly the same commands the player's
 * buttons use. A move the model invents does not exist and is refused.
 *
 * Parity matters as much as legality. The board below is assembled only from
 * what the interface actually shows a player: an undisclosed confession, another
 * villager's private memories, the truth value of a rumour, and hidden scenario
 * facts are all withheld. If the agent could see them it would be playing a
 * different game and its playthrough would prove nothing.
 */

import { SERMON_THEMES } from "./data.js";
import { churchResourceRows } from "./church.js";

export const AGENT_MOVE_KINDS = Object.freeze([
  "speak",
  "next_hour",
  "deliver_sermon",
  "request_visit"
]);

function visibleScenarioFacts(visit) {
  if (!visit) return [];
  return (visit.scenarioFacts || [])
    .filter((fact) => fact.speakable !== false)
    .filter((fact) => (visit.revealedFactIds || []).includes(fact.id))
    .map((fact) => fact.text);
}

function moodWord(visit) {
  const reaction = visit?.reactionState;
  if (!reaction) return "settled";
  if (reaction.anger >= 55) return "angry";
  if (reaction.fear >= 55) return "frightened";
  if (reaction.sadness >= 45) return "grieving";
  if (reaction.shame >= 45) return "ashamed";
  if (reaction.confusion >= 45) return "confused";
  if (reaction.willingnessToContinue <= 30) return "ready to leave";
  if (reaction.trust >= 68) return "trusting";
  return "guarded";
}

/** What a player can read off the screen at this moment, and nothing more. */
export function describeBoard(state) {
  const visit = state.currentVisit;
  const person = visit ? state.residents.find((entry) => entry.id === visit.personId) : null;
  const isSunday = state.calendar.dayIndex === 6;
  const board = {
    parish: {
      town: state.town.name,
      description: state.town.description,
      population: state.residents.filter((resident) => resident.active && resident.alive).length,
      metrics: { ...state.town.metrics }
    },
    calendar: {
      week: state.calendar.week,
      day: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][state.calendar.dayIndex],
      appointmentsToday: state.calendar.slot,
      isSunday
    },
    priest: {
      standing: state.priest.standing,
      scandal: state.priest.scandal,
      bishopFavor: state.priest.bishopFavor
    },
    churchStores: churchResourceRows(state.churchResources)
      .filter((row) => row.amount > 0)
      .map((row) => `${row.amount} ${row.unit} of ${row.label.toLowerCase()} [${row.key}]`),
    visitor: null
  };
  if (visit && person) {
    board.visitor = {
      name: person.name,
      age: person.age,
      occupation: person.occupation,
      background: visit.hiddenConcernDisclosed
        ? (person.backstory || person.publicBackstory)
        : person.publicBackstory,
      mood: moodWord(visit),
      location: visit.location,
      thingsSaid: visit.turnsUsed,
      thingsRemaining: Math.max(0, visit.maxTurns - visit.turnsUsed),
      whatYouHaveLearned: visibleScenarioFacts(visit),
      transcript: visit.history.map((line) => ({
        who: line.speaker === "priest" ? "you" : person.firstName,
        said: line.text
      }))
    };
  }
  return board;
}

/** Everything the priest may legally do right now, described the way the
    interface describes it, so the agent and the player read the same words. */
export function legalMoves(state) {
  const moves = [];
  const visit = state.currentVisit;
  const isSunday = state.calendar.dayIndex === 6;
  const sermonDue = isSunday && !state.sermons.some((entry) => (
    entry.week === state.calendar.week
  ));

  if (visit && !visit.reactionState?.endedEarly && visit.turnsUsed < visit.maxTurns) {
    const person = state.residents.find((entry) => entry.id === visit.personId);
    moves.push({
      kind: "speak",
      needsText: true,
      label: `Say something to ${person?.firstName || "the visitor"}`,
      detail: `You may say anything. ${Math.max(0, visit.maxTurns - visit.turnsUsed)} of ${visit.maxTurns} remain this hour. `
        + "You can also hand over church stores by simply offering them in your own words."
    });
  }
  if (visit) {
    const ended = visit.reactionState?.endedEarly || visit.turnsUsed >= visit.maxTurns;
    moves.push({
      kind: "next_hour",
      needsText: false,
      label: ended ? "Let the visitor depart" : "End the hour early and let the visitor depart",
      detail: ended
        ? "The hour is spent. They will leave and act on what was said."
        : "You still have things you could say. Ending now means they leave with only what has passed so far."
    });
  }
  if (sermonDue) {
    moves.push({
      kind: "deliver_sermon",
      needsText: true,
      needsTheme: true,
      themes: SERMON_THEMES.slice(),
      label: "Preach the Sunday sermon",
      detail: "Up to 100 words, on one theme. The whole parish hears it, and it moves many people at once."
    });
  }
  const requestable = state.residents
    .filter((resident) => resident.active && resident.alive && resident.age >= 16)
    .filter((resident) => !state.visitRequests.some((request) => (
      request.personId === resident.id && request.status === "pending"
    )))
    .slice(0, 40);
  if (state.calendar.absoluteDay >= 1 && requestable.length) {
    for (const resident of requestable.slice(0, 12)) {
      moves.push({
        kind: "request_visit",
        needsText: false,
        personId: resident.id,
        label: `Ask ${resident.name} (${resident.occupation}) to come and see you`,
        detail: "They may accept or refuse. Asking costs nothing but the hour it fills."
      });
    }
  }
  return moves.map((move, index) => ({ ...move, index }));
}

/** Validate a model's choice against the enumerated list. Nothing else is
    trusted: an unknown index, a missing sentence, or an invented theme is
    refused here rather than reaching the simulation. */
export function validateAgentChoice(moves, choice) {
  if (!choice || typeof choice !== "object") {
    return { ok: false, error: "The agent returned no choice." };
  }
  const index = Number(choice.move ?? choice.index);
  if (!Number.isInteger(index) || index < 0 || index >= moves.length) {
    return { ok: false, error: `Move ${choice.move ?? choice.index} is not one of the ${moves.length} legal moves.` };
  }
  const move = moves[index];
  const reason = String(choice.reason || "").slice(0, 400);
  if (move.needsText) {
    const text = String(choice.text || "").trim();
    if (!text) return { ok: false, error: `Move ${index} ("${move.label}") requires something to say.` };
    const limit = move.kind === "deliver_sermon" ? 100 : 0;
    if (limit) {
      const words = text.split(/\s+/).filter(Boolean);
      if (words.length > limit) {
        return { ok: false, error: `A sermon may be at most ${limit} words; that was ${words.length}.` };
      }
    }
    if (move.needsTheme) {
      const theme = String(choice.theme || "").trim();
      if (!move.themes.includes(theme)) {
        return { ok: false, error: `"${theme}" is not one of the sermon themes: ${move.themes.join(", ")}.` };
      }
      return { ok: true, move, text: text.slice(0, 1200), theme, reason };
    }
    return { ok: true, move, text: text.slice(0, 600), reason };
  }
  return { ok: true, move, reason };
}

export function buildAgentPrompt(state, moves, { steer = "", recent = [] } = {}) {
  const board = describeBoard(state);
  const lines = [
    "You are playing the priest in a 16th-century English village parish simulation.",
    "You counsel whoever comes to you. What you say changes what people do afterwards, and those consequences accumulate over weeks.",
    "",
    "You see exactly what a human player sees on screen, and nothing more. People keep things from you until they trust you.",
    "",
    "BOARD:",
    JSON.stringify(board, null, 1),
    "",
    "LEGAL MOVES — you may only choose one of these, by index:",
    ...moves.map((move) => `[${move.index}] ${move.label}\n      ${move.detail}${move.themes ? `\n      themes: ${move.themes.join(", ")}` : ""}`),
    ""
  ];
  if (recent.length) {
    lines.push("YOUR LAST FEW MOVES (do not simply repeat them):", ...recent.slice(-5).map((entry) => `- ${entry}`), "");
  }
  if (steer) {
    lines.push(`THE PERSON WATCHING ASKS YOU TO: ${steer}`, "");
  }
  lines.push(
    "Choose one move and reply with JSON only:",
    '{"move": <index>, "text": "<what you say, if the move needs words>", "theme": "<sermon theme, only for a sermon>", "reason": "<one sentence on why>"}',
    "",
    "Speak as a real parish priest would to that person: plainly, in your own words, responding to what they actually just said.",
    "Do not narrate, do not use asterisks, and do not write stage directions."
  );
  return lines.join("\n");
}

export function parseAgentReply(text) {
  const raw = String(text || "");
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const braced = candidate.match(/\{[\s\S]*\}/);
  if (!braced) return null;
  try {
    return JSON.parse(braced[0]);
  } catch {
    return null;
  }
}
