import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAction,
  beginVisit,
  createGame,
  departureCandidates,
  fallbackConversation,
  finishVisit,
  materializeResident,
  recordExchange,
  validateDeparturePlan
} from "../js/simulation.js";
import { compactReplayHistory, deserializeState, serializeState } from "../js/state.js";

test("reported priest scandal schedules and delivers an ecclesiastical visitor", () => {
  const state = createGame("bishop-escalation-seed");
  const actor = materializeResident(state, state.residents[0].id, true);
  actor.age = 35;
  actor.ageDays = 35 * 365;
  actor.trustPriest = 0;
  state.priest.scandal = 60;
  state.priestReports.push({
    id: "priest-report-authority-test",
    reporterId: actor.id,
    auditIds: ["reaction-authority-test"],
    allegation: "credible threat by the priest",
    createdDay: 0,
    status: "private_complaint",
    eligibleRecipients: ["archdeacon", "bishop"],
    visibility: { scope: "private_visit", authorizedPersonIds: [actor.id] }
  });
  state.nextPriestReportSequence += 1;
  applyAction(state, {
    actorId: actor.id,
    targetId: "priest",
    actionType: "report_priest_to_bishop",
    intensity: 3,
    title: "",
    description: ""
  });

  test("miracle claims enter at the earliest incomplete church stage", () => {
    const state = createGame("miracle-ladder-order");
    const actor = state.residents[0];
    applyAction(state, {
      actorId: actor.id,
      targetId: null,
      actionType: "claim_miracle",
      intensity: 3,
      title: "",
      description: ""
    });
    assert.equal(state.eventQueue[0].role, "archdeacon");
  });
  assert.ok(state.eventQueue.some((event) => ["archdeacon", "bishop"].includes(event.role)));
  const queued = state.eventQueue[0];
  const visitDay = queued.dueDay % 7 === 6 ? queued.dueDay + 1 : queued.dueDay;
  state.calendar.absoluteDay = visitDay;
  state.calendar.dayIndex = visitDay % 7;
  state.calendar.week = Math.floor(visitDay / 7) + 1;
  state.calendar.slot = 0;
  const outsideVisit = beginVisit(state);
  assert.ok(outsideVisit.personId.startsWith("external-"));
  const visitor = state.externalActors.find((person) => person.id === outsideVisit.personId);
  assert.ok(["archdeacon", "bishop"].includes(visitor.role));
  assert.equal(state.residents.filter((person) => person.active).length, 200);
});

test("violence schedules legal and medical responses", () => {
  const state = createGame("sheriff-escalation-seed");
  const actor = state.residents[0];
  applyAction(state, {
    actorId: actor.id,
    targetId: "priest",
    actionType: "attack_priest",
    intensity: 3,
    title: "",
    description: ""
  });

  test("queued authority causes survive replay compaction", () => {
    const state = createGame("queued-cause-compaction");
    const actor = state.residents[0];
    applyAction(state, {
      actorId: actor.id,
      targetId: null,
      actionType: "petition_bishop",
      intensity: 2,
      title: "",
      description: ""
    });
    const sourceEventId = state.eventQueue[0].sourceEventId;
    for (let index = 0; index < 270; index += 1) {
      applyAction(state, {
        actorId: actor.id,
        targetId: null,
        actionType: "keep_silence",
        intensity: 1,
        title: "",
        description: ""
      });
    }
    compactReplayHistory(state);
    assert.ok(state.events.some((event) => event.id === sourceEventId));
    assert.doesNotThrow(() => serializeState(state));
  });
  assert.ok(state.eventQueue.some((event) => event.role === "sheriff"));
  assert.ok(state.eventQueue.some((event) => event.role === "physician"));
  assert.ok(state.outsideAttention.legal >= 30);
});

