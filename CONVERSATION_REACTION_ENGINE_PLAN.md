# Conversation Reaction Engine Plan

## 1. Purpose

This phase makes every visitor response depend on the complete active appointment, not merely the newest priest statement plus a short excerpt of recent dialogue.

The visitor should accumulate an interpretation of the priest across the hour:

- Is the priest listening?
- Is the priest confused, dismissive, absurd, manipulative, cruel, threatening, sacrilegious, kind, practical, apologetic, or trustworthy?
- Has the priest answered the concern, changed the subject, repeated an offense, repaired prior harm, contradicted earlier counsel, respected a boundary, or escalated danger?
- Does this visitor feel safer, angrier, more ashamed, amused, confused, frightened, or determined than several turns earlier?
- Is the visitor still willing to continue the meeting?

The local model supplies natural characterization and prose. Deterministic simulation owns cumulative emotional state, threshold crossings, immediate actions, persistence, and replay.

## 2. Required outcome

Every conversation request will receive:

1. The complete active conversation, including the opening and every prior priest and visitor line.
2. The visitor's current cumulative reaction state.
3. The deterministic interpretation of the priest's newest line.
4. Relevant personality, relationship, issue-thread, material, knowledge, rumor, promise, and memory context.
5. Any reaction that the simulation requires the prose to express.

The same final sentence must be capable of producing different reactions depending on what happened earlier in the appointment.

Examples:

- “You should leave” after patient support may be received as painful but sincere counsel.
- “You should leave” after repeated insults may be understood as rejection or expulsion.
- A strange joke early in an ordinary conversation may amuse a witty visitor.
- The same joke after a death confession may deeply offend a solemn visitor.
- An apology after one offense may repair trust.
- An apology after repeated threats may be judged insincere and fail to stop departure.

## 3. Non-goals and hard boundaries

- Gemma never directly changes authoritative state.
- A single unusual statement must not cause violence.
- Prose alone cannot bypass age, capability, opportunity, relationship, health, consent, resource, location, or historical constraints.
- Visitors do not all react identically to the same speech.
- The engine does not force every hostile meeting into violence.
- Most severe conversations should result in boundaries, anger, crying, withdrawal, scandal, avoidance, reporting, or departure rather than assault.
- The complete current conversation is retained verbatim only for the active appointment. Long-term context remains structured and summarized.

## 4. Current limitations

The current system already provides:

- The newest priest statement.
- A recent conversation slice.
- Structured scenario facts.
- Trust, stress, disclosure, mood, memories, issue pressure, and personality.
- Deterministic intent classification and social-response backstops.

It does not yet provide:

- The guaranteed complete appointment transcript.
- Multi-dimensional cumulative emotional state.
- Structured records of repeated absurdity, cruelty, humiliation, threats, manipulation, or repair.
- Immediate threshold reactions such as crying, setting a boundary, leaving, calling for help, or attacking.
- A deterministic explanation for why an immediate reaction occurred.
- A strong distinction between an isolated bad line and a sustained pattern.

## 5. Authoritative visit schema

Schema version will advance from 13 to 14.

Every active visit will contain:

```js
reactionState: {
  trust: 0..100,
  fear: 0..100,
  anger: 0..100,
  sadness: 0..100,
  shame: 0..100,
  confusion: 0..100,
  amusement: 0..100,
  offense: 0..100,
  patience: 0..100,
  perceivedDanger: 0..100,
  willingnessToContinue: 0..100,

  kindnessCount: integer,
  practicalHelpCount: integer,
  absurdityCount: integer,
  insultCount: integer,
  humiliationCount: integer,
  crueltyCount: integer,
  threatCount: integer,
  sacrilegeCount: integer,
  coercionCount: integer,
  contradictionCount: integer,
  apologyCount: integer,
  repairCount: integer,
  ignoredQuestionCount: integer,
  repeatedOffenseCount: integer,

  activeTopic: string,
  boundary: null | {
    id: string,
    ownerId: string,
    type: BoundaryType,
    createdTurn: integer,
    triggerAuditId: string,
    status: "active" | "respected" | "violated" | "withdrawn",
    resolvedTurn: null | integer
  },
  lastReaction: Reaction,
  lastTriggerTurn: integer,
  endedEarly: boolean,
  endReason: EndReason | null
}
```

The visit will also contain:

```js
turnAudits: [{
  turn: integer,
  priestText: string,
  classification: {
    categories: string[],
    intensity: 0..5,
    directedAtVisitor: boolean,
    credibleThreat: boolean,
    topicRelation: string,
    repairedPriorHarm: boolean,
    violatedBoundary: boolean
  },
  deltas: {
    trust: integer,
    fear: integer,
    anger: integer,
    sadness: integer,
    shame: integer,
    confusion: integer,
    amusement: integer,
    offense: integer,
    patience: integer,
    perceivedDanger: integer,
    willingnessToContinue: integer
  },
  stateAfter: reactionState snapshot,
  requiredReaction: Reaction,
  thresholdReasons: string[],
  visibility: {
    scope: "private_confession" | "private_visit" | "public",
    authorizedPersonIds: string[]
  }
}]
```

## 6. Initial reaction state

Initial values derive deterministically from:

- Existing trust in the priest.
- Stress and morale.
- Personality dimensions and traits.
- Prior memories involving the priest.
- Relationship fear, resentment, familiarity, trust, and obligation.
- Issue gravity and danger.
- Meeting location.
- Priest scandal, authority, and local trust.
- Whether the person came voluntarily, was requested, was summoned, or represents authority.

Examples:

