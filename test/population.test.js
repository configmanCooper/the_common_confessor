import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAction,
  beginVisit,
  createGame,
  departureCandidates,
  fallbackConversation,
  fallbackDeparturePlan,
  finishVisit,
  materializeResident,
  recordExchange,
  validateDeparturePlan
} from "../js/simulation.js";
import {
  advancePopulationDay,
  areProhibitedKin,
  createPopulationResident,
  createRumor,
  getRelationship
} from "../js/population.js";
import {
  compactReplayHistory,
  deserializeState,
  sealState,
  serializeState,
  STATE_SCHEMA_VERSION
} from "../js/state.js";

test("new villages contain directed relationships and household economy state", () => {
  const state = createGame("population-foundation-seed");
  assert.ok(state.relationships.length > 400);
  const relationship = state.relationships[0];
  assert.notEqual(relationship.actorId, relationship.targetId);
  assert.ok(state.relationships.some((entry) => (
    entry.actorId === relationship.targetId && entry.targetId === relationship.actorId
  )));
  assert.ok(state.households.every((household) => (
    Number.isFinite(household.food)
    && Number.isFinite(household.wealth)
    && Number.isFinite(household.dailyProduction)
  )));
  const familyHousehold = state.households.find((household) => household.memberIds.length >= 3);
  const family = familyHousehold.memberIds.map((id) => state.residents.find((person) => person.id === id));
  assert.ok(family.some((person) => person.spouseId || person.parentIds.length || person.childrenIds.length));
  const sameHouseholdPair = family.flatMap((first) => family.map((second) => [first, second]))
    .find(([first, second]) => first.id !== second.id && first.spouseId !== second.id);
  assert.equal(areProhibitedKin(state, sameHouseholdPair[0].id, sameHouseholdPair[1].id), true);
  for (const person of state.residents.filter((resident) => resident.spouseId)) {
    assert.ok(person.relationshipIds.includes(person.spouseId));
    assert.ok(state.relationships.some((relationship) => (
      relationship.actorId === person.id && relationship.targetId === person.spouseId
    )));
  }
  for (const child of state.residents.filter((resident) => resident.parentIds.length)) {
    for (const parentId of child.parentIds) {
      assert.ok(child.relationshipIds.includes(parentId));
      assert.ok(state.residents.find((person) => person.id === parentId).relationshipIds.includes(child.id));
    }
  }
});

test("daily upgrades never remarry separated couples or deceased residents", () => {
  const state = createGame("family-seeding-once");
  const married = state.residents.find((person) => person.spouseId);
  const spouse = state.residents.find((person) => person.id === married.spouseId);
  married.maritalStatus = "separated";
  spouse.maritalStatus = "separated";
  married.spouseId = null;
  spouse.spouseId = null;
  married.marriageDay = null;
  spouse.marriageDay = null;
  spouse.alive = false;
  spouse.active = false;
  spouse.maritalStatus = "deceased";
  state.calendar.absoluteDay = 1;
  state.calendar.dayIndex = 1;
  advancePopulationDay(state);
  assert.equal(married.maritalStatus, "separated");
  assert.equal(married.spouseId, null);
  assert.equal(spouse.maritalStatus, "deceased");
  assert.equal(spouse.spouseId, null);
});

test("daily population resolution changes households and remains deterministic", () => {
  const first = createGame("daily-population-seed");
  const second = createGame("daily-population-seed");
  first.calendar.absoluteDay = 1;
  first.calendar.dayIndex = 1;
  second.calendar.absoluteDay = 1;
  second.calendar.dayIndex = 1;
  const beforeFood = first.households[0].food;
  const firstEvents = advancePopulationDay(first);
  const secondEvents = advancePopulationDay(second);
  assert.notEqual(first.households[0].food, beforeFood);
  assert.deepEqual(first.households, second.households);
  assert.deepEqual(first.residents, second.residents);
  assert.deepEqual(firstEvents, secondEvents);
});

test("AI life-course proposals obey adult, relationship, reputation, and counsel gates", () => {
  const state = createGame("adult-life-course-seed");
  const visit = beginVisit(state);
  const actor = materializeResident(state, visit.personId, true);
  const target = materializeResident(state, state.residents.find((person) => (
    person.id !== actor.id
    && person.sex !== actor.sex
    && !areProhibitedKin(state, actor.id, person.id)
  )).id, true);
  if (!actor.relationshipIds.includes(target.id)) actor.relationshipIds.push(target.id);
  if (!target.relationshipIds.includes(actor.id)) target.relationshipIds.push(actor.id);
  const forward = getRelationship(state, actor.id, target.id, true);
  const reverse = getRelationship(state, target.id, actor.id, true);
  for (const person of [actor, target]) {
    const previousSpouse = state.residents.find((candidate) => candidate.id === person.spouseId);
    if (previousSpouse) {
      previousSpouse.maritalStatus = "single";
      previousSpouse.spouseId = null;
      previousSpouse.marriageDay = null;
    }
  }
  actor.maritalStatus = "single";
  actor.spouseId = null;
  actor.marriageDay = null;
  target.maritalStatus = "single";
  target.spouseId = null;
  target.marriageDay = null;
  actor.age = 17;
  actor.ageDays = 17 * 365;
  target.age = 17;
  target.ageDays = 17 * 365;
  visit.counsel.push("If love is true, consider marriage and family.");
  const proposal = {
    steps: [{
      actorId: actor.id,
      targetId: target.id,
      actionType: "marry",
      intensity: 3
    }]
  };
  assert.equal(validateDeparturePlan(state, proposal, departureCandidates(state)).steps.length, 0);

  actor.age = 24;
  actor.ageDays = 24 * 365;
  target.age = 23;
  target.ageDays = 23 * 365;
  forward.affection = 80;
  reverse.affection = 80;
  forward.resentment = 0;
  reverse.resentment = 0;
  actor.trustPriest = 5;
  state.priest.moralAuthority = 5;
  state.priest.localTrust = 10;
  state.priest.scandal = 95;
  assert.equal(validateDeparturePlan(state, proposal, departureCandidates(state)).steps.length, 0);

  actor.trustPriest = 85;
  state.priest.moralAuthority = 80;
  state.priest.localTrust = 75;
  state.priest.scandal = 0;
  const validated = validateDeparturePlan(state, proposal, departureCandidates(state));
  assert.equal(validated.steps.length, 1);
  assert.ok(validated.steps[0].decisionScore >= 55);
  finishVisit(state, { ...proposal, source: "ai" });
  assert.equal(actor.spouseId, target.id);
  assert.equal(target.spouseId, actor.id);
});

