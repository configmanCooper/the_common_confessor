import { addStructuredMemory } from "./conversation.js";

function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

export function upgradeParishState(state) {
  state.parishFactions ||= [
    { id: "traditionalists", name: "Traditionalists", memberIds: [], influence: 50 },
    { id: "reformers", name: "Reformers", memberIds: [], influence: 35 },
    { id: "brotherhood", name: "Brotherhood of Mercy", memberIds: [], influence: 40 }
  ];
  for (const faction of state.parishFactions) faction.memberIds = [];
  for (const person of state.residents) {
    if (person.alive === false) continue;
    const identityHash = [...person.id].reduce((total, character) => (total * 33 + character.charCodeAt(0)) >>> 0, 5381);
    const faction = person.faith >= 65
      ? state.parishFactions[0]
      : identityHash % 100 < 20 || person.faith < 40
        ? state.parishFactions[1]
        : state.parishFactions[2];
    faction.memberIds.push(person.id);
  }
  state.sermonReactions ||= [];
  return state;
}

export function attendanceReason(state, person, roll) {
  if (!person.alive || !person.active) return "not living in the parish";
  if (person.illness && person.health < 45) return "too ill to attend";
  if (person.flags.includes("under_arrest")) return "held by the sheriff";
  if (person.trustPriest < 20 || person.attendanceChance < 25) return "avoids the priest";
  if (roll > person.attendanceChance) return person.occupation === "farmer" ? "work could not wait" : "remained at home";
  return "attending";
}

export function sermonConsistency(state, theme, text) {
  const speech = `${theme} ${text}`.toLowerCase();
  const latest = state.priest.positions.filter((position) => position.publicPosition === true);
  let score = 70;
  const themeIntent = {
    Mercy: "forgiveness",
    Forgiveness: "forgiveness",
    Justice: "judgment",
    Repentance: "truth",
    Duty: "work",
    Family: "family"
  }[theme];
  const contradictions = {
    forgiveness: "judgment",
    judgment: "forgiveness",
    truth: "secrecy",
    secrecy: "truth"
  };
  if (themeIntent && contradictions[themeIntent]) {
    const relevant = latest.filter((position) => [themeIntent, contradictions[themeIntent]].includes(position.intent));
    if (relevant.at(-1)?.intent === contradictions[themeIntent]) score -= 18;
  }
  if (latest.some((position) => speech.includes(position.intent))) score += 8;
  return clamp(score);
}

/* =========================================================================
   What a sermon actually does to people
   -------------------------------------------------------------------------
   A sermon is not a broadcast that nudges a town statistic. It is one man
   speaking for a few minutes to a room containing everyone he serves, and what
   it does depends almost entirely on who is sitting in that room and what is
   presently wrong in their lives.

   Three things decide it, and they multiply rather than add, because any one
   of them at zero means nothing happened:

     force        how well he preached and whether the parish believes him
     receptivity  whether this person was ever going to listen
     relevance    whether he was, however unknowingly, talking about them

   Relevance is what makes the system worth having. A sermon on forgiveness
   spoken to a congregation containing a woman locked in a feud lands on her
   with several times the weight it lands on anyone else, and if she has sat
   opposite the priest and told him about it, more again — she knows he knows.
   ========================================================================= */

const STOP_WORDS = new Set([
  "the", "and", "for", "that", "with", "you", "your", "our", "his", "her", "who", "not",
  "but", "are", "was", "were", "have", "has", "had", "this", "these", "those", "them",
  "they", "will", "shall", "must", "from", "into", "upon", "when", "what", "which",
  "there", "their", "then", "than", "been", "would", "could", "should", "may", "all",
  "any", "one", "man", "men", "let", "him", "she", "how", "why", "own", "out", "off"
]);