- A fearful, stressed visitor starts with lower patience and higher perceived danger.
- A witty visitor starts with greater tolerance for harmless absurdity.
- A proud visitor is more sensitive to humiliation.
- A devout visitor is more sensitive to sacrilege but more receptive to sincere prayer.
- A visitor previously threatened by the priest begins with elevated fear and lower trust.
- An official begins with greater patience for formal disagreement but lower patience for attempted coercion.

## 7. Newest-turn classification

Add a pure deterministic function:

```js
analyzePriestTurn(state, person, visit, text)
```

It returns bounded categories and intensity without mutating state.

Categories:

- compassionate
- validating
- practical
- clarifying
- prayerful
- apologetic
- humorous
- absurd
- confusing
- dismissive
- insulting
- humiliating
- cruel
- threatening
- coercive
- manipulative
- sacrilegious
- sexual_or_inappropriate
- power_seeking
- selfish
- contradictory
- boundary_respecting
- boundary_violating
- topic_continuing
- topic_changing
- factual_question
- farewell

Classification requirements:

- Process clause order and newest relevant clause.
- Respect negation.
- Distinguish reported speech from direct speech.
- Distinguish a question from a command.
- Distinguish third-party prayer advice from praying with the visitor.
- Detect repeated wording and repeated offenses.
- Detect explicit apologies and retractions.
- Detect whether the statement addresses an unresolved visitor question.
- Record references to earlier turns when possible.

## 8. Cumulative reaction calculation

Add a pure function:

```js
previewConversationReaction(state, person, visit, priestText)
```

It combines:

- Newest-turn categories and intensity.
- Current reaction state.
- Personality.
- Relationship with the priest.
- Existing trust and stress.
- Prior offenses and repairs in the same appointment.
- Current issue danger and vulnerability.
- Whether a prior boundary exists.
- Whether the priest has repeated or repaired the behavior.

The function returns:

```js
{
  classification,
  deltas,
  nextState,
  requiredReaction,
  thresholdReasons
}
```

The same function is used:

- Before the model call, as prompt context.
- During `recordExchange`, to apply authoritative state.
- During replay, to authenticate the recorded audit.

No random roll occurs inside this function.

## 9. Personality modulation

Personality modifies reactions rather than replacing them.

Examples:

- High empathy: stronger response to cruelty toward others.
- High boldness: more likely to challenge, threaten, or remain during confrontation.
- Low boldness: more likely to withdraw, cry, comply outwardly, or seek help.
- High candor: more likely to confront contradictions directly.
- Low candor: more likely to evade or leave without fully explaining.
- High piety: stronger positive response to sincere prayer and stronger negative response to sacrilege.
- Witty trait: amusement from mild absurdity; offense if absurdity mocks grief or suffering.
- Proud trait: stronger humiliation and anger.
- Suspicious trait: apologies repair less trust unless followed by changed behavior.
- Forgiving trait: apologies and repair reduce anger more effectively.
- Vengeful trait: anger and resentment persist after the appointment.
- Melancholic trait: sadness rises more readily; anger rises less readily.
- Quarrelsome trait: lower threshold for verbal challenge, not automatically physical violence.

## 10. Reaction ladder

The engine selects one required reaction per turn.

Ordered from least to most disruptive:

1. continue
2. amused
3. confused
4. emotionally_affected
5. challenge
6. set_boundary
7. cry
8. withdraw
9. leave
10. call_for_help
11. threaten_priest
12. attack_priest

The ladder is not a simple single-number threshold. It uses combinations.

### Continue

Default when no threshold is crossed.

### Amused

Requires mild absurdity or humor, low current danger, and compatible personality.

### Confused

Requires contradiction, incoherence, abrupt topic shifts, repeated unanswered questions, or excessive absurdity without threat.

### Challenge

Likely for proud, candid, bold, official, or quarrelsome visitors after unfair judgment, contradiction, manipulation, or implausible counsel.

### Set boundary

Triggered by repeated insult, humiliation, sexual impropriety, sacrilege, coercion, or refusal to answer after the visitor asks for clarity.

### Cry

Requires high sadness, shame, fear, or emotional overload. It is more likely than anger for fearful, melancholic, grieving, young, exhausted, or vulnerable visitors.

### Withdraw

The visitor gives shorter answers, refuses disclosure, or becomes silent while remaining physically present.

### Leave

Typical conditions:

- Willingness to continue at or below 15.
- A serious boundary is violated after being stated.
- Perceived danger above 65 with low trust.
- Repeated cruelty or humiliation.
- Sustained absurdity during a grave concern.
- The visitor concludes the priest cannot or will not help.

Departure may occur before ten turns.

### Call for help

Requires high perceived danger, a plausible person nearby, and personality favoring protection over confrontation.

Possible help:

- Sacristan.
- Watchman.
- Household member.
- Manor guard.
- Church official.

### Threaten priest

Requires cumulative anger, very low trust, sufficient boldness, adult agency, and a credible grievance. It does not require physical follow-through.

### Attack priest

This is exceptionally rare.

Hard requirements:

- Adult and physically capable.
- Anger at least 92.
- Perceived danger at least 82.
- Stress at least 80.
- Trust in priest at most 10.
- Boldness at least 68, or an established violent history.
- At least two severe provocations or one credible immediate threat.
- No successful apology or de-escalation after the latest severe provocation.
- The visitor has not already chosen to leave or call for help.
- Location and opportunity permit an attack.
- The attack action passes the existing priest-violence validator.

Most extreme conversations must still end without violence.

## 11. Repair and de-escalation

Apologies are stateful.

A repair can reduce anger, offense, fear, and danger only when:

- The priest names or clearly acknowledges the harm.
- The apology is not immediately contradicted.
- The priest changes behavior afterward.
- The visitor's personality allows repair.

Repeated apology without changed behavior loses effectiveness.

Practical aid, respectful clarification, sincere prayer, accepting a boundary, and offering the visitor control can also de-escalate.

## 12. Complete AI context packet

Every call to `ParishAiClient.conversation` receives:

- Entire `visit.history`, never a truncated slice.
- Newest priest statement separately.
- Current reaction state.
- Deterministic reaction preview.
- Required reaction and threshold reasons.
- Active topic and unresolved questions.
- Agreements, promises, retractions, contradictions, and boundaries.
- Relevant scenario facts.
- Relevant issue-thread state.
- Personality and relationship factors.
- Relevant long-term memories.
- Relevant recent interactions and rumors.
- Current location and who could plausibly intervene.

Maximum transcript size remains bounded because an appointment contains at most:

- One opening.
- Ten priest statements.
- Ten ordinary visitor responses.
- A small number of deterministic disclosure or reaction lines.

## 13. AI response contract

Extend the conversation JSON schema:

```js
{
  reply: string,
  memory: string,
  interpretation: string,
  referencedTurnIndexes: integer[],
  expressedReaction: Reaction,
  boundaryProposal: null | BoundaryType,
  segments: [{
    text: string,
    issueId: string,
    answeredQuestionTurnIds: string[],
    referencedFactIds: string[]
  }]
}
```

Gemma must:

- Address the newest statement first.
- Remain consistent with the full conversation.
- Express the deterministic required reaction.
- Identify which prior turn matters when the reaction depends on repetition or repair.
- Break every factual answer into structured segments tied to the active issue.
- Cite only fact IDs included in the visitor-visible allowlist.
- Cite the exact priest question turn IDs being answered.
- Avoid authoring mechanical deltas.
- Avoid inventing an attack, departure, or reconciliation not allowed by the preview.

Validation:

- Every rendered segment must name a valid active issue ID.
- Every `referencedFactId` must be visible to the visitor and allowed for that issue.
- Every factual name, quantity, place, job, property, relationship, or deadline in segment prose must be licensed by its cited facts.
- Every direct question must be answered by at least one segment or explicitly marked unknown/refused.
- If expressed reaction conflicts with the required reaction, replace prose with a deterministic personality-aware fallback.
- If a factual answer contradicts authoritative facts, use the factual grounding fallback.
- If the model ignores a boundary, topic change, offer, prayer, summons, farewell, or full-name request, use the specialized direct fallback.
- If prose repeats prior visitor statements excessively, use progressive forward-motion fallback.

## 14. Applying immediate reactions

`recordExchange` will:

1. Recompute the deterministic reaction preview.
2. Verify the recorded audit matches.
3. Apply emotional deltas and counters.
4. Append priest and visitor lines.
5. Store the per-turn audit.
6. Apply immediate reactions.

Immediate effects:

- `cry`: stress and sadness memory; visitor may continue.
- `set_boundary`: boundary stored and included in all later prompts.
- `withdraw`: disclosure falls and answers shorten.
- `leave`: appointment ends early.
- `call_for_help`: queue or event records the helper.
- `threaten_priest`: immediate event, priest danger/scandal effects, early departure likely.
- `attack_priest`: call existing validated action application and terminate or transform the appointment.

An ended appointment cannot accept further priest input.

## 15. Long-term memory

At minimum, preserve:

- Most important priest counsel.
- Visitor interpretation.
- Emotional turning point.
- Boundary stated.
- Boundary respected or violated.
- Promise or agreement.
- Retraction.
- Immediate reaction.
- Final action and outcome.

Memory types:

- visit_summary
- emotional_turning_point
- boundary
- offense
- repair
- threat
- immediate_reaction
- interaction
- disclosed_secret

Relevant memories are retrieved by:

- Person IDs.
- Issue-thread ID.
- Topic anchors.
- Emotional importance.
- Recency.
- Whether the memory concerns the priest.

Private confession content remains private unless a separate validated disclosure action occurs.

## 16. Relationship and world consequences

Cumulative appointment reactions affect later systems:

- Trust and fear toward the priest.
- Attendance.
- Rumors and reports.
- Priest scandal and moral authority.
- Issue-thread pressure.
- Requested follow-ups.
- Authority attention.
- Household retellings.
- Defenses or accusations involving the priest.

Examples:

- A crying visitor may tell a spouse the priest humiliated them.
- A visitor who leaves after a threat may report the priest to a steward or bishop.
- A witty visitor amused by harmless absurdity may remember warmth rather than incompetence.
- A visitor whose boundary was respected may gain trust despite disagreeing with the advice.

## 17. Replay and diagnostics

Every `conversation_exchange` command records:

```js
reactionAudit: {
  classification,
  deltas,
  stateAfter,
  requiredReaction,
  thresholdReasons,
  expressedReaction,
  fallbackUsed,
  visibility: {
    scope: "private_confession" | "private_visit" | "public",
    authorizedPersonIds: string[]
  }
}
```

Replay:

- Recomputes the preview.
- Compares it with the recorded audit.
- Rejects altered classifications, deltas, states, thresholds, or reaction decisions.
- Never calls the model.

Exported saves will therefore explain:

- Why the visitor became angry.
- Which repeated statement crossed a threshold.
- Why an apology succeeded or failed.
- Why the visitor cried, left, called for help, threatened, or attacked.
- Which personality and relationship factors mattered.

## 18. UI behavior

The visitor panel will show only player-legible state:

- Current mood.
- Visible reaction: amused, confused, upset, frightened, angry, withdrawn.
- Whether a boundary has been stated.
- Whether the meeting has ended early.

Hidden numerical reaction values remain in diagnostics and saves.

The dialogue log may include short stage directions:

- “Her voice breaks.”
- “He rises from the chair.”
- “She moves toward the door.”
- “He calls toward the nave for assistance.”

Stage directions are deterministic presentation of authoritative reactions.

## 19. Implementation order

### Phase A — Schema and pure reaction engine

- Add schema-14 migration.
- Add default reaction state to every visit constructor.
- Add `analyzePriestTurn`.
- Add `previewConversationReaction`.
- Add validation.
- No immediate reactions yet.

### Phase B — Full AI context and contract

- Send full active history.
- Send reaction preview and structured continuity.
- Extend response schema.
- Add reaction-consistency validation and fallbacks.

### Phase C — Immediate nonviolent reactions

- Amusement.
- Confusion.
- Challenge.
- Boundary.
- Crying.
- Withdrawal.
- Early departure.
- Calls for help.

### Phase D — Extreme reactions

- Verbal threats.
- Rare validated attacks.
- De-escalation and apology repair.
- Priest injury, scandal, reporting, and authority consequences.

### Phase E — Memory, UI, and diagnostics

- Emotional turning-point memories.
- Boundary and repair memories.
- Reaction audit persistence.
- UI stage directions and end-state handling.
- Exported diagnostic inspection.

## 20. Independent review before implementation

Two separate reviewers must examine this plan.

Architecture reviewer:

- Schema completeness.
- Deterministic replay.
- Prompt size.
- Threshold model.
- Relationship and memory integration.
- Immediate-action safety.

Adversarial reviewer:

- False-positive violence.
- Manipulation of reaction thresholds through prompt injection.
- Private-information leaks.
- Impossible physical reactions.
- Repeated-apology exploits.
- Personality stereotyping.
- Runaway authority escalation.

All high-confidence blockers must be resolved in this document before Phase A begins.

## 21. Post-implementation deterministic testing

Comprehensive tests begin only after implementation.

### Unit matrices

For each personality family:

- One harmless joke.
- Repeated absurdity.
- Compassion during grief.
- Insult followed by apology.
- Repeated insult after apology.
- Credible threat.
- Empty threat.
- Sacrilege.
- Sexual impropriety.
- Manipulation.
- Coercion.
- Topic neglect.
- Boundary respected.
- Boundary violated.
- Kindness after hostility.
- Contradictory counsel.
- Ten-turn cumulative escalation.

### Context-dependence tests

The same final line is applied after:

- Supportive conversation.
- Repetitive absurd conversation.
- Cruel conversation.
- Threatening conversation.
- Successful repair.

Required result: materially different reaction previews and replies.

### Safety tests

- No child attacks.
- No attack without capability.
- No attack from one mild joke.
- No attack from ordinary disagreement.
- Calls for help require a plausible helper.
- Departures stop further input.
- Private memories remain private.
- Replay detects altered reaction audits.

### Property tests

Across thousands of seeded synthetic appointments:

- All values remain bounded.
- Anger does not rise from sincere comfort without a contextual reason.
- Apology never increases repair after an immediate repeated offense.
- Attack prerequisites are always satisfied.
- Ended visits accept no new exchange.
- Deterministic runs remain identical.

## 22. Live one-week testing sequence

After all implementation and deterministic tests pass:

### Week 1 — Ordinary and compassionate play

- Patient clarification.
- Practical advice.
- Prayer.
- Offers of church aid.
- Disagreement.
- Apology.
- Topic changes.
- Requested visitors.

Fix every high-confidence failure, then rerun affected arcs.

### Week 2 — Strange, selfish, and hostile play

- Repeated absurdity.
- Mockery.
- Selfish advice.
- Political pressure.
- Manipulation.
- Cruelty.
- Threats.
- Boundary violations.
- Repairs and failed repairs.

Fix every high-confidence failure, then rerun affected arcs.

### Week 3 — Mixed and extreme contextual arcs

- Support followed by betrayal.
- Cruelty followed by sincere repair.
- Repeated threats.
- Sacrilege with devout and doubting visitors.
- Fearful, proud, witty, melancholic, forgiving, vengeful, and quarrelsome visitors.
- Early departure.
- Calls for help.
- Extremely rare attack prerequisites.

Each week records:

- Full transcript.
- Reaction audit per turn.
- Fallback rate.
- Repetition rate.
- Boundary count.
- Cry count.
- Early departures.
- Calls for help.
- Threats.
- Attacks.
- False-positive severe reactions.
- Save/replay result.

## 23. Weekly acceptance criteria

Before the year test:

- Zero unexplained reaction-state changes.
- Zero replay mismatches.
- Zero attacks missing a hard prerequisite.
- Zero severe reactions caused by one mild oddity.
- Zero continued input after early departure.
- Full active transcript present in every model request.
- At least 95% of newest statements answered directly or intentionally refused.
- Repeated cruelty produces cumulative escalation.
- Apology and changed behavior can produce measurable repair.
- Different personalities produce meaningfully different reactions.
- No private confession leak.

## 24. Final one-year test

Run only after all three weekly passes satisfy acceptance criteria.

The one-year run will measure:

- Population and save integrity.
- Conversation reaction distributions.
- Early-departure frequency.
- Boundary frequency.
- Crying frequency.
- Calls for help.
- Threats toward the priest.
- Attacks on the priest.
- Priest injuries and deaths.
- Reports and authority visits.
- Issue-thread stability.
- Memory growth and save size.
- Performance.

Balance targets:

