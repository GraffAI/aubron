# @aubron/world-cup-scoreboard

Drive a **32×30 WLED LED matrix** (a converted Govee Elite curtain) as a **live
FIFA World Cup scoreboard**. Whenever a match is on it shows each team's flag,
the live score and the minute, and fires an animated **GOAL** celebration in the
scoring team's colours. When nothing's live it shows a clock (or gets out of the
way and lets WLED do its thing).

It renders a 960-pixel framebuffer and streams it to WLED over **DDP** (the
realtime UDP protocol WLED uses for video-like updates), so all the smarts run
off-device — nothing needs to run on the ESP32.

```
┌──────────────────────────┐
│ [🏴] ENG            2     │   home: flag · code · big score
│ ──────── 67' ● ────────  │   minute + blinking live dot
│ [🇫🇷] FRA            1     │   away
└──────────────────────────┘
```

## Where should the compute run?

You have three candidates; here's the call:

| Option                             | Verdict                                                                                                                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WLED controller (ESP32) itself** | ❌ Not viable. WLED can't fetch live scores or render flags/text/animations. It's the _display_; this package is the _brains_ that streams frames to it.                                                                          |
| **Mac mini**                       | ✅ **Recommended.** Always-on, Node ≥22, trivial to run as a `launchd` service. Lowest-friction.                                                                                                                                  |
| **Home Assistant Yellow**          | ✅ Good alternative. Run it as a container/add-on on HAOS (it's a tiny Node process). Nice if you want HA to own the WLED device the rest of the time — this app only takes over via DDP while a match is live, then releases it. |
| **Balena on old hardware**         | 🟡 Works (it's just a container), but unnecessary given the two above. Avoid unless you want it isolated.                                                                                                                         |

All it needs to reach: the WLED's IP on your LAN (UDP 4048) and, for live data,
an outbound HTTPS connection to a football API. No inbound ports.

## Quick start

```sh
pnpm add @aubron/world-cup-scoreboard      # or run from this repo

# 1. See the scenes without any hardware (writes ./preview/storyboard.png):
worldcup preview

# 2. Dry-run a scripted fake match on the real panel (no API key needed):
worldcup demo --wled 192.168.1.42

# 3. Go live:
worldcup run --wled 192.168.1.42 --provider api-football --key $WC_API_KEY
```

## WLED setup (one time)

1. Flash/confirm WLED on the controller (ESP32 strongly recommended for 960 px).
2. **Settings → LED Preferences → 2D Configuration:** set up a **32×30 matrix**.
   Pick the panel orientation / serpentine that matches your curtain wiring (see
   _Calibration_). With the matrix configured, leave this app on the default
   `--layout wled` and WLED's ledmap handles the physical wiring for you.
3. **Settings → Sync Interfaces:** make sure **Realtime/DDP receive** is enabled.
   Optionally turn on _Force max brightness_ if you want this app to own
   brightness end-to-end.
4. That's it — WLED enters realtime mode automatically when frames arrive and
   reverts to its normal effects ~2.5 s after they stop.

### Calibration

A converted Govee curtain can be wired in a surprising order (usually **vertical
strands, serpentine** — data runs down one strand and up the next). Two ways to
get the mapping right:

- **Let WLED do it (recommended):** configure the 2D matrix + serpentine in
  WLED, keep `--layout wled`, and run `worldcup calibrate --wled <ip>`:
  - `--pattern axes` lights the origin white, top row red, left column green —
    tells you orientation and where (0,0) actually is.
  - `--pattern border` / `--pattern fill` confirm dimensions and that every LED
    is alive.
  - `--pattern walk` lights one pixel at a time (logging `index → x,y`) so you
    can watch the wiring path and build a ledmap.
- **Remap here instead:** if WLED is a plain 1D strip, set
  `--layout vertical --serpentine` (plus `--flipX/--flipY` as needed) and this
  app reorders pixels into physical order before sending.

## Data providers

| Provider              | `--provider`    | Live?                | Free tier            | Notes                                                                             |
| --------------------- | --------------- | -------------------- | -------------------- | --------------------------------------------------------------------------------- |
| **API-Football**      | `api-football`  | ✅ real-time (~15 s) | 100 req/day + 10/min | League id `1`, season `2026`. Best free live option — poll gently (default 45 s). |
| **football-data.org** | `football-data` | ⚠️ delayed           | 10 req/min           | Competition code `WC`. Clean `tla` codes; good for fixtures, scores lag.          |
| **mock**              | `mock`          | —                    | —                    | Keyless scripted match for demos/offline (`worldcup demo`).                       |

Get an API-Football key at api-football.com (or via RapidAPI) and pass it with
`--key` or `WC_API_KEY`. **Mind the 100/day cap** — the engine only polls fast
while a match is live and idles otherwise, but if you cover many matches all day
consider their paid tier.

## Commands

```
worldcup run        stream the live scoreboard to WLED
worldcup demo       stream a scripted fake match (no API key)
worldcup preview    render sample scenes to PNG (no hardware)
worldcup calibrate  send a test pattern (--pattern axes|border|fill|walk)
worldcup once       fetch and print the current match data
```

## Configuration

Every flag has an env-var fallback, so it runs cleanly as a service/container.

| Flag                   | Env                       | Default     | Meaning                                              |
| ---------------------- | ------------------------- | ----------- | ---------------------------------------------------- |
| `--wled <ip>`          | `WC_WLED_HOST`            | —           | WLED controller IP (required for run/demo/calibrate) |
| `--port`               | `WC_WLED_PORT`            | `4048`      | DDP UDP port                                         |
| `--width` / `--height` | `WC_WIDTH` / `WC_HEIGHT`  | `32` / `30` | Matrix size                                          |
| `--layout`             | `WC_LAYOUT`               | `wled`      | `wled` \| `horizontal` \| `vertical`                 |
| `--serpentine`         | `WC_SERPENTINE`           | on          | Boustrophedon wiring (for non-`wled` layouts)        |
| `--flipX` / `--flipY`  | `WC_FLIP_X` / `WC_FLIP_Y` | off         | Mirror axes                                          |
| `--brightness`         | `WC_BRIGHTNESS`           | `1`         | 0–1 master scale                                     |
| `--fps`                | `WC_FPS`                  | `20`        | Frame rate (DDP)                                     |
| `--provider`           | `WC_PROVIDER`             | auto        | `api-football` \| `football-data` \| `mock`          |
| `--key`                | `WC_API_KEY`              | —           | Data API key                                         |
| `--poll`               | `WC_POLL_LIVE`            | `45`        | Seconds between polls while live                     |
| `--idle`               | `WC_IDLE_MODE`            | `clock`     | `clock` (show a clock) or `off` (release WLED)       |

## Run as a service

**macOS (Mac mini) — `launchd`:** create
`~/Library/LaunchAgents/io.aubron.worldcup.plist` running
`worldcup run` with `WC_WLED_HOST` / `WC_API_KEY` in `EnvironmentVariables`, then
`launchctl load` it.

**Linux / Home Assistant (container):**

```dockerfile
FROM node:22-alpine
RUN npm i -g @aubron/world-cup-scoreboard
ENV WC_WLED_HOST=192.168.1.42 WC_PROVIDER=api-football
CMD ["worldcup", "run"]
```

Pass `WC_API_KEY` as a secret. The container only needs LAN access to WLED and
outbound HTTPS to the data API.

## How it works

```
provider.fetchMatches()  →  pickMatch()  →  detectGoal()  →  scene render
   (api-football/…)          choose one      score delta      scoreboard / goal /
                             to display       → celebrate      kickoff / idle
                                                                     │
                                                       serializeFrame() (physical order)
                                                                     │
                                                              DDP packets → WLED
```

Selection logic (`pickMatch`) and goal detection (`detectGoal`) are pure and
unit-tested; flags are a small declarative DSL (`flags/`), and the whole render
path is validated off-device via `preview` (the PNGs in this README are real
output upscaled with a simulated-LED look).