function tokenise(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .split(/[^a-z']+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
  );
}

/* The ideas each theme carries, so a sermon counts as being about mercy even
   when the priest never says the word. */
const THEME_CONCEPTS = Object.freeze({
  Mercy: ["mercy", "forgive", "forgiven", "pity", "spare", "gentle", "kindness", "compassion", "grace"],
  Forgiveness: ["forgive", "forgiven", "pardon", "reconcile", "peace", "grudge", "feud", "apology", "mercy"],
  Repentance: ["repent", "sin", "confess", "confession", "penance", "sorry", "amend", "guilt", "shame"],
  Charity: ["charity", "alms", "give", "poor", "hungry", "need", "share", "bread", "generous", "help"],
  Duty: ["duty", "work", "labour", "labor", "obedience", "office", "service", "faithful", "keep"],
  Family: ["family", "wife", "husband", "child", "children", "mother", "father", "household", "marriage", "kin"],
  Justice: ["justice", "just", "theft", "stolen", "steal", "wrong", "punish", "judge", "court", "truth", "guilty"],
  Humility: ["humble", "humility", "pride", "proud", "boast", "meek", "lowly"],
  Hope: ["hope", "hopeful", "comfort", "morning", "endure", "promise", "despair", "grief", "sorrow"],
  Community: ["neighbour", "neighbor", "together", "parish", "village", "common", "quarrel", "unity", "help"],
  Temperance: ["temperance", "drink", "drunk", "ale", "restraint", "moderate", "appetite", "excess"],
  Courage: ["courage", "brave", "fear", "afraid", "stand", "speak", "danger", "bold"]
});

/* Circumstances a sermon can speak to, and the words that reach them. Each is
   tested against the person's real state, never against a label. */
const CIRCUMSTANCES = Object.freeze([
  {
    id: "sickness",
    words: ["sick", "ill", "illness", "fever", "healing", "heal", "suffer", "suffering", "body", "pain", "dying", "death"],
    applies: (state, person) => Boolean(person.illness) || person.health < 45,
    describe: (person) => `${person.firstName} is ill`
  },
  {
    id: "grief",
    words: ["grief", "grieve", "mourn", "dead", "death", "died", "loss", "buried", "comfort", "sorrow"],
    applies: (state, person) => (person.memories || []).some((memory) => /died|death|buried|lost/i.test(memory.summary || "")),
    describe: (person) => `${person.firstName} has lost someone`
  },
  {
    id: "want",
    words: ["hungry", "hunger", "bread", "food", "poor", "poverty", "need", "cold", "winter", "alms", "charity"],
    applies: (state, person, household) => Boolean(household) && (household.food < 35 || household.wealth < 22),
    describe: (person) => `${person.firstName}'s household is going short`
  },
  {
    id: "debt",
    words: ["debt", "owe", "owed", "lend", "money", "coin", "usury", "creditor", "rent"],
    applies: (state, person, household) => Boolean(household) && household.debt > 6,
    describe: (person) => `${person.firstName} is in debt`
  },
  {
    id: "marriage",
    words: ["marriage", "wife", "husband", "wed", "vow", "vows", "faithful", "family", "home", "household"],
    applies: (state, person) => person.maritalStatus === "married",
    describe: (person) => `${person.firstName} is married`
  },
  {
    id: "children",
    words: ["child", "children", "son", "daughter", "young", "raise", "mother", "father", "born"],
    applies: (state, person) => (person.childrenIds || []).length > 0 || person.pregnantDueDay != null,
    describe: (person) => `${person.firstName} has children to raise`
  },
  {
    id: "shame",
    words: ["shame", "sin", "guilt", "secret", "hidden", "confess", "repent", "gossip", "reputation", "slander"],
    applies: (state, person) => person.reputation < 40 || (person.memories || []).some((memory) => memory.type === "confession"),
    describe: (person) => `${person.firstName} has something weighing on them`
  },
  {
    id: "quarrel",
    words: ["quarrel", "feud", "anger", "angry", "enemy", "forgive", "peace", "reconcile", "grudge", "neighbour", "neighbor"],
    applies: (state, person) => (state.relationships || []).some((bond) => (
      (bond.actorId === person.id || bond.targetId === person.id)
        && ((bond.resentment ?? 0) > 55 || (bond.affection ?? 50) < 22)
    )),
    describe: (person) => `${person.firstName} is at odds with someone`
  },
  {
    id: "toil",
    words: ["work", "labour", "labor", "toil", "weary", "harvest", "field", "trade", "craft", "wages"],
    applies: (state, person) => person.stress > 60,
    describe: (person) => `${person.firstName} is worn down by work`
  }
]);

/* How well it was preached, and whether this parish is inclined to believe it.
   A short mumble from a disgraced priest moves nobody; a well-made sermon from
   a man they trust can move a great many. */
export function sermonForce(state, text, consistency) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  /* Too few words says nothing; the hundred-word limit is the natural best. */
  const craft = Math.min(1, words / 55) * (words > 12 ? 1 : 0.5);
  const standing = (state.priest.moralAuthority * 0.5 + state.priest.localTrust * 0.5) / 100;
  const scandal = 1 - state.priest.scandal / 140;
  return Math.max(0, craft * (0.35 + standing * 0.95) * scandal * (0.55 + consistency / 100 * 0.6));
}

