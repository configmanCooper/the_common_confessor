import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  createGame,
  fallbackConversation,
  fallbackDeparturePlan,
  finishVisit,
  materializeResident,
  recordExchange,
  replayGame,
  validateDeparturePlan
} from "../js/simulation.js";
import {
  addStructuredMemory,
  classifyPriestSpeech,
  detectConfidentialityBreach
} from "../js/conversation.js";
import { deserializeState, sealState, serializeState } from "../js/state.js";

test("priest speech intent drives mechanics while AI deltas are ignored", () => {
  const first = createGame("deterministic-conversation-mechanics");
  const second = createGame("deterministic-conversation-mechanics");
  const firstVisit = beginVisit(first);
  const secondVisit = beginVisit(second);
  const firstPerson = materializeResident(first, firstVisit.personId, true);
  const secondPerson = materializeResident(second, secondVisit.personId, true);
  recordExchange(first, "I hear you. Tell the truth and seek mercy.", {
    reply: "I will try.",
    mood: "resolved",
    trustDelta: -5,
    stressDelta: 5,
    memory: "The priest listened.",
    source: "ai"
  });
  recordExchange(second, "I hear you. Tell the truth and seek mercy.", {
    reply: "Different prose.",
    mood: "resolved",
    trustDelta: 5,
    stressDelta: -5,
    memory: "The priest listened.",
    source: "ai"
  });
  assert.equal(firstPerson.trustPriest, secondPerson.trustPriest);
  assert.equal(firstPerson.stress, secondPerson.stress);
  assert.deepEqual(first.commandLog[1].payload.response.intents, ["comfort", "truth", "forgiveness"]);
});

test("disclosure thresholds reveal hidden concerns organically", () => {
  const state = createGame("disclosure-threshold-seed");
  const visit = beginVisit(state);
  visit.intent.disclosureThreshold = 20;
  recordExchange(state, "I hear you and understand. Tell me the truth.", fallbackConversation(state, "I hear you and understand. Tell me the truth."));
  assert.equal(visit.hiddenConcernDisclosed, true);
  assert.ok(visit.history.some((line) => line.text.includes(visit.intent.hiddenConcern)));
});

test("agreeing to privacy moves the active conversation into the parish office", () => {
  const state = createGame("private-location-change");
  const visit = beginVisit(state);
  visit.location = "nave";
  visit.issue.location = "nave";
  visit.history[0].text = "I would prefer to discuss this in private, if that is possible.";
  visit.lastVisitorReplies = [visit.history[0].text];
  recordExchange(state, "Ok, let us go talk in private.", {
    reply: "Thank you, Father. I can speak more freely there.",
    memory: "The priest agreed to move somewhere private."
  });
  assert.equal(visit.location, "office");
  assert.equal(visit.issue.location, "office");
  const replayed = replayGame(state.seed, state.commandLog, state.replayBase);
  assert.equal(replayed.currentVisit.location, "office");
});

test("explicit destinations move conversations to the confessional, shrine, or nave", () => {
  const cases = [
    ["Let us go to the confession box so I may hear your confession.", "confessional"],
    ["We shall continue this before the shrine.", "shrine"],
    ["Let us return to the main nave.", "nave"]
  ];
  for (const [speech, expected] of cases) {
    const state = createGame(`location-${expected}`);
    const visit = beginVisit(state);
    visit.location = expected === "nave" ? "office" : "nave";
    visit.issue.location = visit.location;
    recordExchange(state, speech, {
      reply: "Yes, Father. I will follow you.",
      memory: "The conversation moved within the church."
    });
    assert.equal(visit.location, expected);
  }
});

test("an accepted summons schedules the named villager to come to church", () => {
  const state = createGame("accepted-priest-summons");
  const visit = beginVisit(state);
  const messenger = materializeResident(state, visit.personId, true);
  const idas = state.residents.find((resident) => resident.id !== messenger.id);
  idas.firstName = "Idas";
  idas.surname = "Strongmill";
  idas.name = "Idas Strongmill";
  recordExchange(state, "Please tell Master Strongmill to come speak with me at the church.", {
    reply: "I will tell Idas Strongmill to come to you, Father.",
    memory: "The visitor agreed to carry the priest's summons."
  });
  const summons = state.eventQueue.find((event) => event.type === "priest_summons");
  assert.equal(summons?.sourcePersonId, idas.id);
  finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
  state.calendar.absoluteDay = summons.dueDay;
  state.calendar.dayIndex = summons.dueDay % 7;
  state.calendar.week = Math.floor(summons.dueDay / 7) + 1;
  state.calendar.slot = 0;
  const summonedVisit = beginVisit(state);
  assert.equal(summonedVisit.personId, idas.id);
  assert.equal(summonedVisit.issue.kind, "requested meeting");
});