test("AI chains cannot reuse participants for conflicting marriages", () => {
  const state = createGame("conflicting-marriage-chain");
  const visit = beginVisit(state);
  const first = materializeResident(state, visit.personId, true);
  /* Both partners have to be people this parish would actually let marry, or
     the chain is refused at the first step for reasons this test is not about.
     Kin and members of the same household are therefore excluded explicitly
     rather than being left to whoever the seed happens to put first. */
  const eligible = (candidate, ...others) => (
    candidate.active
    && candidate.alive
    && candidate.age >= 18
    && others.every((other) => (
      candidate.id !== other.id
      && candidate.householdId !== other.householdId
      && !areProhibitedKin(state, other.id, candidate.id)
    ))
  );
  const second = materializeResident(
    state,
    state.residents.find((person) => eligible(person, first))?.id,
    true
  );
  assert.ok(second, "the parish should contain someone the visitor could marry");
  let third = state.residents.find((person) => eligible(person, first, second));
  assert.ok(third, "the parish should contain someone the groom could conflictingly marry");
  if (!first.relationshipIds.includes(second.id)) first.relationshipIds.push(second.id);
  if (!second.relationshipIds.includes(first.id)) second.relationshipIds.push(first.id);
  if (!second.relationshipIds.includes(third.id)) second.relationshipIds.push(third.id);
  if (!third.relationshipIds.includes(second.id)) third.relationshipIds.push(second.id);
  first.sex = "female";
  second.sex = "male";
  third.sex = "female";
  for (const person of [first, second, third]) {
    const oldSpouse = state.residents.find((candidate) => candidate.id === person.spouseId);
    if (oldSpouse) {
      oldSpouse.spouseId = null;
      oldSpouse.maritalStatus = "single";
      oldSpouse.marriageDay = null;
    }
    person.age = 30;
    person.ageDays = 30 * 365;
    person.maritalStatus = "single";
    person.spouseId = null;
  }
  for (const [actor, target] of [[first, second], [second, first], [second, third], [third, second]]) {
    const relationship = getRelationship(state, actor.id, target.id, true);
    relationship.affection = 95;
    relationship.resentment = 0;
  }
  first.trustPriest = 95;
  state.priest.moralAuthority = 90;
  visit.counsel.push("Marriage and family may be right where love is true.");
  const plan = {
    steps: [
      { actorId: first.id, targetId: second.id, actionType: "marry", intensity: 3 },
      { actorId: second.id, targetId: third.id, actionType: "marry", intensity: 3 }
    ]
  };
  const validated = validateDeparturePlan(state, plan, departureCandidates(state));
  assert.equal(validated.complete, true);
  assert.equal(validated.fullyAccepted, false);
  assert.equal(validated.steps.length, 1);
  finishVisit(state, { ...plan, source: "ai" });
  assert.equal(first.spouseId, second.id);
  assert.equal(second.spouseId, first.id);
  assert.equal(third.spouseId, null);
  assert.doesNotThrow(() => serializeState(state));
});

test("cascade decision scoring is independent of prior profile activation", () => {
  const buildState = () => {
    const state = createGame("cascade-profile-order-seed");
    const visit = beginVisit(state);
    const first = state.residents.find((person) => person.id === visit.personId);
    first.age = 30;
    first.ageDays = 30 * 365;
    first.maritalStatus = "single";
    first.spouseId = null;
    const second = state.residents.find((person) => (
      person.id !== first.id
      && person.sex !== first.sex
      && !areProhibitedKin(state, first.id, person.id)
    ));
    second.age = 29;
    second.ageDays = 29 * 365;
    second.maritalStatus = "single";
    second.spouseId = null;
    if (!first.relationshipIds.includes(second.id)) first.relationshipIds.push(second.id);
    if (!second.relationshipIds.includes(first.id)) second.relationshipIds.push(first.id);
    getRelationship(state, first.id, second.id, true).affection = 70;
    getRelationship(state, second.id, first.id, true).affection = 70;
    visit.counsel.push("You may court where love and affection are honest.");
    return { state, first, second };
  };
  const before = buildState();
  const plan = {
    steps: [{
      actorId: before.first.id,
      targetId: before.second.id,
      actionType: "court",
      intensity: 3
    }]
  };
  const firstResult = validateDeparturePlan(before.state, plan, departureCandidates(before.state));
  const after = buildState();
  materializeResident(after.state, after.second.id, false);
  const secondResult = validateDeparturePlan(after.state, plan, departureCandidates(after.state));
  assert.deepEqual(firstResult, secondResult);
});