/** Whether the sermon was, in truth, about this person. */
export function sermonRelevance(state, person, theme, spokenWords, household) {
  const concepts = THEME_CONCEPTS[theme] || [];
  const reasons = [];
  let score = 0.05;

  for (const circumstance of CIRCUMSTANCES) {
    if (!circumstance.applies(state, person, household)) continue;
    const spoken = circumstance.words.filter((word) => spokenWords.has(word)).length;
    const thematic = circumstance.words.filter((word) => concepts.includes(word)).length;
    if (!spoken && !thematic) continue;
    /* The theme counts for something, but only a little. What decides whether a
       sermon was about this person is what the priest actually said, not which
       word he picked from a list beforehand — otherwise the writing would be
       decoration and the dropdown would be the game. */
    score += Math.min(0.12, thematic * 0.035) + Math.min(0.4, spoken * 0.14);
    if (spoken) reasons.push(circumstance.describe(person));
  }

  /* Whatever they came to him about is the thing they are listening for. */
  for (const thread of state.issueThreads || []) {
    if (thread.status === "resolved") continue;
    if (!(thread.subjectIds || []).includes(person.id)) continue;
    const anchors = new Set();
    for (const fact of thread.facts || []) for (const anchor of fact.anchors || []) anchors.add(String(anchor).toLowerCase());
    for (const word of tokenise(thread.summary)) anchors.add(word);
    const hits = [...anchors].filter((anchor) => spokenWords.has(anchor)).length;
    if (hits > 0) {
      score += Math.min(0.5, hits * 0.16);
      reasons.push(`it spoke to what he already knows: ${String(thread.summary || "their trouble").replace(/\.$/, "")}`);
    }
  }

  return { score: Math.min(1.35, score), reasons };
}

/* How much of this the parish has heard already.

   A congregation that has been given the same sermon eight Sundays running is
   not moved on the eighth as it was on the first. This is what stops a priest
   from finding one good sermon and preaching it until the whole village is a
   saint, and it quietly rewards a man who pays attention to what his parish
   actually needs this week rather than what worked last week. */
export function sermonNovelty(state, theme, spokenWords) {
  /* The sermon being preached has already been written into the record by the
     time this runs, so it must be left out or every sermon would count as a
     word-perfect repeat of itself. */
  const today = state.calendar?.absoluteDay ?? 0;
  const recent = (state.sermons || []).filter((sermon) => sermon.day < today).slice(-6);
  if (!recent.length) return 1;
  let staleness = 0;
  for (const [index, sermon] of recent.entries()) {
    /* The most recent sermons are the ones still in their ears. */
    const recency = (index + 1) / recent.length;
    const previous = tokenise(sermon.text);
    if (!previous.size) continue;
    let shared = 0;
    for (const word of previous) if (spokenWords.has(word)) shared += 1;
    const overlap = shared / previous.size;
    staleness += recency * (overlap * 0.8 + (sermon.theme === theme ? 0.2 : 0));
  }
  return clamp(1 - staleness * 0.42, 0.18, 1);
}

/**
 * Work the sermon through the congregation, person by person, and return an
 * account of everyone it moved and why. Mutates the people it moves.
 */
