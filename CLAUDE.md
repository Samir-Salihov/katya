# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page romantic gift site ("Katera") built as an installable PWA. Zero dependencies, zero build
step, zero tests — plain HTML/CSS/JS served straight from the repository root.

## Running it

No package manager, no build. Serve the root over HTTP (not `file://` — the service worker and
`fetch` interception need an origin):

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

Deploy is Netlify with `publish = "."` and no build command (`netlify.toml`). `_headers` forces
`Cache-Control: no-cache` on `sw.js` so updates actually reach installed clients.

While iterating, keep DevTools → Application → Service Workers → "Update on reload" checked, or the
cached shell will mask your edits.

## The three-list invariant

Every CSS and JS file is registered in **three** places. Adding, renaming, or deleting a file means
touching all three, or the site silently breaks (offline, or entirely):

1. **`index.html`** — a `<script src>` tag (JS) at the bottom, in load order.
2. **`css/main.css`** — an `@import` (CSS). Order is the cascade; the file comments call this out
   explicitly ("порядок каскада как в оригинале"). Do not alphabetize or reorder these imports.
3. **`sw.js` `CORE[]`** — the precache list. `install` uses `cache.addAll(CORE)`, which is
   **all-or-nothing**: one 404 in that array aborts the whole service worker install.

**Bump `CACHE` in `sw.js` (`katya-v3` → `katya-v4`) on any change to a precached file.** The
`activate` handler deletes every cache whose key differs from `CACHE`; without a bump, returning
visitors keep the old CSS/JS forever. Static assets use cache-first with background revalidate, so
stale content is the default failure mode.

`OPTIONAL[]` (the MP3s) is cached with `Promise.allSettled` and may 404 harmlessly — that is where
files that might not exist belong.

**A cache that looks short is usually a stale worker, not a broken `CORE[]`.** Deleting caches from
the page (DevTools or `caches.delete`) does **not** make Chrome reinstall an already-active worker,
so the precache stays empty or partial until `sw.js` itself changes. Bump `CACHE` — that is what
the version is for — rather than hunting for a 404 that is not there.

