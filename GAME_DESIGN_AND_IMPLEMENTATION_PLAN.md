# The Common Confessor

## Complete Game Design, Simulation Architecture, and Phased Implementation Plan

**Working title:** The Common Confessor  
**Setting:** A small European village in the 1500s  
**Genre:** 2D narrative simulation, parish life simulation, social consequence sandbox  
**Core fantasy:** Be the priest who hears a village one person at a time, then watches private words become public history.

---

## 1. Product vision

The Common Confessor is a single-player game about influence without direct control. The player is a village priest. Exactly four appointments occur on every ordinary day. If the normal eligibility pool is exhausted, the scheduler backfills from the least-recently-seen active villagers or a causally scheduled outside visitor rather than shortening the day. Each person chooses a part of the church suited to the matter:

- The **confessional** for hidden sin, shame, or dangerous secrets.
- The **parish office** for private practical counsel, disputes, work, money, family arrangements, or official complaints.
- The **main nave** for ordinary conversation, public concerns, loneliness, rumor, and matters that do not require secrecy.
- The **shrine and altar** for grief, faith, death, vows, grave conscience, miracles, and spiritually serious questions.

The player may type up to ten statements during an hour. The visitor remembers the exchange according to personality, history, knowledge, emotion, and trust. When the person leaves, the game resolves what they do next. Their action may affect another person, whose response may affect a third. The result enters the village chronicle and changes the future context used by simulation and AI.

The game always begins on Monday with exactly 200 named villagers. Every starting villager has a name, age, household, occupation, appearance, and basic public facts. Deeper personality and history are generated deterministically when the person first becomes relevant. This preserves mystery, controls AI context size, and allows a new game to contain a large possibility space without front-loading 200 expensive model calls.

Sunday replaces ordinary appointments with a parish service. The congregation attends according to health, work, weather, faith, grudges, household pressure, scandal, coercion, and prior events. The player selects a sermon theme and writes up to 100 words. The sermon affects every attendee through shared town-level interpretation and individual susceptibility. Known people may receive more specific consequences.

The village must feel causally connected. Large events must have traceable origins. A bishop does not appear randomly merely because such a visit is possible. A bishop may appear because a villager reported the priest, an archdeacon found evidence, repeated sermons caused controversy, a claimed miracle drew attention, or violence in the church demanded intervention. A king, papal legate, or pope is possible, but increasingly rare and dependent on escalating chains of credible causes.

---

## 2. Design pillars

### 2.1 Words become actions

The player's power is primarily conversational. Advice does not directly alter statistics. It changes what a person believes, fears, intends, or feels permitted to do. The person then acts through the same simulation rules used by everyone else.

### 2.2 Every consequence has a chain

Every significant event records:

- A stable event ID.
- A causal parent event, conversation, sermon, or world-pressure ID.
- The initiating conversation, sermon, material pressure, relationship, or prior event.
- The actor's motive.
- The target and relationship.
- The action attempted.
- The validation and resolution result.
- Immediate state changes.
- Follow-on reactions, up to the active chain depth.
- Long-term memories and future hooks.

The chronicle should answer not only what happened, but why. No significant chronicle event may exist without a resolvable causal origin.

### 2.3 AI proposes; the simulation decides

The local Gemma model from The Common Crown provides prose, interpretation, and bounded proposals. It never writes game state directly.

The deterministic simulation:

- Supplies authoritative context.
- Defines allowed action types.
- Validates identities, targets, prerequisites, and intensity.
- Rejects impossible or unjustified proposals.
- Applies mechanical effects.
- Creates save data and chronicle facts.

If Gemma is unavailable, deterministic templates and weighted simulation continue the game.

### 2.4 Historical grounding with human unpredictability

The default tone is plausible for a 1500s village:

- Religion shapes language, legitimacy, fear, charity, guilt, law, and community.
- Households and occupations matter more than modern individual career identity.
- Travel is slow and outside authority is distant.
- Marriage, inheritance, reputation, disease, harvests, rents, guild-like work relations, and parish discipline have practical weight.
- Modern concepts and language are excluded from generated dialogue.

Comic, ridiculous, or outrageous events are possible, but controlled:

- Ordinary or serious outcomes should dominate.
- Mildly comic misunderstandings may occur occasionally.
- Farcical actions should be uncommon.
- Truly outrageous actions should be rare, strongly personality-dependent, and more likely during unusual stress, intoxication, mania, festivals, rumor panics, or escalating public disorder.
- Comedy must still produce realistic reactions and consequences.

### 2.5 The priest is a vulnerable person

The player is not an untouchable dialogue interface. Villagers and outsiders may:

- Trust, admire, obey, resent, fear, mock, avoid, romance, tempt, blackmail, accuse, report, protect, rob, assault, poison, or kill the priest.
- Spread stories about counsel.
- Petition church or royal authorities.
- Test the priest's consistency by comparing advice.
- React to favoritism, cruelty, hypocrisy, generosity, courage, cowardice, or scandal.

The priest has health, fatigue, reputation, ecclesiastical standing, royal notice, scandal, safety, known promises, enemies, supporters, and remembered public positions.

### 2.6 The village exists beyond the church

The visual scene remains the church, but the simulation represents homes, fields, workshops, roads, taverns, market activity, local government, and nearby institutions. Off-screen events should be legible through dialogue, chronicle entries, parish metrics, household changes, visitors, and Sunday attendance.

---

## 3. Core game loop

### 3.1 Monday through Saturday

1. The next hour begins.
2. A visitor is selected from:
   - Eligible villagers.
   - Scheduled follow-up visitors.
   - Rare outside visitors whose arrival has a causal trigger.
3. The visitor walks from the church entrance to the appropriate location.
4. The visitor opens the conversation.
5. The player types up to ten statements.
6. The visitor responds after each statement.
7. The player may end the hour early.
8. The departure resolver determines the visitor's immediate intent.
9. The consequence engine resolves a chain of up to three people.
10. Events, memories, relationships, and metrics update.
11. The chronicle records meaningful outcomes.
12. After four appointments, the day ends.

### 3.2 Sunday

1. Attendance is calculated for every active person.
2. Representative congregation sprites occupy the pews.
3. The interface explains attendance and notable absences.
4. The player selects a theme.
5. The player writes a sermon of no more than 100 words.
6. Gemma interprets tone and likely reception using aggregate parish context and selected known people.
7. Deterministic rules apply effects to all attendees.
8. Notable individual reactions are resolved.
9. Sermon-triggered actions may enter future queues.
10. Monday begins.

### 3.3 Long-term loop

Over weeks and years:

- People revisit with changed circumstances.
- Advice may be remembered, distorted, quoted, weaponized, or ignored.
- Households form and break.
- Children are born or adopted.
- People age, become ill, recover, or die.
- People enter and leave the village.
- Work, prices, health, safety, piety, and authority change.
- Outside institutions become aware of the parish.
- The priest may gain influence, lose office, be transferred, imprisoned, excommunicated, celebrated, injured, or killed.

---

## 4. Population model

### 4.1 Starting population

Every new game creates exactly 200 active villagers.

Each starting person immediately receives:

- Stable ID.
- Unique first and last name.
- Sex.
- Age.
- Household.
- Occupation or dependent status.
- Sprite index.
- Basic public reputation.
- Church attendance tendency.
- Baseline health, prosperity, morale, faith, stress, and trust.
- A small relationship neighborhood.

### 4.2 Deferred person generation

When a person first becomes relevant, the game deterministically generates:

- Two or more personality traits.
- Candor, empathy, boldness, piety, impulsiveness, suggestibility, humor, aggression, ambition, and self-control.
- Childhood origin.
- Formative event.
- Current pressure.
- Private habit or texture.
- Moral boundaries.
- Fears.
- Desires.
- Secrets.
- Grievances.
- Relationship interpretations.
- Speech style.
- Likely coping behavior.

Generation uses seeded combinatorial banks large enough to support:

- More than 1,000 male first names.
- More than 1,000 female first names.
- More than 1,000 surnames.
- More than 100,000 base backstory combinations before personality, household, occupation, relationship, event, and town context are considered.

Deferred generation never consumes a shared activation-order RNG stream. Each person's profile is generated from a stable entity seed such as `hash(worldSeed, personId, profileSchemaVersion)`, so meeting people in a different order cannot change who they are.

### 4.3 Knowledge layers

Each person has separate truth and knowledge:

- **Objective state:** What is mechanically true.
- **Personal knowledge:** What the person believes.
- **Player knowledge:** What the priest has learned.
- **Public reputation:** What the village generally believes.
- **Rumor variants:** Distorted claims circulating through social links.

AI prompts receive only knowledge the speaking person could plausibly possess.

### 4.4 Population changes

The population may change through:

- Birth.
- Adoption.
- Marriage immigration.
- Employment immigration.
- Refugees.
- Pilgrims who settle.
- Expulsion.
- Flight.
- Imprisonment elsewhere.
- Military levy.
- Disease.
- Accident.
- Murder.
- Execution.
- Natural death.

The rule is “always starts at 200,” not “always remains 200.”

---

## 5. Households and relationships

### 5.1 Household structure

Households contain:

- Members.
- Dwelling quality.
- Food stores.
- Money and debt.
- Occupations and tools.
- Dependents.
- Shared secrets.
- Household reputation.
- Religious habits.
- Claims and inheritance expectations.

### 5.2 Relationship model

Directed relationships track:

- Familiarity.
- Trust.
- Affection.
- Attraction.
- Fear.
- Respect.
- Obligation.
- Resentment.
- Rivalry.
- Dependence.
- Knowledge of secrets.
- Recent interactions.

Relationships are directional. One person may love another who feels only obligation or fear.

### 5.3 Social transmission

Information and behavior spread through:

- Household conversation.
- Workplace contact.
- Market contact.
- Tavern contact.
- Worship.
- Neighbor proximity.
- Friendship.
- Kinship.
- Official duties.
- Deliberate letters or petitions.

Transmission changes truth into belief, rumor, accusation, testimony, or legend.

---

## 6. Conversation system

### 6.1 Visit intent

Every visit has:

- A primary matter.
- A desired outcome.
- A hidden concern.
- A disclosure threshold.
- A preferred church location.
- Urgency.
- Gravity.
- Risk.
- Related people.
- Facts the visitor will not initially reveal.

### 6.2 Ten-statement structure

The player may speak ten times. A statement may:

- Ask a question.
- Offer comfort.
- Give advice.
- Judge.
- Threaten.
- Promise.
- Quote scripture.
- Demand confession.
- Refuse help.
- Offer material help.
- Reveal another person's information.
- Lie.
- Flirt.
- Humiliate.
- Encourage illegal or violent action.

Player free text is always treated as untrusted in-world speech. It cannot alter schemas, allowed action lists, rarity licenses, outside-attention tracks, or validation rules merely by instructing the model to do so.

No menu limits the player's wording. The game classifies intent and lets the visitor interpret it.

### 6.3 Visitor response

Each response considers:

- Exact conversation history.
- Personality.
- Current emotion.
- Trust.
- Prior advice from the priest.
- Contradictions.
- Social status.
- Knowledge.
- Goals.
- Danger.
- Location and privacy.

Responses may include agreement, refusal, evasion, confession, bargaining, anger, humor, misunderstanding, silence, tears, threats, or an attempt to end the meeting.

### 6.4 Conversation memory

Stored memories are concise, structured records:

- Subject.
- Speaker.
- Interpreted meaning.
- Emotional charge.
- Confidence.
- Whether it was private.
- Whether it can be shared.
- Whether later events confirmed or contradicted it.

Raw generated prose is not used as mechanical truth. Trust, stress, emotion, relationship, disclosure, and memory-charge changes are computed by deterministic simulation rules from classified speech intent and authoritative context. AI prose may express those results but may not author the mechanical delta.

---

## 7. Action and consequence system

### 7.1 Action ontology

Actions are defined as data with:

- ID.
- Historical description.
- Valid actor types.
- Valid target types.
- Preconditions.
- Base rarity.
- Required motive thresholds.
- Material costs.
- Legal and religious implications.
- Immediate effects.
- Delayed effects.
- Possible reactions.
- Chronicle importance.
- Comedy class.

Romance, attraction, proposition, seduction, courtship, and marriage-like actions hard-exclude minors. They require validated adult age, legal and social eligibility, and any required mutual willingness. Historical setting never weakens this safety invariant.

Action families include:

- Conversation and emotional actions.
- Charity and care.
- Work and commerce.
- Family and romance.
- Faith and ritual.
- Reputation and rumor.
- Crime and violence.
- Law and punishment.
- Migration.
- Church politics.
- Royal politics.
- Absurd or comic disruption.

Combinations of actor, target, motive, location, intensity, material context, witnesses, and response produce thousands of distinct outcomes without requiring thousands of hard-coded one-off scripts.

### 7.2 Causal chain depth

The active departure chain is capped at three people:

1. The visitor acts.
2. A directly affected person responds.
3. A final person may respond to that consequence.

Longer effects enter future queues rather than resolving recursively in the same hour. This prevents runaway processing while preserving long causal histories.

### 7.3 Delayed consequences

Actions may schedule:

- A future visit.
- A rumor wave.
- A household decision.
- A workplace change.
- A legal response.
- An illness progression.
- A pregnancy or birth.
- A church inquiry.
- A royal inquiry.
- Revenge.
- Reconciliation.

### 7.4 Controlled extraordinary behavior

Every consequence receives an event license derived from deterministic context:

- **Ordinary:** approximately 90–94%.
- **Comic:** approximately 5–9%.
- **Outrageous:** approximately 0.5–2%.

The exact chance is modified by:

- Personality.
- Intoxication.
- Stress.
- Mental or physical illness.
- Festival days.
- Crowd behavior.
- Existing disorder.
- The player's words.
- Prior extraordinary events.

Until the material simulation phase supplies seasons, festivals, intoxication, harvest pressure, and similar modifiers, those inputs remain explicit neutral values. Earlier phases must not claim those modifiers are active.

An outrageous license permits consideration; it does not force an outrageous event.

Examples:

- A goat is released during worship as a prank.
- A drunk rings the bells at midnight to announce an invented miracle.
- A jealous person arrives disguised as a pilgrim.
- A villager stages excessive public penance to embarrass a rival.
- Someone steals a relic, then becomes terrified by coincidence and returns it.
- A false prophet predicts that the mill will walk into the river.

The simulation still applies realistic consequences: anger, laughter, punishment, rumor, repair costs, injury, church scrutiny, or lasting nicknames.

---

## 8. Effects on the priest

The priest state includes:

- Health.
- Injury.
- Fatigue.
- Safety.
- Local trust.
- Moral authority.
- Popularity.
- Scandal.
- Bishop favor.
- Royal notice.
- Roman attention.
- Known promises.
- Confidentiality breaches.
- Supporters.
- Enemies.
- Romantic pressure.
- Accusations.
- Official warnings.

Possible actions toward the priest include:

- Comforting or defending him.
- Offering gifts.
- Attempting friendship.
- Attempting romance or seduction.
- Spreading claims of favoritism.
- Blackmail.
- Theft.
- Reporting him to the bishop.
- Praising him to the bishop.
- Petitioning for removal.
- Protecting him from violence.
- Assault.
- Poisoning.
- Murder.

Severe actions require validated motives, access, capability, and opportunity. “Kill the priest” cannot occur merely because the AI proposed it.

Romantic or sexualized actions toward the priest may be initiated only by validated adult actors. The same rule applies to every actor and target pair in the game.

If the priest dies, the chronicle closes with a causal account. Other terminal or transitional outcomes may include:

- Removal from office.
- Transfer.
- Imprisonment.
- Excommunication.
- Flight.
- Royal appointment.
- Episcopal promotion.
- Sainthood legend after death.

---

## 9. Outside authority and rare visitors

### 9.1 Attention tracks

The world tracks:

- Diocesan attention.
- Roman attention.
- Royal attention.
- Noble attention.
- Legal attention.
- Pilgrim attention.

### 9.2 Escalation ladder

Church escalation:

1. Letter or rumor.
2. Archdeacon.
3. Bishop.
4. Ecclesiastical examiner.
5. Papal legate.
6. Pope, only under extraordinary accumulated circumstances.

Royal escalation:

1. Petition or local report.
2. Sheriff.
3. Royal commissioner.
4. Noble intermediary.
5. King or queen, only under exceptional circumstances.

### 9.3 Causal triggers

Outside visitors may be triggered by:

- A villager reporting the priest.
- Repeated public scandal.
- Violence in or around the church.
- Claimed miracles.
- Suspected heresy.
- Unusual mass conversions or disorder.
- A relic dispute.
- Large migration.
- A politically important marriage.
- A tax, rent, land, or inheritance dispute.
- A royal petition.
- A sermon interpreted as sedition.
- A celebrated act of courage or charity.

### 9.4 Direct visits

A pope or king visiting a small village is deliberately extremely unlikely. Direct visits require:

- Very high attention.
- A credible reason.
- Prior escalation.
- Sufficient elapsed time.
- No contradictory state.
- A final rare probability roll.

Most high-level attention should produce representatives rather than the officeholder personally.

---

## 10. Sunday system

### 10.1 Attendance

Attendance considers:

- Baseline piety.
- Health.
- Age.
- Weather and season.
- Work obligations.
- Household pressure.
- Fear or support of the priest.
- Scandal.
- Excommunication or conflict.
- Prior sermon reception.
- Direct intervention by other people.

### 10.2 Sermon interpretation

The selected theme provides a broad frame. The actual text determines:

- Compassion versus severity.
- Inclusiveness versus accusation.
- Hope versus fear.
- Practical guidance versus abstraction.
- Political implications.
- Contradictions with prior advice.
- Whether specific people believe the sermon targets them.

### 10.3 Congregational outcomes

Every attendee receives a small deterministic effect. Known or unusually relevant people may receive stronger individualized and explicitly displayed outcomes. The AI receives at most 36 detailed profiles, selected by a stable relevance score using visit history, relationship to the priest, scandal, leadership, current crisis involvement, and sermon-theme sensitivity. Possible consequences include:

- Reconciliation.
- Charity.
- Increased work.
- Refusal.
- Anger.
- Public confession.
- Gossip.
- Protest.
- Renewed attendance.
- Avoidance.
- Reporting the priest.
- Claims of inspiration or miracle.

---

## 11. Town simulation

Town metrics summarize but do not replace people:

- Harmony.
- Faith.
- Prosperity.
- Health.
- Safety.
- Mercy.
- Food security.
- Authority legitimacy.
- Scandal.
- Outside attention.

Material systems include:

- Seasonal food production.
- Household consumption.
- Work and unemployment.
- Prices and debt.
- Injury and illness.
- Housing.
- Weather.
- Crime.
- Local justice.
- Church charity.

Major changes should resolve through people and households, not arbitrary metric adjustments.

---

## 12. AI architecture

### 12.1 Reused local model

The game reuses The Common Crown's local Gemma 3n E4B-it Q4_K_M model through its llama.cpp server on `127.0.0.1:8095`.

The game server exposes a same-origin `/local-ai` proxy. No village state is sent to a hosted service.

### 12.2 AI request types

1. Visitor conversation response.
2. Departure intent and short causal chain.
3. Sunday sermon interpretation.
4. Rare authority response.
5. Optional chronicle prose polishing.

### 12.3 Prompt construction

Prompts include only relevant context:

- Speaker truth and knowledge.
- Relevant relationships.
- Recent memories.
- Current visit issue.
- Conversation history.
- Town summary.
- Applicable event license.
- Allowed IDs.
- Allowed action types.

### 12.4 Validation

Every AI response uses a strict JSON schema and then passes custom validation:

- Required fields.
- String bounds.
- Enum checks.
- Existing actor and target IDs.
- Causal order.
- Action prerequisites.
- Historical plausibility.
- Capability and opportunity.
- Rarity license.
- No direct mutation.

This validation floor exists before any AI-driven consequence is allowed. Until the complete Phase 4 action engine lands, AI departures are restricted to a small safe action subset with ID existence checks, chain-depth enforcement, coarse capability and opportunity checks, adult-only romance exclusions, and deterministic extraordinary-event licensing.

Invalid output falls back to deterministic resolution.

### 12.5 Context and performance budgets

- Conversation: target under 2,500 prompt tokens.
- Departure: target under 3,500 prompt tokens.
- Sermon: aggregate all attendees, include at most 36 detailed known profiles.
- One request in flight at a time.
- Visible thinking state.
- Explicit timeout.
- No generated prose in deterministic state hashes.
- Conversation response target: local fallback after 60 seconds.
- Departure response target: local fallback after 90 seconds.
- Sunday response target: local fallback after 120 seconds.
- Deterministic Sunday application target: under 100 milliseconds for 500 active people on the reference machine.

