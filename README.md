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
- Ordinary dialogue is one compact model call: the model interprets what the priest just said and answers it, while deterministic rules keep authority over world state, permissions, and consequences.
- Every turn is traced from player text through supplied facts, interpreted meaning, raw model output, and final text, recording any transformation and the code path responsible.
- Invalid model claims are repaired by sentence while valid parts of the reply are preserved.
- Clause-level turn analysis distinguishes silence, questions, commands, suggestions, decisions, accusations, humor, unrelated observations, and up to six custom proposals without forcing every statement to be a solution.
- Visitors may accept, reject, defer, or remain uncertain about each part of a multi-part proposal; those decisions persist into memory and departure planning.
- Visitors can challenge, set boundaries, cry, withdraw, leave early, call for help, threaten, or—under exceptionally strict conditions—attack.
- Scenario selection is grounded in occupation, age, status, household, relationships, travel, access, and knowledge channels.
- Compositional actions support bounded combinations of work, property, resources, family, law, migration, violence, faith, building work, and improvised social acts.
- Departure consequences support up to three parallel visitor commitments or causal response steps, including real route scouting, evacuation preparation, and limited lawful defense readiness.
- Church food, coin, medicine, and fuel stores can be given or replenished through donations.
- Offering church stores works from ordinary speech: "take these four silver pennies" transfers coin, is capped at what the parish actually holds, and reports what remains.
- The priest may ask for donations, privately during a visit or from the pulpit on Sunday. How he asks matters: a plain or faithful appeal opens hands modestly, leaning on damnation opens more of them but costs him moral authority and trust, and a disgraced priest collects nothing. Some parishioners give unprompted if they think well of him.
- A Sunday market built on real production chains. Each good names the trades that make it and the goods it is made from — grain to flour to bread, milk and salt to cheese, herbs and honey to medicine — and every Sunday each producer in the parish is weighed individually by their illness, injuries, worry, age and whether their own household has food. A sick baker means dear bread; a sick miller means no bread at all, and the board says whose absence caused it. People eat before workshops are supplied, and trades competing for the same raw material share what is left in proportion to what they asked for.
- The collection can be spent at the stalls on whatever the village had left over, and the coin ends up in the sellers' own households.
- Sermons move people in proportion to force, receptivity, and relevance. A sermon that names a listener's actual trouble moves them several times as much as anyone else, more again if they have sat opposite the priest and told him about it, and it takes real pressure off the matter itself. Repeating the same sermon week after week lands progressively lighter.
- After the sermon the priest sees exactly who gave and what, who was moved or hardened, by how much, and why.
- Illness can kill, in proportion to what it is, how long it has held, the sufferer's age and whether anyone is nursing them; church medicine and a fed household are the difference between a bad month and a burial. Wounds fester untended and can turn to wound fever, and dressing them closes them.
- Violence grows only out of bonds that have genuinely soured between named people, and only where someone has run out of anything else — hunger, ruin, a violent temper. Most such grudges never come to anything, a few end in a beating, and killing sits at the far rare end of it. Harmony, faith, mercy and safety all restrain it.
- Every figure on the parish panel is both driven and load-bearing: harmony, faith, mercy and safety restrain violence; mercy also decides how freely the parish gives; prosperity sets what the village can pay at market; infrastructure sets how much the parish can make; food security drives hunger, illness and crime.
- Rare stewards, magistrates, lords, bishops, sheriffs, royal officers, papal legates, kings, and popes arise through difficult causal escalation.
- Exported saves include action normalization, accepted-prefix, rejection-gate, and fallback diagnostics.
- Completed appointments retain bounded transcripts and audits, while the most recent visit retains bounded exact prompt traces for debugging.
- End-of-day and end-of-week reports compare every parish, priest, population, and church-store value and list events and affected people.
- The game supports zero-time pause/resume and replay-based undo for the latest uncompacted conversation turn.
- Three deterministic neighboring parishes seed causal relief stories with named priests, stewards, lords, travel time, resource commitments, and delayed reports.
- Error notices remain visible longer, and **Export Debug Log** includes the error journal, active conversation, prompt diagnostics, and full current save state.

## Getting started

Clone it, install the Node dependencies, then fetch the model once:

```powershell
git clone https://github.com/configmanCooper/the_common_confessor.git
cd the_common_confessor
npm install
.\scripts\setup-local-ai.ps1
```

That last step downloads two things into the project folder and nothing else:

| | size | what it is |
|---|---|---|
| llama.cpp | ~90 MB | the server that runs the model |
| Gemma 3n E4B (Q4_K_M) | ~4.5 GB | the model that speaks for the villagers |

