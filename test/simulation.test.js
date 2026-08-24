import assert from "node:assert/strict";
import test from "node:test";
import {
  applySermon,
  beginVisit,
  createGame,
  fallbackDeparturePlan,
  fallbackSermonOutcome,
  finishVisit,
  applyAction,
  materializeResident,
  populationCount,
  recordExchange,
  sundayAttendance,
  validateDeparturePlan
} from "../js/simulation.js";
import {
  BACKSTORY_PARTS,
  buildFirstNameBank,
  buildSurnameBank,
  ISSUE_TEMPLATES,
  SESSION_LOCATIONS
} from "../js/data.js";

test("procedural content banks provide thousands of identities and backstories", () => {
  assert.ok(buildFirstNameBank("male").length > 1000);
  assert.ok(buildFirstNameBank("female").length > 1000);
  assert.ok(buildSurnameBank().length > 1000);
  const backstoryCombinations = Object.values(BACKSTORY_PARTS).reduce((total, values) => total * values.length, 1);
  assert.ok(backstoryCombinations > 100_000);
});

test("every concern routes to a deliberate church conversation area", () => {
  for (const issue of ISSUE_TEMPLATES) {
    assert.ok(SESSION_LOCATIONS[issue.location], `${issue.kind} has no church location`);
  }
  assert.ok(ISSUE_TEMPLATES.some((issue) => issue.location === "confessional"));
  assert.ok(ISSUE_TEMPLATES.some((issue) => issue.location === "office"));
  assert.ok(ISSUE_TEMPLATES.some((issue) => issue.location === "nave"));
  assert.ok(ISSUE_TEMPLATES.some((issue) => issue.location === "shrine"));
});

test("new games always begin Monday with exactly 200 named residents", () => {
  const state = createGame("fixed-seed");
  const living = state.residents.filter((person) => person.alive !== false);
  assert.equal(state.calendar.dayIndex, 0);
  assert.equal(populationCount(state), 200);
  assert.equal(new Set(living.map((person) => person.name)).size, 200);
  /* The parish also opens with a dozen or so graves. They are not part of the
     living two hundred, but no grave may share a name with anybody. */
  assert.equal(
    new Set(state.residents.map((person) => person.name)).size,
    state.residents.length,
    "a departed villager shares a name with somebody else"
  );
  assert.equal(state.residents.filter((person) => person.materialized).length, 0);
});

test("known collision seeds still produce 200 unique full names", () => {
  for (const seed of ["audit-178", "audit-2341", "audit-9177"]) {
    const state = createGame(seed);
    const living = state.residents.filter((person) => person.alive !== false);
    assert.equal(new Set(living.map((person) => person.name)).size, 200, seed);
    assert.equal(
      new Set(state.residents.map((person) => person.name)).size,
      state.residents.length,
      `${seed}: a departed villager shares a name with somebody else`
    );
  }
});

test("a visitor materializes and ten exchanges spend the hour", () => {
  const state = createGame("conversation-seed");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  assert.ok(person.backstory.length > 80);
  for (let index = 0; index < 10; index += 1) {
    recordExchange(state, `Counsel ${index}`, {
      reply: `Answer ${index}`,
      mood: "resolved",
      trustDelta: 1,
      stressDelta: -1,
      memory: `Memory ${index}`
    });
  }
  assert.equal(state.currentVisit.turnsUsed, 10);
  assert.throws(() => recordExchange(state, "One more", {
    reply: "Too late",
    mood: "resolved",
    trustDelta: 0,
    stressDelta: 0,
    memory: ""
  }), /hour is already spent/);
});

test("four visitors advance the calendar to Tuesday", () => {
  const state = createGame("calendar-seed");
  for (let slot = 0; slot < 4; slot += 1) {
    beginVisit(state);
    finishVisit(state, fallbackDeparturePlan(state));
  }
  assert.equal(state.calendar.dayIndex, 1);
  assert.equal(state.calendar.slot, 0);
});

