# Robust Narrative Framework Integration Plan

## Current foundation

The game already has:

- Canonical schema-17 state with integrity hashes, command replay, periodic checkpoints, causal events, and migrations.
- Complete active transcripts, conversational obligations, proposal decisions, reactions, privacy scopes, prompt diagnostics, and bounded visit archives.
- Typed residents, households, relationships, memories, knowledge, rumors, issue threads, material conditions, church resources, authority escalation, and scheduled follow-ups.
- Bounded compositional and parallel actions with deterministic permissions and resource conservation.
- Daily/weekly reports, live-Gemma playtests, dialogue-style matrices, browser tests, and year-scale replay tests.

## Missing framework capabilities

### P0: mode, obligation, and correction control

1. Add explicit modes:
   - `IN_WORLD`
   - `META_PAUSED`
   - `PLAYER_AUTHORING`
   - `REWIND_PENDING`
2. Replace a single current obligation with a resumable stack:
   - pending player decisions
   - factual interruptions
   - promised reports
   - scene transitions
   - meta/correction duties
3. Preserve an interrupted decision after answering a fact.
4. Add turn correction and undo using canonical command replay.
   - Initial scope is the current uncompacted visit command window.
   - Completed visits remain immutable after periodic compaction until branch-history storage is added.
5. Never consume time or mutate simulation state for pause, correction, or incomplete player-authored text.
   - Meta and mode changes are recorded as zero-time commands so replay preserves them.

### P1: atomic response plans

1. Create an explicit `ResponsePlan` between interpretation and prose.
2. Store:
   - addressed and preserved obligation IDs
   - required response duties
   - accepted/rejected/deferred proposals
   - immutable facts
   - forbidden claims
   - permitted action graph
   - requested time advance
3. Validate the plan before dialogue generation.
4. Validate rendered prose against the plan.
5. Commit conversation and resulting events together or restore the pre-turn state.

### P1: canonical commitments and schedules

1. Promote promises and assignments into typed commitments.
2. Link commitments to:
   - actor
   - beneficiary
   - due window
   - status
   - cancellation rule
   - causal events
3. Make promised reports and return visits occur once at the correct time.

### P2: narrative director

1. Add typed narrative threads with:
   - stage
   - participants
   - pressures
   - seeds
   - blockers
   - unresolved questions
   - retirement criteria
2. Run the director only at visit closure, day boundaries, and sermon closure.
   - Initial development selection is a pure seeded function.
   - Any future LLM-authored development must be captured in a `narrative_development` command and replayed verbatim.
3. Require every development to cite:
   - an active pressure or seed
   - at least one causal event
   - authority, resource, travel, and knowledge prerequisites
4. Enforce pacing:
   - 2–4 major arcs
   - no more than two high-intensity developments in sequence
   - ordinary-life recovery scenes
   - resolved-thread echoes before retirement

### P2: institutions, places, and neighboring parishes

1. Create canonical institutions:
   - parish church
   - manor
   - reeve/steward office
   - lord's household
   - watch
   - neighboring parishes
2. Create three named neighboring settlements per campaign with:
   - church and priest
   - steward/lord jurisdiction
   - travel time
   - food/health/order pressure
   - trust and prior contact
3. Add `external_relief_request` storylet:
   - foreshadowed shortage or disorder
   - limited initial request
   - player/official evaluation
   - optional refusal or revised charter
   - formal resource/personnel terms
   - travel or delegated mission
   - follow-up report and local consequences
4. No neighboring mission may appear without causal prerequisites.
5. Every neighboring route stores explicit travel days and jurisdiction.

### P3: provider abstraction

1. Keep the browser free of API secrets.
2. Introduce server-side providers:
   - local Gemma
   - optional GitHub Copilot SDK
   - future BYOK providers
3. Copilot SDK requirements:
   - authenticated GitHub Copilot account or BYOK
   - tools disabled/denied for dialogue-only calls
   - model catalog queried at runtime
   - explicit usage warning and availability probe
4. Gemma remains the default and offline-safe provider.

## Initial implementation sequence

1. Schema 18: mode state, obligation stack, superseded-turn records, canonical commitments, narrative threads, neighboring parishes.
2. Meta pause and one-turn rewind UI/zero-time commands.
3. Interruption push/pop and pending-decision restoration.
4. Typed commitment scheduling.
5. Narrative director with one fully implemented neighboring-parish relief storylet.
6. Provider interface and non-functional Copilot availability probe; enable SDK only after secured server tests.
7. Golden fixtures, browser tests, live campaigns, thirty-day soak, and one-year replay.

## Acceptance requirements

- Fact interruption answers the fact and preserves the prior decision.
- Obligation stack changes reconstruct from logged conversation or zero-time commands.
- Ten meta interactions advance no simulation time.
- Undo removes the latest exchange, memories, reactions, commitments, and events.
- Incomplete sermon/letter/prayer text is never continued by the game.
- Every scheduled promise fires once or is explicitly cancelled.
- A neighboring-parish mission requires prior need, home capacity, contact, authority, resources, and travel time.
- Refusing an external mission is valid and creates no fabricated travel.
- No model provider can mutate state directly.
- Provider choice affects live generation only; replay always reuses recorded payloads.
- Every committed development includes causal provenance.
- Thirty simulated days complete without critical invariant, obligation, schedule, or knowledge failures.
