# Testing without a phone

## Headless Chromium with WebGL

```js
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
```

Serve the assets over HTTP (`npx http-server <dir> -p 8766 -c-1` — the path goes **before** the
options). `scripts/shoot.js` wraps this for one-off screenshots and quick `--eval` checks.

Look at every screenshot: wrong camera framing, washed-out colours, hidden HUD, overlapping
toasts and unreadable text never show up as errors.

## Seeding a state

Skip the early game by writing a save before the page boots:

```js
await page.addInitScript(() => {
  if (location.protocol === 'about:' || localStorage.getItem('game_save_v1')) return;
  localStorage.setItem('game_save_v1', JSON.stringify({ /* chapter, gold, ship, unlocked tabs … */ }));
});
```

Rewinding `lastSave` the same way tests offline income (and catches "the first autosave
overwrote lastSave" bugs).

## Two players in one browser

BroadcastChannel only connects pages of the same context, and those share `localStorage`. Give each
tab its own save by namespacing keys with `window.name`:

```js
await ctx.addInitScript(() => {
  if (location.protocol === 'about:') return;
  const role = window.name, get = Storage.prototype.getItem, set = Storage.prototype.setItem;
  Storage.prototype.getItem = function (k) { return get.call(this, role + ':' + k); };
  Storage.prototype.setItem = function (k, v) { return set.call(this, role + ':' + k, v); };
});
const open = async role => { const p = await ctx.newPage(); await p.goto('about:blank');
  await p.evaluate(r => { window.name = r; }, role); await p.goto(URL); return p; };
```

Then drive host and guest: create → find → join → ready ×2 → tap on both → compare
`battle.s.map(x => x.hp)` from both tabs → one surrenders → assert "won"/"lost" and rating changes.

## Whole-campaign run

Loop in `page.evaluate`: finish dialogues, fill prompts, pick choices, close reward modals, force-win
battles (`battle.s[1].hp = 0; battle.finish(0, 'sink')`), satisfy goals the way a tester "skip" button
would, and stop when the mission index reaches the end. Assert unlocks, collectibles and endgame
modes. This catches broken mission chains, rewards that throw, and flags that never get set.

## On a real device

`adb install -r release/game.apk`, then `chrome://inspect` on a desktop Chrome to attach DevTools to
the WebView (enable `WebView.setWebContentsDebuggingEnabled(true)` in debug builds).