test("rejected proposals do not materialize hidden profiles or break replay", () => {
  const state = createGame("rejected-profile-purity");
  const visit = beginVisit(state);
  const actor = state.residents.find((person) => person.id === visit.personId);
  const target = actor.relationshipIds
    .map((id) => state.residents.find((person) => person.id === id))
    .find((person) => person && !person.materialized);
  const beforeMaterialized = target.materialized;
  recordExchange(state, "Keep silent and take no action.", {
    reply: "I will say nothing, Father.",
    memory: "The priest advised silence."
  });
  finishVisit(state, {
    source: "ai",
    steps: [{
      actorId: actor.id,
      targetId: target.id,
      actionType: "kill_priest",
      intensity: 5
    }]
  });
  assert.equal(target.materialized, beforeMaterialized);
  assert.doesNotThrow(() => deserializeState(serializeState(state)));
});

test("terminal fallback always records one valid no-op under hostile reputation", () => {
  const state = createGame("terminal-fallback-seed");
  state.priest.localTrust = 0;
  state.priest.moralAuthority = 0;
  state.priest.scandal = 100;
  state.residents.forEach((person) => {
    person.trustPriest = 0;
  });
  compactReplayHistory(state);
  const visit = beginVisit(state);
  const actor = state.residents.find((person) => person.id === visit.personId);
  finishVisit(state, {
    source: "ai",
    steps: [{
      actorId: actor.id,
      targetId: null,
      actionType: "kill_priest",
      intensity: 5
    }]
  });
  const finishCommand = state.commandLog.at(-1);
  assert.equal(finishCommand.payload.plan.steps.length, 1);
  assert.equal(finishCommand.payload.plan.steps[0].actionType, "keep_silence");
  const serialized = serializeState(state);
  assert.doesNotThrow(() => deserializeState(serialized));
});