Neither is in this repository — a four-gigabyte model has no business in version control — and both are ignored by git once installed. The download is resumable: if it is interrupted, run the script again and it continues from where it stopped rather than starting over. It finishes by loading the model once to prove it works.

If the script finds no NVIDIA card it installs the CPU build instead, which works but answers slowly. Pass `-Cpu` to force that, or `-Force` to re-download.

**No graphics card, or no wish to download several gigabytes?** You do not need any of the above. Start the game, open **Settings → Google Gemini**, and paste a free API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey). The parish then speaks through `gemini-2.5-flash` and nothing else changes.

## Running the game

Double-click `start.cmd`, or run:

```powershell
.\start.cmd
```

That starts the local model, starts the game server, waits until both answer, and opens the browser. When you have finished playing:

```powershell
.\stop.cmd
```

Stopping matters. Closing the window does not always tear down the model runner, and an orphaned runner keeps its GPU memory until it is killed — which silently pushes the next session onto the CPU and makes replies roughly four times slower. `stop.cmd` reclaims it and reports how much was freed.

Both scripts only ever touch processes belonging to this project, matched by executable path, so local-AI runners from other projects on the same machine are left alone.

Useful options:

```powershell
.\start.cmd -ContextSize 16384   # larger context; costs more GPU memory
.\start.cmd -Port 9000           # a specific port
.\start.cmd -NoBrowser           # do not open a browser
.\start.cmd -GpuLayers 24        # override automatic offload
```

`npm run play` and `npm run stop` do the same thing.

### GPU memory is the thing that decides speed

The start script reports free VRAM and picks an offload level to match. Full GPU offload is worth roughly **36 tok/s versus 8.6 tok/s** partially offloaded, so if it warns that memory is tight, closing Chrome, Edge, or another local-AI project is the single most effective fix.

## Watch a model play

A debugging tool. **Watch AI** in the top bar hands the parish to a Copilot model and lets you watch it work as the priest.

The rule that governs the rest of the game holds most strictly here: **the model never touches game state.** The engine enumerates the moves that are legal at that moment — each carrying the same explanation the interface shows you — and the model replies with the *index* of one plus a sentence on why. The interface then performs it exactly as your click would, so a watched run stays replayable and the model can never reach a move you do not have.

It also sees only what you see. An undisclosed confession, a scenario fact you have not learned, another villager's private memory, and the truth behind a rumour are all withheld; the parity tests in `test/agent.test.js` enforce that in both directions. A model that could see the secret would be playing a different game, and its playthrough would prove nothing.

**Step one move** at a time or **Let it play**. The *Try this* box steers it — *"be as generous as the stores allow"*, *"refuse every request and see what the village does"* — and you can take over at any point.

For a long unattended run there is a headless version:

```powershell
node scripts/watch-ai-playthrough.mjs --days 14 --model gpt-5.6-sol
node scripts/analyze-playthrough.mjs        # reads the newest run
```

The run writes a full save plus a turn-by-turn log to `exports/`. The analyzer reads that log and reports the faults that only appear over weeks: lines the framework wrote instead of the model, scenario prose reaching the screen verbatim, sentences repeated across different visitors, situations the parish over-produces, and visits that spend every turn without anything being decided.

This is how the Unicode-space bug (`"it feltwrong"`) and the stitched-clause leak (`"I cannot promise yet to We must seek..."`) were found.

## AI providers

Local Gemma remains the default and offline-safe provider. The top bar can also select **GitHub Copilot** when the official Copilot SDK can authenticate the signed-in user. Copilot prompts count against that account's usage allowance.

### Playing without a graphics card

A local model wants a graphics card, which most people do not have. **Settings → Google Gemini (free tier)** removes that requirement: paste an API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and the parish speaks through `gemini-2.5-flash` instead. Nothing else about the game changes — the model still only supplies dialogue and proposals, and the deterministic rules still own every consequence.

The key is yours and is treated as such:

- it is kept in your browser's local storage and nowhere else;
- it is never written into a save, an export, or a debug log, and there is a test that fails if it ever is;
- it is sent only to Google, and only when Gemini is the selected provider.

**Test this key** in the settings panel checks it against Google before you rely on it. If the key is missing, rejected, or rate limited, the parish falls back to its deterministic rules rather than stopping.

The Copilot integration runs only in the Node server:

- no GitHub token is sent to the browser;
- every built-in, MCP, and custom tool is excluded;
- every permission request is rejected;
- replay uses recorded responses and never calls either provider.

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
