import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applySermon,
  beginVisit,
  createGame,
  fallbackConversation,
  fallbackDeparturePlan,
  fallbackSermonOutcome,
  finishVisit,
  materializeResident,
  recordExchange,
  replayGame,
  sundayAttendance
} from "../js/simulation.js";
import {
  compactReplayHistory,
  deserializeState,
  sealState,
  serializeState,
  STATE_SCHEMA_VERSION
} from "../js/state.js";

test("state round-trips through the authoritative schema", () => {
  const state = createGame("round-trip-seed");
  beginVisit(state);
  const restored = deserializeState(serializeState(state));
  assert.deepEqual(restored, state);
  assert.equal(restored.schemaVersion, STATE_SCHEMA_VERSION);
});

test("offline wary dialogue remains valid and saveable", () => {
  const state = createGame("wary-fallback-seed");
  beginVisit(state);
  const response = fallbackConversation(state, "You should leave the village if danger comes.");
  assert.equal(response.mood, "wary");
  recordExchange(state, "You should leave the village if danger comes.", response);
  assert.doesNotThrow(() => serializeState(state));
});

test("state validation rejects corrupt references", () => {
  const state = createGame("corruption-seed");
  state.residents[0].relationshipIds.push("person-missing");
  assert.throws(() => serializeState(state), /missing relationship/);

  const rumorState = createGame("missing-rumor-source");
  rumorState.rumors.push({
    id: "rumor-000001",
    originatorId: rumorState.residents[0].id,
    subjectId: rumorState.residents[1].id,
    claim: "A dangling rumor.",
    truth: 50,
    intensity: 2,
    sourceEventId: "event-missing",
    createdDay: 0,
    heardByIds: [rumorState.residents[0].id],
    active: true
  });
  rumorState.nextRumorSequence = 2;
  assert.throws(() => serializeState(rumorState), /Rumor .* missing source event/);
});

test("state validation rejects malformed visits, causal references, and counters", () => {
  const malformedVisit = createGame("malformed-visit-seed");
  beginVisit(malformedVisit);
  delete malformedVisit.currentVisit.history;
  assert.throws(() => serializeState(malformedVisit), /history/);

  const badEvent = createGame("bad-event-seed");
  badEvent.events[0].actorId = "person-missing";
  assert.throws(() => serializeState(badEvent), /missing actor/);

  const badOrigin = createGame("bad-origin-seed");
  beginVisit(badOrigin);
  badOrigin.currentVisit.originEventId = "event-missing";
  assert.throws(() => serializeState(badOrigin), /missing origin event/);

  const badCounter = createGame("bad-counter-seed");
  badCounter.nextEventSequence = 1;
  assert.throws(() => serializeState(badCounter), /duplicate ID/);

  const externalVisit = createGame("external-visit-seed");
  externalVisit.externalActors.push({
    id: "external-001",
    name: "Visitor",
    role: "bishop",
    active: true,
    sprite: 0,
    relationshipIds: [],
    memories: []
  });
  beginVisit(externalVisit);
  externalVisit.currentVisit.personId = "external-001";
  assert.throws(() => serializeState(externalVisit), /must reference a resident/);

  const cycle = createGame("event-cycle-seed");
  cycle.events[0].parentId = cycle.events[1].id;
  assert.throws(() => serializeState(cycle), /non-prior parent/);

  const missingResidentField = createGame("missing-resident-field-seed");
  delete missingResidentField.residents[0].memories;
  assert.throws(() => serializeState(missingResidentField), /Memories/);

  const missingCoreFields = createGame("missing-core-fields-seed");
  delete missingCoreFields.town.name;
  delete missingCoreFields.priest.alive;
  delete missingCoreFields.households[0].wealth;
  missingCoreFields.statistics.conversations = "corrupt";
  missingCoreFields.settings.aiEnabled = {};
  assert.throws(() => serializeState(missingCoreFields), /Town name/);
});

