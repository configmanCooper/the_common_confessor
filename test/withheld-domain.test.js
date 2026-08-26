/* A withheld secret still has to be a secret about something.

   A reticent penitent opens with "Something I did after market closed, beside
   the mill road, may cause another person to suffer" - the hour, the place,
   the whispering, and nothing whatever about the matter. That much is right:
   the matter is the secret, and the model must not be told it until the
   visitor discloses it.

   But a model that has to produce a first line supplies the missing subject
   itself, and it has no reason to supply the one on file. In a watched run a
   confession recorded as a hidden fever was spoken as the theft of wood from a
   cart, and from that line onward the visit, its consequences, its follow-ups
   and every audit of it hung on a thread whose own summary was a lie.

   It is the same hole the premise inertia came out of: a villager seeded with
   a deed he was never told will hunt for one forever, because nothing he can
   establish is ever the thing he came to confess.

   So the kind of matter is given while the deed is not. */

import test from "node:test";
import assert from "node:assert/strict";

import { createGame, beginVisit } from "../js/simulation.js";
import { withheldDomain, withheldDomains, ParishAiClient } from "../js/ai.js";

/** A parish where somebody arrives with something they are not yet saying. */
function aGuardedConfession() {
  for (let index = 0; index < 200; index += 1) {
    const state = createGame(`withheld-domain-${index}`);
    const visit = beginVisit(state);
    if (visit.issue.kind === "confession" && !visit.hiddenConcernDisclosed) {
      return { state, visit };
    }
  }
  return null;
}

test("a guarded visitor is told what kind of matter he is holding back", () => {
  const found = aGuardedConfession();
  assert.ok(found, "no guarded confession could be generated");

  const said = withheldDomain(found.visit);
  assert.ok(said, "a guarded visitor was given no sense of his own subject at all");
  assert.match(said, /would answer with/);
});

test("every guarded confession is bounded, and none of them by naming the deed", () => {
  /* Two sources of scenarios exist - the generated catalogue, which carries
     response domains, and the older hand-written ones, which do not. A visitor
     from either must be bounded, or the fault survives in half the parish.

     And the bound must not be the deed. The hand-written scenarios are named
     after what was done - hidden_illness, secret_pregnancy, corrupt_measure -
     so an earlier version of this that humanised the id handed the model a
     serviceable one-line confession in the same breath as telling it to say
     nothing of the matter. Checking one arbitrary visit missed that entirely:
     the first guarded confession in this seed range happens to be the one
     scenario whose name shares no word with its own secret. */
  let guarded = 0;
  const silent = [];
  const namedByTheDeed = [];
  const improvised = [];
  for (let index = 0; index < 120; index += 1) {
    const state = createGame(`withheld-domain-sweep-${index}`);
    const visit = beginVisit(state);
    if (visit.issue.kind !== "confession" || visit.hiddenConcernDisclosed) continue;
    guarded += 1;
    const said = withheldDomain(visit);
    const scenarioId = visit.issue.scenarioId || "(unnamed)";
    if (!said) {
      silent.push(scenarioId);
      continue;
    }
    /* The fault itself: the bound must never be the scenario's own name, with
       or without its variant number. */
    const asWords = String(scenarioId).replace(/_\d+$/, "").replace(/_/g, " ");
    if (asWords && said.includes(asWords)) namedByTheDeed.push(scenarioId);
    /* And it must come from the catalogue's abstract vocabulary rather than
       being made up on the spot, which is what keeps it abstract at all. */
    const domains = withheldDomains(visit) || [];
    if (!domains.length || domains.some((domain) => typeof domain !== "string" || !domain.trim())) {
      improvised.push(scenarioId);
    }
  }
  assert.ok(guarded >= 5, `too few guarded confessions gathered: ${guarded}`);
  assert.deepEqual([...new Set(silent)], [], "these scenarios bound nothing");
  assert.deepEqual([...new Set(namedByTheDeed)], [], "these scenarios gave the secret away");
  assert.deepEqual([...new Set(improvised)], [], "these scenarios invented their own domains");
});