---

## 13. Save, replay, and determinism

Saves include:

- Schema version.
- Seed.
- Calendar.
- Town.
- Priest.
- Residents.
- Outside actors.
- Households.
- Relationships.
- Event queues.
- Chronicle facts.
- Sermons.
- Statistics.

Generated prose is stored only when needed for display. Mechanical resolution uses structured records.

The game will support:

- Automatic save after each hour.
- Manual save.
- Export and import.
- Migration between schema versions.
- Deterministic replay of commands and AI proposals.
- Corruption detection.

Every accepted AI proposal is persisted after validation as structured input to the simulation command log. Replay consumes that recorded proposal and never calls the model again. Rejected proposals and fallback selection are also recorded so the same mechanical state can be reproduced.

---

## 14. User interface and presentation

### 14.1 Church scene

The supplied church image is the permanent primary scene.

The supplied character sheet is chroma-keyed to true transparency. The first figure is the priest. Remaining figures represent villagers and visitors.

### 14.2 Movement

Visitors enter through the south door and follow location-specific paths. Sunday attendees occupy representative pew positions. Movement is cosmetic and does not drive simulation time.

### 14.3 Information surfaces

- Calendar and hour.
- Local AI state.
- Town summary.
- Priest condition.
- Visitor identity and known profile.
- Dialogue history.
- Parish register.
- Chronicle.
- Sunday sermon panel.
- Outside attention and warnings.
- Save controls.

### 14.4 Accessibility

- Keyboard-operable controls.
- Reduced motion.
- Scalable UI.
- High contrast option.
- No information communicated only by color.
- Clear AI wait and fallback states.
- Responsive layout.

---

## 15. Testing strategy

### 15.1 Unit tests

- Seeded generation.
- Exactly 200 starting villagers.
- Unique names.
- Deferred profiles.
- Church location routing.
- Ten-statement limit.
- Four-hour day.
- Sunday transition.
- Attendance.
- Sermon word limit.
- Action validation.
- Chain depth.
- Priest-targeting prerequisites.
- Outside attention escalation.
- Birth, migration, departure, and death.
- Save migration.

### 15.2 Property and fuzz tests

- Thousands of seeds.
- No duplicate starting IDs.
- No invalid relationship references.
- Metrics remain bounded.
- No impossible chain actor.
- No unbounded queues.
- No action targets missing people.
- Population changes remain internally consistent.

### 15.3 AI contract tests

- Health endpoint.
- Conversation schema.
- Departure schema.
- Sermon schema.
- Invalid output fallback.
- Timeout fallback.
- Prompt injection resistance.
- Unknown ID rejection.
- Extraordinary action rejection without license.

### 15.4 Browser tests

- Start new game.
- Continue save.
- Render art.
- Enter each church location.
- Submit dialogue.
- Reach ten statements.
- End four hours.
- Sunday service.
- Word limit.
- Register and chronicle.
- Outside visitor.
- Priest injury and terminal outcome.
- No console errors.

### 15.5 Long-run tests

Run deterministic simulations for:

- Up to one in-game year across representative seeds during final balancing.
- High-conflict scenarios.
- High-scandal scenarios.
- AI-disabled scenarios.

Check:

- Population does not explode or vanish without causes.
- Across at least 1,000 simulated village-years, realized comic events remain between 2% and 10% of significant events unless a deliberately comic test scenario is active.
- Across at least 1,000 simulated village-years, realized outrageous events remain below 2% of significant events.
- Unprovoked serious violence remains below 1% of significant events; violence with traceable feud, crime, war, severe stress, or defense causes is measured separately.
- Archdeacon, sheriff, and comparable representatives may appear when attention warrants, but a direct king or pope visit occurs in fewer than 0.5% of one-year seeded runs.
- No direct pope or king visit occurs without all documented escalation prerequisites.
- Advice creates traceable long-term differences.
- Paired deterministic scenarios that differ only in one material piece of priestly advice produce at least one causally attributable state divergence within 30 simulated days in the designated consequence test cases.

---

## 16. Independent review protocol

Every phase follows this sequence:

1. Confirm the phase acceptance criteria.
2. Implement only the phase scope.
3. Run the smallest complete automated test set.
4. Run browser checks for changed behavior.
5. Request an independent code/design review from a separate reviewer context that did not author the implementation.
6. Fix every high-confidence correctness issue. A phase cannot pass review while any reviewer finding classified as blocking, correctness, state-integrity, AI-authority, safety, or acceptance-coverage remains unresolved.
7. Re-run tests.
8. Commit the phase with a descriptive message and required co-author trailer.
9. Start the next phase only after the commit succeeds.

The independent reviewer must specifically examine:

- Hidden state corruption.
- AI authority leaks.
- Broken causal chains.
- Historical or tonal contradictions.
- Unbounded or overly frequent rare events.
- Save compatibility.
- UI regressions.
- Missing tests.

---

## 17. Phased implementation

### Phase 0 — Reviewed playable prototype baseline

**Current prototype scope**

- New standalone game folder.
- Supplied church background.
- Processed transparent character atlas.
- 200 named villagers.
- Procedural identity and backstory banks.
- Four appointments per day.
- Ten statements per visitor.
- Location routing and walking.
- Basic local Gemma conversation, departure, and sermon requests.
- Deterministic fallback.
- Minimal AI validation floor: safe action subset, valid actor and target IDs, maximum three steps, coarse capability and opportunity checks, adult-only romance exclusion, and deterministic extraordinary-event license.
- Sunday attendance and sermon.
- Parish register.
- Chronicle.
- Local save.
- Unit and browser smoke tests.

**Exit criteria**

- Master plan independently reviewed.
- Existing tests pass.
- Dedicated git repository initialized.
- Baseline committed.

### Phase 1 — Authoritative state model and save foundation

**Scope**

- Formalize schemas for town, priest, resident, household, relationship, visit, action, event, outside actor, and queue.
- Add schema versioning and migration.
- Separate mechanical event facts from generated prose.
- Add command log and deterministic replay hooks.
- Persist every accepted validated AI proposal and replay it without calling the model.
- Guarantee deferred person generation is independent of activation order.
- Add export/import and rotating autosave.
- Add integrity validation on load.

**Tests**

- Round-trip all state.
- Corrupted save rejection.
- Migration fixture.
- Replay produces the same mechanical state.
- Replaying recorded AI proposals performs no network or model request.
- Generating the same two people in opposite activation orders produces identical profiles.
- Save and reload preserve identical deferred profiles.

**Review focus**

- Missing persistent fields.
- Circular data.
- Nondeterministic state.
- Unsafe migration defaults.

### Phase 2 — Population, households, knowledge, and life course

**Scope**

- Expand validated AI departure proposals beyond prose so conversation-driven reactions may directly initiate eligible work, relationship, family, health, and migration changes.
- Resolve final choices from a blended decision score: AI interpretation and conversation conclusions matter substantially, while personality, relationships, household pressure, health, wealth, rumors, and the priest's trust, moral authority, scandal, and consistency independently constrain the result.
- Household economy.
- Directed relationships.
- Knowledge and rumor layers.
- Aging.
- Illness and death.
- Marriage, separation, annulment, and desertion; no modern civil divorce abstraction.
- Pregnancy, birth, adoption.
- Immigration and emigration.
- Occupation changes.

**Tests**

- Referential integrity.
- Household consistency.
- Population lifecycle.
- Adult-only romance and marriage eligibility.
- Long-run stability.

**Review focus**

- Impossible family structures.
- Population runaway.
- Knowledge leaks.
- Uncaused state changes.

### Phase 3 — Conversation and memory depth

**Scope**

- Structured visit intent.
- Hidden disclosure thresholds.
- Intent classification for player speech.
- Contradiction tracking.
- Promises and confidentiality.
- Structured memories.
- AI prompt minimization.
- Better deterministic dialogue fallback.
- Deterministic trust, emotion, relationship, disclosure, and memory-charge resolution; AI supplies prose rather than mechanical deltas.
- Adversarial player speech cannot change allowed actions, outside attention, or validation rules.

**Tests**

- Ten-statement behavior.
- Memory formation.
- Contradictory advice.
- Confidentiality breach.
- AI schema and timeout.

**Review focus**

- Prompt injection.
- Model inventing facts.
- Excessive context.
- Mechanical effects hidden in prose.

