import { churchResourceRows } from "./church.js";
import { WEEK_DAYS } from "./data.js";
import { completeStoredText } from "./text.js";

export const DAILY_REPORT_LIMIT = 35;
export const WEEKLY_REPORT_LIMIT = 12;
export const VISIT_ARCHIVE_LIMIT = 40;

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function reportMetricSnapshot(state) {
  const metrics = [
    ...Object.entries(state.town.metrics).map(([key, value]) => ({
      group: "Village",
      key,
      label: key[0].toUpperCase() + key.slice(1),
      value: Math.round(value),
      unit: ""
    })),
    {
      group: "Village",
      key: "food",
      label: "Food",
      value: Math.round(state.material.foodSecurity),
      unit: ""
    },
    {
      group: "Village",
      key: "infrastructure",
      label: "Infrastructure",
      value: Math.round(state.material.infrastructure),
      unit: ""
    },
    {
      group: "Village",
      key: "crime",
      label: "Crime",
      value: Math.round(100 - state.material.crime),
      unit: ""
    },
    {
      group: "Father Benedict",
      key: "trust",
      label: "Trust",
      value: Math.round(state.priest.localTrust),
      unit: ""
    },
    {
      group: "Father Benedict",
      key: "authority",
      label: "Authority",
      value: Math.round(state.priest.moralAuthority),
      unit: ""
    },
    {
      group: "Father Benedict",
      key: "scandal",
      label: "Scandal",
      value: Math.round(state.priest.scandal),
      unit: ""
    },
    {
      group: "Father Benedict",
      key: "health",
      label: "Health",
      value: Math.round(state.priest.health),
      unit: ""
    },
    ...churchResourceRows(state.churchResources).map((resource) => ({
      group: "Church stores",
      key: resource.key,
      label: resource.label,
      value: resource.amount,
      unit: resource.unit
    })),
    {
      group: "Parish",
      key: "population",
      label: "Living population",
      value: state.residents.filter((person) => person.active && person.alive).length,
      unit: "people"
    }
  ];
  return metrics;
}

function createBaseline(state, partial = false) {
  return {
    day: state.calendar.absoluteDay,
    week: state.calendar.week,
    eventSequence: state.nextEventSequence,
    metrics: reportMetricSnapshot(state),
    partial: Boolean(partial)
  };
}

export function upgradeReportingState(state, partial = false) {
  state.visitArchive ||= [];
  state.periodReports ||= [];
  state.nextPeriodReportSequence ||= state.periodReports.length + 1;
  state.material.modifiers ||= {
    foodSecurity: 0,
    grainPrice: 0,
    diseasePressure: 0,
    crime: 0,
    infrastructure: 0
  };
  state.periodTracking ||= {
    dayStart: createBaseline(state, partial),
    weekStart: createBaseline(state, partial)
  };
  return state;
}

function eventSequence(eventId) {
  const match = /^event-(\d+)$/.exec(String(eventId || ""));
  return match ? Number(match[1]) : 0;
}

function compareMetrics(startMetrics, endMetrics) {
  const startByKey = new Map(startMetrics.map((metric) => [`${metric.group}:${metric.key}`, metric]));
  return endMetrics.map((end) => {
    const start = startByKey.get(`${end.group}:${end.key}`) || { ...end, value: end.value };
    return {
      group: end.group,
      key: end.key,
      label: end.label,
      unit: end.unit,
      start: start.value,
      end: end.value,
      delta: end.value - start.value
    };
  });
}

function personById(state, personId) {
  if (personId === "priest") return state.priest;
  return [...state.residents, ...state.externalActors].find((person) => person.id === personId);
}

function collectAffectedPeople(state, eventIds, visits, startDay, endDay) {
  const affected = new Map();
  const add = (personId, reason) => {
    const person = personById(state, personId);
    if (!person || person.id === "priest") return;
    const entry = affected.get(person.id) || {
      personId: person.id,
      name: person.name,
      reasons: []
    };
    const cleanReason = completeStoredText(reason, 180);
    if (cleanReason && !entry.reasons.includes(cleanReason)) entry.reasons.push(cleanReason);
    affected.set(person.id, entry);
  };
  for (const visit of visits) {
    add(visit.personId, `Received counsel about ${visit.issue.summary || visit.issue.kind}.`);
  }
  const selectedEvents = state.events.filter((event) => eventIds.has(event.id));
  for (const event of selectedEvents) {
    const title = completeStoredText(event.facts?.title || event.type.replaceAll("_", " "), 160);
    add(event.actorId, title);
    add(event.targetId, title);
  }
  for (const person of state.residents) {
    const relevantMemories = person.memories.filter((memory) => (
      memory.day >= startDay
      && memory.day <= endDay
      && (eventIds.has(memory.sourceEventId)
        || ["sermon", "sermon_reaction", "immediate_reaction"].includes(memory.type))
    ));
    for (const memory of relevantMemories) {
      add(person.id, memory.type === "sermon" ? "Heard the Sunday sermon." : memory.summary);
    }
  }
  return [...affected.values()]
    .map((entry) => ({ ...entry, reasons: entry.reasons.slice(0, 6) }))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 220);
}