test("command and accepted AI proposal audit data must match exactly", () => {
  const unknown = createGame("unknown-command-seed");
  unknown.commandLog.push({
    id: "command-000001",
    sequence: 1,
    day: 0,
    slot: 0,
    type: "unknown_command",
    source: "simulation",
    payload: {}
  });

  test("large AI proposal logs validate in linear time", () => {
    const state = createGame("large-command-log-seed");
    const actorId = state.residents[0].id;
    const commands = [];
    const proposals = [];
    let sequence = 1;
    for (let visitIndex = 0; visitIndex < 500; visitIndex += 1) {
      commands.push({
        id: `command-${String(sequence).padStart(6, "0")}`,
        sequence,
        day: 0,
        slot: 0,
        type: "begin_visit",
        source: "simulation",
        payload: { personId: actorId, visitId: `synthetic-${visitIndex}` }
      });
      sequence += 1;
      for (let turn = 0; turn < 10; turn += 1) {
        const commandId = `command-${String(sequence).padStart(6, "0")}`;
        commands.push({
          id: commandId,
          sequence,
          day: 0,
          slot: 0,
          type: "conversation_exchange",
          source: "ai",
          payload: {
            playerText: `Counsel ${turn}`,
            response: {
              reply: `Reply ${turn}`,
              mood: "resolved",
              trustDelta: 0,
              stressDelta: 0,
              memory: "",
              intents: ["neutral"],
              disclosure: 10,
              contradictionId: null
            }
          }
        });
        proposals.push({
          id: `proposal-${String(proposals.length + 1).padStart(6, "0")}`,
          commandId
        });
        sequence += 1;
      }
      commands.push({
        id: `command-${String(sequence).padStart(6, "0")}`,
        sequence,
        day: 0,
        slot: 0,
        type: "finish_visit",
        source: "simulation",
        payload: {
          plan: {
            summary: "Synthetic visit complete.",
            steps: [{
              depth: 1,
              actorId,
              targetId: null,
              actionType: "keep_silence",
              intensity: 1,
              title: "keep silence",
              description: "The visitor kept silence.",
              detail: "",
              decisionScore: 50
            }]
          }
        }
      });
      sequence += 1;
    }
    state.commandLog = commands;
    state.aiProposals = proposals;
    state.nextCommandSequence = sequence;
    const started = performance.now();
    serializeState(state);
    assert.ok(performance.now() - started < 1500);
    compactReplayHistory(state);
    assert.equal(state.commandLog.length, 0);
    assert.equal(state.aiProposals.length, 0);
    assert.ok(serializeState(state).length < 1_500_000);
  });
  unknown.nextCommandSequence = 2;
  assert.throws(() => serializeState(unknown), /Unknown command type/);

  const missingProposal = createGame("missing-proposal-seed");
  beginVisit(missingProposal);
  recordExchange(missingProposal, "Listen.", { ...fallbackConversation(missingProposal, "Listen."), source: "ai" });
  missingProposal.aiProposals = [];
  assert.throws(() => serializeState(missingProposal), /no accepted proposal/);

  const duplicate = createGame("duplicate-proposal-seed");
  beginVisit(duplicate);
  recordExchange(duplicate, "Listen.", { ...fallbackConversation(duplicate, "Listen."), source: "ai" });
  duplicate.aiProposals.push({ ...duplicate.aiProposals[0], id: "proposal-000002" });
  assert.throws(() => serializeState(duplicate), /multiple proposals/);

  const malformedPayload = createGame("malformed-command-payload-seed");
  beginVisit(malformedPayload);
  recordExchange(malformedPayload, "Listen.", fallbackConversation(malformedPayload, "Listen."));
  delete malformedPayload.commandLog[1].payload.response.reply;
  assert.throws(() => serializeState(malformedPayload), /no reply/);

  const excessiveTurns = createGame("excessive-turn-command-seed");
  beginVisit(excessiveTurns);
  for (let index = 0; index < 10; index += 1) {
    recordExchange(excessiveTurns, `Counsel ${index}`, fallbackConversation(excessiveTurns, `Counsel ${index}`));
  }
  const forged = JSON.parse(serializeState(excessiveTurns));
  const extra = JSON.parse(JSON.stringify(forged.commandLog.at(-1)));
  extra.id = "command-000012";
  extra.sequence = 12;
  forged.commandLog.push(extra);
  forged.nextCommandSequence = 13;
  sealState(forged);
  assert.throws(() => deserializeState(JSON.stringify(forged)), /ten-exchange/);
});

