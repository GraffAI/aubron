# FIFA Ticket Scout — local de-paywalled build

## Provenance

Vendored from [`david-dirring/fifa-ticket-scout`](https://github.com/david-dirring/fifa-ticket-scout)
(`main`, manifest version 2.3.4). Upstream is licensed **ISC** (see `LICENSE`),
which grants permission to use, copy, modify, and distribute "for any purpose
with or without fee," provided the copyright + permission notice is retained.
That notice is kept intact in `LICENSE`.

The upstream prebuilt artifact (`fifa-ticket-scout-2.1.1.zip`) and marketing
`store-assets/` were intentionally **not** vendored.

## What was changed

All changes are confined to `extension/background.js` and gated behind a single
switch. **No other extension files were modified.**

```js
const UNLOCK_TIER = TIERS.PRO_WEB_ALERTS; // set to null to restore normal behavior
function effectiveLevel(storedLevel) {
  return UNLOCK_TIER != null ? UNLOCK_TIER : storedLevel || 0;
}
```

The toggle drives exactly three things:

1. **`enforceGameLimit()`** — uses `effectiveLevel()`, so the free-tier
   "one game at a time" limit is lifted (multi-game tracking).
2. **`sendScanToTab()`** — uses `effectiveLevel()`, so the non-`balanced`
   scan-speed profiles (aggressive / cautious / stealth) are no longer forced
   back to `balanced`.
3. **`GET_LICENSE` handler** — reports `level: UNLOCK_TIER` to the popup, which
   unlocks the entire popup UI (the popup derives its whole `userLevel` gating
   from this one response). A placeholder `key` label is supplied so the
   masked-key display renders when no real key was activated.

Setting `UNLOCK_TIER = null` restores stock, license-driven behavior everywhere.

## What was deliberately left alone

The server-backed routes — `fetchAlerts()`, `fetchInsights()`, `saveAlerts()` —
were **not** routed through the toggle. They keep upstream behavior: with no
activated key they return "No license found," exactly as if unlicensed. These
features additionally re-verify the license **server-side** (the Supabase Edge
Functions call Gumroad directly), so the client could not unlock them anyway.

Net effect: the **local** features (multi-game, scan speeds, full popup UI) are
unlocked and fully functional. The **cloud** features (Insights, Alerts) remain
dark until you stand up your own backend (`supabase/`) and point the extension
at it with a key it will accept.

## Loading it

`chrome://extensions` → enable Developer mode → "Load unpacked" → select
`vendor/fifa-ticket-scout/extension`.

## Caveats (unchanged from upstream)

- The extension scrapes `tickets.fifa.com` (header replay + credentialed tiled
  requests). That is likely against FIFA's ToS regardless of licensing; this
  build does not change that behavior.
- `background.js` still fetches `scan_config.json` from the upstream GitHub repo
  and still references the upstream Supabase project URL/anon key. Repoint these
  once your own backend exists.