test("a refused summons and an ambiguous titled surname schedule nobody", () => {
  const refused = createGame("refused-priest-summons");
  const refusedVisit = beginVisit(refused);
  const refusedMessenger = materializeResident(refused, refusedVisit.personId, true);
  const idas = refused.residents.find((resident) => resident.id !== refusedMessenger.id);
  idas.firstName = "Idas";
  idas.surname = "Strongmill";
  idas.name = "Idas Strongmill";
  recordExchange(refused, "Tell Master Strongmill to come to the church.", {
    reply: "Yes, Father, but I will not tell him to come.",
    memory: "The visitor refused the summons."
  });
  assert.equal(refused.eventQueue.some((event) => event.type === "priest_summons"), false);

  const ambiguous = createGame("ambiguous-priest-summons");
  const ambiguousVisit = beginVisit(ambiguous);
  const ambiguousMessenger = materializeResident(ambiguous, ambiguousVisit.personId, true);
  const matches = ambiguous.residents.filter((resident) => resident.id !== ambiguousMessenger.id).slice(0, 2);
  matches[0].surname = "Strongmill";
  matches[0].name = `${matches[0].firstName} Strongmill`;
  matches[1].surname = "Strongmill";
  matches[1].name = `${matches[1].firstName} Strongmill`;
  recordExchange(ambiguous, "Tell Master Strongmill to come to the church.", {
    reply: "I will tell him, Father.",
    memory: "The visitor heard an ambiguous request."
  });
  assert.equal(ambiguous.eventQueue.some((event) => event.type === "priest_summons"), false);
});

test("visitor promises drive fallback actions instead of collapsing to silence", () => {
  const state = createGame("promised-action-fallback");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const target = state.residents.find((resident) => person.relationshipIds.includes(resident.id));
  target.firstName = "Idas";
  target.surname = "Strongmill";
  target.name = "Idas Strongmill";
  visit.issue.relatedPersonId = target.id;
  recordExchange(state, "Speak with Idas first about making the work safe.", {
    reply: "I will speak with Idas first and insist that the work be made safer.",
    memory: "The visitor promised to speak with Idas."
  });
  const plan = fallbackDeparturePlan(state);
  assert.equal(plan.steps[0].actionType, "visit");
  assert.equal(plan.steps[0].targetId, target.id);
  assert.equal(validateDeparturePlan(state, plan).complete, true);
});

test("visitor commitments survive thanks but explicit retractions cancel them", () => {
  const state = createGame("commitment-lifecycle");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const target = state.residents.find((resident) => person.relationshipIds.includes(resident.id));
  visit.issue.relatedPersonId = target.id;
  recordExchange(state, `Speak with ${target.firstName} about this.`, {
    reply: `I will speak with ${target.firstName}, Father.`,
    memory: "The visitor promised to speak."
  });
  recordExchange(state, "Go with care.", {
    reply: "Thank you, Father.",
    memory: "The visitor thanked the priest."
  });
  assert.equal(fallbackDeparturePlan(state).steps[0].actionType, "visit");
  recordExchange(state, "Do what conscience requires.", {
    reply: "I changed my mind. I will not speak with them.",
    memory: "The visitor retracted the promise."
  });
  assert.notEqual(fallbackDeparturePlan(state).steps[0].actionType, "visit");
});

