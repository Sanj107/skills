#!/usr/bin/env node
// Screenshot a WebGL page in headless Chromium (SwiftShader) and report console errors.
//
// Usage: node shoot.js <url> <out.png> [--mobile] [--size 412x860] [--wait 1500]
//                      [--click <selector>]... [--tap x,y]... [--eval <js>]... [--two]
//   --mobile   phone emulation (touch, isMobile, DPR 2) at 412x860 unless --size is given
//   --two      open the URL in a second tab of the same context too (BroadcastChannel peers);
//              the second tab is saved as <out>-b.png
// Actions run in the order given, each followed by a short pause. Exit code 1 on page errors.
'use strict';
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch (e) { /* try next */ }
}
if (!chromium) { console.error('Playwright not found: npm i -D playwright'); process.exit(2); }

const args = process.argv.slice(2);
if (args.length < 2 || args.includes('-h') || args.includes('--help')) {
  console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(1, 9).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(args.length < 2 ? 1 : 0);
}
const [url, out] = args;
const opt = { mobile: false, size: null, wait: 1500, two: false, actions: [] };
for (let i = 2; i < args.length; i++) {
  const a = args[i];
  if (a === '--mobile') opt.mobile = true;
  else if (a === '--two') opt.two = true;
  else if (a === '--size') opt.size = args[++i];
  else if (a === '--wait') opt.wait = +args[++i];
  else if (a === '--click') opt.actions.push(['click', args[++i]]);
  else if (a === '--tap') opt.actions.push(['tap', args[++i]]);
  else if (a === '--eval') opt.actions.push(['eval', args[++i]]);
}
const [w, h] = (opt.size || (opt.mobile ? '412x860' : '1280x800')).split('x').map(Number);

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: opt.mobile ? 2 : 1, isMobile: opt.mobile, hasTouch: opt.mobile });
  const errors = [];
  const open = async tag => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`[${tag}] ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); });
    await p.goto(url);
    await p.waitForTimeout(opt.wait);
    return p;
  };
  const page = await open('a');
  const second = opt.two ? await open('b') : null;
  for (const [kind, val] of opt.actions) {
    if (kind === 'click') await page.click(val);
    if (kind === 'tap') { const [x, y] = val.split(',').map(Number); await page.mouse.click(x, y); }
    if (kind === 'eval') console.log('eval →', JSON.stringify(await page.evaluate(val)));
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: out });
  if (second) await second.screenshot({ path: out.replace(/\.png$/, '') + '-b.png' });
  console.log('saved', out);
  for (const e of errors) console.log('ERROR', e);
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