- Unprovoked attack rate: zero.
- Serious attack rate: below 1% of significant appointments and always causally justified.
- Threats and early departures: uncommon but visible under sustained hostile play.
- Crying and withdrawal: more common than violence.
- Authority escalation: rare and causally traceable.
- Save and replay: 100% successful.
- Memory collections: bounded.

## 25. Completion standard

This phase is complete only when:

- The plan passes both independent reviews.
- All implementation phases are complete.
- Deterministic unit, property, replay, and browser tests pass.
- Three live one-week playthroughs pass after iterative fixes.
- The final one-year test passes.
- The final save contains enough diagnostics to explain every immediate reaction.
- The implementation and test evidence are committed.

## 26. Independent-review amendments

The first independent architecture and adversarial reviews identified mandatory changes. These amendments are part of the implementation contract.

### 26.1 Terminal-reaction lifecycle

Immediate `leave`, `call_for_help`, `threaten_priest`, and `attack_priest` reactions do not directly clear `state.currentVisit`.

They:

1. Set `reactionState.endedEarly = true`.
2. Set an enum `endReason`.
3. Prevent all further conversation exchanges.
4. Continue through the ordinary `finish_visit` command.
5. Let `finishVisit` apply immediate effects, memories, issue-thread updates, follow-up scheduling, calendar advancement, and replay logging.

This preserves the command invariant:

`begin_visit -> conversation_exchange* -> finish_visit`

`recordExchange` rejects input after `endedEarly`.

### 26.2 One authoritative emotional pipeline

`previewConversationReaction` subsumes the emotional work currently performed by `resolvePriestSpeech`.

There will not be two independent trust/stress systems.

- Appointment-local dimensions live in `visit.reactionState`.
- Persistent `person.trustPriest` and `person.stress` change only through the bounded persistent deltas returned by the reaction preview.
- Disclosure change is returned by the same preview.
- Existing intent, contradiction, promise, and position detection is reused by the preview.
- `recordExchange` applies the preview exactly once.
- Replay recomputes the preview against pre-turn state.

### 26.3 Existing priest relationship data

No new resident-to-priest relationship table is required for this phase.

Initial reaction state derives from:

- `person.trustPriest`.
- `person.stress`.
- Personality.
- Priest scandal, authority, and local trust.
- Priest-subject memories.
- Prior `offense`, `threat`, `repair`, `boundary`, and `visit_summary` memories.
- Whether the appointment is ordinary, requested, summoned, causal follow-up, or official.

Persistent fear and resentment toward the priest are represented by prioritized memories and bounded person state rather than a parallel relationship record.

### 26.4 Migration and validation

Add:

```js
upgradeReactionState(state)
```

It is called inside every supported migration branch before sealing state.

All four visit constructors receive reaction state:

- Ordinary visitor.
- Requested visitor.
- Consequence, sermon, or summons follow-up.
- External authority visitor.

Migration rules:

- A migrated active visit receives a reaction state derived from its current person/visit state.
- Existing turns do not receive fabricated audits.
- `turnAudits.length <= turnsUsed`.
- New exchanges append one audit per new turn.
- Fresh schema-14 visits require `turnAudits.length === turnsUsed`.

Validation covers:

- Every reaction dimension: finite 0–100.
- Counters: non-negative integers.
- Enum reaction/end/boundary values.
- Boundary ownership and turn references.
- Audit turn order.
- Bounded deltas.
- Trigger turn IDs.
- Confidentiality scopes.

### 26.5 Replay ordering

For every turn:

1. Read pre-turn person state.
2. Read pre-turn reaction state.
3. Compute deterministic preview.
4. Build model context from that preview.
5. Receive and validate prose.
6. Recompute preview inside `recordExchange`.
7. Compare against recorded audit during replay.
8. Apply persistent and appointment-local changes once.

Recorded model-only fields such as prose and expressed reaction are validated but not recomputed.

### 26.6 Explicit threshold precedence

Evaluate reactions from most severe to least severe:

1. attack_priest
2. threaten_priest
3. call_for_help
4. leave
5. withdraw
6. cry
7. set_boundary
8. challenge
9. emotionally_affected
10. confused
11. amused
12. continue

The highest reaction whose hard requirements are satisfied wins.

Attack eligibility is checked through one canonical `canApplyImmediateReaction` function before selection and again before application. A failed extreme-action gate deterministically downgrades to `call_for_help` or `leave`.

### 26.7 Objective evidence requirements

Severe reactions cannot arise from personality, issue gravity, or baseline stress alone.

Each turn receives objective evidence points:

| Evidence | Points |
|---|---:|
| Mild irrelevant absurdity | 1 |
| Repeated irrelevant absurdity | 2 |
| Dismissal of expressed concern | 2 |
| Direct insult | 3 |
| Public or identity-based humiliation | 4 |
| Sexual impropriety | 5 |
| Coercion | 5 |
| Sacrilege directed at a devout visitor's grief or confession | 4 |
| Credible threat of punishment, exposure, injury, or arrest | 7 |
| Repeating a recorded offense after a boundary | +4 |
| Sincere acknowledged repair followed by changed behavior | -3 |

Minimum evidence:

- `cry`: emotional overload plus at least two harmful evidence turns, unless the newest turn is sexual/coercive harm or a credible threat.
- `leave`: at least two harmful evidence turns, a violated boundary, or one credible immediate threat.
- `call_for_help`: credible danger plus a verified safe helper.
- `threaten_priest`: at least two severe provocations and all personality/capability gates.
- `attack_priest`: existing hard requirements plus at least 12 cumulative objective evidence points and either two severe provocations or one immediate credible threat.