test("completed visits and interpersonal actions create durable summary memories", () => {
  const state = createGame("visit-summary-memories");
  const visit = beginVisit(state);
  const person = materializeResident(state, visit.personId, true);
  const target = state.residents.find((resident) => person.relationshipIds.includes(resident.id));
  visit.issue.relatedPersonId = target.id;
  recordExchange(state, `Speak honestly with ${target.firstName} and seek a peaceful answer.`, {
    reply: `I will speak with ${target.firstName} and try to make peace.`,
    memory: "The visitor agreed to seek peace."
  });
  finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
  assert.ok(person.memories.some((memory) => (
    memory.type === "visit_summary"
    && memory.summary.includes("Agreed next action")
  )));
  assert.ok(person.memories.some((memory) => memory.type === "interaction"));
  assert.ok(target.memories.some((memory) => (
    memory.type === "interaction" && memory.subjectId === person.id
  )));
  for (let index = 0; index < 30; index += 1) {
    addStructuredMemory(state, person, {
      summary: `Ordinary later memory ${index}.`,
      emotion: "neutral"
    });
  }
  assert.ok(person.memories.some((memory) => memory.type === "visit_summary"));
});

test("candid opening confessions immediately create canonical secret memory", () => {
  let found = null;
  for (let index = 0; index < 300 && !found; index += 1) {
    const state = createGame(`candid-opening-${index}`);
    const visit = beginVisit(state);
    if (visit.issue.kind === "confession" && visit.hiddenConcernDisclosed) found = { state, visit };
  }
  assert.ok(found, "expected a candid confession seed");
  const person = found.state.residents.find((resident) => resident.id === found.visit.personId);
  assert.ok(person.memories.some((memory) => (
    memory.type === "disclosed_secret"
    && memory.summary === found.visit.intent.hiddenConcern
  )));
});

test("promises, contradictions, and confidentiality breaches persist", () => {
  const state = createGame("promise-confidentiality-seed");
  const subject = materializeResident(state, state.residents[0].id, true);
  addStructuredMemory(state, subject, {
    type: "disclosed_secret",
    summary: "A hidden family offense.",
    privateMemory: true,
    emotion: "ashamed"
  });
  const visit = beginVisit(state);
  const listener = materializeResident(state, visit.personId, true);
  recordExchange(state, `I promise to help you. ${subject.name} once confessed a hidden family offense.`, {
    reply: "That is a grave thing to tell me.",
    mood: "troubled",
    memory: "The priest made a promise and named another confession."
  });
  assert.equal(state.priest.promises.length, 1);
  assert.equal(state.priest.confidentialityBreaches.length, 1);
  assert.ok(state.priest.scandal > 0);
  const trustAfterBreach = listener.trustPriest;
  recordExchange(state, "Truth must always be spoken.", {
    reply: "Then I will speak.",
    mood: "resolved",
    memory: "The priest demanded truth."
  });
  recordExchange(state, "Keep this secret even if it hides the truth.", {
    reply: "Your counsel has changed.",
    mood: "guarded",
    memory: "The priest contradicted earlier counsel."
  });
  assert.ok(listener.trustPriest < trustAfterBreach + 8);
  assert.ok(state.priest.positions.length >= 2);
});

test("benign name mentions do not breach unrelated confidential facts", () => {
  const state = createGame("benign-name-confidentiality");
  const subject = materializeResident(state, state.residents[0].id, true);
  addStructuredMemory(state, subject, {
    summary: "Stole a silver chalice from the sacristy.",
    privateMemory: true,
    emotion: "ashamed"
  });

  test("canonical disclosed secrets trigger breaches even when AI memory is generic", () => {
    const state = createGame("canonical-secret-breach");
    const firstVisit = beginVisit(state);
    firstVisit.intent.hiddenConcern = "is hiding a worsening illness";
    firstVisit.intent.disclosureThreshold = 0;
    const subject = state.residents.find((person) => person.id === firstVisit.personId);
    recordExchange(state, "I hear you.", {
      reply: "Thank you.",
      memory: "The priest listened."
    });
    assert.ok(subject.memories.some((memory) => memory.type === "disclosed_secret"));
    state.currentVisit = null;
    state.calendar.slot += 1;
    const nextVisit = beginVisit(state);
    recordExchange(state, `${subject.name} is hiding a worsening illness.`, {
      reply: "You should not have told me.",
      memory: "The priest revealed another person's illness."
    });
    assert.equal(state.priest.confidentialityBreaches.length, 1);
    assert.equal(state.priest.confidentialityBreaches[0].listenerId, nextVisit.personId);
  });
  const visit = beginVisit(state);
  recordExchange(state, `${subject.name} is known as a good neighbor.`, {
    reply: "I agree.",
    memory: "The priest praised a neighbor."
  });
  assert.equal(state.priest.confidentialityBreaches.length, 0);
  recordExchange(state, `${subject.name} stole a silver chalice from the sacristy.`, {
    reply: "That is serious.",
    memory: "The priest repeated an unverified story."
  });
  assert.equal(state.priest.confidentialityBreaches.length, 0);
});