test("legacy schema fixture migrates to the current schema", async () => {
  const fixture = await readFile(new URL("./fixtures/schema-v1.json", import.meta.url), "utf8");
  const migrated = deserializeState(fixture);
  assert.equal(migrated.schemaVersion, STATE_SCHEMA_VERSION);
  assert.ok(migrated.priest);
  assert.ok(migrated.households.length > 0);
  assert.ok(migrated.events.length > 0);
});

test("legacy migration rejects fractional or inconsistent calendars", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/schema-v1.json", import.meta.url), "utf8"));
  fixture.calendar.slot = 0.5;
  assert.throws(() => deserializeState(JSON.stringify(fixture)), /Calendar slot/);
  fixture.calendar.slot = 0;
  fixture.calendar.week = 3;
  assert.throws(() => deserializeState(JSON.stringify(fixture)), /inconsistent/);
});

test("legacy migration rejects empty or wholly inactive resident rosters", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/schema-v1.json", import.meta.url), "utf8"));
  fixture.residents = [];
  assert.throws(() => deserializeState(JSON.stringify(fixture)), /no active resident roster/);
  const inactive = JSON.parse(await readFile(new URL("./fixtures/schema-v1.json", import.meta.url), "utf8"));
  inactive.residents.forEach((resident) => {
    resident.active = false;
  });
  assert.throws(() => deserializeState(JSON.stringify(inactive)), /no active resident roster/);
});

test("integrity seals reject replay-divergent imported state", () => {
  const state = createGame("integrity-divergence-seed");
  beginVisit(state);
  const serialized = serializeState(state);
  const changedVisit = JSON.parse(serialized);
  changedVisit.currentVisit.turnsUsed = 7;
  assert.throws(() => deserializeState(JSON.stringify(changedVisit)), /turn count|integrity check failed/);
  const changedTown = JSON.parse(serialized);
  changedTown.town.metrics.faith = 99;
  assert.throws(() => deserializeState(JSON.stringify(changedTown)), /integrity check failed/);
  sealState(changedTown);
  assert.throws(() => deserializeState(JSON.stringify(changedTown)), /canonical replay/);

  const forgedCheckpoint = JSON.parse(serialized);
  forgedCheckpoint.town.metrics.faith = 99;
  const forgedSnapshot = JSON.parse(JSON.stringify(forgedCheckpoint));
  forgedSnapshot.replayBase = null;
  forgedSnapshot.commandLog = [];
  forgedSnapshot.aiProposals = [];
  forgedSnapshot.nextCommandSequence = 1;
  sealState(forgedSnapshot);
  forgedCheckpoint.replayBase = {
    legacySchemaVersion: 1,
    snapshot: forgedSnapshot
  };
  sealState(forgedCheckpoint);
  assert.throws(() => deserializeState(JSON.stringify(forgedCheckpoint)), /Replay base/);
});

test("canonical replay authenticates command metadata", () => {
  const state = createGame("forged-command-metadata-seed");
  beginVisit(state);
  const forgedDay = JSON.parse(serializeState(state));
  forgedDay.commandLog[0].day = 99;
  sealState(forgedDay);
  assert.throws(() => deserializeState(JSON.stringify(forgedDay)), /Replay metadata mismatch/);

  const forgedVisit = JSON.parse(serializeState(state));
  forgedVisit.commandLog[0].payload.visitId = "forged-visit";
  sealState(forgedVisit);
  assert.throws(() => deserializeState(JSON.stringify(forgedVisit)), /Replay visitor mismatch/);
});