test("conversation-driven AI proposals can change work, migration, and family state", () => {
  const workState = createGame("conversation-work-change");
  const workVisit = beginVisit(workState);
  const worker = materializeResident(workState, workVisit.personId, true);
  worker.trustPriest = 90;
  workState.priest.moralAuthority = 85;
  workVisit.counsel.push("Your present work is harming your household. Change your job and take up the carpenter trade.");
  finishVisit(workState, {
    source: "ai",
    steps: [{
      actorId: worker.id,
      targetId: null,
      actionType: "change_job",
      intensity: 3,
      detail: "carpenter"
    }]
  });

  test("invited migration requires authority, capacity, and cooldown and records the new resident", () => {
    const state = createGame("invited-migration-controls");
    const visit = beginVisit(state);
    const official = materializeResident(state, visit.personId, true);
    official.age = 35;
    official.ageDays = 35 * 365;
    official.occupation = "reeve";
    official.trustPriest = 100;
    state.priest.moralAuthority = 100;
    state.priest.localTrust = 100;
    state.town.metrics.prosperity = 70;
    visit.counsel.push("Invite a useful newcomer to settle in the village.");
    const before = state.residents.length;
    finishVisit(state, {
      source: "ai",
      steps: [{
        actorId: official.id,
        targetId: null,
        actionType: "invite_migrant",
        intensity: 3
      }]
    });
    assert.equal(state.residents.length, before + 1);
    const created = state.residents.at(-1);
    const command = state.commandLog.at(-1);
    assert.equal(command.payload.plan.steps[0].createdResidentId, created.id);
    const arrivalEvent = state.events.find((event) => event.type === "immigration" && event.targetId === created.id);
    assert.ok(arrivalEvent);
    assert.ok(state.events.some((event) => event.id === arrivalEvent.parentId && event.type === "person_action"));
    assert.ok(created.relationshipIds.length > 0);
    assert.doesNotThrow(() => serializeState(state));

    const forged = JSON.parse(serializeState(state));
    const creationStep = forged.commandLog.find((entry) => entry.type === "finish_visit").payload.plan.steps[0];
    creationStep.createdResidentId = forged.residents[0].id;
    sealState(forged);
    assert.throws(() => deserializeState(JSON.stringify(forged)), /created resident mismatch|departure evaluation|canonical replay/);

    state.calendar.absoluteDay = 1;
    state.calendar.dayIndex = 1;
    state.calendar.slot = 0;
    const cooldownVisit = beginVisit(state);
    cooldownVisit.personId = official.id;
    cooldownVisit.counsel.push("Invite another newcomer to settle here.");
    assert.equal(validateDeparturePlan(state, {
      steps: [{
        actorId: official.id,
        targetId: null,
        actionType: "invite_migrant",
        intensity: 3
      }]
    }, [official]).steps.length, 0);
  });

  test("unrelated life-course proposals require conversation support or independent pressure", () => {
    const state = createGame("life-course-causality-seed");
    const visit = beginVisit(state);
    const actor = materializeResident(state, visit.personId, true);
    const target = materializeResident(state, state.residents.find((person) => (
      person.id !== actor.id
      && person.sex !== actor.sex
      && !areProhibitedKin(state, actor.id, person.id)
    )).id, true);
    if (!actor.relationshipIds.includes(target.id)) actor.relationshipIds.push(target.id);
    if (!target.relationshipIds.includes(actor.id)) target.relationshipIds.push(actor.id);
    actor.trustPriest = 100;
    state.priest.moralAuthority = 100;
    state.priest.localTrust = 100;
    state.priest.scandal = 0;
    assert.equal(validateDeparturePlan(state, {
      steps: [{ actorId: actor.id, targetId: null, actionType: "change_job", intensity: 3, detail: "mason" }]
    }, departureCandidates(state)).steps.length, 0);

    visit.counsel.push("You must not marry this person; remain single. Do not adopt or invite anyone.");
    actor.age = 30;
    actor.ageDays = 30 * 365;
    target.age = 29;
    target.ageDays = 29 * 365;
    for (const person of [actor, target]) {
      const spouse = state.residents.find((candidate) => candidate.id === person.spouseId);
      if (spouse) {
        spouse.maritalStatus = "single";
        spouse.spouseId = null;
        spouse.marriageDay = null;
      }
      person.spouseId = null;
      person.marriageDay = null;
    }
    actor.maritalStatus = "single";
    target.maritalStatus = "single";
    const forward = getRelationship(state, actor.id, target.id, true);
    const reverse = getRelationship(state, target.id, actor.id, true);
    forward.affection = 95;
    reverse.affection = 95;
    assert.equal(validateDeparturePlan(state, {
      steps: [{ actorId: actor.id, targetId: target.id, actionType: "marry", intensity: 3 }]
    }, departureCandidates(state)).steps.length, 0);
    actor.maritalStatus = "married";
    target.maritalStatus = "married";
    actor.spouseId = target.id;
    target.spouseId = actor.id;
    actor.marriageDay = 0;
    target.marriageDay = 0;
    visit.counsel.push("Do not become pregnant. Do not be adopting a child. Do not be marrying anyone.");
    assert.equal(validateDeparturePlan(state, {
      steps: [{ actorId: actor.id, targetId: target.id, actionType: "conceive_child", intensity: 3 }]
    }, departureCandidates(state)).steps.length, 0);
    assert.equal(validateDeparturePlan(state, {
      steps: [{ actorId: actor.id, targetId: target.id, actionType: "adopt_child", intensity: 3 }]
    }, departureCandidates(state)).steps.length, 0);
    assert.equal(validateDeparturePlan(state, {
      steps: [{ actorId: actor.id, targetId: null, actionType: "invite_migrant", intensity: 3 }]
    }, departureCandidates(state)).steps.length, 0);
  });

  test("close kin can never marry through AI or autonomous relationship logic", () => {
    const state = createGame("kinship-safety-seed");
    const parent = state.residents[0];
    const child = state.residents[1];
    parent.age = 45;
    parent.ageDays = 45 * 365;
    child.age = 22;
    child.ageDays = 22 * 365;
    child.parentIds = [parent.id];
    parent.childrenIds = [child.id];
    if (!parent.relationshipIds.includes(child.id)) parent.relationshipIds.push(child.id);
    if (!child.relationshipIds.includes(parent.id)) child.relationshipIds.push(parent.id);
    getRelationship(state, parent.id, child.id, true).affection = 100;
    getRelationship(state, child.id, parent.id, true).affection = 100;
    assert.equal(areProhibitedKin(state, parent.id, child.id), true);
    const lineage = state.residents.slice(10, 16);
    for (let index = 1; index < lineage.length; index += 1) {
      lineage[index].parentIds = [lineage[index - 1].id];
      lineage[index - 1].childrenIds = [lineage[index].id];
    }
    assert.equal(areProhibitedKin(state, lineage[0].id, lineage[5].id), true);
    const [grandparent, parentSibling, aunt, nephew] = state.residents.slice(20, 24);
    parentSibling.parentIds = [grandparent.id];
    aunt.parentIds = [grandparent.id];
    nephew.parentIds = [parentSibling.id];
    assert.equal(areProhibitedKin(state, aunt.id, nephew.id), true);
    const visit = beginVisit(state);
    const visitor = state.residents.find((person) => person.id === visit.personId);
    visit.personId = parent.id;
    visit.counsel.push("You should marry for love and family.");
    const candidates = departureCandidates(state);
    assert.equal(validateDeparturePlan(state, {
      steps: [{ actorId: parent.id, targetId: child.id, actionType: "marry", intensity: 3 }]
    }, candidates).steps.length, 0);
    assert.equal(validateDeparturePlan(state, {
      steps: [{ actorId: parent.id, targetId: child.id, actionType: "court", intensity: 3 }]
    }, candidates).steps.length, 0);
    visit.personId = visitor.id;
  });

  test("biological conception requires one female and one male spouse", () => {
    const state = createGame("conception-sex-safety");
    const women = state.residents.filter((person) => person.sex === "female");
    const first = women[0];
    const second = women.find((person) => person.id !== first.id && !areProhibitedKin(state, first.id, person.id));
    first.age = 28;
    first.ageDays = 28 * 365;
    second.age = 27;
    second.ageDays = 27 * 365;
    first.maritalStatus = "married";
    second.maritalStatus = "married";
    first.spouseId = second.id;
    second.spouseId = first.id;
    first.marriageDay = 0;
    second.marriageDay = 0;
    if (!first.relationshipIds.includes(second.id)) first.relationshipIds.push(second.id);
    if (!second.relationshipIds.includes(first.id)) second.relationshipIds.push(first.id);
    getRelationship(state, first.id, second.id, true).affection = 100;
    getRelationship(state, second.id, first.id, true).affection = 100;
    const visit = beginVisit(state);
    visit.personId = first.id;
    visit.counsel.push("You have spoken of wanting a child and family.");
    assert.equal(validateDeparturePlan(state, {
      steps: [{ actorId: first.id, targetId: second.id, actionType: "conceive_child", intensity: 3 }]
    }, departureCandidates(state)).steps.length, 0);
  });
  assert.equal(worker.occupation, "carpenter");
  assert.equal(workState.aiProposals.length, 1);

  const defaultWorkState = createGame("conversation-default-work-change");
  const defaultVisit = beginVisit(defaultWorkState);
  const defaultWorker = materializeResident(defaultWorkState, defaultVisit.personId, true);
  defaultWorker.age = 30;
  defaultWorker.ageDays = 30 * 365;
  defaultWorker.trustPriest = 90;
  defaultWorkState.priest.moralAuthority = 85;
  defaultVisit.counsel.push("Change your job so your household may survive.");
  finishVisit(defaultWorkState, {
    source: "ai",
    steps: [{
      actorId: defaultWorker.id,
      targetId: null,
      actionType: "change_job",
      intensity: 3
    }]
  });
  assert.equal(defaultWorker.occupation, "laborer");

  const migrationState = createGame("conversation-migration-change");
  const migrationVisit = beginVisit(migrationState);
  const migrant = materializeResident(migrationState, migrationVisit.personId, true);
  migrant.stress = 85;
  migrant.morale = 15;
  const beforePopulation = migrationState.residents.filter((person) => person.active).length;
  finishVisit(migrationState, {
    source: "ai",
    steps: [{
      actorId: migrant.id,
      targetId: null,
      actionType: "leave_village",
      intensity: 3
    }]
  });
  assert.equal(migrant.active, false);
  assert.equal(migrationState.residents.filter((person) => person.active).length, beforePopulation - 1);
});