test("all durable positions receive unique monotonic IDs", () => {
  const state = createGame("position-sequence-seed");
  beginVisit(state);
  for (let index = 0; index < 62; index += 1) {
    state.priest.positions.push({
      id: `position-${String(state.nextPositionSequence++).padStart(5, "0")}`,
      personId: state.currentVisit.personId,
      publicPosition: false,
      intent: "truth",
      summary: `Position ${index}`,
      day: 0
    });
  }
  state.priest.positions = state.priest.positions.slice(-60);
  recordExchange(state, "Tell the truth and forgive him.", {
    reply: "I understand.",
    memory: "The priest joined truth and forgiveness."
  });
  assert.equal(new Set(state.priest.positions.map((position) => position.id)).size, state.priest.positions.length);
  assert.ok(state.priest.positions.some((position) => position.intent === "truth"));
  assert.ok(state.priest.positions.some((position) => position.intent === "forgiveness"));
});

test("structured memories and conversation state save and replay", () => {
  const state = createGame("structured-memory-replay");
  beginVisit(state);
  recordExchange(state, "I hear you. Be honest.", {
    reply: "I will answer.",
    mood: "resolved",
    memory: "The priest asked for honesty.",
    source: "ai"
  });

  test("positions do not create contradictions across unrelated people", () => {
    const state = createGame("scoped-position-seed");
    beginVisit(state);
    recordExchange(state, "Tell the truth.", {
      reply: "I will.",
      memory: "The priest asked for truth."
    });
    const firstPersonId = state.currentVisit.personId;
    finishVisit(state, fallbackDeparturePlan(state));
    beginVisit(state);
    assert.notEqual(state.currentVisit.personId, firstPersonId);
    recordExchange(state, "Keep this confidential.", {
      reply: "I understand.",
      memory: "The priest advised secrecy."
    });
    assert.equal(state.commandLog.at(-1).payload.response.contradictionId, null);
  });

  test("offline fallback respects negated truth counsel", () => {
    const state = createGame("fallback-negation-seed");
    beginVisit(state);
    const reply = fallbackConversation(state, "You do not need to confess or tell me the truth.");
    assert.doesNotMatch(reply.reply, /must tell the truth/i);
  });

  test("replay rejects falsified deterministic conversation audit fields", () => {
    const state = createGame("conversation-audit-forgery");
    beginVisit(state);
    recordExchange(state, "I hear you. Tell the truth.", {
      reply: "I will.",
      memory: "The priest listened.",
      source: "ai"
    });
    const forged = JSON.parse(serializeState(state));
    forged.commandLog[1].payload.response.trustDelta = -5;
    sealState(forged);
    assert.throws(() => deserializeState(JSON.stringify(forged)), /conversation audit mismatch/);
  });
  const person = state.residents.find((resident) => resident.id === state.currentVisit.personId);
  assert.equal(typeof person.memories[0], "object");
  const restored = deserializeState(serializeState(state));
  assert.deepEqual(restored.currentVisit, state.currentVisit);
  assert.deepEqual(restored.residents, state.residents);
  const replayed = replayGame(state.seed, state.commandLog, state.replayBase);
  assert.deepEqual(replayed.priest.promises, state.priest.promises);
  assert.deepEqual(replayed.residents, state.residents);
});

