# FIFA World Cup 2026 ticket watch

Standing task: alert (via IFTTT webhook) when resale tickets for two Seattle
(Lumen Field) group-stage matches drop to target prices.

## Targets

| Match | Date | Target (all-in price) |
| --- | --- | --- |
| **Egypt vs Iran** (Match 63, Group G) | Jun 26, 2026 | upper bowl (~Cat 3) **≤ $250**, lower bowl (~Cat 2) **≤ $300** |
| **Bosnia vs Qatar** (Match 52, Group B) | Jun 24, 2026 | any seat **≤ $150** |

"All-in" = the total the buyer pays incl. fees (Gametime `price.total`).

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

## Status as of last manual check (2026-06-21)

The open resale market was ~2× the targets — **nothing qualified**, so no
webhook was fired:

| Match | Cheapest live (all-in) | Target |
| --- | --- | --- |
| Egypt–Iran, upper | $551 | ≤ $250 |
| Egypt–Iran, lower | $629 | ≤ $300 |
| Bosnia–Qatar, any | $365 | ≤ $150 |

FIFA face values (worldcuppass guide): Cat 1 ~$410, Cat 2 ~$310, **Cat 3 ~$140**,
Cat 4 ~$60–70. Target prices are realistic only on **FIFA's official resale
marketplace at face value** (`FIFA.com/tickets`, login required) — not on the
open secondary market for these high-/normal-demand matches this close to
kickoff. The watcher catches a secondary-market drop if one happens.

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
