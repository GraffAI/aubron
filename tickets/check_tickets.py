#!/usr/bin/env python3
"""
FIFA World Cup 2026 ticket watcher.

Polls the Gametime mobile listings API (the one marketplace source that
answers unauthenticated requests from this environment) for two matches and
fires an IFTTT webhook when a listing falls to/below the target price.

Targets (all-in price the buyer actually pays, i.e. Gametime price.total):
  - Egypt vs Iran  (Jun 26): upper bowl (~Cat 3) <= $250  OR  lower bowl (~Cat 2) <= $300
  - Bosnia vs Qatar (Jun 24): any seat <= $150

Run one-shot (cron / on reboot):   python3 check_tickets.py
Dry run, never fire the webhook:    python3 check_tickets.py --dry-run

State is kept in state.json next to this file so repeated runs don't spam the
webhook: an alert only re-fires if a strictly cheaper qualifying price appears.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

IFTTT_URL = "https://maker.ifttt.com/trigger/ticket_found/with/key/c9RyOqyE_yYzSnNtcjO_Fk"
GAMETIME = "https://mobile.gametime.co/v1/listings?event_id={event_id}"
UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")

STATE_FILE = Path(__file__).with_name("state.json")

# Gametime section_group labels vary by event (e.g. "Upper Sideline",
# "Upper Level Corner", or bare "Upper"; "Lower End Zone" or "Lower Level End
# Zone"). Classify by PREFIX so new label variants can't be silently missed.
# "Upper*" ~ FIFA Cat 3/4; "Lower*"/"Middle*" ~ Cat 1/2. The literal
# "Category N"/"VIP" groups are hospitality/lot anomalies -> excluded.
EXCLUDE_GROUPS = {"Category 1", "Category 2", "Category 3", "Category 4", "VIP"}


def tier_of(group: str | None) -> str | None:
    """Map a Gametime section_group to 'upper' or 'lower' (or None to skip)."""
    if not group or group in EXCLUDE_GROUPS:
        return None
    g = group.lower()
    if g.startswith("upper"):
        return "upper"
    if g.startswith("lower") or g.startswith("middle"):
        return "lower"
    return None

# Egypt finished 1st in Group G (Jun 26) -> R32 is CONFIRMED:
#   Match 82, Jul 1, Lumen Field Seattle (vs a 3rd-place team).
# User criteria: Egypt only, any seat up to $999 all-in.
# (Match 88 / Jul 3 Arlington was the "if Egypt 2nd" scenario -> moot.)
MATCHES = [
    {
        "key": "egypt_r32_seattle",
        "name": "Egypt R32: Match 82 (Jul 1, Lumen Field Seattle)",
        "event_id": "66ac2cc859eb64be1a22d640",
        "buy_url": "https://gametime.co/fifa/fifa-world-cup-match-82-round-of-32-tickets/7-1-2026-seattle-wa-lumen-field/events/66ac2cc859eb64be1a22d640",
        # (label, tier 'upper'|'lower'|'any', threshold USD)
        "rules": [
            ("any seat", "any", 999.0),
        ],
    },
]


def fetch_listings(event_id: str, retries: int = 3) -> list[dict]:
    url = GAMETIME.format(event_id=event_id)
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
            return data.get("listings", [])
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Gametime fetch failed for {event_id}: {last}")


def cheapest(listings: list[dict], tier: str) -> dict | None:
    best = None
    for lst in listings:
        t = tier_of(lst.get("section_group"))
        if t is None or (tier != "any" and t != tier):
            continue
        total = lst.get("price", {}).get("total")
        if not isinstance(total, (int, float)):
            continue
        if best is None or total < best["price"]["total"]:
            best = lst
    return best


def fire_webhook(value1: str, value2: str, value3: str, dry: bool) -> None:
    payload = json.dumps({"value1": value1, "value2": value2, "value3": value3}).encode()
    if dry:
        print(f"  [dry-run] would POST: {value1} | {value2} | {value3}")
        return
    req = urllib.request.Request(IFTTT_URL, data=payload,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        print(f"  webhook fired -> HTTP {resp.status}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="never fire the webhook")
    args = ap.parse_args()

    state = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}
    now = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
    print(f"=== ticket check {now} ===")
    any_alert = False

    for match in MATCHES:
        if match.get("disabled"):
            continue
        try:
            listings = fetch_listings(match["event_id"])
        except RuntimeError as exc:
            print(f"{match['name']}: FETCH ERROR: {exc}")
            continue
        print(f"{match['name']}: {len(listings)} listings")
        for label, groups, threshold in match["rules"]:
            best = cheapest(listings, groups)
            if best is None:
                print(f"  - {label}: none available")
                continue
            price = best["price"]["total"] / 100.0
            sec = best.get("section", "?")
            grp = best.get("section_group", "?")
            row = best.get("row", "?")
            mark = "  <== MEETS TARGET" if price <= threshold else ""
            print(f"  - {label} <= ${threshold:.0f}: cheapest ${price:.2f} "
                  f"(sec {sec} [{grp}] row {row}){mark}")

            if price <= threshold:
                skey = f"{match['key']}::{label}"
                prev = state.get(skey, {}).get("price")
                if prev is None or price < prev:  # new, or a strictly better deal
                    any_alert = True
                    v1 = match["name"]
                    v2 = f"{label}: ${price:.2f} all-in, sec {sec} [{grp}] row {row} (target <= ${threshold:.0f})"
                    fire_webhook(v1, v2, match["buy_url"], args.dry_run)
                    state[skey] = {"price": price, "ts": now}
                else:
                    print(f"    (already alerted at ${prev:.2f}; not re-firing)")

    if not args.dry_run:
        STATE_FILE.write_text(json.dumps(state, indent=2) + "\n")
    print("=== done" + (" (candidates found!)" if any_alert else " (no qualifying tickets)") + " ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