test("appointment scheduling backfills when every villager was seen recently", () => {
  const state = createGame("backfill-seed");
  state.residents.forEach((person) => {
    person.lastVisitDay = state.calendar.absoluteDay;
    person.visitCount = 2;
  });

  test("negated advice to stay never triggers irreversible departure", () => {
    const state = createGame("negated-departure-seed");
    beginVisit(state);
    state.currentVisit.counsel.push("Do not leave or flee; remain with your family.");
    const visitor = state.residents.find((person) => person.id === state.currentVisit.personId);
    visitor.stress = 80;
    visitor.morale = 20;
    const plan = fallbackDeparturePlan(state);
    assert.notEqual(plan.steps[0].actionType, "leave_village");
    const visitorId = state.currentVisit.personId;
    const validated = validateDeparturePlan(state, {
      summary: "The visitor leaves.",
      steps: [{
        actorId: visitorId,
        targetId: null,
        actionType: "leave_village",
        intensity: 3,
        title: "Departure",
        description: "The visitor leaves."
      }]
    });
    assert.equal(validated.steps.length, 0);
  });

  test("life-course departure requires explicit counsel or severe independent distress", () => {
    for (const counsel of [
      "You should leave your anger behind and reconcile.",
      "You should leave? No. Stay here with your family.",
      "You should leave the village. No, stay here with your family.",
      "You should leave the village, shouldn't you?",
      "You should leave the village?",
      "It is not best to leave the village.",
      "You should leave the village. I retract that advice. Do not go.",
      "You should leave the village, but do not go.",
      "You should leave the village. However, do not go.",
      "You should leave the village. Not."
    ]) {
      const state = createGame(`leave-language-${counsel}`);
      beginVisit(state);
      state.currentVisit.counsel.push(counsel);
      const visitorId = state.currentVisit.personId;
      const visitor = state.residents.find((person) => person.id === visitorId);
      visitor.stress = 80;
      visitor.morale = 20;
      const validated = validateDeparturePlan(state, {
        steps: [{
          actorId: visitorId,
          targetId: null,
          actionType: "leave_village",
          intensity: 3,
          title: "Departure",
          description: "Departure"
        }]
      });
      assert.equal(validated.steps.length, 0, counsel);
    }

    const advised = createGame("explicit-departure-advice");
    beginVisit(advised);
    advised.currentVisit.counsel.push("For your safety, you should leave the village.");
    const advisedId = advised.currentVisit.personId;
    assert.equal(validateDeparturePlan(advised, {
      steps: [{
        actorId: advisedId,
        targetId: null,
        actionType: "leave_village",
        intensity: 3
      }]
    }).steps.length, 1);

    for (const counsel of [
      "You should leave the village. It will not be easy.",
      "You are not safe. You should flee the village.",
      "I tell you to leave the village.",
      "Leave the village."
    ]) {
      const clear = createGame(`clear-departure-${counsel}`);
      beginVisit(clear);
      clear.currentVisit.counsel.push(counsel);
      const actorId = clear.currentVisit.personId;
      const clearActor = clear.residents.find((person) => person.id === actorId);
      clearActor.trustPriest = 90;
      clearActor.age = 30;
      clearActor.ageDays = 30 * 365;
      clear.priest.localTrust = 85;
      clear.priest.moralAuthority = 85;
      assert.equal(validateDeparturePlan(clear, {
        steps: [{
          actorId,
          targetId: null,
          actionType: "leave_village",
          intensity: 3
        }]
      }).steps.length, 1, counsel);
    }

    const distressed = createGame("independent-departure-distress");
    beginVisit(distressed);
    const distressedPerson = distressed.residents.find((person) => person.id === distressed.currentVisit.personId);
    distressedPerson.stress = 80;
    distressedPerson.morale = 20;
    assert.equal(validateDeparturePlan(distressed, {
      steps: [{
        actorId: distressedPerson.id,
        targetId: null,
        actionType: "leave_village",
        intensity: 3
      }]
    }).steps.length, 1);

    const counseledDistress = createGame("counseled-distress");
    beginVisit(counseledDistress);
    counseledDistress.currentVisit.counsel.push("I hear you.");
    const counseledPerson = counseledDistress.residents.find((person) => person.id === counseledDistress.currentVisit.personId);
    counseledPerson.age = 30;
    counseledPerson.ageDays = 30 * 365;
    counseledPerson.stress = 80;
    counseledPerson.morale = 20;
    assert.equal(validateDeparturePlan(counseledDistress, {
      steps: [{
        actorId: counseledPerson.id,
        targetId: null,
        actionType: "leave_village",
        intensity: 3
      }]
    }).steps.length, 0);

    const reported = createGame("reported-departure-advice");
    beginVisit(reported);
    reported.currentVisit.counsel.push("Thomas told me that you should leave the village.");
    const reportedActor = reported.currentVisit.personId;
    assert.equal(validateDeparturePlan(reported, {
      steps: [{
        actorId: reportedActor,
        targetId: null,
        actionType: "leave_village",
        intensity: 3
      }]
    }).steps.length, 0);
  });

  test("offering work changes the recipient rather than the employer", () => {
    const state = createGame("offer-work-seed");
    const employer = state.residents[0];
    const recipient = state.residents[1];
    employer.occupation = "bailiff";
    recipient.occupation = "fishmonger";
    applyAction(state, {
      actorId: employer.id,
      targetId: recipient.id,
      actionType: "offer_work",
      intensity: 2,
      detail: "clerk",
      title: "",
      description: ""
    });
    assert.equal(employer.occupation, "bailiff");
    assert.equal(recipient.occupation, "clerk");
  });
  const visit = beginVisit(state);
  assert.ok(visit.personId);
});