test("speech classifier recognizes multiple simultaneous intentions", () => {
  assert.deepEqual(
    classifyPriestSpeech("I understand. Tell the truth, forgive him, and pray."),
    ["comfort", "truth", "forgiveness", "prayer"]
  );
  const negated = classifyPriestSpeech("I will not report you. You do not need to tell me the truth.");
  assert.ok(!negated.includes("threat"));
  assert.ok(!negated.includes("truth"));
  for (const reassurance of [
    "You are not wicked.",
    "You are not sinful.",
    "There is no shame in asking for help."
  ]) {
    assert.ok(!classifyPriestSpeech(reassurance).includes("judgment"), reassurance);
  }
  for (const prohibited of [
    ["Do not forgive him.", "forgiveness"],
    ["Do not pray about this.", "prayer"],
    ["You must not change your work.", "work"],
    ["Do not marry into that family.", "family"],
    ["I cannot promise this.", "promise"]
  ]) {
    assert.ok(!classifyPriestSpeech(prohibited[0]).includes(prohibited[1]), prohibited[0]);
  }
  assert.ok(!classifyPriestSpeech("Truth matters in difficult times.").includes("truth"));
  assert.ok(!classifyPriestSpeech("People tell the truth in court.").includes("truth"));
  assert.deepEqual(classifyPriestSpeech("Do not confess; tell the truth."), ["truth"]);
  assert.deepEqual(classifyPriestSpeech("Do not pray — forgive him."), ["forgiveness"]);
  assert.deepEqual(classifyPriestSpeech("Thomas says you must confess."), ["neutral"]);
  assert.deepEqual(classifyPriestSpeech("A man named Thomas says you must confess."), ["neutral"]);
  assert.deepEqual(classifyPriestSpeech(`${"A very concerned neighbor ".repeat(5)}says you should leave the village.`), ["neutral"]);
  assert.deepEqual(classifyPriestSpeech("I believe you should confess."), ["truth"]);
  assert.deepEqual(classifyPriestSpeech("I think you should forgive him."), ["forgiveness"]);
  assert.deepEqual(classifyPriestSpeech("I say you must report this."), ["report"]);
  assert.ok(!classifyPriestSpeech("Forgive him. However, do not forgive him.").includes("forgiveness"));
  assert.deepEqual(classifyPriestSpeech("Confess because Thomas says you must."), ["truth"]);
  assert.deepEqual(classifyPriestSpeech("Leave the village because Thomas said danger is coming."), ["departure"]);
  assert.deepEqual(classifyPriestSpeech("Thomas says you must confess, but I tell you to confess."), ["truth"]);
  assert.deepEqual(classifyPriestSpeech("You said you must confess, but I tell you to report it."), ["report"]);
  assert.deepEqual(classifyPriestSpeech("Thomas told me that you should leave the village."), ["neutral"]);
  assert.deepEqual(classifyPriestSpeech("Thomas Smith says you must confess."), ["neutral"]);
  assert.ok(!classifyPriestSpeech("I cannot forgive him.").includes("forgiveness"));
  assert.ok(!classifyPriestSpeech("I cannot pray about this.").includes("prayer"));
  assert.deepEqual(classifyPriestSpeech("Apologize and make amends."), ["forgiveness", "apology"]);
  assert.deepEqual(classifyPriestSpeech("Give him food."), ["charity"]);
  assert.deepEqual(classifyPriestSpeech("Say sorry."), ["apology"]);
  assert.deepEqual(classifyPriestSpeech("What if you should give him food?"), ["question"]);
  assert.deepEqual(classifyPriestSpeech("Report this to the reeve."), ["report"]);
});

test("negated forgiveness does not produce affirmative fallback or supportive mechanics", () => {
  const state = createGame("negated-forgiveness-seed");
  beginVisit(state);
  const person = state.residents.find((resident) => resident.id === state.currentVisit.personId);
  const trustBefore = person.trustPriest;
  const response = fallbackConversation(state, "Do not forgive him and do not pray.");
  assert.doesNotMatch(response.reply, /mercy is easier|pray on it/i);
  recordExchange(state, "Do not forgive him and do not pray.", response);
  assert.ok(!state.commandLog.at(-1).payload.response.intents.includes("forgiveness"));
  assert.ok(!state.commandLog.at(-1).payload.response.intents.includes("prayer"));
  assert.ok(person.trustPriest <= trustBefore + 2);
  state.currentVisit.counsel = ["Do not forgive him."];
  assert.equal(fallbackDeparturePlan(state).steps[0].actionType, "keep_silence");

  state.currentVisit.counsel = ["Do not pray", "Forgive him"];
  assert.equal(fallbackDeparturePlan(state).steps[0].actionType, "forgive");
  state.currentVisit.counsel = ["Apologize and make amends."];
  assert.equal(fallbackDeparturePlan(state).steps[0].actionType, "apologize");
  state.currentVisit.counsel = ["Do not apologize."];
  assert.notEqual(fallbackDeparturePlan(state).steps[0].actionType, "apologize");
  state.currentVisit.counsel = ["I will not report you."];
  assert.notEqual(fallbackDeparturePlan(state).steps[0].actionType, "report_crime");
  state.currentVisit.counsel = ["Can you give him food?"];
  assert.notEqual(fallbackDeparturePlan(state).steps[0].actionType, "share_food");
  state.currentVisit.counsel = ["People share food at harvest."];
  assert.notEqual(fallbackDeparturePlan(state).steps[0].actionType, "share_food");
  state.currentVisit.counsel = ["Give him food.", "Do not help or share with him.", "Think carefully."];
  assert.notEqual(fallbackDeparturePlan(state).steps[0].actionType, "share_food");
});

