# The Common Confessor

A painterly 2D parish social simulation set in the 1500s. The game reuses The Common Crown's local Gemma model for visitor dialogue, departure consequences, and Sunday sermon interpretation.

## Playtest loop

- Four private appointments each ordinary day.
- Up to ten typed statements per visitor.
- Confessional, office, nave, and shrine meeting locations.
- Sunday attendance, sermon themes, and 100-word sermons.
- 200 named starting villagers with households, relationships, knowledge, rumors, health, work, marriage, children, migration, and material conditions.
- Conversation-driven AI may propose real actions and life changes, but deterministic rules validate every result.
- Rare bishops, sheriffs, royal officers, papal legates, kings, and popes arise through causal escalation.

```powershell
npm run play
```

Open the local URL printed in the terminal. `npm run play` starts this game and, when needed, The Common Crown's local AI server.

```powershell
npm test
npm run test:browser
```

Final balancing can run a one-year deterministic simulation with:

```powershell
npm run balance:year
```

See [GAME_DESIGN_AND_IMPLEMENTATION_PLAN.md](GAME_DESIGN_AND_IMPLEMENTATION_PLAN.md) for the reviewed phased development plan.
