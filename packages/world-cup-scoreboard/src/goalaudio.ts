/**
 * The goal-audio pipeline, cast to a Nest Hub. Two kinds of sound:
 *
 *   - **every goal** plays just the horn (immediate, no narration);
 *   - **lead changes and full-time results** add the announcer voice — for a
 *     lead-changing goal the horn is spliced in front of the spoken line; a
 *     result is the spoken line alone.
 *
 *   event → [horn (+ ElevenLabs TTS)] → serve over HTTP → Home Assistant casts
 *   the URL to the Chromecast device.
 *
 * Goals are wired to the engine's `onGoal` hook (fired when a celebration hits
 * the screen, so the audio lands with the right match); results to `onMatchEnd`.
 * Everything is best-effort: if TTS fails a goal still plays the horn, and any
 * error is logged and swallowed so a speaker hiccup never disturbs the panel.
 */
import { readFile } from "node:fs/promises";

import { postJson } from "./announce.js";
import { GoalAudioServer, lanAddress } from "./audioserver.js";
import { leadChangeLine, resultLine } from "./commentary.js";
import type { GoalAnnouncement, MatchResult } from "./engine.js";
import { synthesize } from "./elevenlabs.js";
import { castAudio, type HassConfig } from "./hass.js";
import { concatMp3 } from "./mp3.js";

export interface GoalAudioOptions {
  hornPath: string;
  audioHost?: string;
  audioPort: number;
  elevenLabs?: { apiKey: string; voice: string; model: string; timeoutMs?: number };
  hass?: HassConfig;
  /** Alternative to HASS: POST { ...goal, line, audioUrl } to this webhook. */
  webhookUrl?: string;
  webhookTimeoutMs?: number;
  log?: (msg: string) => void;
}

export interface GoalAudio {
  onGoal: (a: GoalAnnouncement) => void;
  onMatchEnd: (r: MatchResult) => void;
  close: () => void;
}

/** Estimated play length of a 128 kbps CBR MP3 (16 000 bytes/sec). */
function durationMs(mp3: Buffer): number {
  return Math.round(mp3.length / 16);
}

/** Read the horn, start the audio server, and return the `onGoal` handler. */
export async function createGoalAudio(opts: GoalAudioOptions): Promise<GoalAudio> {
  const log = opts.log ?? (() => {});
  const horn = await readFile(opts.hornPath);
  const host = opts.audioHost ?? lanAddress();
  const server = new GoalAudioServer(host, opts.audioPort);
  await server.start();
  log(`goal audio: horn ${horn.length}B, serving on http://${host}:${opts.audioPort}`);

  /** Synthesize a line (best-effort) and return its MP3, or null on failure. */
  async function speak(line: string): Promise<Buffer | null> {
    if (!opts.elevenLabs) return null;
    try {
      return await synthesize({ ...opts.elevenLabs, text: line });
    } catch (err) {
      log(`tts failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Publish a clip and cast it (or POST the webhook). */
  async function cast(clip: Buffer, body: Record<string, unknown>): Promise<void> {
    const url = server.publish(clip);
    if (opts.hass) {
      await castAudio(opts.hass, url, durationMs(clip) + 1000);
    } else if (opts.webhookUrl) {
      postJson(opts.webhookUrl, { ...body, audioUrl: url }, log, opts.webhookTimeoutMs);
    }
  }

  // A goal is just the horn — unless it changed the lead, in which case the
  // announcer line follows the horn in one clip.
  async function handleGoal(a: GoalAnnouncement): Promise<void> {
    let clip: Buffer = horn;
    let line: string | undefined;
    if (a.leadChange) {
      line = leadChangeLine(a);
      log(`announcing: "${line}"`);
      const speech = await speak(line);
      if (speech) clip = concatMp3([horn, speech]);
    }
    await cast(clip, { ...a, line });
  }

  // A result is the spoken line alone (no horn). Without TTS there's nothing to
  // say, so skip it.
  async function handleEnd(r: MatchResult): Promise<void> {
    const line = resultLine(r);
    log(`announcing: "${line}"`);
    const speech = await speak(line);
    if (!speech) return;
    await cast(speech, { ...r, line });
  }

  return {
    onGoal: (a) =>
      void handleGoal(a).catch((err: unknown) =>
        log(`goal audio error: ${(err as Error).message}`),
      ),
    onMatchEnd: (r) =>
      void handleEnd(r).catch((err: unknown) =>
        log(`result audio error: ${(err as Error).message}`),
      ),
    close: () => server.close(),
  };
}