Ten harmless jokes or ordinary disagreements cannot independently satisfy a severe reaction.

### 26.8 Canonical boundaries

The model cannot create authoritative free-text boundaries.

Boundaries are enum records:

```js
{
  id,
  ownerId,
  type: "stop_mockery" | "stop_threats" | "stop_sexual_conduct" |
        "respect_privacy" | "do_not_name_third_party" |
        "stop_sacrilege" | "allow_departure",
  createdTurn,
  triggerAuditId,
  status: "active" | "respected" | "violated" | "withdrawn",
  resolvedTurn: null | integer
}
```

A boundary cannot:

- Force agreement.
- Suppress lawful reporting or safety.
- Demand obedience.
- Authorize disclosure.
- Override consent.

### 26.9 Repair rules

An apology alone gives no repair benefit.

A repair requires:

1. A recorded offense ID.
2. A later acknowledgment or apology referring to that harm.
3. At least one subsequent non-offending turn.
4. No repeated version of the offense.

Repeated apology without changed behavior gives zero additional repair. Repeating the offense after apology increases `repeatedOffenseCount` and makes future repair harder.

### 26.10 Confidentiality scope

Every reaction audit, memory, issue fact, report, event, and transcript-derived record has:

```js
visibility: {
  scope: "private_confession" | "private_visit" | "public",
  authorizedPersonIds: string[]
}
```

Rules:

- Model prompts receive only data visible to that visitor.
- Public rumors never derive directly from private confession data.
- Authority reports require a separately validated disclosure record.
- Exported saves retain private data for the player but mark its scope.
- Public UI and chronicles do not render private confession content.
- Reaction diagnostics may reference audit IDs and categories, but public surfaces cannot include private raw text.

### 26.11 Minor and vulnerable visitor policy

Minors and coercively vulnerable visitors:

- Never threaten or attack the priest.
- Cannot consent to sexual or coercive conduct.
- Do not get routed to an unsafe helper.
- Prefer leaving, crying, withdrawing, or calling a verified safe adult.
- Cannot have severe reactions caused by personality stereotypes alone.

Safe helpers are selected from verified:

- Adult household protectors without fear/resentment danger.
- Sacristan or church worker.
- Watchman when the watch is not implicated.
- Healer or midwife when appropriate.
- Manor guard only when the manor is not the source of danger.

### 26.12 Report and authority evidence gate

Private complaint and public authority report are separate records.

External reporting requires:

- A reportable allegation category.
- Trigger audit IDs.
- Disclosable evidence.
- Eligible recipient.
- No confidentiality prohibition.
- Deduplication and cooldown.

A visitor leaving angry does not automatically summon a bishop, magistrate, or lord.

### 26.13 Adversarial negative-oracle tests

Required deterministic fixtures:

- Ten harmless jokes never cause crying, departure, reporting, threats, or attack.
- Quoted, negated, hypothetical, and third-party threats do not count as direct threats.
- Prompt-injection strings cannot change authoritative preview or visibility.
- Private sentinel facts never appear in unauthorized prompts, replies, memories, rumors, reports, chronicles, or public diagnostics.
- Repeated apologies without changed behavior produce no repair.
- A violated boundary is traceable to exact turn IDs.
- A vulnerable visitor chooses only verified safe exits/helpers.
- Removing any attack prerequisite makes the attack test fail.
- Removing report evidence blocks authority escalation.

### 26.14 Canonical reaction enums

The following enums are authoritative everywhere in state, commands, audits, AI validation, and UI:

```js
Reaction = [
  "continue", "amused", "confused", "emotionally_affected", "challenge",
  "set_boundary", "cry", "withdraw", "leave", "call_for_help",
  "threaten_priest", "attack_priest"
]

EndReason = [
  "completed", "farewell", "visitor_left", "boundary_violated",
  "danger", "called_for_help", "threatened_priest", "attacked_priest",
  "priest_incapacitated"
]

BoundaryType = [
  "stop_mockery", "stop_threats", "stop_sexual_conduct",
  "respect_privacy", "do_not_name_third_party",
  "stop_sacrilege", "allow_departure"
]
```

`lastReaction`, `requiredReaction`, and `expressedReaction` use `Reaction`.

`endReason` is nullable `EndReason`.

The model does not return authoritative free-text boundary content. It may return:

```js
boundaryProposal: null | BoundaryType
```

The deterministic preview must already permit that exact boundary type before it can become state.

### 26.15 Compositional-action hard caps

Before resolution, reject any composition exceeding:

- Three direct actors.
- Three direct target IDs total.
- Two target IDs on one action.
- One property object.
- One resource type.
- One location.
- One condition.
- Description: 400 characters.
- Detail: 120 characters.
- Evidence turn IDs: at most five.
- Direct effects: at most twelve scalar field changes.
- Deterministic relationship ripple: at most twenty-four directed edges.
- Household ripple: at most eight households.
- Occupation/faction ripple: at most forty residents per batch.
- Rumor creation: at most one rumor per direct step.
- Follow-up scheduling: at most three appointments per resolved chain.

Targets are deduplicated and sorted canonically before validation.

Broad effects beyond these limits are aggregated into bounded town, faction, market, congregation, or issue-thread deltas rather than individual state writes.

## 27. Professionally grounded scenario selection

Scenario selection must answer:

1. Why does this person know about the matter?
2. Why would this person care?
3. Why can this person act?
4. Why would this person bring it to the priest?
5. How do age, work, status, personality, household, relationships, travel, and prior memories shape the first interpretation?

### 27.1 Scenario eligibility schema

Each scenario family will define:

```js
eligibility: {
  minimumAge,
  maximumAge,
  occupationGroups: string[],
  excludedOccupations: string[],
  socialStatuses: string[],
  requiredAccess: string[],
  possibleKnowledgeChannels: string[],
  requiredRelationshipRoles: string[],
  locationTypes: string[],
  personalityWeights: object,
  householdPressureWeights: object
}
```

### 27.2 Hard exclusions

Reject a scenario/person pairing when:

- The person could not physically or socially access the relevant place, record, resource, or decision.
- The age is incompatible with the claimed responsibility.
- The occupation directly contradicts the claimed authority.
- No relationship, travel, work, rumor, witness, or household channel explains the knowledge.
- The person is described as controlling property, labor, taxes, medicine, justice, or manor stores they cannot plausibly control.

Examples:

- A peddler does not personally reserve manor grain unless a recorded delivery contract, manor customer, debt, family member, or witnessed transaction supplies access.
- A stablehand may know about manor grain through cart movement, stable-yard talk, deliveries, or a household relation, but does not issue grain orders.
- A child may report dangerous work witnessed at an apprenticeship, but does not negotiate a binding lease.
- A midwife may report birth, health, household violence, hidden pregnancy, or contaminated water through patients.
- A reeve, bailiff, clerk, miller, steward, or manor servant has stronger access to taxation, records, reserves, and official orders.

### 27.3 Soft relevance scoring

Eligible pairings receive a deterministic score:

- Direct occupational access: +35.
- Household member directly involved: +30.
- Close relationship involved: +25.
- Personally witnessed location/event: +25.
- Relevant recurring travel: +15.
- Heard rumor from a known source: +10, with lower certainty.
- Personality motivation: up to +15.
- Matching material pressure: up to +20.
- Prior issue-thread involvement: +30.
- Relevant memory: +20.

Choose from high-scoring scenarios while preserving diversity and recent-repeat avoidance.

### 27.4 Perspective and proposed solution

The same scenario produces different initial ideas.

Contaminated well examples:

- Healer: quarantine water use, compare symptoms, identify exposure.
- Tanner: inspect runoff and defend or admit workshop responsibility.
- Miller: identify downstream contamination and lost production.
- Parent: seek clean water for children immediately.
- Reeve: close access and organize replacement supply.
- Peddler: report similar illness along the trade road.
- Child: describe smell, color, dead animals, or an adult's warning.

The opening context includes:

- Knowledge channel.
- Personal stake.
- Initial theory.
- Initial preferred action.
- Confidence.
- What the visitor does not know.

Gemma phrases those facts through occupation, age, status, and personality.

### 27.5 Scenario tests

- Every generated scenario must explain access and knowledge.
- Impossible occupation/status pairings are rejected.
- At least five professions produce distinct perspectives on shared scenario families.
- Children never hold adult legal/property authority.
- Officials do not receive private knowledge without a channel.
- One thousand seeded first visitors meet a minimum relevance score.
- Scenario diversity remains above the existing catalog threshold.

### 27.6 Multi-issue coherence

One visitor may discuss more than one concern only when the engine records an explicit causal connection:

- The debt caused the questionable act.
- The household relationship connects both disputes.
- Solving one issue materially worsens the other.
- The visitor explicitly asked to discuss a second matter during the appointment.

Generic scenario variants may not attach an unrelated debt, promise, illness, romance, or family concern merely to add texture.

Each active issue has:

- Its own issue-thread ID.
- Its own authoritative facts.
- Its own unresolved questions.
- Its own active topic.

When a conversation contains multiple issues, every priest clause and visitor answer is assigned to one or more issue IDs. The engine must not answer a debt question with a contaminated-well fact.

### 27.7 Concrete household and work context

When the priest asks what the visitor owns, can sell, can contribute, or can do for work, the answer comes from authoritative household/person state:

- Household food and wealth bands.
- Dwelling.
- Adult household members and occupations.
- Dependents.
- Existing church resources and aid.
- Tools or goods plausibly associated with occupations.
- Existing debts and creditors.
- Work the visitor is physically and socially capable of doing.

The model may phrase these facts but cannot invent quantities, children, property, another well, a water expert, tools, or saleable goods.

Potential child labor must be answered with age, safety, guardianship, and existing apprenticeship constraints. A child is not treated as generic debt collateral or labor capacity.

### 27.8 Expert and alternative-location selection

Advice requiring an expert, official, helper, alternate well, shelter, workplace, or property must reference an actual eligible entity or location in state.

Examples:

- Water illness: healer, herbalist, reeve, tanner, miller, or another person with a recorded knowledge channel.
- Alternate water: only if a second clean source exists in town state.
- Manor records: clerk, steward, bailiff, reeve, or person with record access.
- Dangerous apprenticeship: guardian, alternate master, reeve, healer, or safe foster household.

If no eligible person or location exists, the visitor says so and suggests a feasible information-gathering step.

### 27.9 Clause-level question routing

Priest speech is parsed into clauses and questions in order.

For each clause:

- Detect active issue/topic.
- Detect requested fact type.
- Resolve pronouns and named people.
- Answer every direct question that can be answered.
- Explicitly state when a fact is unknown.

Question types include:

- Identity.
- Quantity.
- Creditor/debtor.
- Ownership/assets.
- Household composition.
- Work capability.
- Expert/helper.
- Location.
- Timeline/deadline.
- Cause/mechanism.
- Personal role.
- Proposed next step.
- Risk or objection.

The response must not let an early broad keyword such as `work`, `trade`, `who`, or `how` override the actual object of a later question.

### 27.10 Fact provenance and anti-invention