test("birth, adoption, rumors, and knowledge create persistent connected state", () => {
  const state = createGame("birth-rumor-seed");
  const mother = state.residents.find((person) => person.sex === "female" && person.age >= 18 && person.age <= 40);
  const partner = state.residents.find((person) => person.sex === "male" && person.age >= 18);
  for (const person of [mother, partner]) {
    const oldSpouse = state.residents.find((candidate) => candidate.id === person.spouseId);
    if (oldSpouse) {
      oldSpouse.spouseId = null;
      oldSpouse.maritalStatus = "single";
      oldSpouse.marriageDay = null;
    }
  }
  mother.spouseId = partner.id;
  partner.spouseId = mother.id;
  mother.maritalStatus = "married";
  partner.maritalStatus = "married";
  mother.pregnantDueDay = 1;
  mother.pregnancyCoParentId = partner.id;
  state.calendar.absoluteDay = 1;
  state.calendar.dayIndex = 1;
  const before = state.residents.length;
  const events = advancePopulationDay(state);
  assert.equal(state.residents.length, before + 1);
  assert.ok(events.some((event) => event.type === "birth"));
  const child = state.residents.at(-1);
  assert.ok(child.parentIds.includes(mother.id));
  assert.ok(state.households.find((household) => household.id === mother.householdId).memberIds.includes(child.id));

  applyAction(state, {
    actorId: mother.id,
    targetId: partner.id,
    actionType: "gossip",
    intensity: 2,
    title: "",
    description: ""
  });

  test("children mature into work, community relationships, and age-gated agency", () => {
    const state = createGame("child-maturation-seed");
    const parent = state.residents[0];
    const child = createPopulationResident(state, {
      sex: "female",
      age: 17,
      surname: parent.surname,
      householdId: parent.householdId,
      occupation: "infant",
      parentIds: [parent.id],
      reason: "birth"
    });
    child.ageDays = 18 * 365 - 1;
    state.calendar.absoluteDay = 1;
    state.calendar.dayIndex = 1;
    advancePopulationDay(state);
    assert.equal(child.age, 18);
    assert.notEqual(child.occupation, "infant");
    assert.ok(child.relationshipIds.some((id) => id !== parent.id));

    const infant = createPopulationResident(state, {
      sex: "male",
      age: 0,
      surname: parent.surname,
      householdId: parent.householdId,
      occupation: "infant",
      parentIds: [parent.id],
      reason: "birth"
    });
    const visit = beginVisit(state);
    assert.ok(state.residents.find((person) => person.id === visit.personId).age >= 12);
    visit.personId = infant.id;
    visit.counsel.push("You should find work as a farmer.");
    assert.equal(validateDeparturePlan(state, {
      steps: [{
        actorId: infant.id,
        targetId: null,
        actionType: "change_job",
        intensity: 3,
        detail: "farmer"
      }]
    }, [infant]).steps.length, 0);

    child.age = 17;
    child.ageDays = 17 * 365;
    child.occupation = "unemployed";
    visit.personId = child.id;
    assert.equal(validateDeparturePlan(state, {
      steps: [{
        actorId: child.id,
        targetId: null,
        actionType: "change_job",
        intensity: 3,
        detail: "mason"
      }]
    }, [child]).steps.length, 0);
    const employer = state.residents.find((person) => person.age >= 18);
    employer.occupation = "reeve";
    if (!employer.relationshipIds.includes(infant.id)) employer.relationshipIds.push(infant.id);
    visit.personId = employer.id;
    assert.equal(validateDeparturePlan(state, {
      steps: [{
        actorId: employer.id,
        targetId: infant.id,
        actionType: "hire",
        intensity: 2
      }]
    }, [employer, infant]).steps.length, 0);
    employer.age = 16;
    employer.ageDays = 16 * 365;
    child.age = 18;
    child.ageDays = 18 * 365;
    if (!employer.relationshipIds.includes(child.id)) employer.relationshipIds.push(child.id);
    visit.personId = employer.id;
    assert.equal(validateDeparturePlan(state, {
      steps: [{
        actorId: employer.id,
        targetId: child.id,
        actionType: "offer_work",
        intensity: 2,
        detail: "mason"
      }]
    }, [employer, child]).steps.length, 0);
  });

  test("replay compaction retains source events used by persistent rumors and knowledge", () => {
    const state = createGame("rumor-compaction-seed");
    const actor = state.residents[0];
    const target = state.residents[1];
    for (let index = 0; index < 260; index += 1) {
      applyAction(state, {
        actorId: actor.id,
        targetId: target.id,
        actionType: "gossip",
        intensity: 1,
        title: "",
        description: ""
      });
    }
    const oldestSource = state.rumors[0].sourceEventId;
    const originalParent = state.events.find((event) => event.id === oldestSource).parentId;
    compactReplayHistory(state);
    const retainedSource = state.events.find((event) => event.id === oldestSource);
    assert.ok(retainedSource);
    assert.equal(retainedSource.parentId, originalParent);
    if (originalParent) assert.ok(state.events.some((event) => event.id === originalParent));
    assert.doesNotThrow(() => serializeState(state));
  });

  test("death, migration, and health actions maintain coherent person state", () => {
    const state = createGame("widow-migration-health-seed");
    const patient = state.residents[0];
    const healer = state.residents[1];
    healer.occupation = "healer";
    patient.health = 10;
    patient.illness = "fever";
    patient.illnessDays = 8;
    applyAction(state, {
      actorId: healer.id,
      targetId: patient.id,
      actionType: "heal",
      intensity: 5,
      title: "",
      description: ""
    });

    test("autonomous emigration resolves reciprocal marriage state", () => {
      const state = createGame("autonomous-married-emigration");
      const emigrant = state.residents[0];
      const spouse = state.residents.find((person) => person.id !== emigrant.id && person.sex !== emigrant.sex);
      emigrant.age = 30;
      emigrant.ageDays = 30 * 365;
      spouse.age = 29;
      spouse.ageDays = 29 * 365;
      emigrant.maritalStatus = "married";
      spouse.maritalStatus = "married";
      emigrant.spouseId = spouse.id;
      spouse.spouseId = emigrant.id;
      emigrant.marriageDay = 0;
      spouse.marriageDay = 0;
      emigrant.morale = 0;
      emigrant.prosperity = 0;
      emigrant.health = 100;
      spouse.morale = 100;
      spouse.prosperity = 100;
      for (let day = 1; day <= 10000 && emigrant.active; day += 1) {
        state.calendar.absoluteDay = day;
        state.calendar.dayIndex = day % 7;
        state.calendar.week = Math.floor(day / 7) + 1;
        advancePopulationDay(state);
      }
      assert.equal(emigrant.active, false);
      assert.equal(emigrant.causeOfDeath, null);
      assert.equal(emigrant.departureDay != null, true);
      assert.equal(emigrant.spouseId, null);
      assert.equal(spouse.spouseId, null);
      assert.equal(spouse.maritalStatus, "deserted");
    });

    test("minors cannot emigrate or take autonomous adult employment", () => {
      const state = createGame("minor-autonomy-gates");
      const minor = state.residents[0];
      minor.age = 5;
      minor.ageDays = 5 * 365;
      minor.morale = 0;
      minor.prosperity = 0;
      minor.occupation = "unemployed";
      for (let day = 1; day <= 3650; day += 1) {
        state.calendar.absoluteDay = day;
        state.calendar.dayIndex = day % 7;
        state.calendar.week = Math.floor(day / 7) + 1;
        advancePopulationDay(state);
      }
      assert.equal(minor.active, true);
      assert.notEqual(minor.occupation, "mason");
      assert.ok(minor.age < 18);
    });

    test("pregnancy preserves co-parent lineage after death, separation, or emigration", () => {
      const state = createGame("pregnancy-lineage-seed");
      const mother = state.residents.find((person) => person.sex === "female" && person.age >= 18 && person.age <= 40);
      const father = state.residents.find((person) => person.sex === "male" && person.age >= 18);
      mother.maritalStatus = "married";
      father.maritalStatus = "married";
      mother.spouseId = father.id;
      father.spouseId = mother.id;
      mother.marriageDay = 0;
      father.marriageDay = 0;
      mother.pregnantDueDay = 1;
      mother.pregnancyCoParentId = father.id;
      applyAction(state, {
        actorId: father.id,
        targetId: null,
        actionType: "leave_village",
        intensity: 3,
        title: "",
        description: ""
      });
      state.calendar.absoluteDay = 1;
      state.calendar.dayIndex = 1;
      advancePopulationDay(state);
      const child = state.residents.at(-1);
      assert.deepEqual(new Set(child.parentIds), new Set([mother.id, father.id]));
      assert.ok(father.childrenIds.includes(child.id));
      assert.equal(mother.pregnancyCoParentId, null);
    });
    assert.ok(patient.health > 10);
    assert.ok(patient.illnessDays < 8);

    const spouse = state.residents.find((person) => (
      person.id !== patient.id && person.id !== healer.id && person.sex !== patient.sex
    ));
    patient.age = 35;
    patient.ageDays = 35 * 365;
    spouse.age = 34;
    spouse.ageDays = 34 * 365;
    patient.maritalStatus = "married";
    spouse.maritalStatus = "married";
    patient.spouseId = spouse.id;
    spouse.spouseId = patient.id;
    patient.marriageDay = 0;
    spouse.marriageDay = 0;
    patient.health = 1;
    patient.illness = "fever";
    let died = false;
    for (let day = 1; day < 2000 && !died; day += 1) {
      state.calendar.absoluteDay = day;
      state.calendar.dayIndex = day % 7;
      state.calendar.week = Math.floor(day / 7) + 1;
      advancePopulationDay(state);
      died = !patient.alive;
    }
    if (died) {
      assert.equal(spouse.maritalStatus, "widowed");
      assert.equal(spouse.spouseId, null);
      assert.equal(patient.maritalStatus, "deceased");
    }

    const departing = state.residents.find((person) => person.active && person.alive && person.id !== spouse.id);
    const ageBefore = departing.ageDays;
    applyAction(state, {
      actorId: departing.id,
      targetId: null,
      actionType: "leave_village",
      intensity: 3,
      title: "",
      description: ""
    });

    test("single deaths remain deceased rather than becoming widowed", () => {
      const state = createGame("single-death-status");
      const person = state.residents.find((resident) => resident.sex === "female");
      const coParent = state.residents.find((resident) => resident.sex === "male");
      person.age = 120;
      person.ageDays = 120 * 365;
      person.health = 1;
      person.illness = "fever";
      person.maritalStatus = "single";
      person.pregnantDueDay = 200;
      person.pregnancyCoParentId = coParent.id;
      for (let day = 1; day <= 5000 && person.alive; day += 1) {
        state.calendar.absoluteDay = day;
        state.calendar.dayIndex = day % 7;
        state.calendar.week = Math.floor(day / 7) + 1;
        advancePopulationDay(state);
      }
      assert.equal(person.alive, false);
      assert.equal(person.maritalStatus, "deceased");
      assert.equal(person.pregnantDueDay, null);
      assert.equal(person.pregnancyCoParentId, null);
    });

    test("severe illness and inadequate care can be fatal before old age", () => {
      const state = createGame("young-illness-mortality");
      const patient = state.residents.find((person) => person.age >= 25 && person.age <= 35);
      const household = state.households.find((entry) => entry.id === patient.householdId);
      patient.health = 10;
      patient.illness = "lung sickness";
      patient.illnessDays = 20;
      household.food = 0;
      household.wealth = 0;
      household.debt = 100;
      patient.occupation = "unemployed";
      for (const memberId of household.memberIds) {
        const member = state.residents.find((person) => person.id === memberId);
        if (member && member.id !== patient.id) member.active = false;
      }
      for (let day = 1; day <= 1000 && patient.alive; day += 1) {
        state.calendar.absoluteDay = day;
        state.calendar.dayIndex = day % 7;
        state.calendar.week = Math.floor(day / 7) + 1;
        advancePopulationDay(state);
      }
      assert.equal(patient.alive, false);
      assert.equal(patient.causeOfDeath, "lung sickness");
    });

    test("extraordinary longevity remains schema-valid without an arbitrary age ceiling", () => {
      const state = createGame("extraordinary-longevity");
      const person = state.residents[0];
      person.age = 130;
      person.ageDays = 131 * 365 - 1;
      person.health = 100;
      state.calendar.absoluteDay = 1;
      state.calendar.dayIndex = 1;
      advancePopulationDay(state);
      assert.equal(person.age, 131);
      assert.doesNotThrow(() => serializeState(state));
    });

    test("autonomous births attach to an explicit population-day cause", () => {
      const state = createGame("population-birth-cause");
      const mother = state.residents.find((person) => person.sex === "female" && person.age >= 18 && person.age <= 40);
      const father = state.residents.find((person) => person.sex === "male" && person.age >= 18);
      mother.maritalStatus = "married";
      father.maritalStatus = "married";
      mother.spouseId = father.id;
      father.spouseId = mother.id;
      mother.marriageDay = 0;
      father.marriageDay = 0;
      mother.pregnantDueDay = 1;
      mother.pregnancyCoParentId = father.id;
      for (let slot = 0; slot < 4; slot += 1) {
        beginVisit(state);
        finishVisit(state, fallbackDeparturePlan(state));
      }
      const birth = state.events.find((event) => event.type === "birth");
      assert.ok(birth);
      assert.equal(state.events.find((event) => event.id === birth.parentId)?.type, "population_day");
    });
    assert.equal(departing.departureDay, state.calendar.absoluteDay);
    state.calendar.absoluteDay += 1;
    state.calendar.dayIndex = state.calendar.absoluteDay % 7;
    state.calendar.week = Math.floor(state.calendar.absoluteDay / 7) + 1;
    advancePopulationDay(state);
    assert.equal(departing.ageDays, ageBefore);
  });
  assert.equal(state.rumors.length, 1);
  assert.ok(state.knowledge.some((entry) => entry.holderId === mother.id && entry.subjectId === partner.id));
  assert.doesNotThrow(() => serializeState(state));
});

