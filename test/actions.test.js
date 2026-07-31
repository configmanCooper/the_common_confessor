import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  createGame,
  departureCandidates,
  finishVisit,
  materializeResident,
  validateDeparturePlan
} from "../js/simulation.js";
import { compactReplayHistory, deserializeState, serializeState } from "../js/state.js";

function preparedVisitor(seed) {
  const state = createGame(seed);
  const visit = beginVisit(state);
  const actor = materializeResident(state, visit.personId, true);
  actor.age = 30;
  actor.ageDays = 30 * 365;
  actor.trustPriest = 0;
  actor.stress = 100;
  actor.personality.boldness = 100;
  state.priest.localTrust = 100;
  state.priest.moralAuthority = 100;
  state.priest.scandal = 0;
  return { state, visit, actor };
}

test("priest violence requires adult capability and outrageous license", () => {
  const { state, visit, actor } = preparedVisitor("priest-violence-license");
  const plan = {
    steps: [{
      actorId: actor.id,
      targetId: "priest",
      actionType: "kill_priest",
      intensity: 5
    }]
  };
  visit.eventLicense = "ordinary";
  assert.equal(validateDeparturePlan(state, plan, departureCandidates(state)).steps.length, 0);
  visit.eventLicense = "outrageous";
  const validated = validateDeparturePlan(state, plan, departureCandidates(state));
  assert.equal(validated.complete, true);
  finishVisit(state, { ...plan, source: "ai" });
  assert.equal(state.priest.alive, false);
  assert.equal(state.priest.health, 0);
  assert.equal(state.commandLog.at(-1).payload.plan.steps[0].targetId, "priest");
});

test("lethal poison marks the priest dead and dead worlds reject appointments", () => {
  const state = createGame("lethal-poison-action");
  state.priest.health = 50;
  compactReplayHistory(state);
  const visit = beginVisit(state);
  const actor = materializeResident(state, visit.personId, true);
  actor.age = 30;
  actor.ageDays = 30 * 365;
  actor.trustPriest = 0;
  actor.stress = 100;
  actor.personality.boldness = 100;
  state.priest.localTrust = 100;
  state.priest.moralAuthority = 100;
  visit.eventLicense = "outrageous";
  finishVisit(state, {
    source: "ai",
    steps: [{
      actorId: actor.id,
      targetId: "priest",
      actionType: "poison_priest",
      intensity: 5
    }]
  });
  assert.equal(state.priest.health, 0);
  assert.equal(state.priest.alive, false);
  assert.throws(() => beginVisit(state), /priest is dead/);
});

test("reports, praise, defense, and scandal mechanically affect the priest", () => {
  const report = createGame("priest-report-action");
  const reportVisit = beginVisit(report);
  const reporter = materializeResident(report, reportVisit.personId, true);
  reporter.age = 35;
  reporter.ageDays = 35 * 365;
  reporter.trustPriest = 0;
  report.priest.scandal = 50;
  const favor = report.priest.bishopFavor;
  finishVisit(report, {
    source: "ai",
    steps: [{
      actorId: reporter.id,
      targetId: "priest",
      actionType: "report_priest_to_bishop",
      intensity: 3
    }]
  });
  assert.ok(report.priest.bishopFavor < favor);
  compactReplayHistory(report);
  assert.doesNotThrow(() => deserializeState(serializeState(report)));

  const defend = createGame("priest-defense-action");
  const defendVisit = beginVisit(defend);
  const defender = materializeResident(defend, defendVisit.personId, true);
  defender.age = 40;
  defender.ageDays = 40 * 365;
  const safety = defend.priest.safety;
  finishVisit(defend, {
    source: "ai",
    steps: [{
      actorId: defender.id,
      targetId: "priest",
      actionType: "defend_priest",
      intensity: 3
    }]
  });
  assert.ok(defend.priest.safety > safety);
});