Every factual claim available to Gemma carries:

```js
{
  factId,
  issueId,
  text,
  provenance: "state" | "witnessed" | "heard_rumor" | "inferred",
  confidence,
  visibility: {
    scope: "private_confession" | "private_visit" | "public",
    authorizedPersonIds: string[]
  }
}
```

Generated prose is validated for:

- Named people.
- Quantities.
- Property.
- Jobs.
- Family members.
- Locations.
- Deadlines.
- Causal responsibility.

Unsupported new facts cause a deterministic correction or regeneration.

### 27.11 Conversation regression represented by the well/debt example

Required exact regression arc:

1. A contaminated-well concern must not receive an unrelated debt unless causally connected.
2. If a debt is connected, the creditor and amount are authoritative from the opening onward.
3. Asking for a steward response must acknowledge urgency.
4. Asking for an expert must name an eligible real person or state that none is known.
5. Suggesting another well must be rejected if no alternate water source exists.
6. Asking debt amount returns the authoritative amount.
7. Asking assets, household labor capacity, personal work capacity, and saleable goods answers those exact questions.
8. The tannery runoff fact must not overwrite debt/work answers.
9. “That did not answer my question” must trigger repair by answering the unresolved questions, not repeat a different scenario fact.
10. Repeating the debt/work question must produce consistent facts and forward motion.

## 28. Compositional action grammar

The game will support thousands of potential actions through validated composition rather than thousands of unrelated hard-coded enums.

### 28.1 Action structure

```js
{
  domain,
  verb,
  actorId,
  targetIds,
  objectType,
  objectId,
  resourceType,
  quantity,
  locationId,
  method,
  visibility,
  timing,
  condition,
  motive,
  evidenceTurnIds,
  expectedEffects
}
```

### 28.2 Domains

- Conversation and communication.
- Work and apprenticeship.
- Trade and prices.
- Property and housing.
- Food, coin, medicine, fuel, and church resources.
- Family, courtship, marriage, separation, children, and guardianship.
- Health, care, quarantine, injury, and death.
- Faith, attendance, penance, sanctuary, and church service.
- Law, evidence, testimony, arrest, release, restitution, and appeal.
- Reputation, rumor, secrecy, accusation, and public declarations.
- Aid, shelter, fostering, education, and community labor.
- Migration, invitation, expulsion, travel, and relocation.
- Violence, protection, threats, feuds, and de-escalation.
- Authority petitions and institutional agreements.
- Bounded improvised social acts.

### 28.3 Composition creates breadth

Examples:

- `work + begin + church_garden + volunteer`
- `work + quit + manor_stable`
- `work + retrain + soldier`
- `property + buy + cottage`
- `property + lease + market_stall + shared`
- `resource + donate + grain + church + 3 sacks`
- `resource + receive + bread + church + 2 loaves`
- `repair + bridge + parish_labor`
- `care + shelter + abused_spouse + church_room`
- `law + appeal + excess_tax + magistrate`
- `communication + summon + master_strongmill + church`
- `family + supervised_meeting + spouse`
- `reputation + public_apology + apprentice`
- `violence + threaten + creditor`
- `crime + steal + manor_grain`
- `faith + begin_service + church`
- `migration + move_household + washhouse_room`

Verb, target, object, resource, method, visibility, condition, and motive combinations provide thousands of concrete possibilities.

### 28.4 Effect resolvers

Each domain has deterministic resolvers for:

- Preconditions.
- Costs.
- Consent.
- Authority.
- Capability.
- Opportunity.
- Immediate effects.
- Target reactions.
- Household effects.
- Relationship effects.
- Issue-thread effects.
- Town/faction/rumor propagation.
- Follow-up scheduling.
- Memory creation.

An unknown composition may map to bounded `improvise`, but `improvise` cannot create:

- Marriage.
- Pregnancy.
- Death.
- Arrest.
- Migration.
- Property ownership.
- Unfunded resource transfers.
- Supreme authority.
- Impossible technology.

### 28.5 Direct and broad effects

Gemma may choose at most three direct actors.

The simulation then propagates effects efficiently through:

- Household members.
- Directed relationships.
- Occupation groups.
- Parish factions.
- Knowledge and rumor networks.
- Market and material systems.
- Congregation attendance and reactions.
- Persistent issue-thread pressure.

This supports village-wide effects without one model call per resident.

### 28.6 Action flexibility tests

- Thousands of generated valid action compositions.
- Every accepted action has a deterministic resolver.
- Every state change has a causal event.
- Invalid resource, consent, authority, age, or capability combinations fail.
- Opposite actions produce opposite or materially different effects.
- Unusual bounded actions preserve prose without gaining forbidden mechanics.
- Different motives change relationship, memory, and reputation effects.
- Direct action count never exceeds three.
- Broad deterministic propagation remains bounded and performant.

## 29. Revised post-implementation test order

No comprehensive live or year testing occurs before implementation and independent plan approval.

Order:

1. Resolve all plan-review blockers.
2. Obtain approval from both independent reviewers.
3. Implement schema and pure reaction engine.
4. Implement AI contract.
5. Implement immediate reactions.
6. Implement memory and diagnostics.
7. Implement profession-grounded scenario eligibility.
8. Implement compositional action grammar and resolvers.
9. Complete deterministic unit, property, replay, and browser tests.
10. Run live Week 1 and fix findings.
11. Run live Week 2 and fix findings.
12. Run live Week 3 and fix findings.
13. Re-run all deterministic and browser tests.
14. Run the final one-year simulation.
15. Independently review the completed implementation.
16. Commit only after blockers are resolved.
