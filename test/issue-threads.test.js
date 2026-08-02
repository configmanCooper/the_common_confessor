import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  createGame,
  fallbackDeparturePlan,
  finishVisit,
  materializeResident,
  recordExchange
} from "../js/simulation.js";
import { deserializeState, sealState, serializeState } from "../js/state.js";

function finishQuietly(state) {
  beginVisit(state);
  recordExchange(state, "Act carefully and do no harm.", {
    reply: "I will be careful, Father.",
    memory: "The priest urged caution."
  });
  finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
}

test("ordinary visits create persistent issue threads with concrete participants", () => {
  const state = createGame("issue-thread-creation");
  const visit = beginVisit(state);
  const thread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
  assert.ok(thread);
  assert.equal(thread.scenarioId, visit.issue.scenarioId);
  assert.equal(thread.originatorId, visit.personId);
  assert.ok(thread.subjectIds.includes(visit.personId));
  assert.ok(thread.facts.length >= 4);
  assert.ok(thread.pressure > 0);
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("secondary participants never inherit another person's confession as their own", () => {
  let found = null;
  for (let index = 0; index < 200 && !found; index += 1) {
    const state = createGame(`confession-thread-owner-${index}`);
    const visit = beginVisit(state);
    const thread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
    const secondaryId = thread?.subjectIds.find((personId) => personId !== visit.personId);
    if (visit.issue.kind === "confession" && secondaryId) found = { state, visit, thread, secondaryId };
  }
  assert.ok(found);
  found.thread.pressure = 90;
  found.state.currentVisit = null;
  found.state.calendar.slot = 1;
  const secondary = found.state.residents.find((resident) => resident.id === found.secondaryId);
  secondary.lastVisitDay = -999;
  const secondaryIssueThread = found.state.issueThreads
    .find((thread) => thread.status !== "resolved" && thread.originatorId === secondary.id);
  assert.equal(secondaryIssueThread, undefined);
});

test("private confession threads never become automatic public rumors", () => {
  let found = null;
  for (let index = 0; index < 200 && !found; index += 1) {
    const state = createGame(`private-confession-rumor-${index}`);
    const visit = beginVisit(state);
    const thread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
    if (visit.issue.kind === "confession") found = { state, visit, thread };
  }
  assert.ok(found);
  found.thread.pressure = 90;
  found.thread.publicAwareness = 70;
  found.thread.momentum = 80;
  finishVisit(found.state, { ...fallbackDeparturePlan(found.state), source: "fallback" });
  while (found.state.calendar.absoluteDay === 0) finishQuietly(found.state);
  assert.equal(found.state.rumors.some((rumor) => rumor.claim === found.thread.summary), false);
});

test("resolved actions reduce issue pressure while silence lets it grow", () => {
  const helpfulState = createGame("issue-thread-helpful");
  const helpfulVisit = beginVisit(helpfulState);
  const helpfulThread = helpfulState.issueThreads.find((entry) => entry.id === helpfulVisit.issue.threadId);
  const helpfulPerson = materializeResident(helpfulState, helpfulVisit.personId, true);
  const helpfulTarget = helpfulState.residents.find((resident) => helpfulPerson.relationshipIds.includes(resident.id));
  helpfulVisit.issue.relatedPersonId = helpfulTarget.id;
  helpfulThread.relatedPersonId = helpfulTarget.id;
  if (!helpfulThread.subjectIds.includes(helpfulTarget.id)) helpfulThread.subjectIds.push(helpfulTarget.id);
  const helpfulBefore = helpfulThread.pressure;
  recordExchange(helpfulState, `Speak with ${helpfulTarget.firstName} and make peace.`, {
    reply: `I will speak with ${helpfulTarget.firstName} and try to make peace.`,
    memory: "The visitor committed to reconciliation."
  });
  finishVisit(helpfulState, {
    source: "ai",
    steps: [{
      actorId: helpfulPerson.id,
      targetId: helpfulTarget.id,
      actionType: "make_peace",
      intensity: 2
    }]
  });
  assert.ok(helpfulThread.pressure < helpfulBefore);

  const silentState = createGame("issue-thread-silence");
  const silentVisit = beginVisit(silentState);
  const silentThread = silentState.issueThreads.find((entry) => entry.id === silentVisit.issue.threadId);
  const silentBefore = silentThread.pressure;
  recordExchange(silentState, "Keep silent and tell no one.", {
    reply: "I will say nothing.",
    memory: "The priest advised silence."
  });
  finishVisit(silentState, { ...fallbackDeparturePlan(silentState), source: "fallback" });
  assert.ok(silentThread.pressure > silentBefore);
});

test("high-pressure threads affect participants and schedule organic follow-ups", () => {
  const state = createGame("issue-thread-propagation");
  const firstVisit = beginVisit(state);
  const thread = state.issueThreads.find((entry) => entry.id === firstVisit.issue.threadId);
  const participant = state.residents.find((resident) => resident.id === thread.subjectIds[0]);
  thread.pressure = 92;
  thread.publicAwareness = 60;
  thread.danger = 65;
  thread.momentum = 80;
  finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
  const stressBeforeAdvance = participant.stress;
  while (state.calendar.absoluteDay === 0) finishQuietly(state);
  assert.ok(participant.stress > stressBeforeAdvance);
  assert.ok(
    state.eventQueue.some((event) => event.type === "resident_followup")
    || state.events.some((event) => event.type === "resident_followup_started")
    || state.currentVisit?.issue.kind === "consequence follow-up"
  );
});

test("authority invocations require substantial issue pressure", () => {
  const state = createGame("issue-thread-authority");
  const visit = beginVisit(state);
  const thread = state.issueThreads.find((entry) => entry.id === visit.issue.threadId);
  thread.pressure = 92;
  thread.publicAwareness = 65;
  thread.danger = 60;
  thread.authorityRequestedRole = "magistrate";
  finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
  while (state.calendar.absoluteDay === 0) finishQuietly(state);
  assert.ok(state.eventQueue.some((event) => event.type === "external_visit" && event.role === "magistrate"));
});

test("schema-12 parishes gain empty issue-thread state", () => {
  const legacy = createGame("issue-thread-migration");
  delete legacy.issueThreads;
  delete legacy.nextIssueThreadSequence;
  legacy.schemaVersion = 12;
  legacy.version = 12;
  sealState(legacy);
  const migrated = deserializeState(JSON.stringify(legacy));
  assert.equal(migrated.schemaVersion, 17);
  assert.deepEqual(migrated.issueThreads, []);
  assert.equal(migrated.nextIssueThreadSequence, 1);
});