test("imported AI proposals pass the same conversation and sermon validators", () => {
  const conversation = createGame("imported-ai-conversation-seed");
  beginVisit(conversation);
  recordExchange(conversation, "Listen.", {
    ...fallbackConversation(conversation, "Listen."),
    source: "ai"
  });
  const forgedConversation = JSON.parse(serializeState(conversation));
  forgedConversation.commandLog[1].payload.response.mood = "ecstatic";
  sealState(forgedConversation);
  assert.throws(() => deserializeState(JSON.stringify(forgedConversation)), /conversation audit mismatch/);

  const sermon = createGame("imported-ai-sermon-seed");
  while (sermon.calendar.dayIndex !== 6) {
    beginVisit(sermon);
    finishVisit(sermon, { ...fallbackDeparturePlan(sermon), source: "fallback" });
  }
  const attendees = sundayAttendance(sermon);
  const attendeeIds = new Set(attendees.map((person) => person.id));
  const nonAttendee = sermon.residents.find((person) => !attendeeIds.has(person.id));
  assert.ok(nonAttendee, "test seed must have a non-attendee");
  const outcome = fallbackSermonOutcome(sermon, "Mercy", "Let mercy guide us.");
  outcome.notableEffects = [{
    personId: nonAttendee.id,
    faithDelta: 2,
    moraleDelta: 1,
    attendanceDelta: 1,
    memory: "Did not hear this sermon."
  }];
  applySermon(sermon, "Mercy", "Let mercy guide us.", { ...outcome, source: "ai" });
  const forgedSermon = serializeState(sermon);
  assert.throws(() => deserializeState(forgedSermon), /non-attendee/);
});

test("legacy newest-first chronicles migrate into chronological causal events", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/schema-v1.json", import.meta.url), "utf8"));
  fixture.chronicle = [
    { day: 1, title: "Tuesday begins", text: "Newest", tone: "neutral" },
    { day: 0, title: "Register opens", text: "Middle", tone: "faith" },
    { day: 0, title: "World begins", text: "Oldest", tone: "neutral" }
  ];
  const migrated = deserializeState(JSON.stringify(fixture));
  assert.equal(migrated.events[0].facts.title, "World begins");
  assert.equal(migrated.events[0].parentId, null);
  assert.equal(migrated.events[2].facts.title, "Tuesday begins");
  assert.equal(migrated.events[2].parentId, migrated.events[1].id);
  assert.equal(migrated.chronicle[0].eventId, migrated.events[2].id);
});

test("legacy replay checkpoints reproduce migrated inactive and active states", async () => {
  const fixture = await readFile(new URL("./fixtures/schema-v1.json", import.meta.url), "utf8");
  const inactive = deserializeState(fixture);
  const inactiveReplay = replayGame(inactive.seed, inactive.commandLog, inactive.replayBase);
  assert.deepEqual(inactiveReplay.residents, inactive.residents);
  assert.deepEqual(inactiveReplay.events, inactive.events);

  const legacyActive = createGame("legacy-active-replay");
  beginVisit(legacyActive);
  const legacyJson = JSON.parse(JSON.stringify(legacyActive));
  legacyJson.version = 1;
  delete legacyJson.schemaVersion;
  delete legacyJson.priest;
  delete legacyJson.households;
  delete legacyJson.externalActors;
  delete legacyJson.eventQueue;
  delete legacyJson.commandLog;
  delete legacyJson.aiProposals;
  delete legacyJson.events;
  delete legacyJson.nextEventSequence;
  delete legacyJson.nextCommandSequence;
  delete legacyJson.replayBase;
  delete legacyJson.currentVisit.visitId;
  delete legacyJson.currentVisit.originEventId;
  const migratedActive = deserializeState(JSON.stringify(legacyJson));
  recordExchange(migratedActive, "Remain patient.", fallbackConversation(migratedActive, "Remain patient."));
  const activeReplay = replayGame(migratedActive.seed, migratedActive.commandLog, migratedActive.replayBase);
  assert.deepEqual(activeReplay.currentVisit, migratedActive.currentVisit);
  assert.deepEqual(activeReplay.residents, migratedActive.residents);
});

test("deferred profiles are independent of activation order", () => {
  const first = createGame("activation-order-seed");
  const second = createGame("activation-order-seed");
  const firstId = first.residents[12].id;
  const secondId = first.residents[88].id;
  const a1 = materializeResident(first, firstId, true);
  const b1 = materializeResident(first, secondId, true);
  const b2 = materializeResident(second, secondId, true);
  const a2 = materializeResident(second, firstId, true);
  assert.deepEqual(a1.personality, a2.personality);
  assert.deepEqual(a1.backstory, a2.backstory);
  assert.deepEqual(b1.personality, b2.personality);
  assert.deepEqual(b1.backstory, b2.backstory);
});