test("schema-v2 saves migrate into Phase 2 population state", () => {
  const state = createGame("schema-two-migration");
  const legacy = JSON.parse(JSON.stringify(state));
  legacy.version = 2;
  legacy.schemaVersion = 2;
  delete legacy.relationships;
  delete legacy.knowledge;
  delete legacy.rumors;
  delete legacy.populationSequence;
  delete legacy.nextKnowledgeSequence;
  delete legacy.nextRumorSequence;
  delete legacy.integrityHash;
  for (const resident of legacy.residents) {
    for (const field of [
      "alive", "ageDays", "maritalStatus", "spouseId", "marriageDay", "parentIds", "childrenIds",
      "pregnantDueDay", "pregnancyCoParentId", "illness", "illnessDays", "causeOfDeath", "arrivalDay", "departureDay"
    ]) {
      delete resident[field];
    }
  }
  for (const household of legacy.households) {
    delete household.dailyProduction;
    delete household.lastBalanceDay;
  }
  sealState(legacy);
  const migrated = deserializeState(JSON.stringify(legacy));
  assert.equal(migrated.schemaVersion, STATE_SCHEMA_VERSION);
  assert.ok(migrated.relationships.length > 0);
  assert.ok(migrated.residents.every((resident) => typeof resident.alive === "boolean"));
});

