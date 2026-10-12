# LAN 1v1 multiplayer (Wi-Fi or hotspot, no internet, no server)

## Transport (GameBridge.java, already in the template)

| Piece | How |
|---|---|
| Host | `ServerSocket` on TCP **47800**, accepts one peer; while waiting, a thread sends a UDP beacon every second |
| Beacon | `"<TAG>|<name>|47800"` to `255.255.255.255` **and** every interface's directed broadcast (`InterfaceAddress.getBroadcast()`); some phones (hotspot hosts especially) drop the limited broadcast |
| Discovery | `DatagramSocket` bound to UDP **47801** with `setReuseAddress(true)`/`setBroadcast(true)`; hold a `WifiManager.MulticastLock` while listening or many devices filter broadcasts |
| Manual fallback | show `getLocalIps()` on the host; the guest types it (`lanConnect(ip)`) — works when broadcasts are blocked (guest Wi-Fi, AP isolation) |
| Framing | one JSON object per line (`BufferedWriter` + `'\n'`); `JSON.stringify` never emits raw newlines |
| Threads | accept/read/beacon/discover each on their own thread; writes through a single-thread executor so lines never interleave |
| Events to JS | `{"ev":"hosting|found|connected|msg|closed|error", ...}` → `window.VCNet.onNative(json)`, posted to the UI thread |
| Sessions | every `lanHost`/`lanConnect`/`lanClose` bumps a session counter; threads from an old session stay silent, so a cancelled host does not report a late "error" |

Permissions (all "normal", no runtime prompt): `INTERNET`, `ACCESS_NETWORK_STATE`,
`ACCESS_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE`. Cleartext rules only affect HTTP, not raw sockets.

Hotspot play: phone A enables its hotspot and taps Host, phone B joins that hotspot and taps Find.
Mobile data is not used.

`net.js` gives the page one API on both platforms — `host(name)`, `discover(on)`, `connect(ip)`,
`send(obj)`, `close()`, `localIps()`, `on(event, fn)` — and in a desktop browser falls back to a
`BroadcastChannel` emulation so two tabs are two "phones".

## Game protocol pattern (host-authoritative)

```
both:  hello {v: PROTO, p: profile}      // version check + names, ship stats, rating
host:  mode {m}                          // lobby options belong to the host
both:  ready {i}
host:  start {seed, mode, a, b, ...}     // full initial state for both sides
guest: in {c: cmd, a: arg}               // inputs only: tap, ammo, ability, board, flee
host:  fx {l: [events]}                  // what happened (shots, hits, abilities) for effects/sound
host:  st {s: snapshot}                  // ~10 Hz authoritative state
host:  end {w, r}                        // winner, reason
both:  emote {i}, bye
```

- The host runs the only simulation (`Battle.step`), feeding the guest's inputs into side 1.
  The guest keeps a mirror `Battle` built from the same start data (for max HP etc.), overwrites it
  with each snapshot and renders queued `fx`. No desync is possible; latency on a LAN is ~5–20 ms.
- Let the guest apply cosmetic choices optimistically (selected ammo highlight) — the host confirms.
- Rate-limit inputs on the host (e.g. a tap bucket of 8/s) so autoclickers do not win.
- Mirror sides for the guest's view: scene side 0 is always "me".
- Disconnect mid-battle → technical win for the remaining player; in the lobby → back to idle.
- Rating: Elo, `exp = 1 / (1 + 10^((opp - me) / 400))`, `me += 32 * (score - exp)`. It is
  client-side and trust-based (fine between friends); a server would be needed for a real ladder.
- Offer a practice bot that uses the same battle code with an AI controller, so single-device
  testers can play the mode too.

## Testing without phones

Open the page in two tabs of one browser context. To give each tab its own save, namespace
`localStorage` by `window.name` in an init script (see reference/testing.md). Assert both tabs
report the same HP after a fight and opposite results at the end.