test("recorded AI proposals replay without model or network calls", () => {
  const state = createGame("replay-seed");
  beginVisit(state);
  const response = {
    ...fallbackConversation(state, "Tell the truth with mercy."),
    source: "ai"
  };
  recordExchange(state, "Tell the truth with mercy.", response);
  finishVisit(state, { ...fallbackDeparturePlan(state), source: "ai" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Replay attempted a network request");
  };
  try {
    const replayed = replayGame(state.seed, state.commandLog);
    assert.deepEqual(replayed.commandLog, state.commandLog);
    assert.deepEqual(replayed.town, state.town);
    assert.deepEqual(replayed.residents, state.residents);
    assert.deepEqual(replayed.events, state.events);
    assert.deepEqual(replayed.chronicle, state.chronicle);
    assert.deepEqual(replayed.aiProposals, state.aiProposals);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("periodic checkpoints replay later mid-visit commands", () => {
  const state = createGame("periodic-checkpoint-seed");
  beginVisit(state);
  finishVisit(state, { ...fallbackDeparturePlan(state), source: "fallback" });
  compactReplayHistory(state);
  assert.equal(state.commandLog.length, 0);
  beginVisit(state);
  recordExchange(state, "Remain patient.", fallbackConversation(state, "Remain patient."));
  const restored = deserializeState(serializeState(state));
  assert.deepEqual(restored.currentVisit, state.currentVisit);
  assert.deepEqual(restored.residents, state.residents);
  assert.equal(restored.replayBase.kind, "periodic");
});

test("rejected AI departures are recorded separately from accepted proposals", () => {
  const state = createGame("rejected-proposal-seed");
  const visit = beginVisit(state);
  finishVisit(state, {
    source: "ai",
    summary: "An invalid violent proposal.",
    steps: [{
      actorId: visit.personId,
      targetId: null,
      actionType: "kill_priest",
      intensity: 5
    }]
  });
  const command = state.commandLog.at(-1);
  assert.equal(command.type, "finish_visit");
  assert.equal(command.source, "fallback");
  assert.equal(command.payload.resolution, "fallback_after_rejection");
  assert.equal(command.payload.rejectedProposal.steps[0].actionType, "kill_priest");
  assert.equal(state.aiProposals.length, 0);
});

test("partially invalid AI departure chains are rejected in full", () => {
  const state = createGame("partial-ai-rejection-seed");
  const visit = beginVisit(state);
  visit.eventLicense = "ordinary";
  const actor = state.residents.find((person) => person.id === visit.personId);
  const targetId = actor.relationshipIds[0];
  finishVisit(state, {
    source: "ai",
    summary: "A partly invalid plan.",
    steps: [
      {
        actorId: actor.id,
        targetId,
        actionType: "visit",
        intensity: 2
      },
      {
        actorId: targetId,
        targetId: null,
        actionType: "confess_publicly",
        intensity: 5
      }
    ]
  });

  test("oversized AI departure chains are rejected before truncation", () => {
    const state = createGame("oversized-ai-rejection-seed");
    const visit = beginVisit(state);
    finishVisit(state, {
      source: "ai",
      summary: "Four steps are not permitted.",
      steps: Array.from({ length: 4 }, () => ({
        actorId: visit.personId,
        targetId: null,
        actionType: "keep_silence",
        intensity: 1
      }))
    });
    const command = state.commandLog.at(-1);
    assert.equal(command.source, "fallback");
    assert.equal(command.payload.resolution, "fallback_after_rejection");
    assert.equal(command.payload.rejectedProposal.submittedStepCount, 4);
    assert.equal(command.payload.rejectedProposal.steps.length, 4);
    assert.equal(state.aiProposals.length, 0);
  });
  const command = state.commandLog.at(-1);
  assert.equal(command.source, "fallback");
  assert.equal(command.payload.resolution, "fallback_after_rejection");
  assert.equal(command.payload.rejectedProposal.steps.length, 2);
  assert.equal(state.aiProposals.length, 0);
});