test("latest relevant counsel overrides an earlier prohibition", () => {
  const state = createGame("revised-work-counsel");
  beginVisit(state);
  const worker = state.residents.find((person) => person.id === state.currentVisit.personId);
  worker.age = 30;
  worker.ageDays = 30 * 365;
  worker.trustPriest = 90;
  state.priest.moralAuthority = 90;
  state.currentVisit.counsel = [
    "Do not change your job.",
    "Actually, you should change your job."
  ];
  const result = validateDeparturePlan(state, {
    steps: [{
      actorId: worker.id,
      targetId: null,
      actionType: "change_job",
      intensity: 3,
      detail: "carpenter"
    }]
  });

  test("latest relevant priest position supersedes stale contradictions", () => {
    const state = createGame("latest-position-wins");
    beginVisit(state);
    recordExchange(state, "Keep this secret.", {
      reply: "I will.",
      memory: "The priest advised secrecy."
    });
    recordExchange(state, "Tell the truth.", {
      reply: "I will speak.",
      memory: "The priest revised the counsel."
    });
    recordExchange(state, "Tell the truth.", {
      reply: "I understand.",
      memory: "The priest repeated the latest counsel."
    });
    assert.equal(state.commandLog.at(-1).payload.response.contradictionId, null);

    state.currentVisit.counsel = ["Forgive him.", "Do not forgive him.", "Pray with him."];
    assert.equal(fallbackDeparturePlan(state).steps[0].actionType, "pray_with");
  });
  assert.equal(result.complete, true);

  state.currentVisit.counsel = [
    "You should leave the village.",
    "Actually, you should stay in the village."
  ];
  const leaveResult = validateDeparturePlan(state, {
    steps: [{
      actorId: worker.id,
      targetId: null,
      actionType: "leave_village",
      intensity: 3
    }]
  });
  assert.equal(leaveResult.complete, false);
});

test("reported questions do not become threats or durable secrecy positions", () => {
  assert.deepEqual(classifyPriestSpeech("Did your husband threaten to hurt you?"), ["question"]);
  assert.deepEqual(classifyPriestSpeech("Is this confidential?"), ["question"]);
  assert.deepEqual(classifyPriestSpeech("What happened at work?"), ["question"]);
  assert.deepEqual(classifyPriestSpeech("Tell me about your family?"), ["question"]);
  assert.deepEqual(classifyPriestSpeech("Please, what happened at work?"), ["question"]);
  assert.deepEqual(classifyPriestSpeech("I understand. Did your husband threaten to hurt you?"), ["comfort", "question"]);
  const state = createGame("reported-question-seed");
  beginVisit(state);
  const person = state.residents.find((resident) => resident.id === state.currentVisit.personId);
  const trust = person.trustPriest;
  recordExchange(state, "Did your husband threaten to hurt you?", {
    reply: "He did.",
    memory: "The priest asked about a threat."
  });

  test("departure directives resolve wary mood deterministically", () => {
    const state = createGame("deterministic-wary-mood");
    beginVisit(state);
    recordExchange(state, "You should leave the village.", {
      reply: "I will consider it.",
      mood: "relieved",
      memory: "The priest advised departure."
    });
    assert.equal(state.currentVisit.mood, "wary");
    assert.equal(state.commandLog.at(-1).payload.response.mood, "wary");
  });
  assert.ok(person.trustPriest >= trust);
  assert.equal(state.priest.positions.length, 0);
});

