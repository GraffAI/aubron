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

## Develop

```bash
pnpm --filter transit dev        # next dev
pnpm --filter transit build      # next build
pnpm --filter transit lint
pnpm --filter transit typecheck
pnpm --filter transit test
```
