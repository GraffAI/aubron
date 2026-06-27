# FIFA World Cup 2026 ticket watch

Standing task: alert (via IFTTT webhook) when resale tickets for the watched
matches drop to target prices. Now tracking **Egypt's Round-of-32 match** (the
group-stage watches below are over).

## Targets

Egypt's R32 opponent/slot depends on their Group G finish (settled Jun 27):

| Match                           | Date / Venue                    | Target (all-in price)                                          |
| ------------------------------- | ------------------------------- | -------------------------------------------------------------- |
| **R32 if Egypt 1st** (Match 82) | Jul 1 · Lumen Field, Seattle    | upper bowl (~Cat 3) **≤ $250**, lower bowl (~Cat 2) **≤ $300** |
| **R32 if Egypt 2nd** (Match 88) | Jul 3 · AT&T Stadium, Arlington | upper bowl (~Cat 3) **≤ $250**, lower bowl (~Cat 2) **≤ $300** |

Both are watched until the group result is final; then prune the irrelevant one.
"All-in" = the total the buyer pays incl. fees (Gametime `price.total`).

_Group stage (done): Egypt vs Iran (Jun 26) and Bosnia vs Qatar (Jun 24) — both
played; never dropped to target on the open market._

## How to check (run on every reboot)

```sh
python3 tickets/check_tickets.py          # checks both matches, fires webhook on a qualifying drop
python3 tickets/check_tickets.py --dry-run # same, but never fires the webhook
```

The script polls the **Gametime mobile listings API**
(`https://mobile.gametime.co/v1/listings?event_id=...`) — the only marketplace
that answers unauthenticated requests from this environment. SeatGeek (403),
TickPick (DataDome), Vivid Seats (Incapsula) and SeatPick (429) all bot-block
raw requests; only the Anthropic `WebFetch` tool gets through to some of them.

On a qualifying listing it POSTs to the IFTTT webhook with:
`value1` = match, `value2` = price/section detail, `value3` = buy link.

## Status as of last manual check (2026-06-27, group stage just ended)

Egypt advanced from Group G; exact R32 slot pends the final standings. Knockout
resale is **much** pricier than the group stage — nothing near target, no
webhook fired:

| R32 scenario                | Cheapest upper (~Cat3) | Cheapest lower (~Cat2) |
| --------------------------- | ---------------------- | ---------------------- |
| Egypt 1st — Jul 1 Seattle   | $655                   | $747                   |
| Egypt 2nd — Jul 3 Arlington | $732                   | $1,051                 |

Targets ($250/$300) are ~2.6–4× the current market. As in the group stage, they
are realistic only via **FIFA's official face-value resale** (`FIFA.com/tickets`,
login-gated) or a steep late drop. The watcher catches a secondary-market drop
if one happens.

## Notes / caveats

- `Upper*` section groups ≈ FIFA Cat 3/4; `Lower*`/`Middle Sideline` ≈ Cat 1/2.
  Gametime's literal `Category N` / `VIP` groups are hospitality/lot anomalies
  and are excluded.
- `state.json` prevents re-firing the webhook for the same (or worse) price
  within a session. To persist that dedupe across fresh-clone reboots, commit
  `state.json` after a run. A duplicate alert is preferable to a missed one, so
  leaving it uncommitted is acceptable.
- Section→category mapping is approximate; the alert says "~Cat 3" so the buyer
  verifies the exact FIFA category at checkout.