test("outside visits save, load, and finish without changing the starting roster", () => {
  const state = createGame("external-replay-seed");
  const actor = state.residents[0];
  applyAction(state, {
    actorId: actor.id,
    targetId: null,
    actionType: "petition_bishop",
    intensity: 2,
    title: "",
    description: ""
  });
  const queued = state.eventQueue[0];
  const visitDay = queued.dueDay % 7 === 6 ? queued.dueDay + 1 : queued.dueDay;
  state.calendar.absoluteDay = visitDay;
  state.calendar.dayIndex = visitDay % 7;
  state.calendar.week = Math.floor(visitDay / 7) + 1;
  compactReplayHistory(state);
  const visit = beginVisit(state);
  const external = state.externalActors.find((person) => person.id === visit.personId);
  assert.ok(external);
  const loaded = deserializeState(serializeState(state));
  assert.equal(loaded.currentVisit.personId, visit.personId);
  recordExchange(state, "Explain your authority and judgment.", fallbackConversation(state, "Explain your authority and judgment."));
  finishVisit(state, {
    source: "fallback",
    steps: [{
      actorId: external.id,
      targetId: null,
      actionType: "keep_silence",
      intensity: 1
    }]
  });
  assert.equal(external.active, false);
  assert.ok(state.events.some((event) => event.type === "authority_judgment"));
  compactReplayHistory(state);
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("king and pope visits require extreme attention, time, and rare rolls", () => {
  const state = createGame("rare-sovereign-visits");
  const actor = state.residents[0];
  state.outsideAttention.crown = 95;
  state.outsideAttention.rome = 95;
  state.calendar.absoluteDay = 100;
  state.calendar.dayIndex = 2;
  state.calendar.week = 15;
  applyAction(state, {
    actorId: actor.id,
    targetId: null,
    actionType: "petition_crown",
    intensity: 2,
    title: "",
    description: ""
  });

  test("authority petitions require adult causal standing", () => {
    const state = createGame("petition-eligibility");
    const visit = beginVisit(state);
    const actor = materializeResident(state, visit.personId, true);
    actor.age = 15;
    actor.ageDays = 15 * 365;
    assert.equal(
      validateDeparturePlan(state, {
        steps: [{ actorId: actor.id, targetId: null, actionType: "appeal_to_rome", intensity: 3 }]
      }, departureCandidates(state)).steps.length,
      0
    );
    actor.age = 30;
    actor.ageDays = 30 * 365;
    for (const [counsel, actionType] of [
      ["The bishop should know nothing of this.", "petition_bishop"],
      ["The bishop wore a red cloak.", "appeal_to_rome"],
      ["Petition the bishop.", "petition_crown"],
      ["Petition the bishop? No, never.", "petition_bishop"],
      ["Before you petition the bishop, consider the cost.", "petition_bishop"],
      ["Alice told me to petition the Crown.", "petition_crown"],
      ["Petition the bishop if the accusation proves true.", "petition_bishop"],
      ["Petition the Crown was the command Alice says she received.", "petition_crown"],
      ["Write to Rome. I take that back.", "appeal_to_rome"]
    ]) {
      visit.counsel = [counsel];
      assert.equal(validateDeparturePlan(state, {
        steps: [{ actorId: actor.id, targetId: null, actionType, intensity: 3 }]
      }, departureCandidates(state)).steps.length, 0);
    }
    actor.occupation = "merchant";
    state.priest.scandal = 50;
    visit.counsel = [];
    assert.equal(validateDeparturePlan(state, {
      steps: [{ actorId: actor.id, targetId: null, actionType: "petition_crown", intensity: 3 }]
    }, departureCandidates(state)).steps.length, 0);
  });
  applyAction(state, {
    actorId: actor.id,
    targetId: null,
    actionType: "appeal_to_rome",
    intensity: 2,
    title: "",
    description: ""
  });
  assert.equal(state.eventQueue.some((event) => ["king", "pope"].includes(event.role)), false);
  assert.equal(state.authorityStages.kingRollAttempted, false);
  assert.equal(state.authorityStages.popeRollAttempted, false);
  state.authorityStages.royalCommissionerCompleted = true;
  state.authorityStages.sheriffCompleted = true;
  state.authorityStages.nobleCompleted = true;
  state.authorityStages.bishopCompleted = true;
  state.authorityStages.examinerCompleted = true;
  state.authorityStages.papalLegateCompleted = true;
  applyAction(state, {
    actorId: actor.id,
    targetId: null,
    actionType: "petition_crown",
    intensity: 2,
    title: "",
    description: ""
  });
  applyAction(state, {
    actorId: actor.id,
    targetId: null,
    actionType: "appeal_to_rome",
    intensity: 2,
    title: "",
    description: ""
  });
  assert.equal(state.authorityStages.kingRollAttempted, true);
  assert.equal(state.authorityStages.popeRollAttempted, true);
});
