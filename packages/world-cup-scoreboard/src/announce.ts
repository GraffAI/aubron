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
 * Fire-and-forget JSON POST: log non-OK responses and swallow every error so a
 * missing/hung listener can never disrupt the scoreboard. Time-boxed.
 */
export function postJson(
  url: string,
  body: unknown,
  log: (msg: string) => void = () => {},
  timeoutMs = 2000,
): void {
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then((res) => {
      if (!res.ok) log(`goal webhook ${res.status} ${res.statusText}`);
    })
    .catch((err: unknown) => log(`goal webhook error: ${(err as Error).message}`));
}

/**
 * Build an `onGoal` handler that POSTs the announcement as JSON to `url` — for
 * the lightweight setup where Home Assistant owns the sound. (When the daemon
 * synthesizes its own audio it posts a richer body; see goalaudio.ts.)
 */
export function webhookAnnouncer(
  url: string,
  log: (msg: string) => void = () => {},
  timeoutMs = 2000,
): (a: GoalAnnouncement) => void {
  return (a) => postJson(url, a, log, timeoutMs);
}