test("schema-v2 migration verifies the original Phase 1 integrity seal", () => {
  const legacy = JSON.parse(JSON.stringify(createGame("schema-two-integrity")));
  legacy.version = 2;
  legacy.schemaVersion = 2;
  delete legacy.relationships;
  delete legacy.knowledge;
  delete legacy.rumors;
  delete legacy.populationSequence;
  delete legacy.nextKnowledgeSequence;
  delete legacy.nextRumorSequence;
  for (const resident of legacy.residents) {
    for (const field of [
      "alive", "ageDays", "maritalStatus", "spouseId", "marriageDay", "parentIds", "childrenIds",
      "pregnantDueDay", "pregnancyCoParentId", "illness", "illnessDays", "causeOfDeath", "arrivalDay", "departureDay"
    ]) delete resident[field];
  }
  for (const household of legacy.households) {
    delete household.dailyProduction;
    delete household.lastBalanceDay;
  }
  sealState(legacy);
  legacy.town.metrics.harmony = 0;
  legacy.integrityHash = "fnv1a-deadbeef";
  assert.throws(() => deserializeState(JSON.stringify(legacy)), /integrity check failed/);
});

test("schema-v2 empty work details replay with Phase 1 laborer semantics", () => {
  const state = createGame("schema-two-work-replay");
  const visit = beginVisit(state);
  const worker = state.residents.find((person) => person.id === visit.personId);
  recordExchange(
    state,
    "You must change your work and find a new job.",
    fallbackConversation(state, "You must change your work and find a new job.")
  );
  finishVisit(state, {
    source: "ai",
    steps: [{
      actorId: worker.id,
      targetId: null,
      actionType: "change_job",
      intensity: 3,
      detail: "laborer"
    }]
  });
  const legacy = JSON.parse(JSON.stringify(state));
  legacy.version = 2;
  legacy.schemaVersion = 2;
  delete legacy.integrityHash;
  delete legacy.relationships;
  delete legacy.knowledge;
  delete legacy.rumors;
  delete legacy.populationSequence;
  delete legacy.nextKnowledgeSequence;
  delete legacy.nextRumorSequence;
  for (const resident of legacy.residents) {
    for (const field of [
      "alive", "ageDays", "maritalStatus", "spouseId", "marriageDay", "parentIds", "childrenIds",
      "pregnantDueDay", "pregnancyCoParentId", "illness", "illnessDays", "causeOfDeath", "arrivalDay", "departureDay"
    ]) delete resident[field];
  }
  for (const household of legacy.households) {
    delete household.dailyProduction;
    delete household.lastBalanceDay;
  }
  const finishCommand = legacy.commandLog.find((command) => command.type === "finish_visit");
  finishCommand.payload.plan.steps[0].detail = "";
  delete finishCommand.payload.plan.steps[0].decisionScore;
  legacy.aiProposals = legacy.aiProposals.map((proposal) => ({ ...proposal }));
  sealState(legacy);
  const migrated = deserializeState(JSON.stringify(legacy));
  assert.equal(migrated.residents.find((person) => person.id === worker.id).occupation, "laborer");
  assert.equal(migrated.commandLog.length, 0);
  assert.equal(migrated.replayBase.kind, "migration");
  assert.equal(migrated.replayBase.snapshot.residents.find((person) => person.id === worker.id).occupation, "laborer");
});