test("priest romance excludes minors and creates bounded scandal", () => {
  const { state, actor } = preparedVisitor("priest-romance-action");
  actor.trustPriest = 70;
  actor.age = 17;
  actor.ageDays = 17 * 365;
  const plan = {
    steps: [{
      actorId: actor.id,
      targetId: "priest",
      actionType: "proposition_priest",
      intensity: 2
    }]
  };
  assert.equal(validateDeparturePlan(state, plan, departureCandidates(state)).steps.length, 0);
  actor.age = 25;
  actor.ageDays = 25 * 365;
  assert.equal(validateDeparturePlan(state, plan, departureCandidates(state)).steps.length, 1);
  const scandal = state.priest.scandal;
  finishVisit(state, { ...plan, source: "ai" });
  assert.ok(state.priest.scandal > scandal && state.priest.scandal <= 100);
});

test("comic and outrageous actions obey deterministic event licenses", () => {
  const state = createGame("comic-license-actions");
  const visit = beginVisit(state);
  const actor = materializeResident(state, visit.personId, true);
  actor.age = 30;
  actor.ageDays = 30 * 365;
  const prank = {
    steps: [{
      actorId: actor.id,
      targetId: null,
      actionType: "play_prank",
      intensity: 2
    }]
  };
  visit.eventLicense = "ordinary";
  assert.equal(validateDeparturePlan(state, prank, departureCandidates(state)).steps.length, 0);
  visit.eventLicense = "comic";
  assert.equal(validateDeparturePlan(state, prank, departureCandidates(state)).steps.length, 1);
  const livestock = {
    steps: [{
      actorId: actor.id,
      targetId: null,
      actionType: "release_livestock_in_church",
      intensity: 4
    }]
  };
  assert.equal(validateDeparturePlan(state, livestock, departureCandidates(state)).steps.length, 0);
  visit.eventLicense = "outrageous";
  assert.equal(validateDeparturePlan(state, livestock, departureCandidates(state)).steps.length, 1);
  for (const actionType of ["ring_bells_at_midnight", "claim_miracle"]) {
    visit.eventLicense = "comic";
    assert.equal(validateDeparturePlan(state, {
      steps: [{ actorId: actor.id, targetId: null, actionType, intensity: 3 }]
    }, departureCandidates(state)).steps.length, 0);
    visit.eventLicense = "outrageous";
    assert.equal(validateDeparturePlan(state, {
      steps: [{ actorId: actor.id, targetId: null, actionType, intensity: 3 }]
    }, departureCandidates(state)).steps.length, 1);
  }
});

test("resident-only actions cannot target the priest", () => {
  const state = createGame("priest-target-compatibility");
  const visit = beginVisit(state);
  const healer = materializeResident(state, visit.personId, true);
  healer.age = 30;
  healer.ageDays = 30 * 365;
  healer.occupation = "healer";
  visit.counsel.push("Heal the sick.");
  assert.equal(validateDeparturePlan(state, {
    steps: [{
      actorId: healer.id,
      targetId: "priest",
      actionType: "heal",
      intensity: 3
    }]
  }, departureCandidates(state)).steps.length, 0);
});

test("relic theft is outrageous and only the thief can return it", () => {
  const state = createGame("relic-causality-seed");
  const visit = beginVisit(state);
  const actor = materializeResident(state, visit.personId, true);
  actor.age = 30;
  actor.ageDays = 30 * 365;
  const theft = {
    steps: [{
      actorId: actor.id,
      targetId: null,
      actionType: "steal_church_relic",
      intensity: 4
    }]
  };
  visit.eventLicense = "ordinary";
  assert.equal(validateDeparturePlan(state, theft, departureCandidates(state)).steps.length, 0);
  visit.eventLicense = "outrageous";
  finishVisit(state, { ...theft, source: "ai" });
  assert.equal(state.priest.relicStolenById, actor.id);
  const next = beginVisit(state);
  next.personId = actor.id;
  assert.equal(validateDeparturePlan(state, {
    steps: [{
      actorId: actor.id,
      targetId: null,
      actionType: "return_church_relic",
      intensity: 2
    }]
  }, [actor]).steps.length, 1);
});