test("public backstory excludes private turns and current pressure", () => {
  for (let index = 0; index < 100; index += 1) {
    const state = createGame(`public-backstory-${index}`);
    const person = materializeResident(state, state.residents[index % state.residents.length].id, true);
    assert.doesNotMatch(person.publicBackstory, /secret|not accidental|and now|hiding|betray/i);
    assert.ok(!person.publicBackstory.includes(person.privatePressure));
  }
});

test("disclosed secrets survive ordinary memory trimming", () => {
  const state = createGame("durable-secret-memory");
  const person = materializeResident(state, state.residents[0].id, true);
  addStructuredMemory(state, person, {
    type: "disclosed_secret",
    summary: "Stole the hidden silver chalice.",
    privateMemory: true
  });

  test("name substrings do not trigger confidentiality breaches", () => {
    const state = createGame("name-token-breach");
    const person = state.residents[0];
    person.firstName = "Anne";
    person.name = `Anne ${person.surname}`;
    addStructuredMemory(state, person, {
      type: "disclosed_secret",
      summary: "is hiding a worsening illness",
      privateMemory: true
    });
    assert.equal(
      detectConfidentialityBreach(state, state.residents[1].id, "In what manner is someone hiding a worsening illness?"),
      null
    );
  });
  for (let index = 0; index < 30; index += 1) {
    addStructuredMemory(state, person, { summary: `Ordinary memory ${index}` });
  }
  assert.ok(person.memories.some((memory) => memory.type === "disclosed_secret"));
  const listener = state.residents[1];
  assert.equal(
    detectConfidentialityBreach(state, listener.id, `${person.name} stole the hidden silver chalice.`)?.id,
    person.id
  );
});

test("schema-v3 saves migrate strings into structured conversation state", () => {
  const state = createGame("schema-three-conversation-migration");
  const person = state.residents[0];
  person.memories = ["An old unstructured memory."];
  state.priest.promises = ["An old unstructured promise."];
  const legacy = JSON.parse(JSON.stringify(state));
  legacy.version = 3;
  legacy.schemaVersion = 3;
  delete legacy.nextMemorySequence;
  delete legacy.priest.positions;
  delete legacy.priest.confidentialityBreaches;
  delete legacy.integrityHash;
  sealState(legacy);
  const migrated = deserializeState(JSON.stringify(legacy));
  assert.equal(migrated.schemaVersion, 14);
  assert.equal(typeof migrated.residents[0].memories[0], "object");
  assert.equal(migrated.residents[0].memories[0].privateMemory, true);
  assert.equal(typeof migrated.priest.promises[0], "object");
  assert.equal(migrated.replayBase.kind, "migration");

  const active = createGame("schema-three-mid-visit");
  beginVisit(active);
  recordExchange(active, "Tell the truth.", fallbackConversation(active, "Tell the truth."));
  const activeLegacy = JSON.parse(JSON.stringify(active));
  activeLegacy.version = 3;
  activeLegacy.schemaVersion = 3;
  delete activeLegacy.nextMemorySequence;
  delete activeLegacy.nextPositionSequence;
  delete activeLegacy.priest.positions;
  delete activeLegacy.priest.confidentialityBreaches;
  activeLegacy.residents.forEach((resident) => {
    resident.memories = resident.memories.map((memory) => memory.summary);
    delete resident.publicBackstory;
  });
  delete activeLegacy.currentVisit.intent;
  delete activeLegacy.currentVisit.disclosure;
  delete activeLegacy.currentVisit.hiddenConcernDisclosed;
  for (const command of activeLegacy.commandLog.filter((entry) => entry.type === "conversation_exchange")) {
    delete command.payload.response.intents;
    delete command.payload.response.disclosure;
    delete command.payload.response.contradictionId;
  }
  delete activeLegacy.integrityHash;
  sealState(activeLegacy);
  const migratedActive = deserializeState(JSON.stringify(activeLegacy));
  assert.equal(migratedActive.currentVisit.turnsUsed, 1);
  assert.equal(migratedActive.replayBase.snapshot.currentVisit.turnsUsed, 1);
});