test("twelve-week population runs retain referential integrity", () => {
  for (const seed of ["long-population-a", "long-population-b", "long-population-c"]) {
    const state = createGame(seed);
    for (let day = 1; day <= 84; day += 1) {
      state.calendar.absoluteDay = day;
      state.calendar.dayIndex = day % 7;
      state.calendar.week = Math.floor(day / 7) + 1;
      state.calendar.slot = 0;
      advancePopulationDay(state);
    }
    const living = state.residents.filter((person) => person.alive && person.active);
    assert.ok(living.length >= 180 && living.length <= 230, `${seed}: ${living.length}`);
    for (const person of state.residents) {
      if (person.spouseId) {
        const spouse = state.residents.find((candidate) => candidate.id === person.spouseId);
        assert.equal(spouse?.spouseId, person.id);
        assert.ok(person.age >= 18 && spouse.age >= 18);
        assert.notEqual(person.sex, spouse.sex);
      }
      assert.ok(Number.isFinite(person.health));
      assert.ok(Number.isFinite(person.morale));
    }
    assert.doesNotThrow(() => serializeState(state));
  }
});

test("starting population is young overall and working septuagenarians are rare", () => {
  const residents = [];
  for (let index = 0; index < 10; index += 1) {
    /* The parish also carries a dozen or so graves from before the game began.
       They are not the living population and must not be counted in its
       demographics. */
    residents.push(...createGame(`historical-age-distribution-${index}`).residents
      .filter((person) => person.alive !== false));
  }
  const children = residents.filter((person) => person.age < 14);
  const seventies = residents.filter((person) => person.age >= 70);
  const workingSeventies = seventies.filter((person) => person.occupation !== "retired");
  assert.ok(children.length / residents.length >= 0.24);
  assert.ok(seventies.length / residents.length <= 0.03);
  assert.ok(workingSeventies.length / Math.max(1, seventies.length) <= 0.25);
  assert.ok(residents.every((person) => person.age <= 79));
});