function reportLabel(type, endingDay, endingWeek) {
  if (type === "week") return `Week ${endingWeek}`;
  return `${WEEK_DAYS[endingDay % 7]}, Week ${endingWeek}`;
}

function buildReport(state, type, baseline, endingDay, endingWeek) {
  const endMetrics = reportMetricSnapshot(state);
  const eventIds = new Set(
    state.events
      .filter((event) => eventSequence(event.id) >= baseline.eventSequence)
      .map((event) => event.id)
  );
  const startDay = type === "week" ? Math.max(0, endingDay - 6) : endingDay;
  const visits = state.visitArchive.filter((visit) => visit.day >= startDay && visit.day <= endingDay);
  const eventById = new Map(state.events.map((event) => [event.id, event]));
  const summaries = [...state.chronicle]
    .reverse()
    .filter((entry) => eventIds.has(entry.eventId))
    .filter((entry) => !/\bbegins$/.test(entry.title))
    .map((entry) => ({
      eventId: entry.eventId,
      title: completeStoredText(entry.title, 120),
      text: completeStoredText(entry.text, 700),
      tone: entry.tone,
      type: eventById.get(entry.eventId)?.type || "chronicle_event"
    }));
  const summaryLimit = type === "week" ? 70 : 30;
  return {
    id: `report-${String(state.nextPeriodReportSequence++).padStart(6, "0")}`,
    type,
    label: reportLabel(type, endingDay, endingWeek),
    startDay,
    endDay: endingDay,
    week: endingWeek,
    partial: Boolean(baseline.partial),
    metrics: compareMetrics(baseline.metrics, endMetrics),
    eventIds: [...eventIds],
    summaries: summaries.slice(-summaryLimit),
    omittedSummaryCount: Math.max(0, summaries.length - summaryLimit),
    visits: visits.map((visit) => ({
      visitId: visit.visitId,
      personId: visit.personId,
      personName: visit.personName,
      issue: visit.issue.summary || visit.issue.kind,
      finalReaction: visit.finalReaction?.lastReaction || "continue",
      actions: visit.acceptedPlan.steps.map((step) => ({
        title: step.title,
        actionType: step.actionType,
        description: step.description
      }))
    })),
    affectedPeople: collectAffectedPeople(state, eventIds, visits, startDay, state.calendar.absoluteDay)
  };
}

export function finalizePeriodReports(state, { endingDay, endingWeek, includeWeek = false }) {
  upgradeReportingState(state);
  const created = [];
  const daily = buildReport(state, "day", state.periodTracking.dayStart, endingDay, endingWeek);
  state.periodReports.push(daily);
  created.push(daily);
  if (includeWeek) {
    const weekly = buildReport(state, "week", state.periodTracking.weekStart, endingDay, endingWeek);
    state.periodReports.push(weekly);
    created.push(weekly);
  }
  const dailyReports = state.periodReports.filter((report) => report.type === "day").slice(-DAILY_REPORT_LIMIT);
  const weeklyReports = state.periodReports.filter((report) => report.type === "week").slice(-WEEKLY_REPORT_LIMIT);
  state.periodReports = [...dailyReports, ...weeklyReports].sort((left, right) => (
    left.endDay - right.endDay || (left.type === "day" ? -1 : 1)
  ));
  state.periodTracking.dayStart = createBaseline(state, false);
  if (includeWeek) state.periodTracking.weekStart = createBaseline(state, false);
  return cloneJson(created);
}

export function archiveCompletedVisit(state, visit, details) {
  upgradeReportingState(state);
  const archive = {
    visitId: visit.visitId,
    day: state.calendar.absoluteDay,
    week: state.calendar.week,
    slot: state.calendar.slot,
    personId: visit.personId,
    personName: details.personName,
    location: visit.location,
    visibility: cloneJson(details.visibility),
    issue: {
      threadId: visit.issue.threadId || null,
      scenarioId: visit.issue.scenarioId || null,
      kind: visit.issue.kind,
      summary: completeStoredText(details.issueSummary || visit.issue.detail || visit.issue.opening, 300),
      facts: cloneJson((visit.scenarioFacts || []).slice(0, 8))
    },
    history: cloneJson(visit.history.slice(0, 21)),
    counsel: cloneJson(visit.counsel.slice(0, 10)),
    turnAudits: cloneJson(visit.turnAudits.slice(0, 10)),
    continuity: cloneJson(visit.continuity),
    finalReaction: cloneJson(visit.reactionState),
    submittedPlan: cloneJson(details.submittedPlan),
    acceptedPlan: cloneJson(details.acceptedPlan),
    evaluation: cloneJson(details.evaluation),
    resolution: details.resolution,
    eventIds: [...new Set(details.eventIds.filter(Boolean))]
  };
  state.visitArchive.push(archive);
  state.visitArchive = state.visitArchive.slice(-VISIT_ARCHIVE_LIMIT);
  return archive;
}