test("the deed itself is never in it", () => {
  /* The whole constraint. Bounding the subject must not disclose the secret,
     or it has traded one fault for a worse one. */
  const found = aGuardedConfession();
  const said = withheldDomain(found.visit);
  const secret = String(found.visit.intent.hiddenConcern || "");
  assert.ok(secret, "the visit had no hidden concern to protect");

  for (const word of secret.toLowerCase().match(/[a-z]{5,}/g) || []) {
    assert.ok(
      !said.toLowerCase().includes(word),
      `"${word}" leaked out of the secret and into the instruction: ${said}`
    );
  }
});

test("the catalogue's own tags are used when it has them", () => {
  const said = withheldDomain({
    issue: { blueprint: { responseDomains: ["medical", "warning", "isolation", "privacy"] } }
  });
  for (const domain of ["medical", "warning", "isolation", "privacy"]) {
    assert.ok(said.includes(domain), `the domain "${domain}" was not passed on`);
  }
});

test("a hand-written scenario borrows the abstract tags of its catalogue twin", () => {
  /* Its own name is the deed, so it cannot be used. Each hand-written
     scenario is mapped to the catalogue family covering the same ground. */
  const said = withheldDomain({ issue: { scenarioId: "hidden_illness" } });
  assert.ok(said, "a hand-written scenario was left with no bound at all");
  assert.ok(!said.includes("hidden illness"), said);
  assert.ok(said.includes("medical"), said);
  assert.ok(said.includes("isolation"), said);
});

test("no scenario is ever bounded by its own name", () => {
  /* The exact shape of the fault, kept as its own guard. Every hand-written
     confession scenario names the deed in its id. */
  const named = [
    "hidden_illness", "secret_pregnancy", "corrupt_measure", "inheritance_document",
    "marriage_coercion", "missing_relic", "poaching_hunger", "stolen_food_false_accusation"
  ];
  for (const scenarioId of named) {
    const said = withheldDomain({ issue: { scenarioId } });
    const asWords = scenarioId.replace(/_/g, " ");
    assert.ok(!said.includes(asWords), `${scenarioId} was bounded by its own name: ${said}`);
  }
});

test("a returning visit is bounded even though it lost its blueprint", () => {
  /* An issue rebuilt from a thread carries no blueprint, so the domains have
     to be found from the family name instead. Without this every returning
     guarded confession fell through to whatever the fallback was. */
  const said = withheldDomain({ issue: { scenarioId: "false_weights_1" } });
  assert.ok(said.includes("market measure"), said);
  assert.ok(!said.includes("false weights"), said);
});

test("the variant number is not mistaken for part of the subject", () => {
  const said = withheldDomain({ issue: { scenarioId: "hidden_contagion_2" } });
  assert.ok(said.includes("medical"), said);
  assert.ok(!/\d/.test(said), said);
});

test("machine tags are put into words a person could read", () => {
  const said = withheldDomain({
    issue: { blueprint: { responseDomains: ["immediate_safety", "market_measure"] } }
  });
  assert.ok(said.includes("immediate safety"));
  assert.ok(said.includes("market measure"));
  assert.ok(!said.includes("_"));
});

test("a visit with no scenario behind it is left alone", () => {
  /* No bound at all is better than a bound that gives the secret away, so a
     scenario with no family behind it says nothing rather than improvising. */
  assert.equal(withheldDomain(null), "");
  assert.equal(withheldDomain({}), "");
  assert.equal(withheldDomain({ issue: {} }), "");
  assert.equal(withheldDomain({ issue: { blueprint: {} } }), "");
  assert.equal(withheldDomain({ issue: { blueprint: { responseDomains: [] } } }), "");
  /* A thread whose scenarioId defaulted to the issue kind must not produce
     "a matter of confession". */
  assert.equal(withheldDomain({ issue: { scenarioId: "confession" } }), "");
  assert.equal(withheldDomain({ issue: { scenarioId: "village_concern" } }), "");
});