export function resolveSermonImpact(state, theme, text, attendees, consistency, reactions) {
  /* Only what the priest actually wrote. The theme is weighed separately and
     far more lightly inside sermonRelevance; folding its words in here would
     let the dropdown masquerade as the sermon, and would credit the priest with
     naming troubles he never mentioned. */
  const spokenWords = tokenise(text);
  const novelty = sermonNovelty(state, theme, spokenWords);
  const force = sermonForce(state, text, consistency) * novelty;
  const reactionOf = new Map((reactions || []).map((entry) => [entry.personId, entry.reaction]));
  const affected = [];

  for (const person of attendees) {
    const household = state.households.find((entry) => entry.id === person.householdId);
    const relevance = sermonRelevance(state, person, theme, spokenWords, household);

    /* Some people were never going to be moved, and a few were always going to
       be. Piety and trust decide most of it; a grudge against the priest turns
       even a good sermon sour. */
    const piety = (person.materialized ? person.personality.piety : person.faith) / 100;
    const traits = person.personality?.traits || [];
    let receptivity = 0.35 + piety * 0.55 + (person.trustPriest - 50) / 190;
    if (traits.includes("devout")) receptivity += 0.2;
    if (traits.includes("skeptical") || traits.includes("cynical")) receptivity -= 0.22;
    if (traits.includes("resentful") || traits.includes("stubborn")) receptivity -= 0.14;
    if (traits.includes("gentle") || traits.includes("loyal")) receptivity += 0.08;

    /* Sitting across a table from a man changes what his words weigh. Those who
       have brought him their troubles hear a sermon as half addressed to them,
       and hear it again in his voice from that room. */
    const acquaintance = person.visitCount > 0
      ? 1.35 + Math.min(0.55, person.visitCount * 0.18)
      : 1;

    const impact = force * Math.max(0, receptivity) * relevance.score * acquaintance;
    if (impact < 0.085) continue;

    /* A sermon can wound as well as heal. A man with no faith in this priest,
       hearing him preach at a trouble he already knows the priest mishandled,
       comes away angrier than he went in. */
    const resentful = reactionOf.get(person.id) === "resentful"
      || (person.trustPriest < 30 && state.priest.scandal > 40);
    const direction = resentful ? -1 : 1;
    /* Weight lands where it belongs. A sermon that merely passed over someone
       leaves a trace; one that named their trouble to the whole parish is an
       event in their life, so impact tells rather than averages. */
    const scale = Math.pow(impact, 1.35) * 62;

    const before = {
      faith: person.faith,
      trustPriest: person.trustPriest,
      morale: person.morale,
      stress: person.stress
    };

    /* Diminishing returns, both ways. There is far less to be gained from
       preaching to someone whose faith is already near total than to someone
       who has almost none left, and a man who already distrusts you cannot be
       made to distrust you much further. Without this, a competent priest
       preaching weekly saturates the whole parish inside a month and nothing
       he does afterwards means anything. */
    const headroom = (value) => 0.12 + 0.88 * (direction > 0 ? (100 - value) / 100 : value / 100);

    person.faith = clamp(person.faith + direction * scale * 0.6 * headroom(person.faith));
    person.trustPriest = clamp(person.trustPriest + direction * scale * 0.5 * headroom(person.trustPriest));
    person.morale = clamp(person.morale + direction * scale * 0.45 * headroom(person.morale));
    person.stress = clamp(person.stress - direction * scale * 0.4 * headroom(100 - person.stress));
    person.attendanceChance = clamp(person.attendanceChance + direction * scale * 0.35 * headroom(person.attendanceChance));

    const deltas = {
      faith: Math.round(person.faith - before.faith),
      trust: Math.round(person.trustPriest - before.trustPriest),
      morale: Math.round(person.morale - before.morale),
      stress: Math.round(person.stress - before.stress)
    };
    if (!Object.values(deltas).some((value) => value !== 0)) continue;

    /* When a sermon genuinely speaks to a person's trouble, it does not merely
       cheer them: it takes some of the weight off the trouble itself. */
    const eased = [];
    if (direction > 0 && relevance.score > 0.5 && impact > 0.22) {
      for (const thread of state.issueThreads || []) {
        if (thread.status === "resolved" || !(thread.subjectIds || []).includes(person.id)) continue;
        const relief = Math.min(12, Math.round(impact * 22));
        thread.pressure = clamp((thread.pressure ?? 50) - relief);
        thread.danger = clamp((thread.danger ?? 0) - Math.round(relief * 0.5));
        eased.push(thread.id);
      }
    }

    affected.push({
      personId: person.id,
      name: person.name,
      occupation: person.occupation,
      knownToPriest: person.visitCount > 0,
      relevance: Math.round(relevance.score * 100) / 100,
      impact: Math.round(impact * 100) / 100,
      direction: direction > 0 ? "moved" : "hardened",
      reasons: relevance.reasons.slice(0, 3),
      deltas,
      easedThreadIds: eased
    });

    addStructuredMemory(state, person, {
      type: "sermon_reaction",
      summary: direction > 0
        ? `The ${theme.toLowerCase()} sermon spoke to me${relevance.reasons.length ? `: ${relevance.reasons[0]}` : ""}.`
        : `The ${theme.toLowerCase()} sermon set my teeth on edge.`,
      emotion: direction > 0 ? "hopeful" : "angry",
      confidence: 75
    });
  }

  affected.sort((a, b) => b.impact - a.impact);
  return { force: Math.round(force * 100) / 100, novelty: Math.round(novelty * 100) / 100, affected };
}