### Phase 4 — Causal action engine, priest vulnerability, and rare behavior

**Scope**

- Data-driven action definitions.
- Preconditions and capability checks.
- Priest state.
- Actions toward the priest.
- Causal event records.
- Deferred queues.
- Ordinary/comic/outrageous event licensing.
- Injury, removal, and death outcomes.
- Explicit adult-only romance, seduction, courtship, and marriage gates.

**Tests**

- Chain depth never exceeds three.
- Murder and poisoning prerequisites.
- Romance and scandal prerequisites.
- Minors can never be targets of romantic or sexualized actions.
- Rare event frequency distribution.
- No invalid actor or target.

**Review focus**

- AI bypassing validators.
- Random cruelty.
- Comedy frequency.
- Terminal-state bugs.

### Phase 5 — Church, royal, and outside-world escalation

**Scope**

- Attention tracks.
- Archdeacon, bishop, examiner, papal legate, pope.
- Sheriff, commissioner, noble, king or queen.
- Outside visitor scheduling.
- Letters and petitions.
- Authority investigations and judgments.
- Historically plausible escalation delays.

**Tests**

- Report-to-bishop chain.
- Violence-to-sheriff chain.
- Papal and royal rarity.
- Outside actors excluded from starting 200.
- External visitor conversations and departures.

**Review focus**

- Direct high authority appearing too often.
- Missing causal prerequisites.
- Broken population count.
- Visitors persisting incorrectly.

### Phase 6 — Sunday congregation and parish politics

**Scope**

- Detailed attendance reasons.
- Visible notable absences.
- Sermon interpretation.
- Individual reactions.
- Sermon contradiction memory.
- Public confession, protest, procession, disruption.
- Parish factions and informal leaders.
- Stable relevance scoring for the maximum 36 detailed sermon profiles.

**Tests**

- All attendees affected.
- Non-attendees do not receive direct sermon effects.
- Word limit.
- Sermon-triggered queues.
- Sunday performance with 200+ people.

**Review focus**

- Sermon AI overreach.
- Unreadable mass effects.
- Attendance causality.

### Phase 7 — Material village simulation

**Scope**

- Seasonal calendar.
- Food, work, prices, debt, charity.
- Weather.
- Disease.
- Crime and local justice.
- Integration with counsel and sermons.

**Tests**

- Seasonal economy.
- Scarcity consequences.
- Material prerequisites.
- One-year final balance runs.

**Review focus**

- Metrics changing without people.
- Economy instability.
- Excessive simulation cost.

### Phase 8 — Presentation, accessibility, balance, and release

**Scope**

- Final UI and animation.
- Audio and ambience.
- Accessibility settings.
- Tutorial.
- Chronicle readability.
- Balance passes.
- Performance profiling.
- Release documentation.

**Tests**

- Full browser acceptance suite.
- Accessibility checks.
- Save compatibility.
- Long-run balance.
- AI-on and AI-off play.

**Review focus**

- Release blockers.
- Accessibility regressions.
- Stale assets.
- Unclear failure states.

---

## 18. Commit plan

Expected commits:

1. `chore: establish reviewed prototype baseline`
2. `feat: add authoritative state and save schemas`
3. `feat: simulate households relationships and life course`
4. `feat: deepen conversation memory and disclosure`
5. `feat: add causal actions and priest vulnerability`
6. `feat: add external authority escalation`
7. `feat: expand Sunday parish consequences`
8. `feat: add material village simulation`
9. `feat: finish presentation balance and release`

Every commit must include:

`Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`

---

## 19. Definition of done

The game is complete when:

- Every new game begins with exactly 200 named villagers.
- The player can conduct four appointments per ordinary day.
- Each appointment supports ten typed statements.
- Visitors reliably use the appropriate church location.
- Sunday gathers a causally determined congregation.
- Sermons affect all attendees and produce legible individual consequences.
- Villagers can perform a broad, validated set of actions toward one another and the priest.
- Serious, comic, and outrageous behavior occurs at believable relative frequencies.
- Outside authority visits arise from traceable escalation.
- The local Gemma model enriches play without controlling authoritative state.
- The game remains playable without AI.
- Saves survive version changes.
- Long-run simulations remain stable.
- Automated tests and independent reviews pass for every committed phase.
