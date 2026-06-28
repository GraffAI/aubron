# @aubron/world-cup-scoreboard

Drive a **30×32 WLED LED matrix** (a converted Govee Elite curtain) as a **live
FIFA World Cup scoreboard**. While matches are on it rotates through every game
in play — each team's flag, the live score and a ticking match clock — and fires
an animated **GOAL** celebration in the scoring team's colours. Between games it
shows the day's upcoming fixtures as countdown cards, alternating with a clock.

It renders a 960-pixel framebuffer and streams it to WLED over **DDP** (the
realtime UDP protocol WLED uses for video-like updates), so all the smarts run
off-device — nothing needs to run on the ESP32.

```
┌────────────────────────┐
│ ▟▙ENGLAND          2   │   home: tall flag · big score
│ ───────── 67:14 ─────  │   ticking MM:SS (or 45+2 in stoppage)
│ ▟▙FRANCE           1   │   away
└────────────────────────┘
```

## Highlights

- **Every live match, rotated.** The group stage runs several games at once, so
  the engine cycles through all of them (and upcoming-soon / just-finished ones)
  every 15 s. A goal in _any_ match interrupts to its celebration, then resumes.
- **Real pixel-art flags.** Native-resolution sprites for all 48 nations (see
  [Flags](#flags)), with a hand-coded vector fallback so it still runs without
  the art pack.
- **A live clock**, not just the minute — `67:14` ticking, and `45+2` / `90+3`
  in stoppage time (from the API's `extra` field).
- **Gamma-corrected colour** so flags don't wash out on bright LEDs.

## Where should the compute run?

| Option                             | Verdict                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **WLED controller (ESP32) itself** | ❌ Not viable. WLED is the _display_; this package is the _brains_ that streams frames to it.                   |
| **Mac mini**                       | ✅ **Recommended.** Always-on, Node ≥22, one-command `launchd` install ([Run as a service](#run-as-a-service)). |
| **Home Assistant Yellow**          | ✅ Good alternative. A tiny Node process; run it as a container/add-on on HAOS.                                 |
| **Balena on old hardware**         | 🟡 Works (it's just a container), but unnecessary given the two above.                                          |

All it needs to reach: the WLED's IP on your LAN (UDP 4048) and, for live data,
an outbound HTTPS connection to a football API. No inbound ports.

## Quick start

```sh
pnpm add @aubron/world-cup-scoreboard      # or run from this repo

# 1. See the scenes without any hardware (writes ./preview/storyboard.png):
worldcup preview

# 2. (Optional) drop in real flag art — see "Flags" below:
./deploy/install-flags.sh ~/Downloads/Flag_Assets_by_ReffPixels_v2.zip

# 3. Dry-run a scripted fake match on the real panel (no API key needed):
worldcup demo --wled 192.168.1.42

# 4. Go live:
worldcup run --wled 192.168.1.42 --provider api-football --key $WC_API_KEY
```

## WLED setup (one time)

1. Flash/confirm WLED on the controller (ESP32 strongly recommended for 960 px).
2. **Settings → LED Preferences → 2D Configuration:** set up a **30×32 matrix**.
   Pick the panel orientation / serpentine that matches your curtain wiring (see
   _Calibration_). With the matrix configured, leave this app on the default
   `--layout wled` and WLED's ledmap handles the physical wiring for you.
3. **Settings → Sync Interfaces:** make sure **Realtime/DDP receive** is enabled.
4. That's it — WLED enters realtime mode automatically when frames arrive and
   reverts to its normal effects ~2.5 s after they stop.

### Calibration

A converted Govee curtain can be wired in a surprising order (usually **vertical
strands, serpentine**). Two ways to get the mapping right:

- **Let WLED do it (recommended):** configure the 2D matrix + serpentine in
  WLED, keep `--layout wled`, and run `worldcup calibrate --wled <ip>`:
  - `--pattern axes` lights the origin white, top row red, left column green.
  - `--pattern border` / `--pattern fill` confirm dimensions and that every LED
    is alive.
  - `--pattern walk` lights one pixel at a time (logging `index → x,y`).
- **Remap here instead:** if WLED is a plain 1D strip, set
  `--layout vertical --serpentine` (plus `--flipX/--flipY` as needed).

## Flags

Flags are real pixel-art sprites from the **ReffPixels "Flag Assets" pack**
(CC-BY 4.0), at the panel's native sizes — **12×8** on the scoreboard/cards and
**24×16** for the GOAL hero (the 18×12 scoreboard flag is the 24×16 scaled). The
pack's outline is bled away for a clean full-bleed flag, and output runs through
a gamma curve so the colours stay saturated on LEDs.

The art is **not committed** (the licence forbids redistribution), so populate
it locally from your own copy of the pack:

```sh
./deploy/install-flags.sh <path-to-pack-or.zip>   # → packages/.../assets/flags/
```

Without the pack, every flag falls back to a hand-coded vector design
(`flags/registry.ts`), so the app always renders — just less prettily.

## Data providers

| Provider              | `--provider`    | Live?                | Notes                                                               |
| --------------------- | --------------- | -------------------- | ------------------------------------------------------------------- |
| **API-Football**      | `api-football`  | ✅ real-time (~15 s) | League id `1`, season `2026`. Carries live scores **and** stoppage. |
| **football-data.org** | `football-data` | ⚠️ delayed           | Competition code `WC`. Clean `tla` codes; scores lag.               |
| **mock**              | `mock`          | —                    | Keyless scripted match for demos/offline (`worldcup demo`).         |

Get an API-Football key at api-football.com and pass it with `--key` or
`WC_API_KEY`. The default live poll is **15 s** (≈240/h), which suits a paid
plan; on the free 100-req/day tier raise `WC_POLL_LIVE` (e.g. `60`+).

## Commands

```
worldcup run        stream the live scoreboard to WLED
worldcup demo       stream a scripted fake match (no API key)
worldcup showcase   loop every interface to the panel (for judging the look)
worldcup preview    render sample scenes to PNG (no hardware)
worldcup flags      write 12x8/24x16/48x32 flag contact sheets to ./preview
worldcup calibrate  send a test pattern (--pattern axes|border|fill|walk)
worldcup once       fetch and print the current match data
```

## Configuration

Every flag has an env-var fallback, so it runs cleanly as a service/container.

| Flag                   | Env                       | Default     | Meaning                                              |
| ---------------------- | ------------------------- | ----------- | ---------------------------------------------------- |
| `--wled <ip>`          | `WC_WLED_HOST`            | —           | WLED controller IP (required for run/demo/calibrate) |
| `--port`               | `WC_WLED_PORT`            | `4048`      | DDP UDP port                                         |
| `--width` / `--height` | `WC_WIDTH` / `WC_HEIGHT`  | `30` / `32` | Matrix size                                          |
| `--layout`             | `WC_LAYOUT`               | `wled`      | `wled` \| `horizontal` \| `vertical`                 |
| `--serpentine`         | `WC_SERPENTINE`           | on          | Boustrophedon wiring (for non-`wled` layouts)        |
| `--flipX` / `--flipY`  | `WC_FLIP_X` / `WC_FLIP_Y` | off         | Mirror axes                                          |
| `--brightness`         | `WC_BRIGHTNESS`           | `1`         | 0–1 master scale                                     |
| `--gamma`              | `WC_GAMMA`                | `2.2`       | Colour gamma (>1 deepens; `1` = raw sRGB)            |
| `--fps`                | `WC_FPS`                  | `20`        | Frame rate (DDP)                                     |
| `--provider`           | `WC_PROVIDER`             | auto        | `api-football` \| `football-data` \| `mock`          |
| `--key`                | `WC_API_KEY`              | —           | Data API key                                         |
| `--poll`               | `WC_POLL_LIVE`            | `15`        | Seconds between polls while a match is live          |
| `--rotate`             | `WC_ROTATE`               | `15`        | Seconds each match shows before rotating to the next |
| `--idle`               | `WC_IDLE_MODE`            | `clock`     | `clock` (fixtures + clock) or `off` (release WLED)   |
| —                      | `WC_FLAG_DIR`             | bundled     | Override the flag-asset directory                    |

## Run as a service

**macOS (Mac mini) — `launchd`:** one command resolves the absolute node/repo
paths, writes the LaunchAgent, and boots it (re-run it after a node upgrade):

```sh
WC_WLED_HOST=192.168.1.42 WC_API_KEY=xxxx ./deploy/install-launchd.sh
```

It sets `RunAtLoad` + `KeepAlive`, so it auto-starts at login and restarts on
crash; logs go to `~/Library/Logs/worldcup.log`.

**Linux / Home Assistant (container):**

```dockerfile
FROM node:22-alpine
RUN npm i -g @aubron/world-cup-scoreboard
ENV WC_WLED_HOST=192.168.1.42 WC_PROVIDER=api-football
CMD ["worldcup", "run"]
```

Pass `WC_API_KEY` as a secret and mount your flag assets (or rely on the vector
fallback). The container only needs LAN access to WLED and outbound HTTPS.

## How it works

```
provider.fetchMatches() → selectDisplaySet() → detectGoal() → scene render
   (api-football/…)        every in-window      score delta    scoreboard / goal /
                           match, rotated        → celebrate    kickoff / idle
                                                                      │
                                                       serializeFrame() (gamma +
                                                       physical LED order)
                                                                      │
                                                               DDP packets → WLED
```

A match is "in window" from 30 min before kickoff, through play, to an hour
after full time; the engine rotates through all of them. When the window is
empty it idles on the day's (or tomorrow's) fixtures as countdown cards,
alternating with the clock. Selection (`selectDisplaySet`) and goal detection
(`detectGoal`) are pure and unit-tested; the whole render path is validated
off-device via `preview` / `flags` (the PNGs are real output with a simulated-LED
look).
