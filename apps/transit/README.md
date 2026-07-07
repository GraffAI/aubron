# transit

Puget Sound transit, live — a bespoke WebGL map of every Link train, Sounder, streetcar and bus in motion.

An **app** in the aubron monorepo: not published to npm, deployed to the open
internet by CI (Vercel). See the repo README's "Apps" section for the deploy
model.

## How a rider uses it

It opens on the ambient overview — every Link/Sounder/T-line train gliding the
rails — but the real flow is a **drill-down**:

1. **Pick a line.** The selector (top-left) is a typeahead: rail lines first,
   then ST Express buses. Choosing one isolates the map to that line and the
   camera **flies** to frame it.
2. **Read the line.** A drilled-in line draws bold, with its stations enlarged,
   named, and turned into proper click targets.
3. **Open a station.** Tapping a stop opens its **departure board** and frames
   the soonest incoming vehicle alongside the stop, re-flying to keep them in
   shot. Arrivals show as transit signage — `ARRIVED` / `ARRIVING` / `DELAYED` /
   `5 MIN` — on a split-flap (Solari) display.

Clearing the selector ("Everything") drops back to the overview.

The data comes from OneBusAway (Sound Transit). Set `OBA_API_KEY` in the env to
run against the live feed locally.

## Replay

`/?replay=1` swaps the live feed for a recorded one: real captured trains ride
the same map through the same track-snapped smoothing, with a transport bar
(play/pause, 1–60×, scrubber). It doubles as a demo reel and a test bench —
flip on "Debug interp" to dissect the interpolation over known data.

Recordings live in `public/replay/<name>.json.gz` (`?replay=<name>` picks one).
To record a fresh slice of live service:

```bash
OBA_API_KEY=… pnpm --filter transit data:replay -- --minutes 30
```

## How the numbers behave (measured 2026-07 against the live feed)

Constants in the code lean on these measurements rather than guesses:

- A train's GPS fix refreshes every **~20s median (p90 35s)** and is already
  **~16s old** when it first appears. Drawing raw fixes puts a moving train
  ~213m behind reality (median); the 15s track-following prediction in
  `useSmoothPositions` cuts that to ~119m.
- Measured speeds glitch hard at the tails (p99 = 90 m/s on trip re-seats) —
  motion is re-seeded beyond 45 m/s.
- A position with `lastLocationUpdateTime: 0` is OBA's schedule interpolation,
  not GPS (~16% of trip rows) — those are never drawn as live trains.
- OBA's own arrival predictions wander **±2–4 minutes** at 5–15 minute leads,
  and occasionally emit a wraparound `predictedArrivalTime` from the previous
  service day — the station board gates ARRIVED/ARRIVING on live GPS distance
  and ignores predictions staler than 15 minutes.
- `scheduleDeviation` drifts ~45s (p90 ~2min) within five minutes, so trip
  ETAs beyond ~10 minutes display as approximate (`~12 min`).

## Develop

```bash
pnpm --filter transit dev        # next dev
pnpm --filter transit build      # next build
pnpm --filter transit lint
pnpm --filter transit typecheck
pnpm --filter transit test       # vitest — includes real-payload fixtures
```
