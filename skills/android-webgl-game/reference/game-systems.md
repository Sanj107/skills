# Game systems for clicker / idle / strategy games

## Structure

- `data.js` — every table: buildings, upgrades, enemies, regions, talents, shop, achievements.
- `story.js` — chapters and missions: `{id, ch, title, intro: [[speaker, text]], goal, outro, reward}`.
- `state.js` — default state, migration (fill missing fields), save/load, `recompute()` of all
  derived numbers (income, tap power, combat stats) into one object read by UI and logic.
- `combat.js` — pure simulation (no DOM), reused by story fights, raids, the bot and PvP.
- `ui.js` / `panels.js` — HUD, bottom tabs + sliding sheet, modals, dialogue, toasts; panels
  render HTML strings and a cheap `refresh()` toggles affordability every 0.5 s.

## Economy formulas that work

| Thing | Formula |
|---|---|
| Building level price | `cost · 1.15^level` (bulk: geometric sum; "max": `floor(log(gold·0.15/first + 1) / log 1.15)`) |
| Building income | `inc · level · 2^(milestones reached)`, milestones 10/25/50/100/150/… |
| New building tier | ~×10 price and ×6–7 income of the previous one |
| Tap | `base · multipliers + income/s · share` (1–4%) so taps stay relevant late |
| Upgrades with caps | stat `base · 1.08^lvl`, price `base · 1.27–1.3^lvl`, cap rises with the ship/hero tier |
| Enemy at level L | HP/damage `k · 1.276^L`; loot `12 · 1.46^L` (loot outgrows power so deeper is richer) |
| XP | need `20 · L^1.6 + 30`; battle XP `8 + 4 · L^1.55` |
| Prestige | currency `3 · cbrt(earned / 1e9)`, +5% income each; keep story, reset economy |

Adjacency/strategy layer: limited plots of two types plus pair bonuses (A next to B: +30–50%
both) and auras. Placement then matters even when every building is affordable.

## Offline and background time

- Measure `away = now - lastSave` at boot **before** anything saves.
- Pay `income · min(away, cap) · rate` (rate 50–100%, cap 2–15 h from upgrades) in a modal with a
  "×2 for premium currency" option.
- In a WebView the process often survives in the background while frames stop: detect a wall-clock
  gap > 60 s between frames and pay it the same way.
- Expeditions, boosts and daily resets use `Date.now()`, so they progress while closed.

## Story missions as the tutorial

Goal types: `taps n`, `build id n`, `gold n` (earned since mission start: store a base value when
the goal begins), `upgrade id n`, `tier n`, `module id n`, `battle enemy level`, `level n`,
`events n`, `expeditions n`, `choice`. Missions unlock tabs (`unlock: ['island']`), officers,
artifacts and features. A goal chip at the top shows progress and a "Go" button that opens the right
tab or starts the fight. Write player lines without gendered verb forms when the language has them.

## Balance simulation

Write a Node script that loads the real `data.js`/`state.js`/`combat.js` into a `vm` context and plays
the campaign with a greedy bot: buy the best `price / income gain`, save up for the current
mission's purchase, upgrade the ship when a fight is too hard, raid every N seconds, optionally
alternate active and offline periods. Print when each chapter is reached. Look for walls
(a mission that takes hours) and snowballs (chapters that last seconds), then retune prices.
Typical targets: first chapter in minutes, story finale in 10–20 active hours, prestige useful from mid-game.
