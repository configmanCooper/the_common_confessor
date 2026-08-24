/* ===========================================================================
   The life of the village between visits
   ---------------------------------------------------------------------------
   A villager who leaves the church having decided something does not do it in
   the doorway. He goes home, thinks better of it or does not, and acts on
   Thursday. The person he acts upon then has to answer, and the person *they*
   turn to has to answer in turn, and that is how a quiet word in a confessional
   ends up rearranging three households a fortnight later.

   This file owns that: intentions with a day attached, resolved when the day
   comes, each one able to provoke an answer that is itself scheduled a day or
   two further out. The engine already knows how to *perform* a hundred kinds of
   act - applyAction does that - so nothing here duplicates it. What lives here
   is when a thing happens, who answers it, and how far the ripple travels.

   Three rules keep it from becoming noise:

     Every intention names its cause, so any event can be traced back through
     the chain to the sentence in the church that started it.

     A chain has a depth and it runs out. Without that, one kind word would
     ripple through two hundred people forever.

     People act from what they are and what has happened to them, never from a
     dice roll alone. A generous man with food helps; a frightened man with none
     steals; a man whose brother was beaten last week does not simply forget.
   =========================================================================== */

import { ACTION_TYPES } from "./data.js";

function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

/* Deterministic, seeded on the parties and the day, so a replayed parish makes
   exactly the same choices. */
