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

import { EXTERNAL_ROLES, SERMON_THEMES } from "./data.js";
import { churchResourceRows } from "./church.js";
import { availableOfficers } from "./simulation.js";

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
    const stores = churchResourceRows(state.churchResources).filter((row) => row.amount > 0);
    moves.push({
      kind: "speak",
      needsText: true,
      allowsGifts: true,
      stores: stores.map((row) => ({ key: row.key, label: row.label, unit: row.unit, left: row.amount })),
      label: `Say something to ${person?.firstName || "the visitor"}`,
      detail: `You may say anything. ${Math.max(0, visit.maxTurns - visit.turnsUsed)} of ${visit.maxTurns} remain this hour. `
        + (stores.length
          ? `You may also hand over church stores with these words by adding "gives": ${stores.map((row) => `${row.key} (${row.left} ${row.unit} left)`).join(", ")}. Handing something over is the same act as saying you will, so do not count it twice.`
          : "The church stores are empty.")
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
        detail: "They come to the church within a day or two, if they are willing. This is how you reach anyone: you do not leave the church yourself."
      });
    }
  }

  /* Sending for the law, and beyond it to the manor. These are real acts with
     real weight, not turns of phrase: the village has a watch, a bailiff and a
     reeve, and behind them a steward and a lord. It has no constable. */
  if (visit) {
    const officers = availableOfficers(state);
    const subjects = [
      state.residents.find((entry) => entry.id === visit.personId),
      state.residents.find((entry) => entry.id === visit.issue.relatedPersonId)
    ].filter((entry) => entry && officers.every((officer) => officer.id !== entry.id));
    for (const officer of officers.slice(0, 2)) {
      for (const subject of subjects) {
        moves.push({
          kind: "summon_officer",
          needsText: false,
          officerId: officer.id,
          subjectId: subject.id,
          purpose: "protect",
          label: `Send ${officer.name} the ${officer.occupation} to keep the peace around ${subject.name}`,
          detail: "The watch coming out deters a gathering crowd and calms the household, but it is a public act and not everyone will thank you for it."
        });
        moves.push({
          kind: "summon_officer",
          needsText: false,
          officerId: officer.id,
          subjectId: subject.id,
          purpose: "investigate",
          label: `Send ${officer.name} the ${officer.occupation} to look into the matter concerning ${subject.name}`,
          detail: "An officer asking questions can settle what is true, but being investigated frightens people and can harden a quarrel."
        });
      }
    }
    for (const role of ["steward", "lord"]) {
      const definition = EXTERNAL_ROLES[role];
      if (!definition) continue;
      const alreadySent = state.eventQueue.some((event) => (
        event.type === "external_visit" && event.role === role
      ));
      if (alreadySent) continue;
      moves.push({
        kind: "petition_authority",
        needsText: true,
        role,
        label: `Send word to the ${definition.title}`,
        detail: `${definition.authority || ""} ${role === "lord"
          ? "He is three days in answering and will not thank you for a small matter."
          : "He will come within a day."} Write what you are asking him to settle.`.trim()
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
    let gives = [];
    if (move.allowsGifts && Array.isArray(choice.gives)) {
      const byKey = new Map(move.stores.map((row) => [row.key, row]));
      for (const gift of choice.gives.slice(0, 4)) {
        const row = byKey.get(gift?.resource);
        const amount = Math.floor(Number(gift?.amount) || 0);
        if (!row) {
          return { ok: false, error: `The church keeps no "${gift?.resource}". Choose from: ${[...byKey.keys()].join(", ")}.` };
        }
        if (amount <= 0 || amount > row.left) {
          return { ok: false, error: `The church has ${row.left} ${row.unit} of ${row.label.toLowerCase()}; ${amount} cannot be given.` };
        }
        gives.push({ resource: row.key, amount });
      }
    }
    return { ok: true, move, text: text.slice(0, 600), gives, reason };
  }
  return { ok: true, move, reason };
}

export function buildAgentPrompt(state, moves, { steer = "", recent = [], persona = null } = {}) {
  const board = describeBoard(state);
  const lines = [
    "You are playing the priest in a 16th-century English village parish simulation.",
    "You counsel whoever comes to you. What you say changes what people do afterwards, and those consequences accumulate over weeks.",
    ""
  ];
  if (persona?.description) {
    lines.push(
      `WHO YOU ARE: ${persona.description}`,
      "Play this priest honestly, including where his instincts serve the parish badly. Do not soften him into a neutral counsellor.",
      ""
    );
  }
  lines.push(
    "You see exactly what a human player sees on screen, and nothing more. People keep things from you until they trust you.",
    "",
    "WHAT YOU CANNOT DO: you never leave the church. You cannot call on anyone, walk to a cottage, go to the mill, or accompany someone anywhere. Everything you do, you do from this building. If someone needs to be spoken to, send for them with the move that asks them to come, or send an officer who can go where you cannot. Do not promise to go somewhere yourself.",
    "",
    "BOARD:",
    JSON.stringify(board, null, 1),
    "",
    "LEGAL MOVES — you may only choose one of these, by index:",
    ...moves.map((move) => `[${move.index}] ${move.label}\n      ${move.detail}${move.themes ? `\n      themes: ${move.themes.join(", ")}` : ""}`),
    ""
  );
  if (recent.length) {
    lines.push("YOUR LAST FEW MOVES (do not simply repeat them):", ...recent.slice(-5).map((entry) => `- ${entry}`), "");
  }
  if (steer) {
    lines.push(`THE PERSON WATCHING ASKS YOU TO: ${steer}`, "");
  }
  lines.push(
    "Choose one move and reply with JSON only:",
    '{"move": <index>, "text": "<what you say, if the move needs words>", "theme": "<sermon theme, only for a sermon>", "gives": [{"resource":"bread","amount":2}], "reason": "<one sentence on why>"}',
    "",
    "Use \"gives\" only when you are handing something over from the church stores as you speak, and say so in your words as well. It is one act, not two.",
    "Give only what answers the need actually in front of you, and say in your reason why that thing helps this person now. Medicine is for the sick, food for the hungry, firewood for the cold or the ill, coin for debt or restitution. Handing a man firewood because he is unhappy is not charity, it is waste, and the stores are finite.",
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
