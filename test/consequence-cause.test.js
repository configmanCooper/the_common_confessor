import assert from "node:assert/strict";
import test from "node:test";
import {
  beginVisit,
  createGame,
  executeDueCommitments,
  finishVisit,
  materializeResident
} from "../js/simulation.js";

/* A consequence must be about the thing that actually happened.
 *
 * A villager who had kept a promise used to return saying only that he
 * "returns to report what happened after keeping the promise". The causal
 * pointer existed in state - the commitment, the event that fulfilled it, the
 * person it concerned - but none of it travelled with the summons, so the
 * visitor arrived with no subject and talked about whatever came to hand. One
 * man came back to report on a promise and spent the visit discussing firewood.
 */

function parishWithAPromise(seed) {
  const state = createGame(seed);
  const visit = beginVisit(state);
  const actor = materializeResident(state, visit.personId, true);
  const concerned = state.residents.find((person) => (
    person.alive !== false && person.id !== actor.id && person.age >= 18
  ));
  state.commitments.push({
    id: "commitment-000999",
    type: "npc_intention",
    actorId: actor.id,
    targetId: concerned.id,
    dueDay: state.calendar.absoluteDay,
    status: "open",
    sourceEventId: state.events.at(-1)?.id ?? null,
    payload: { text: "speak to the reeve about the boundary stones" }
  });
  executeDueCommitments(state, state.events.at(-1)?.id ?? null);
  const queued = (state.eventQueue || []).find((event) => event.type === "resident_followup");
  return { state, actor, concerned, queued };
}

test("a resolved promise queues a follow-up that carries its cause", () => {
  const { actor, concerned, queued } = parishWithAPromise("promise-cause");
  assert.ok(queued, "keeping or breaking a promise queued nothing at all");
  assert.equal(queued.sourcePersonId, actor.id);
  assert.equal(queued.payload.commitmentId, "commitment-000999");
  assert.ok(queued.sourceEventId, "the follow-up has no pointer to the event that caused it");
  assert.equal(queued.payload.promise, "speak to the reeve about the boundary stones");
  assert.equal(typeof queued.payload.kept, "boolean");
  assert.equal(queued.payload.concernedName, concerned.name);
  /* The written reason must name the promise and the person, not merely say
     that somebody is returning to report. */
  assert.match(queued.reason, /speak to the reeve about the boundary stones/);
  assert.match(queued.reason, new RegExp(concerned.name));
  assert.doesNotMatch(queued.reason, /returns to report what happened/);
});

test("the visitor opens on the promise, and on whether they kept it", () => {
  for (const seed of ["promise-open-a", "promise-open-b", "promise-open-c", "promise-open-d"]) {
    const { state, actor, queued } = parishWithAPromise(seed);
    if (!queued) continue;
    finishVisit(state);
    state.calendar.absoluteDay += 1;
    state.calendar.dayIndex = 1;
    state.calendar.slot = 0;
    let opening = null;
    for (let index = 0; index < 4; index += 1) {
      let visit = null;
      try {
        visit = beginVisit(state);
      } catch {
        break;
      }
      if (!visit) break;
      if (visit.personId === actor.id) {
        opening = visit.issue.opening;
        break;
      }
      finishVisit(state);
    }
    assert.ok(opening, `${seed}: the villager never came back about the promise`);
    assert.match(
      opening,
      /I said I would speak to the reeve about the boundary stones/,
      `${seed}: the visitor did not open on the promise: ${opening}`
    );
    /* Saying they kept it when they did not would be worse than saying nothing. */
    const opensAsKept = /what came of it/.test(opening);
    assert.equal(
      opensAsKept,
      queued.payload.kept,
      `${seed}: the opening and the record disagree about whether the promise was kept`
    );
  }
});