function socialRoll(state, ...parts) {
  let hash = 2166136261;
  for (const character of `${state.seed}:social:${parts.join(":")}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash % 10000) / 10000;
}

/* How far a single word is allowed to travel. Three is the depth the game has
   always promised: the person the priest spoke to, whoever they act upon, and
   whoever answers that. */
export const MAX_CHAIN_DEPTH = 3;

/* What one act provokes in the person it was done to, and in those watching.
   The point of the table is that answers are in kind but not identical: shown
   kindness, most people return it, but a proud man is embarrassed by it and a
   desperate one asks for more. */
const ANSWERS = Object.freeze({
  share_food: [
    { action: "comfort", weight: 3, mood: "grateful" },
    { action: "share_food", weight: 2, mood: "grateful", needsTrait: "generous" },
    { action: "gossip", weight: 1, mood: "grateful" }
  ],
  lend_money: [
    { action: "work_harder", weight: 3, mood: "resolved" },
    { action: "comfort", weight: 1, mood: "grateful" }
  ],
  shelter: [
    { action: "comfort", weight: 3, mood: "grateful" },
    { action: "organize_aid", weight: 1, mood: "resolved" }
  ],
  comfort: [
    { action: "comfort", weight: 2, mood: "grateful" },
    { action: "pray_with", weight: 2, mood: "hopeful" },
    { action: "apologize", weight: 1, mood: "ashamed" }
  ],
  apologize: [
    { action: "forgive", weight: 4, mood: "relieved" },
    { action: "reconcile", weight: 2, mood: "relieved" },
    { action: "keep_silence", weight: 1, mood: "resentful" }
  ],
  forgive: [
    { action: "reconcile", weight: 3, mood: "relieved" },
    { action: "repent", weight: 1, mood: "ashamed" }
  ],
  reconcile: [{ action: "celebrate", weight: 2, mood: "relieved" }],
  court: [
    { action: "court", weight: 4, mood: "hopeful" },
    { action: "keep_silence", weight: 2, mood: "uncertain" }
  ],
  marry: [{ action: "celebrate", weight: 3, mood: "joyful" }],
  protect: [{ action: "comfort", weight: 2, mood: "grateful" }],
  organize_aid: [{ action: "donate", weight: 2, mood: "resolved" }],
  teach: [{ action: "work_harder", weight: 3, mood: "resolved" }],
  heal: [{ action: "comfort", weight: 2, mood: "grateful" }],
  nurse: [{ action: "comfort", weight: 3, mood: "grateful" }],

  accuse: [
    { action: "threaten", weight: 2, mood: "furious" },
    { action: "testify", weight: 2, mood: "resolved" },
    { action: "confess_publicly", weight: 1, mood: "ashamed" }
  ],
  gossip: [
    { action: "gossip", weight: 3, mood: "excited" },
    { action: "accuse", weight: 1, mood: "furious" }
  ],
  reveal_secret: [
    { action: "begin_feud", weight: 3, mood: "furious" },
    { action: "leave_village", weight: 1, mood: "ashamed" }
  ],
  steal: [
    { action: "report_crime", weight: 3, mood: "furious" },
    { action: "accuse", weight: 2, mood: "furious" },
    { action: "begin_feud", weight: 1, mood: "resentful" }
  ],
  threaten: [
    { action: "report_crime", weight: 2, mood: "afraid" },
    { action: "threaten", weight: 2, mood: "furious" },
    { action: "keep_silence", weight: 2, mood: "afraid" }
  ],
  assault: [
    { action: "report_crime", weight: 3, mood: "furious" },
    { action: "begin_feud", weight: 3, mood: "furious" },
    { action: "assault", weight: 1, mood: "furious", needsTrait: "vengeful" }
  ],
  begin_feud: [
    { action: "begin_feud", weight: 3, mood: "resentful" },
    { action: "make_peace", weight: 1, mood: "weary" }
  ],
  betray: [
    { action: "begin_feud", weight: 3, mood: "furious" },
    { action: "accuse", weight: 2, mood: "furious" }
  ],
  evict: [
    { action: "leave_village", weight: 2, mood: "despairing" },
    { action: "protest", weight: 2, mood: "furious" }
  ],
  vandalize: [{ action: "report_crime", weight: 3, mood: "furious" }],
  expel: [{ action: "protest", weight: 2, mood: "furious" }],
  separate: [{ action: "mourn", weight: 2, mood: "grieving" }],
  divorce: [{ action: "mourn", weight: 2, mood: "grieving" }]
});

/* Which acts a person might undertake unprompted, and what makes them likely.
   Each reads the actor's real condition rather than a label, so the village
   behaves differently when it is hungry, frightened, or content.

   The thresholds below are set against what this parish's figures actually do,
   not against what round numbers suggest they might. Measured over a settled
   village: food runs 38-64, resentment tops out near 35, attraction near 45,
   morale sits around 56. Writing "resentment > 60" reads well and can never
   once be true, which is how a first draft of this file left the whole village
   inert except for the one impulse whose threshold happened to be reachable. */
const IMPULSES = Object.freeze([
  {
    action: "share_food",
    wants: (state, person, household, bond, other, otherHousehold) => {
      if (!household || !otherHousehold) return 0;
      /* Relative want, not an absolute line: a fuller house beside an emptier
         one, which is a thing that happens every week in a real village. */
      const gap = household.food - otherHousehold.food;
      if (gap < 8) return 0;
      return Math.min(0.7, gap / 30) + ((person.personality?.traits || []).includes("generous") ? 0.3 : 0);
    },
    mood: "kindly"
  },
  {
    action: "nurse",
    wants: (state, person, household, bond, other) => (
      other.illness || other.injury ? 0.4 + Math.max(0, (bond.affection ?? 0) - 30) / 70 : 0
    ),
    mood: "concerned"
  },
  {
    action: "comfort",
    wants: (state, person, household, bond, other) => (
      other.morale < 48 && (bond.affection ?? 0) > 38
        ? 0.25 + (48 - other.morale) / 40
        : 0
    ),
    mood: "kindly"
  },
  {
    action: "court",
    wants: (state, person, household, bond, other) => (
      person.maritalStatus === "single" && other.maritalStatus === "single"
        && person.age >= 17 && other.age >= 17 && person.age <= 55
        && Math.abs(person.age - other.age) <= 14
        && person.sex !== other.sex
        && (bond.attraction ?? 0) > 28
        ? 0.3 + ((bond.attraction ?? 0) - 28) / 40
        : 0
    ),
    mood: "hopeful"
  },
  {
    action: "marry",
    wants: (state, person, household, bond, other) => {
      /* There is no "courting" status in this village; courtship shows itself
         as attraction climbing past what any pair start with. Natural
         attraction tops out around 45, and each courtship adds to it, so a
         bond above that has been actively courted and is ready to be asked. */
      if (person.maritalStatus !== "single" || other.maritalStatus !== "single") return 0;
      if (person.spouseId != null || other.spouseId != null) return 0;
      if (person.age < 17 || other.age < 17 || person.sex === other.sex) return 0;
      if (Math.abs(person.age - other.age) > 14) return 0;
      const attraction = bond.attraction ?? 0;
      const affection = bond.affection ?? 0;
      if (attraction < 52 || affection < 45) return 0;
      return 0.45 + (attraction - 52) / 60;
    },
    mood: "joyful"
  },
  {
    action: "gossip",
    wants: (state, person, household, bond, other) => (
      /* Talk needs something to be about: a rift, a poor name, or a grievance. */
      ((bond.resentment ?? 0) > 22 || (other.reputation ?? 60) < 48)
        ? ((person.personality?.traits || []).includes("gossipy") ? 0.28 : 0.09)
        : 0
    ),
    mood: "idle"
  },
  {
    action: "steal",
    wants: (state, person, household, bond, other, otherHousehold) => (
      household && otherHousehold
        && household.food < 45 && otherHousehold.food - household.food > 10
        && person.faith < 50
        ? 0.12 + (45 - household.food) / 40
        : 0
    ),
    mood: "desperate"
  },
  {
    action: "threaten",
    wants: (state, person, household, bond) => (
      (bond.resentment ?? 0) > 26 && person.stress > 52
        ? 0.15 + ((bond.resentment ?? 0) - 26) / 25
        : 0
    ),
    mood: "furious"
  },
  {
    action: "make_peace",
    wants: (state, person, household, bond) => (
      (bond.resentment ?? 0) > 18 && person.faith > 55 && person.trustPriest > 52
        ? 0.3 + Math.max(0, person.faith - 55) / 60
        : 0
    ),
    mood: "weary"
  },
  {
    action: "organize_aid",
    wants: (state, person) => (
      /* Kept deliberately modest: it was the only impulse that could fire in
         the first draft, and it drowned out everything else. */
      person.faith > 68 && person.morale > 60 && (state.town.metrics.mercy ?? 50) > 52 ? 0.16 : 0
    ),
    mood: "resolved"
  },
  {
    action: "teach",
    wants: (state, person, household, bond, other) => (
      person.age > 30 && other.age < 25 && (bond.familiarity ?? 0) > 45
        && ["teacher", "scribe", "clerk", "carpenter", "mason", "blacksmith", "weaver"].includes(person.occupation)
        ? 0.3 : 0
    ),
    mood: "patient"
  },
  {
    action: "lend_money",
    wants: (state, person, household, bond, other, otherHousehold) => (
      household && otherHousehold
        && household.wealth - otherHousehold.wealth > 4
        && (otherHousehold.debt ?? 0) > 0
        && (bond.affection ?? 0) > 40 ? 0.3 : 0
    ),
    mood: "obliging"
  },
  {
    action: "pray_with",
    wants: (state, person, household, bond, other) => (
      person.faith > 62 && (other.morale < 52 || other.illness) && (bond.familiarity ?? 0) > 40
        ? 0.22 : 0
    ),
    mood: "devout"
  }
]);

export function upgradeSocialState(state) {
  state.intentions ||= [];
  state.nextIntentionSequence ||= 1;
  state.socialLog ||= [];
  return state;
}

/**
 * Set someone to do something, on a day, for a reason.
 *
 * Nothing happens now. The intention sits in the parish until its day comes,
 * which is what lets a conversation on Monday rearrange a household on Friday.
 */
export function scheduleIntention(state, {
  actorId,
  targetId = null,
  actionType,
  dueDay,
  motive = "",
  causeEventId = null,
  causeSummary = "",
  depth = 1,
  intensity = 2
} = {}) {
  upgradeSocialState(state);
  if (!ACTION_TYPES.includes(actionType)) return null;
  if (depth > MAX_CHAIN_DEPTH) return null;
  const actor = state.residents.find((entry) => entry.id === actorId);
  if (!actor?.active || !actor.alive) return null;
  if (targetId && targetId !== "priest") {
    const target = state.residents.find((entry) => entry.id === targetId);
    if (!target?.active || !target.alive) return null;
  }
  /* One errand at a time between the same two people. A man does not resolve
     to help his neighbour three times over because three things reminded him. */
  if (state.intentions.some((entry) => (
    entry.status === "pending"
      && entry.actorId === actorId
      && entry.targetId === targetId
      && entry.actionType === actionType
  ))) return null;

  const intention = {
    id: `intention-${String(state.nextIntentionSequence++).padStart(6, "0")}`,
    actorId,
    targetId,
    actionType,
    dueDay: Math.max(state.calendar.absoluteDay, Math.floor(dueDay)),
    intensity: clamp(intensity, 1, 5),
    motive: String(motive).slice(0, 160),
    causeEventId,
    causeSummary: String(causeSummary).slice(0, 200),
    depth,
    status: "pending"
  };
  state.intentions.push(intention);
  return intention;
}

/* Second thoughts. Between deciding and doing, a person may lose their nerve,
   be talked out of it, or simply find the moment has passed. */
function stillMeansIt(state, intention, actor, target) {
  const roll = socialRoll(state, intention.id, "resolve", state.calendar.absoluteDay);
  let resolve = 0.72;
  if (["assault", "steal", "kill_person", "threaten", "betray", "vandalize"].includes(intention.actionType)) {
    /* Harm is the easiest thing to think better of, and faith and a trusted
       priest are exactly what makes a man think better of it. */
    resolve -= 0.25;
    resolve -= Math.max(0, actor.faith - 50) / 200;
    resolve -= Math.max(0, actor.trustPriest - 50) / 220;
    resolve += Math.max(0, actor.stress - 55) / 130;
  }
  if (["marry", "court", "reconcile", "forgive", "apologize"].includes(intention.actionType)) {
    resolve += Math.max(0, actor.morale - 50) / 200;
  }
  if (target && target.id !== "priest" && (!target.active || !target.alive)) return false;
  return roll < clamp(resolve, 0.05, 0.95);
}

/** What the person it was done to does about it, a day or two later. */
function scheduleAnswer(state, intention, actor, target, appliedEvent) {
  if (!target || target.id === "priest") return null;
  if (intention.depth >= MAX_CHAIN_DEPTH) return null;
  return scheduleSocialAnswer(state, {
    actorId: target.id,
    subjectId: actor.id,
    actionType: intention.actionType,
    causeEventId: appliedEvent?.id ?? intention.causeEventId,
    causeSummary: `answering ${actor.name} over ${intention.actionType.replace(/_/g, " ")}`,
    depth: intention.depth,
    intensity: intention.intensity,
    seed: intention.id
  });
}

/**
 * Somebody has had something done to them. Decide what, if anything, they do
 * back, and set them to do it in a day or two.
 *
 * Shared by the two places an act can come from: a visitor carrying out what
 * they resolved on in the church, and the village's own ordinary life.
 */
export function scheduleSocialAnswer(state, {
  actorId,
  subjectId,
  actionType,
  causeEventId = null,
  causeSummary = "",
  depth = 1,
  intensity = 2,
  seed = null
} = {}) {
  upgradeSocialState(state);
  if (depth >= MAX_CHAIN_DEPTH) return null;
  const answerer = state.residents.find((entry) => entry.id === actorId);
  if (!answerer?.active || !answerer.alive) return null;
  const options = ANSWERS[actionType];
  if (!options?.length) return null;

  const key = seed || `${actorId}:${subjectId}:${actionType}:${state.calendar.absoluteDay}`;
  const traits = answerer.personality?.traits || [];
  const pool = options.filter((option) => !option.needsTrait || traits.includes(option.needsTrait));
  if (!pool.length) return null;

  /* Not everything is answered. A person absorbed in their own trouble lets it
     go, and a slight is often simply borne. */
  if (socialRoll(state, key, "answers-at-all") > 0.72) return null;

  const total = pool.reduce((sum, option) => sum + option.weight, 0);
  let pick = socialRoll(state, key, "answer") * total;
  const chosen = pool.find((option) => (pick -= option.weight) < 0) || pool[0];

  return scheduleIntention(state, {
    actorId,
    targetId: subjectId,
    actionType: chosen.action,
    dueDay: state.calendar.absoluteDay + 1 + Math.floor(socialRoll(state, key, "answer-delay") * 3),
    motive: chosen.mood,
    causeEventId,
    causeSummary,
    depth: depth + 1,
    intensity
  });
}

/**
 * Carry out everything the village meant to do today.
 *
 * `perform` is the engine's own applyAction, passed in rather than imported so
 * this file never reaches back into the simulation and create a cycle.
 */
export function resolveDueIntentions(state, perform) {
  upgradeSocialState(state);
  const today = state.calendar.absoluteDay;
  const done = [];

  for (const intention of state.intentions) {
    if (intention.status !== "pending" || intention.dueDay > today) continue;
    const actor = state.residents.find((entry) => entry.id === intention.actorId);
    const target = intention.targetId === "priest"
      ? { id: "priest", name: "Father Benedict" }
      : state.residents.find((entry) => entry.id === intention.targetId);

    if (!actor?.active || !actor.alive) {
      intention.status = "lapsed";
      continue;
    }
    if (!stillMeansIt(state, intention, actor, target)) {
      intention.status = "thought_better_of_it";
      continue;
    }

    const result = perform(state, {
      actorId: intention.actorId,
      targetId: intention.targetId,
      actionType: intention.actionType,
      intensity: intention.intensity,
      motive: intention.motive,
      title: `${actor.name} ${intention.actionType.replace(/_/g, " ")}${target ? ` — ${target.name}` : ""}`,
      causeEventId: intention.causeEventId
    });

    intention.status = result ? "done" : "failed";
    if (!result) continue;

    const entry = {
      id: intention.id,
      day: today,
      week: state.calendar.week,
      actorId: actor.id,
      actorName: actor.name,
      targetId: target?.id ?? null,
      targetName: target?.name ?? null,
      actionType: intention.actionType,
      motive: intention.motive,
      depth: intention.depth,
      causeEventId: intention.causeEventId,
      causeSummary: intention.causeSummary,
      eventId: result.eventId ?? result.id ?? null
    };
    state.socialLog.push(entry);
    done.push(entry);

    scheduleAnswer(state, intention, actor, target, result);
  }

  /* The log is the player's memory of the village, so it is kept long, but not
     forever. */
  if (state.socialLog.length > 600) state.socialLog = state.socialLog.slice(-600);
  state.intentions = state.intentions.filter((entry) => (
    entry.status === "pending" || entry.dueDay >= today - 30
  ));
  return done;
}

/**
 * The week's ordinary social life, settled after the Sunday sermon.
 *
 * Everybody in the parish is considered against the people they actually have a
 * bond with, and those who have reason to act are set to do so during the week
 * ahead. This is what keeps the village moving when the priest is not looking.
 */
export function planWeeklySocialLife(state, { limit = 18 } = {}) {
  upgradeSocialState(state);
  const planned = [];
  const bonds = (state.relationships || []).slice();

  /* Considered in a fixed order so a replay makes the same village. */
  bonds.sort((left, right) => String(left.id).localeCompare(String(right.id)));

  for (const bond of bonds) {
    if (planned.length >= limit) break;
    const actor = state.residents.find((entry) => entry.id === bond.actorId);
    const other = state.residents.find((entry) => entry.id === bond.targetId);
    if (!actor?.active || !actor.alive || !other?.active || !other.alive) continue;
    if (actor.age < 14 || other.age < 14) continue;

    const household = state.households.find((entry) => entry.id === actor.householdId);
    const otherHousehold = state.households.find((entry) => entry.id === other.householdId);

    let best = null;
    let bestWeight = 0;
    for (const impulse of IMPULSES) {
      const want = impulse.wants(state, actor, household, bond, other, otherHousehold);
      if (want <= 0) continue;
      /* Familiarity decides whether they would act on it at all. */
      const weight = want * (0.4 + (bond.familiarity ?? 40) / 160);
      if (weight > bestWeight) {
        bestWeight = weight;
        best = impulse;
      }
    }
    if (!best) continue;
    if (socialRoll(state, bond.id, "weekly", state.calendar.week) > bestWeight) continue;

    const intention = scheduleIntention(state, {
      actorId: actor.id,
      targetId: other.id,
      actionType: best.action,
      dueDay: state.calendar.absoluteDay + 1 + Math.floor(socialRoll(state, bond.id, "when", state.calendar.week) * 6),
      motive: best.mood,
      causeSummary: "the ordinary life of the village",
      depth: 1
    });
    if (intention) planned.push(intention);
  }
  return planned;
}

/** What the priest can be told about, and what the player can read afterwards. */
export function recentSocialLog(state, { limit = 60, personId = null } = {}) {
  upgradeSocialState(state);
  return state.socialLog
    .filter((entry) => !personId || entry.actorId === personId || entry.targetId === personId)
    .slice(-limit)
    .reverse();
}