export function resolveCongregationReactions(state, theme, text, attendees, outcome) {

  upgradeParishState(state);
  const consistency = sermonConsistency(state, theme, text);
  const reactions = [];
  const tags = new Set(outcome?.responseTags || []);
  for (const person of attendees) {
    const faction = state.parishFactions.find((entry) => entry.memberIds.includes(person.id));
    const resonance = person.faith * 0.45 + person.trustPriest * 0.3 + consistency * 0.25;
    let reaction = resonance >= 70 ? "inspired" : resonance < 38 ? "resentful" : "reflective";
    if (faction?.id === "reformers" && theme === "Duty") reaction = "skeptical";
    reactions.push({ personId: person.id, reaction, factionId: faction?.id || null });
    addStructuredMemory(state, person, {
      type: "sermon_reaction",
      summary: `Reacted to the ${theme} sermon as ${reaction}.`,
      emotion: reaction === "resentful" ? "angry" : reaction === "inspired" ? "hopeful" : "contemplative",
      confidence: 80
    });
  }
  const leaders = Object.fromEntries(state.parishFactions.map((faction) => [
    faction.id,
    attendees.find((person) => faction.memberIds.includes(person.id)) || null
  ]));
  const events = [];
  const reactionFor = (person) => reactions.find((reaction) => reaction.personId === person?.id)?.reaction;
  if (theme === "Repentance" && consistency >= 55
    && reactionFor(leaders.traditionalists) === "inspired"
    && (tags.has("confession") || consistency >= 80)) {
    const person = leaders.traditionalists;
    if (person) events.push({ type: "public_confession", actorId: person.id, title: `${person.name} confesses publicly`, text: `${person.name} asks the congregation for forgiveness.` });
  }
  if (consistency <= 55 && leaders.reformers
    && ["resentful", "skeptical"].includes(reactionFor(leaders.reformers))
    && (tags.has("protest") || consistency <= 52)) {
    const person = leaders.reformers;
    events.push({ type: "sermon_protest", actorId: person.id, title: `${person.name} protests the sermon`, text: `${person.name} openly challenges the priest's consistency.` });
  }
  if (consistency <= 52 && leaders.traditionalists
    && ["resentful", "reflective"].includes(reactionFor(leaders.traditionalists))
    && (tags.has("disruption") || tags.has("protest"))) {
    const person = leaders.traditionalists;
    events.push({ type: "church_disruption", actorId: person.id, title: "The service is disrupted", text: `${person.name} and several others interrupt the service.` });
  }
  if (theme === "Community" && consistency >= 65
    && reactionFor(leaders.brotherhood) === "inspired"
    && (tags.has("procession") || consistency >= 85)) {
    const person = leaders.brotherhood;
    if (person) events.push({ type: "parish_procession", actorId: person.id, title: "The parish forms a procession", text: "Villagers leave the church together in a public act of unity." });
  }
  state.sermonReactions.push({
    day: state.calendar.absoluteDay,
    theme,
    consistency,
    reactions
  });
  state.sermonReactions = state.sermonReactions.slice(-52);
  return { consistency, reactions, events };
}
