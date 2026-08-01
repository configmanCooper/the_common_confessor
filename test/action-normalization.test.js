import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  createGame,
  finishVisit,
  materializeResident
} from "../js/simulation.js";
import { deserializeState, serializeState } from "../js/state.js";

test("AI targetless actions drop accidental priest targets and clamp intensity", () => {
  const state = createGame("normalize-targetless-ai-action");
  const visit = beginVisit(state);
  visit.eventLicense = "ordinary";
  finishVisit(state, {
    source: "ai",
    summary: "The visitor seeks absolution.",
    steps: [{
      actorId: visit.personId,
      targetId: "priest",
      actionType: "seek_absolution",
      intensity: 5
    }]
  });
  const command = state.commandLog.at(-1);
  assert.equal(command.payload.resolution, "accepted_ai");
  assert.equal(command.payload.plan.steps[0].targetId, null);
  assert.equal(command.payload.plan.steps[0].intensity, 3);
  assert.equal(command.payload.evaluation.normalizations.length, 2);
});

test("AI safe social actions retarget accidental priest targets to issue participants", () => {
  const state = createGame("normalize-social-ai-target");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const target = state.residents.find((resident) => resident.id === visit.issue.relatedPersonId);
  assert.ok(target);
  finishVisit(state, {
    source: "ai",
    summary: "The visitor shelters the endangered person.",
    steps: [{
      actorId: person.id,
      targetId: "priest",
      actionType: "shelter",
      intensity: 2
    }]
  });
  const command = state.commandLog.at(-1);
  assert.equal(command.payload.plan.steps[0].targetId, target.id);
  assert.equal(command.payload.resolution, "accepted_ai");
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("AI dangerous actions are not assigned an inferred target", () => {
  const state = createGame("no-dangerous-auto-target");
  const visit = beginVisit(state);
  finishVisit(state, {
    source: "ai",
    summary: "An unsupported assault.",
    steps: [{
      actorId: visit.personId,
      targetId: "priest",
      actionType: "assault",
      intensity: 3
    }]
  });
  const command = state.commandLog.at(-1);
  assert.equal(command.source, "fallback");
  assert.equal(command.payload.evaluation.submittedRejection.gate, "priest_target");
});

test("AI keep-silence proposals require an actual decision to remain silent", () => {
  const state = createGame("reject-unjustified-silence");
  const visit = beginVisit(state);
  finishVisit(state, {
    source: "ai",
    summary: "The visitor supposedly remains silent.",
    steps: [{
      actorId: visit.personId,
      targetId: null,
      actionType: "keep_silence",
      intensity: 1
    }]
  });
  const command = state.commandLog.at(-1);
  assert.equal(command.payload.evaluation.submittedRejection.gate, "eligibility");
  assert.notEqual(command.payload.plan.steps[0].actionType, "keep_silence");
});

test("bounded improvised actions preserve unusual prose without bypassing mechanics", () => {
  const state = createGame("bounded-improvised-action");
  const visit = beginVisit(state);
  const actor = materializeResident(state, visit.personId, true);
  const target = state.residents.find((resident) => actor.relationshipIds.includes(resident.id));
  finishVisit(state, {
    source: "ai",
    summary: "The visitor tries an unusual peace gesture.",
    steps: [{
      actorId: actor.id,
      targetId: target.id,
      actionType: "improvise",
      intensity: 5,
      title: "A chicken-shaped peace offering",
      description: `${actor.name} brings a carved wooden chicken as an awkward peace offering to ${target.name}.`,
      detail: "bring a carved wooden chicken",
      motive: "absurd",
      evidence: "The priest suggested an unusual but harmless gesture."
    }]
  });
  const command = state.commandLog.at(-1);
  const step = command.payload.plan.steps[0];
  assert.equal(command.payload.resolution, "accepted_ai");
  assert.equal(step.actionType, "improvise");
  assert.equal(step.intensity, 2);
  assert.match(step.description, /carved wooden chicken/i);
  assert.equal(step.motive, "absurd");
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("improvised actions without concrete detail are rejected", () => {
  const state = createGame("reject-empty-improvisation");
  const visit = beginVisit(state);
  finishVisit(state, {
    source: "ai",
    steps: [{
      actorId: visit.personId,
      targetId: null,
      actionType: "improvise",
      intensity: 1,
      detail: ""
    }]
  });
  const command = state.commandLog.at(-1);
  assert.equal(command.payload.evaluation.submittedRejection.gate, "detail_required");
});
