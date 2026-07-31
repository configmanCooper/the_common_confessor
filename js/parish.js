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
