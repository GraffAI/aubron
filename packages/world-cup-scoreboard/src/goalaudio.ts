/**
 * The goal-audio pipeline: on each goal, narrate it in the announcer voice,
 * splice it onto the horn, and cast the result to a Nest Hub.
 *
 *   goal → announcementLine() → ElevenLabs TTS → concat with horn → serve over
 *   HTTP → Home Assistant casts the URL to the Chromecast device.
 *
 * Wired to the engine's `onGoal` hook (fired when a celebration hits the screen,
 * so the audio lands with the right match). Everything is best-effort: if TTS
 * fails we still play the horn, and any error is logged and swallowed so a
 * speaker hiccup never disturbs the panel.
 */
import { readFile } from "node:fs/promises";

import { postJson } from "./announce.js";
import { GoalAudioServer, lanAddress } from "./audioserver.js";
import { announcementLine } from "./commentary.js";
import type { GoalAnnouncement } from "./engine.js";
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

  async function handle(a: GoalAnnouncement): Promise<void> {
    const line = announcementLine(a);
    log(`announcing: "${line}"`);

    let clip: Buffer = horn;
    if (opts.elevenLabs) {
      try {
        const speech = await synthesize({ ...opts.elevenLabs, text: line });
        clip = concatMp3([horn, speech]);
      } catch (err) {
        log(`tts failed, horn only: ${(err as Error).message}`);
      }
    }

    const url = server.publish(clip);
    if (opts.hass) {
      await castAudio(opts.hass, url, durationMs(clip) + 1000);
    } else if (opts.webhookUrl) {
      postJson(opts.webhookUrl, { ...a, line, audioUrl: url }, log, opts.webhookTimeoutMs);
    }
  }

  return {
    onGoal: (a) =>
      void handle(a).catch((err: unknown) => log(`goal audio error: ${(err as Error).message}`)),
    close: () => server.close(),
  };
}