test("the domains are told, but the visitor is still told to hold his tongue", () => {
  const found = aGuardedConfession();
  const said = withheldDomain(found.visit);
  assert.match(said, /nothing of the thing itself yet/i);
});

test("the opening prompt carries the bound, since that is the line that went wrong", () => {
  /* The failure was that the villager OPENED by confessing a theft the record
     knew nothing about. That first line is not written by the conversation
     prompt - it comes from a separate opening prompt with its own context, and
     for a guarded confession that context is given no permitted facts at all.
     Bounding only the later turns would leave the invented deed already fixed
     in the record before the bound was ever applied. */
  const found = aGuardedConfession();
  const domains = withheldDomains(found.visit);
  assert.ok(domains?.length, "the visit had no domains to pass on");

  let prompt = "";
  const client = new ParishAiClient({
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      prompt = body.messages.map((message) => message.content).join("\n");
      throw new Error("stop here — the prompt is all this test wants");
    }
  });
  const person = found.state.residents.find((resident) => resident.id === found.visit.personId);

  return client.opening(found.state, person).then(
    () => assert.fail("the stub should not have returned a reply"),
    () => {
      assert.ok(prompt, "no prompt was built");
      assert.match(prompt, /withheldDomains/);
      for (const domain of domains) {
        /* The opening prompt humanizes the tags too, so the model is not shown
           the same domain two different ways in two different prompts. */
        assert.ok(
          prompt.includes(String(domain).replace(/_/g, " ")),
          `the opening prompt was never told about "${domain}"`
        );
      }
      /* And they must be given as the remedy they are, not as the matter. */
      assert.match(prompt, /answer this trouble with - not the trouble itself/);
    }
  );
});

test("a visitor who has already spoken plainly is given no such bound", () => {
  /* The bound exists only to stop a guarded villager inventing a subject. Once
     the matter is out it would be telling him what he has already said, and it
     must not reach the opening prompt at all. */
  const found = aGuardedConfession();
  found.visit.hiddenConcernDisclosed = true;

  let prompt = "";
  const client = new ParishAiClient({
    fetchImpl: async (_url, options) => {
      prompt = JSON.parse(options.body).messages.map((message) => message.content).join("\n");
      throw new Error("stop here — the prompt is all this test wants");
    }
  });
  const person = found.state.residents.find((resident) => resident.id === found.visit.personId);

  return client.opening(found.state, person).then(
    () => assert.fail("the stub should not have returned a reply"),
    () => {
      assert.ok(prompt, "no prompt was built");
      assert.match(prompt, /"withheldDomains":\[\]/, "a disclosed visitor was still bounded");
    }
  );
});

test("the domains steer the opening but do not license it", () => {
  /* The grounding check whitelists whatever appears anywhere in the context.
     Putting the domains into that context let a guarded opening speak of a
     debt merely because "debt" is one of the tags of coerced_marriage and
     blackmail_letter - the withheld matter leaking out through the validator
     rather than the prompt, and money invented in the visitor's first line. */
  const found = aGuardedConfession();
  found.visit.issue.scenarioId = "coerced_marriage_1";
  found.visit.issue.blueprint = null;
  assert.ok(
    (withheldDomains(found.visit) || []).includes("debt"),
    "this scenario was supposed to carry the debt tag"
  );

  const client = new ParishAiClient({
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            opening: "I have carried a debt I never told you of, Father, and it presses on me. "
              + "I cannot say the whole of it plainly. What would you have me do, Father?"
          })
        }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  const person = found.state.residents.find((resident) => resident.id === found.visit.personId);

  return client.opening(found.state, person).then(
    () => assert.fail("an invented debt was allowed into the opening"),
    (error) => assert.match(
      error.message,
      /unsupported opening material: debt/,
      `refused, but for the wrong reason: ${error.message}`
    )
  );
});