test("phase zero rejects unsafe, invalid, and non-causal AI departure actions", () => {
  const state = createGame("safe-departure-seed");
  const visit = beginVisit(state);
  const visitor = materializeResident(state, visit.personId, true);
  const targetId = visitor.relationshipIds[0];
  const unsafe = validateDeparturePlan(state, {
    summary: "An unsafe proposal",
    steps: [{
      actorId: visitor.id,
      targetId,
      actionType: "kill_priest",
      intensity: 5,
      title: "Using a pistol",
      description: "Using electricity, the villager summons a king and pope."
    }]
  });
  assert.equal(unsafe.steps.length, 0);

  const safe = validateDeparturePlan(state, {
    summary: "A causal proposal",
    steps: [
      {
        actorId: visitor.id,
        targetId,
        actionType: "visit",
        intensity: 2,
        title: "Using a pistol",
        description: "Using electricity, the villager summons a king and pope."
      },
      {
        actorId: "person-999",
        targetId: visitor.id,
        actionType: "forgive",
        intensity: 2,
        title: "Invalid continuation",
        description: "A nonexistent person cannot continue the chain."
      }
    ]
  });
  assert.equal(safe.steps.length, 1);
  assert.equal(safe.steps[0].depth, 1);
  assert.doesNotMatch(safe.steps[0].description, /pistol|electricity|pope|king/i);

  const noOpChain = validateDeparturePlan(state, {
    steps: [
      {
        actorId: visitor.id,
        targetId,
        actionType: "keep_silence",
        intensity: 1
      },
      {
        actorId: targetId,
        targetId: null,
        actionType: "quit_job",
        intensity: 2
      }
    ]
  });
  assert.equal(noOpChain.steps.length, 0);
});

test("phase zero enforces social opportunity and deterministic event license", () => {
  const state = createGame("opportunity-license-seed");
  const visit = beginVisit(state);
  visit.eventLicense = "ordinary";
  const visitor = materializeResident(state, visit.personId, true);
  const directId = visitor.relationshipIds[0];
  const direct = materializeResident(state, directId, false);
  const unrelated = state.residents.find((person) => (
    person.id !== visitor.id
    && !visitor.relationshipIds.includes(person.id)
    && person.active
  ));
  const invalidOpportunity = validateDeparturePlan(state, {
    steps: [{
      actorId: visitor.id,
      targetId: unrelated.id,
      actionType: "visit",
      intensity: 2
    }]
  }, [visitor, direct, unrelated]);
  assert.equal(invalidOpportunity.steps.length, 0);

  const licensed = validateDeparturePlan(state, {
    steps: [{
      actorId: visitor.id,
      targetId: null,
      actionType: "confess_publicly",
      intensity: 5
    }]
  }, [visitor, direct]);
  assert.equal(licensed.steps.length, 0);
  visit.eventLicense = "comic";
  const comicLicensed = validateDeparturePlan(state, {
    steps: [{
      actorId: visitor.id,
      targetId: null,
      actionType: "confess_publicly",
      intensity: 4
    }]
  }, [visitor, direct]);
  assert.equal(comicLicensed.steps.length, 1);
  assert.equal(comicLicensed.steps[0].intensity, 4);
});

test("fallback targetless actions remain valid instead of degrading to silence", () => {
  for (const [seed, counsel, expectedAction] of [
    ["fallback-work", "Attend to your work and duty with greater care.", "work_harder"],
    ["fallback-absolution", "Tell the truth, confess, and seek absolution.", "seek_absolution"]
  ]) {
    const state = createGame(seed);
    beginVisit(state);
    state.currentVisit.counsel.push(counsel);
    const fallback = fallbackDeparturePlan(state);
    assert.equal(fallback.steps[0].actionType, expectedAction);
    assert.equal(fallback.steps[0].targetId, null);
    assert.equal(validateDeparturePlan(state, fallback).steps.length, 1);
  }
});

test("a Sunday sermon affects the village and returns to Monday", () => {
  const state = createGame("sermon-seed");
  state.calendar.absoluteDay = 6;
  state.calendar.dayIndex = 6;
  state.calendar.week = 1;
  const attendance = sundayAttendance(state);
  const outcome = fallbackSermonOutcome(state, "Mercy", "Let mercy govern the judgment we offer one another.");
  applySermon(state, "Mercy", "Let mercy govern the judgment we offer one another.", outcome);
  assert.ok(attendance.length > 0);
  assert.equal(state.calendar.dayIndex, 0);
  assert.equal(state.calendar.week, 2);
  assert.equal(state.sermons.length, 1);
  assert.doesNotMatch(state.sermons[0].summary, /king arrived|burned the mill/i);
});
