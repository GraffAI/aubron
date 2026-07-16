import { describe, expect, it } from "vitest";

import { fileExt, mp3FileName, transcodePlan } from "./transcode";

const probe = (over: Partial<Parameters<typeof transcodePlan>[0]> = {}) => ({
  fileName: "song.mp3",
  contentType: "audio/mpeg",
  bytes: 8 * 1024 * 1024,
  channels: 2,
  sampleRate: 44100,
  ...over,
});

describe("transcodePlan", () => {
  it("keeps a normal stereo MP3 untouched", () => {
    expect(transcodePlan(probe()).action).toBe("keep");
  });

  it("keeps compressed stereo formats (m4a, ogg, opus)", () => {
    for (const [fileName, contentType] of [
      ["song.m4a", "audio/mp4"],
      ["song.ogg", "audio/ogg"],
      ["song.opus", "audio/opus"],
    ] as const) {
      expect(transcodePlan(probe({ fileName, contentType })).action).toBe("keep");
    }
  });

  it("transcodes the 600 MB 6-channel FLAC crime", () => {
    const plan = transcodePlan(
      probe({
        fileName: "bohemian.flac",
        contentType: "audio/flac",
        bytes: 600 * 1024 * 1024,
        channels: 6,
        sampleRate: 96000,
      }),
    );
    expect(plan.action).toBe("transcode");
    expect(plan.reason).toBe("6-channel FLAC");
    expect(plan.targetChannels).toBe(2);
    expect(plan.targetSampleRate).toBe(48000); // 96 kHz isn't MP3-legal
  });

  it("transcodes lossless/uncompressed stereo too (wav, aiff, flac)", () => {
    for (const fileName of ["song.wav", "song.aiff", "song.flac"]) {
      const plan = transcodePlan(probe({ fileName, contentType: "" }));
      expect(plan.action).toBe("transcode");
      expect(plan.targetChannels).toBe(2);
      expect(plan.targetSampleRate).toBe(44100);
    }
  });

  it("transcodes a surround file even in a compressed container", () => {
    const plan = transcodePlan(probe({ fileName: "surround.m4a", channels: 6 }));
    expect(plan.action).toBe("transcode");
    expect(plan.reason).toBe("6-channel M4A");
  });

  it("keeps mono mono and preserves MP3-legal sample rates", () => {
    const plan = transcodePlan(
      probe({ fileName: "voice.wav", contentType: "audio/wav", channels: 1, sampleRate: 22050 }),
    );
    expect(plan.action).toBe("transcode");
    expect(plan.targetChannels).toBe(1);
    expect(plan.targetSampleRate).toBe(22050);
  });

  it("rounds odd sample rates to a legal one", () => {
    expect(transcodePlan(probe({ fileName: "s.wav", sampleRate: 37800 })).targetSampleRate).toBe(
      44100,
    );
    expect(transcodePlan(probe({ fileName: "s.wav", sampleRate: 88200 })).targetSampleRate).toBe(
      48000,
    );
  });

  it("treats an unknown extension and MIME as needing conversion", () => {
    const plan = transcodePlan(probe({ fileName: "mystery.snd", contentType: "" }));
    expect(plan.action).toBe("transcode");
    expect(plan.reason).toBe("SND");
  });
});

describe("file name helpers", () => {
  it("extracts extensions case-insensitively", () => {
    expect(fileExt("A.FLAC")).toBe("flac");
    expect(fileExt("noext")).toBe("");
  });

  it("rewrites to .mp3", () => {
    expect(mp3FileName("song.flac")).toBe("song.mp3");
    expect(mp3FileName("weird.name.wav")).toBe("weird.name.mp3");
    expect(mp3FileName("noext")).toBe("noext.mp3");
  });
});
