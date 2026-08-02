# The Common Confessor

A painterly 2D parish social simulation set in the 1500s. The game reuses The Common Crown's local Gemma model for visitor dialogue, departure consequences, and Sunday sermon interpretation.

## Playtest loop

- Four private appointments each ordinary day.
- From the second day onward, up to four additional named villagers may be requested; they may accept or decline.
- Up to ten typed statements per visitor.
- Confessional, office, nave, and shrine meeting locations.
- Sunday attendance, sermon themes, and 100-word sermons.
- 200 named starting villagers with households, relationships, knowledge, rumors, health, work, marriage, children, migration, and material conditions.
- Conversation-driven AI may propose real actions and life changes, but deterministic rules validate every result.
- Persistent issue threads track pressure, awareness, danger, deadlines, memories, rumors, and recurring participants.
- Every reply receives the complete active appointment plus cumulative trust, fear, anger, sadness, confusion, offense, patience, danger, boundaries, and willingness state.
- A deterministic conversational-obligation planner gives the newest question or command priority over background concerns, tracks mentioned facts, and records whether a reply came from facts, reactions, Gemma, or regeneration.
- Clause-level turn analysis distinguishes silence, questions, commands, suggestions, decisions, accusations, humor, unrelated observations, and up to six custom proposals without forcing every statement to be a solution.
- Visitors may accept, reject, defer, or remain uncertain about each part of a multi-part proposal; those decisions persist into memory and departure planning.
- Visitors can challenge, set boundaries, cry, withdraw, leave early, call for help, threaten, or—under exceptionally strict conditions—attack.
- Scenario selection is grounded in occupation, age, status, household, relationships, travel, access, and knowledge channels.
- Compositional actions support bounded combinations of work, property, resources, family, law, migration, violence, faith, building work, and improvised social acts.
- Departure consequences support up to three parallel visitor commitments or causal response steps, including real route scouting, evacuation preparation, and limited lawful defense readiness.
- Church food, coin, medicine, and fuel stores can be given or replenished through donations.
- Rare stewards, magistrates, lords, bishops, sheriffs, royal officers, papal legates, kings, and popes arise through difficult causal escalation.
- Exported saves include action normalization, accepted-prefix, rejection-gate, and fallback diagnostics.
- Completed appointments retain bounded transcripts and audits, while the most recent visit retains bounded exact prompt traces for debugging.
- End-of-day and end-of-week reports compare every parish, priest, population, and church-store value and list events and affected people.

```powershell
npm run play
```

Open the local URL printed in the terminal. `npm run play` starts this game and, when needed, The Common Crown's local AI server.

```powershell
npm test
npm run test:browser
npm run balance:social-12w
npm run balance:reaction-year
```

Final balancing can run a one-year deterministic simulation with:

```powershell
npm run balance:year
```

See [GAME_DESIGN_AND_IMPLEMENTATION_PLAN.md](GAME_DESIGN_AND_IMPLEMENTATION_PLAN.md) for the reviewed phased development plan.