The single exception is `js/vendor/trystero.mjs`: it is an ES module pulled in by dynamic
`import()` from `js/call.js`, so it is registered in `sw.js` `CORE[]` only — never as a
`<script src>` tag. See [The call feature](#the-call-feature).

## Script architecture

Classic `<script>` tags, no modules, no bundler — **everything shares one global scope**. This is
load-bearing, not incidental:

- Inline `onclick` handlers in `index.html` call globals directly: `clb()`, `nlb()`, `togglePlay()`,
  `nextTrack()`, `prevTrack()`, `randomMemory()`, `openSamirLetter()`, `closeSamirLetter()`.
  Converting a file to an IIFE or a module breaks its markup unless you also rewrite the handlers.
- Files that own no inline handlers (`intro.js`, `call.js`, `install-hint.js`) already wrap
  themselves in IIFEs. Prefer that pattern for new code.
- `js/haptics.js` must load first — it defines `window.buzz(pattern)`, which everything else calls
  defensively as `window.buzz && window.buzz(...)`.

### The intro corridor

`js/stream.js` is a dependency-free port of a React/Tailwind component (`ImageStreamHero`). It
builds the memory corridor shown between the envelope and the password prompt: two rails of cards
flying out of the dark, sized geometrically so consecutive cards keep a constant ratio and the
ribbon never tears. Every length is `cqw`, so `.ks-host` **must** keep `container-type:inline-size`
— drop it and the corridor collapses.

Three invariants are load-bearing; the comments in the file explain why each exists:

- Depth is authored as *apparent size*, not as an even `z` range.
- `railBirth` is negative — cards are born across the axis, so no hole blinks open at dead centre.
- `exitHeight / birthHeight` spread across `CARDS` sets how fast consecutive cards grow. Keep the
  ratio `(exitHeight/birthHeight)^(1/CARDS)` under roughly **1.45**; past that, neighbours stop
  overlapping and the ribbon tears near the frame edge. Raising `exitHeight` or lowering `CARDS`
  both push toward that tear.

`IMAGES` at the top of the file is empty, so cards fall back to `FALLBACK` sunset gradients.
Dropping real paths into `IMAGES` is the only change needed once photos exist.

`js/stream.js` must load **before** `js/intro.js`, which calls `window.katyaStream.build()`.

### Unlock handshake

`js/intro.js` gates the site behind a 6-digit password (`PWD` constant; hint in the markup is the
author's birthday). This is a keepsake gate, not security — the password is in client-side source.

The opening is choreographed in three beats inside `openEnvelope()` — envelope opens, the stage
"dives" at the viewer (`.env-stage.dive`) while the overlay fades to night (`.in-stream`), then the
password card rises over the running corridor. The beats are chained with `setTimeout` and their
delays are tuned against the CSS transition durations in `envelope.css`; changing one without the
other visibly breaks the seam.

On success it persists `localStorage['katya-unlocked'] = '1'` and dispatches the custom event
`katya:unlocked` on `document`. Anything that must not appear over the envelope overlay waits on it.
Because the event may fire before a listener attaches, `install-hint.js` also sets and checks the
`window.__katyaUnlocked` latch — use that same both-ways pattern (`if (window.__katyaUnlocked) run();
else document.addEventListener('katya:unlocked', run, { once: true })`) for any new late-starting
feature.

`localStorage` keys in use: `katya-unlocked`, `katya-who` (caller identity for the call feature),
`katya-install-dismissed`, `katya-call-total`, `katya-call-log`.

## Known gaps — don't mistake these for bugs to "fix" blindly

- **Placeholder media.** There is no `audio/`, `img/`, or `images/` directory. The gallery, strip,
  and timeline render `.ph` placeholder divs, and `player.js` shows "(добавь MP3)" on audio error.
  Real assets are meant to be dropped in later.
- **Orphaned modules.** `js/secret.js` is loaded but its markup (`#secretClosed`, `#secretOpen`)
  is no longer in `index.html`; likewise `css/sections/{secret,parallax,reasons,story,letter}.css`.
  They guard on element existence and are harmless. Restore the markup or remove all three
  registrations — don't half-delete. (`js/stars.js` is *not* orphaned any more: `#starsCanvas`
  lives inside the counter section and paints its night sky.)
- **Hardcoded values** that are content, not config: the relationship start date in `js/counter.js`
  (`new Date('2024-01-15')`), the 930 km / city names in `index.html`, the memory list in
  `js/memory.js`, the playlist in `js/player.js`.

## The call feature

`js/call.js` renders its **own** call screen — no third-party UI anywhere. It is split in two:

- **`Transport`** — the only place that knows about the media service. Room lifecycle
  (`join`, `leave`), media (`openCamera`, `share`, `closeCamera`, `setAudio`, `setVideo`,
  `switchCamera`), signalling (`callPeer`, `cancelCall`, `answer`, `hangup`, `sendHeart`,
  `sendNote`, `sendShot`) and measurement (`quality`, `countCameras`), plus the `on*` callbacks the
  UI hangs off. Swapping the service means rewriting this object and nothing else.
- **UI** — overlay states, own controls, timer, ringtone, night mode, picture-in-picture.

**No hosted service, no account.** Jitsi went first — `meet.jit.si` now makes the room creator sign
in. Daily.co went second — its free tier now wants a card on file. The transport today is
**Trystero** on its default **Nostr** strategy: the SDP exchange rides over ~28 public Nostr relays
with redundancy, then media goes peer-to-peer. No account, no API key, no secret to deploy. That
absence is the reason it was chosen, not latency or features.

Handing over raw `MediaStream`s remains a hard requirement rather than a preference: the custom
controls and picture-in-picture are impossible with an embedded iframe.

**The room is three constants** at the top of `js/call.js` — `APP_ID`, `ROOM_ID`, `PASSWORD`.
`PASSWORD` is what makes it private: without one, Trystero derives the signaling key from the app
and room ids, which a relay operator could reproduce. Change any of the three and both sides must
change together, or they sit in different rooms and never see each other.

`js/vendor/trystero.mjs` is the library itself, vendored deliberately — 62 KB, zero external
imports, fetched once from `https://esm.sh/trystero@0.25.4/es2020/trystero.bundle.mjs`. A call
needs the network anyway; the point is that it must not depend on someone else's CDN being up.
Updating it means re-downloading that URL and bumping `CACHE`.

### The room is always open

`join()` runs on `katya:unlocked` (via the `window.__katyaUnlocked` both-ways latch) and the room
stays open for the whole page lifetime — **without media**. That open, almost always empty room is
what makes two things possible that a dial-on-demand design cannot have:

- **presence** — `#callLive` on the section card lights up when the other person has the site open;
- **a real incoming call** — the `ring` message makes the other device actually ring.

`pagehide` calls `leave()` so the other side's light goes out at once instead of by timeout.

Messages are Trystero actions, all short:

| action | meaning |
|---|---|
| `hi` | «I am here, my name is…» — sent targeted on every peer join |
| `ring` | knock, and `{cancel:true}` to take it back |
| `pick` | `{ok}` — picked up or refused |
| `bye` | hung up, **and** «I am not in a call» (see below) |
| `heart` / `note` / `shot` | a heart at `{x,y}`, a text note, «I saved this frame» |

`hi` carries the name so the presence line can tell the other person from your own second tab, and
so an incoming call can be labelled before anyone has answered.

### Camera discipline

`openCamera()` only acquires the stream — it does **not** put it in the room. `share()` does that,
and it is called only once the call is accepted, on both sides. This ordering is the privacy
guarantee: until someone picks up, the other end can neither see nor hear you. `closeCamera()`
removes the stream and `stop()`s every track, or the camera light stays on after hanging up.

Because the stream can arrive a beat before the screen becomes a call, the UI parks it in `pending`
and `attachRemote()` hangs it on the elements when the state catches up.

### Losing the connection is not hanging up

`onPeerLeave` during a call shows the `.lost` banner and starts a **20-second** grace timer instead
of ending the call — a phone switching cell towers must not end a conversation. If the peer comes
back, `onPeerJoin` re-sends our stream targeted at them and the timer is cancelled.

The subtle case: a peer who **reloaded the page** also "comes back", but is no longer in any call.
That is why `onPeerJoin` sends a targeted `bye` when we are *not* sharing — it tells a waiting peer
there is nothing to wait for. The `onBye` handler ignores the message unless the overlay is open,
so this cannot disturb an idle page.

### Overlay states

`asking` → `calling` / `incoming` → `talking`, plus three modifiers: `lost` (connection gone,
waiting), `voice` (audio only), and `sleep` + `dim` (night mode). CSS keys off these classes; the
JS never touches inline styles for layout.

**Night mode** (`setSleep`) is for falling asleep on a call: video off, voice kept, a 70-star sky
faded in, and after six untouched seconds everything else drops to 9% opacity. Any pointer press
brings it back. The screen wake lock is deliberately *kept* — a phone that sleeps drops the call on
iOS, which defeats the point. An 8-hour guard ends a call forgotten till morning.

### Signals are addressed, not broadcast

A reloaded tab lingers in the room as a ghost peer for a while. Early on that was enough to kill a
live call: a ghost leaving fired `onPeerLeave`, and `onJoinError` for a peer that could never
connect overwrote the call screen. So `Transport.partner` holds the id of the person this call is
with:

- only `hi` and `ring` are broadcast — before anyone answers we cannot know which tab is alive;
- `pick` sets `partner` to whoever replied, and everything after (`bye`, `heart`, `shot`, `stick`,
  the stream itself) is targeted at them alone;
- incoming messages from any other peer are dropped, `onPeerLeave` only matters for the partner,
  and `onFail` is ignored entirely while a call is on screen.

Targeting `share()` is also the privacy guarantee the open room would otherwise break: nobody else
in the room receives your camera, not even for a moment.

### Sound and picture quality

Codec settings go through `sender.setParameters()`, never SDP munging — SDP hacks rot between
browser versions. `Transport.applyQuality()` re-applies them after `share()`, after a peer joins,
after any track swap; a fresh connection starts with the browser's defaults, so skipping any of
those call sites silently loses the settings.

- **`TIERS`** — three steps (2.5 / 1.1 / 0.5 Mbps with `scaleResolutionDownBy` 1 / 1.6 / 2.5) with
  `degradationPreference: 'maintain-framerate'`, so a weak link costs resolution, not smoothness.
  The 5-second quality poll steps **down** immediately above 6% loss or 700 ms, and **up** only
  after four consecutive good samples — oscillating quality is worse than a minute of soft picture.
  Only at the bottom step does it offer voice-only.
- **Music mode** (`setMusic`) re-acquires the mic with `echoCancellation`, `noiseSuppression` and
  `autoGainControl` **off** and raises audio to 128 kbps, then swaps the track live. The speech
  defaults exist to strip everything that is not a voice, which is exactly why a guitar or a song
  cannot survive them. Mono on purpose: stereo doubles the bitrate for nothing on a phone.
- Camera is requested at 1080p `ideal` — a wish, not a demand; the browser downgrades silently.
- `window.katyaCall.stats()` prints the tier and the parameters actually on the senders. Use it
  before believing anything about quality.

### Masks, backgrounds, filters — `js/mask.js`

The effect must reach the other person, so it cannot be CSS: `mask.js` draws each frame into a
canvas and `captureStream()`s it, and that canvas track replaces the camera track in the call.

Track ownership is the thing to get right, or the camera light stays on:

- `Transport.camTrack` is the real camera while an effect runs. It is **not** in the outgoing
  stream — it only feeds the pipeline — and must not be stopped by a track swap.
- The canvas track belongs to `mask.js`; `katyaMask.stop()` ends it.
- `_swapVideo()` deliberately stops **nothing**. `clearEffects()` and `closeCamera()` own the
  lifecycle, and `closeCamera()` stops the pipeline *before* releasing the camera.
- `switchCamera()` with an effect on swaps the pipeline's *source* and leaves the outgoing track
  alone, so the far end does not blink.

Three tiers of cost, and they are not interchangeable:

| effect | needs | works offline |
|---|---|---|
| filter | canvas only | yes |
| background (blur / gradient / stars) | selfie segmenter, ~250 KB + ~3 MB wasm | no |
| face mask | face landmarker, ~3.6 MB | no |

Models come from the jsDelivr / Google CDN on **first use** and are deliberately not vendored: 7 MB
for a few buttons would dominate a precache that is otherwise the whole site. The accepted price is
that without a network the heavy buttons fail and say so — `set()` resolves `false` rather than
throwing, and the UI falls back to "Без". Filters keep working offline, which is why they exist as
a separate tier rather than as a degraded mode of the others.

Face landmarks are sampled at most every 55 ms and drawn from the last known points in between —
the model is expensive and a face does not move far in one frame. Masks are drawn as emoji through
`fillText`, rotated by the eye-line angle, so there are no image assets at all; the "above the head"
anchor offsets along the face axis rather than the screen axis, or a crown floats upright when the
head tilts.

### Hearts and stickers

Same data channel, three shapes: hearts on tap (`heart`), flying stickers that fade after 2.3 s,
and sticky ones that stay until swiped off (`stick` carries `{emoji,x,y,sticky}`). Positions travel
as **fractions**, not pixels — the two screens are different sizes and it should land where the
finger pointed. `.cv-stick` is the only layer element with `pointer-events`, since it is the only
one that must be grabbable.

There is no text chat; the input was removed on purpose. The channel it used carries everything
above, so removing the actions instead of just the field would take the stickers with it.

### Smaller things worth knowing

- **Wake lock** is requested on `talking` and re-requested on `visibilitychange`, because the system
  releases it whenever the tab is hidden. It is rejected outright for a hidden document — that is
  expected, not a bug.
- **Quality** is sampled every 5 s from `room.ping(id)` and `getStats()` on `room.getPeers()[id]`.
  Packet loss is a *delta* between samples; the absolute counters only describe the whole call.
  Above 5% loss or 600 ms it offers to switch to voice — the hint is a button that does it.
  Exposed as `window.katyaCall.quality()` for diagnosing "why does it break up".
- **`switchCamera`** uses `replaceTrack`, so there is no renegotiation and the far end does not
  blink. The button only appears when `countCameras()` reports two or more.
- **Snapshot** draws the remote `<video>` into a canvas, stamps the date, and downloads a JPEG. It
  also sends `shot`, so the other person is told their frame was saved. Do not make this silent.
- Mic and camera toggles flip `track.enabled` instead of adding or removing tracks — renegotiating
  mid-call is a needless way to drop the connection.
- If some particular pairing never connects (symmetric NAT, mobile CGNAT), the fix is a TURN server
  passed through Trystero's `turnConfig` option and nothing else. Deliberately not configured yet.
- **Discovery can stall while every relay socket reads OPEN.** Trystero defaults to five relays;
  `relayConfig.redundancy: 12` in `join()` widens that. Seen repeatedly after dozens of rapid
  joins from one IP — public relays keep the socket and quietly stop forwarding events. It clears
  after a clean reload on both sides. If a real pairing ever sits at "не на сайте" for minutes,
  this is the first thing to suspect, not the code; pinning `relayConfig.urls` to known-good
  relays or switching strategy is the escalation.
- `Trystero peer error: OperationError: User-Initiated Abort` in the console is what a normal
  hang-up looks like from inside the library. Not a failure.

Note `getUserMedia` needs a secure context: it works on `localhost` and HTTPS, and fails silently
on `file://`. The call screen cannot be verified by screenshot in a background tab either — Chrome
does not paint or run transitions there, so computed styles read as their pre-transition values.
Two tabs on **different origins** (`localhost` and `127.0.0.1`) are the way to test two people:
same origin means one shared `localStorage`, so both tabs believe they are the same person.

`localStorage` keys added here: `katya-call-total` (lifetime seconds, shown on the section card)
and `katya-call-log` (last 50 calls, also the source of the "longest call" and "days in a row"
chips). `window.katyaCall` exposes `totalSeconds()`, `history()`, `open()`, `online()`,
`quality()` and `stats()`.

The ringtone is synthesised with `AudioContext` oscillators rather than shipped as an MP3, to keep
the precache small and avoid another `OPTIONAL[]` entry that may 404.

## Conventions

- **All UI copy and code comments are in Russian.** Keep it that way — new comments and any
  user-visible text included. Section banners use the `// ═══ NAME ═══` / `/* ═══ NAME ═══ */` form.
- Colors come from the token block in `css/base/variables.css`. The palette is a **sunset**:
  surfaces (`--white`, `--cream`, `--sand`), accents (`--rose`, `--coral`, `--gold`, `--blush`),
  depth (`--deep`, `--wine`, `--ink`, `--night`), plus `--glow` and the `--grad-*` section
  gradients. Use the variables, including inside inline SVG `fill`/`stroke` attributes, as the
  map section does.
- **`css/base/flow.css` owns every section background.** It runs the page's dawn→night arc and
  deliberately overrides the `background` set in each `sections/*.css`, so it is imported after
  them. Section stops are chosen so one section's bottom color equals the next one's top —
  changing one background means fixing its neighbour, or a visible seam appears. It also holds
  the light-on-dark text overrides for the night half (`.hearts`, `.call-sec`, `.counter`, footer).
- **Fonts are local, in `fonts/`.** `css/base/fonts.css` declares Playfair Display (headings,
  italics) and Inter (labels, buttons) via `--font-display` / `--font-text`, cyrillic + latin
  subsets only. They are precached — the site must look identical offline, which is why these
  are not loaded from Google Fonts.
- `css/base/app.css` is imported last on purpose — it holds the safe-area insets and the
  "feels like an app" overrides (disabled text selection, no tap highlight, no overscroll) and must
  win the cascade. Note that it re-enables selection for `.pwd-digit`, `.sl-parchment`, `.env-letter`.
- Every `localStorage` access is wrapped in `try/catch` (private mode / disabled storage). Match that.
- Scroll-triggered animation is opt-in via the `.rv` class, observed by `js/reveal.js`; the element
  gets `.vis` when it intersects. Add `.rv` to new sections rather than writing a new observer.
