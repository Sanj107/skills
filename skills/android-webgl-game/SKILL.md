---
name: android-webgl-game
description: Build a complete Android game as an installable .apk from HTML5/WebGL (three.js) without the Android SDK - a full-screen WebView shell, a Java bridge for local Wi-Fi multiplayer (TCP + UDP discovery), vibration and save backups, a voxel renderer, and headless-browser tests including two-player tests. Use when the user asks for a mobile/Android game, a clicker/idle/strategy/3D/voxel game as an APK, LAN or hotspot 1v1 multiplayer for a phone game, or wants to test such a game without a device.
license: Complete terms in LICENSE.txt (Apache-2.0). Downloaded tools keep their own licenses (three.js MIT, Apktool/apksig Apache-2.0, dalvik-dx Apache-2.0, uber-apk-signer Apache-2.0).
---

# Android WebGL game

The game is a web page (`assets/index.html` + JS) running inside a full-screen `WebView`.
A tiny Java shell adds what the browser cannot do: raw sockets for LAN multiplayer, vibration,
a file backup of the save, lifecycle hooks and the Back button. The APK is built with
standalone tools, so no Android SDK, Gradle or emulator is needed — only a JDK, `curl`, `unzip`, `zip`.
A Gradle project is generated too, for anyone who has Android Studio.

Why this stack: one codebase that you can run and screenshot in headless Chromium, iterate on
in seconds, and package into a ~0.5 MB APK. three.js r149 is the last release with a classic
`three.min.js` global build (ES modules do not load from `file:///android_asset`).

## Workflow

1. **Scaffold**: `bash scripts/new_game.sh <dir> --package com.example.mygame --name "My Game"`
   → Android shell (MainActivity, GameBridge with LAN networking), manifest, icons,
   `tools/build_apk.sh`, and a playable starter page (voxel island, tap counter, save, LAN ping).
2. **Write the game** in `<dir>/android/app/src/main/assets/` (plain `<script>` files, no bundler).
   Keep content in data tables (`data.js`) separate from systems. See the references below.
3. **Run it in a browser**: `npx http-server -p 8766 -c-1 <dir>` and open
   `/android/app/src/main/assets/index.html`. The starter's `net.js` switches to a
   BroadcastChannel transport when `window.AndroidBridge` is missing, so two tabs behave like two phones.
4. **Test headless**: `node scripts/shoot.js <url> out.png --mobile [--click sel] [--eval js] [--wait ms]`
   for screenshots and console errors; write Playwright scripts for flows (see reference/testing.md).
   Always look at the screenshots — layout, framing and colours fail silently.
5. **Build the APK**: `bash <dir>/tools/build_apk.sh` → `<dir>/release/<name>.apk`
   (javac against a real `android.jar` API 34 → dx → aapt2 link → zipalign + v1/v2/v3 debug signing).
   Bump `versionCode`/`versionName` in `android/app/build.gradle.kts`; the script reads them.
6. **Deliver**: commit the APK and the sources; hand the user the `.apk` (it is signed with a debug key:
   fine for sideloading and testing, re-sign with a release key for a store).

## Shell ↔ page contract

| Direction | Mechanism |
|---|---|
| JS → Java | `window.AndroidBridge.method(...)` — methods annotated `@JavascriptInterface` in `GameBridge.java` |
| Java → JS | `webView.post(() -> webView.evaluateJavascript("window.VCNet && VCNet.onNative(" + JSONObject.quote(json) + ")", null))` — always on the UI thread, always quote with `JSONObject.quote` |
| Back button | `MainActivity.onBackPressed` calls `window.VC.onBack()`; return `true` if the page handled it (closed a panel/modal), otherwise the activity finishes |
| Pause / resume | `VC.onPause()` (save now — the process may be killed) and `VC.onResume()` |

Bridge methods in the template: `vibrate(ms)`, `saveBackup(json)`/`loadBackup()`, `getLocalIps()`,
`lanHost(name)`, `lanDiscover(on)`, `lanConnect(ip)`, `lanSend(line)`, `lanClose()`.

## References — read the one you need

- [reference/lan-multiplayer.md](reference/lan-multiplayer.md) — Wi-Fi/hotspot 1v1: discovery, framing, host-authoritative sync, protocol, rating, failure handling.
- [reference/voxel-rendering.md](reference/voxel-rendering.md) — voxel models and the culled/AO mesher, colours, camera framing on portrait phones, particles, performance budget.
- [reference/game-systems.md](reference/game-systems.md) — clicker/idle economy formulas, offline income, prestige, story missions, a balance-simulation bot.
- [reference/testing.md](reference/testing.md) — Playwright with SwiftShader WebGL, mobile emulation, two-tab multiplayer tests, full-campaign automation.

## Pitfalls that cost real time

- `'#fff'`-style colours parsed with `parseInt(hex, 16)` become `0x000fff` (blue). Expand 3-digit hex first.
- `renderer.outputEncoding = THREE.sRGBEncoding` with hand-picked vertex colours washes everything out. Leave the default (linear) unless you convert colours.
- Portrait phones have a ~30° horizontal FOV at a 60° vertical FOV. Fit the camera to the content's bounding box (project corners, back off until they fit the area the HUD leaves free) instead of guessing distances.
- `requestAnimationFrame` stops while the app is in the background but the process lives on. Pay idle income for the gap on the next frame, and measure "time away" at boot **before** the first autosave refreshes `lastSave`.
- WebView needs `setDomStorageEnabled(true)` for `localStorage`; mirror the save to a file through the bridge anyway.
- AudioContext starts suspended: create/resume it on the first `pointerdown`.
- `pkill -f "<pattern>"` in the same shell command line as the pattern kills that shell. Start/stop dev servers in separate commands.
- dx (not d8) is used because d8 is not on Maven Central; compile with `-source 8 -target 8 -bootclasspath android.jar`.