test("a remedy is offered as a remedy, not as the trouble", () => {
  /* The tags are what a priest could DO about a matter - the catalogue calls
     them response domains. Told that they are the matter, the likeliest way a
     model obeys is to have the penitent open by asking for food relief, which
     is a different wrong opening and puts a claim on church stores in his
     first line. */
  const said = withheldDomain({
    issue: { blueprint: { responseDomains: ["food_relief", "restitution"] } }
  });
  assert.match(said, /would answer with/);
  assert.match(said, /do not ask for any of that outright/);
  assert.match(said, /it is the remedy/);
  assert.ok(!said.includes("is a matter of food relief"), said);
});

/** Walk one parish until somebody comes back about a matter still unsettled. */
function returningConfessions(limit = 3) {
  const state = createGame("returning-confessions");
  const seen = [];
  for (let index = 0; index < 200 && seen.length < limit; index += 1) {
    const visit = beginVisit(state);
    if (visit.issue.returningIssue && visit.issue.kind === "confession") {
      seen.push({
        state,
        visit,
        person: state.residents.find((resident) => resident.id === visit.personId),
        thread: state.issueThreads.find((entry) => entry.id === visit.issue.threadId)
      });
    }
    state.currentVisit = null;
    state.calendar.slot += 1;
    if (state.calendar.slot > 3) {
      state.calendar.slot = 0;
      state.calendar.absoluteDay += 1;
    }
  }
  return seen;
}

test("a returning penitent does not restate the thing he is still guarding", () => {
  /* The opening read "I have returned because this matter remains unresolved:
     <the whole summary>" - the hidden concern verbatim - so a villager the
     engine still had guarding his secret arrived having already said it, and
     the transcript and the record disagreed from his first line. */
  const returning = returningConfessions();
  assert.ok(returning.length, "no returning confession occurred in this parish");

  const guarded = returning.filter((entry) => entry.visit.issue.openingDisclosesHidden === false);
  assert.ok(guarded.length, "no returning confession was still guarded");
  for (const entry of guarded) {
    assert.ok(
      !entry.visit.issue.opening.includes(entry.thread.summary),
      `a guarded returning opening restated the secret: ${entry.visit.issue.opening}`
    );
  }
});

test("a candid returning penitent still says plainly why he has come", () => {
  /* Guarding the reticent must not silence everybody else. */
  const open = returningConfessions()
    .filter((entry) => entry.visit.issue.openingDisclosesHidden !== false);
  for (const entry of open) {
    assert.ok(
      entry.visit.issue.opening.includes(entry.thread.summary),
      `a candid returning opening lost its subject: ${entry.visit.issue.opening}`
    );
  }
});

test("a secret once told is not guarded all over again", () => {
  /* Disclosure used to leave no mark on the thread, only on the visit. A
     reticent villager who fully confessed on one day and came back about the
     same unresolved matter was made to withhold it a second time, and the
     priest had to draw out something he had already been told. */
  const returning = returningConfessions(6);
  const guarded = returning.find((entry) => entry.visit.issue.openingDisclosesHidden === false);
  assert.ok(guarded, "no returning confession was still guarded");
  assert.ok(
    !guarded.thread.secretDisclosed,
    "this thread was supposed to be one whose secret was never told"
  );

  /* Mark it told, and the same villager should come back speaking plainly. */
  guarded.thread.secretDisclosed = true;
  const state = guarded.state;
  for (let index = 0; index < 200; index += 1) {
    const visit = beginVisit(state);
    const isSame = visit.issue.returningIssue && visit.issue.threadId === guarded.thread.id;
    state.currentVisit = null;
    state.calendar.slot += 1;
    if (state.calendar.slot > 3) {
      state.calendar.slot = 0;
      state.calendar.absoluteDay += 1;
    }
    if (isSame) {
      assert.equal(
        visit.issue.openingDisclosesHidden,
        true,
        `a secret already told was guarded again: ${visit.issue.opening}`
      );
      return;
    }
  }
  assert.fail("that thread never came back to be checked");
});
