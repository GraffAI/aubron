/**
 * Fire-and-forget goal announcer: POST the goal event to an HTTP webhook so an
 * external system can react — e.g. a Home Assistant automation that casts a
 * "GOAL!" chime to a Google Nest Hub, aligned with the on-panel celebration.
 *
 * Deliberately decoupled: the daemon knows nothing about Cast, devices, volume
 * or which sound. It just says "team X scored in match Y" and lets the webhook
 * target own all of that — tweak the sound or device in Home Assistant without
 * touching this package. It never throws and never blocks the render loop.
 *
 * See README "Goal sound effects (Home Assistant → Nest Hub)" and
 * examples/home-assistant.yaml for the receiving end.
 */
import type { GoalAnnouncement } from "./engine.js";

/**
 * Build an `onGoal` handler that POSTs the announcement as JSON to `url`.
 * Failures are logged and swallowed — a missing speaker must never disrupt the
 * scoreboard. The request is time-boxed so a hung webhook can't pile up.
 */
export function webhookAnnouncer(
  url: string,
  log: (msg: string) => void = () => {},
  timeoutMs = 2000,
): (a: GoalAnnouncement) => void {
  return (a) => {
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(a),
      signal: AbortSignal.timeout(timeoutMs),
    })
      .then((res) => {
        if (!res.ok) log(`goal webhook ${res.status} ${res.statusText}`);
      })
      .catch((err: unknown) => log(`goal webhook error: ${(err as Error).message}`));
  };
}
