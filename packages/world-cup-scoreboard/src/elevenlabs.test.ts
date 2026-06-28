import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveVoiceId, synthesize } from "./elevenlabs.js";

afterEach(() => vi.unstubAllGlobals());

// A 20-char alphanumeric id, like ElevenLabs returns.
const VOICE_ID = "gU0LNdkMOQCOrPrwtbee";

describe("resolveVoiceId", () => {
  it("passes a voice id straight through without a lookup", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveVoiceId("k", VOICE_ID)).toBe(VOICE_ID);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves a name to an id via search, matching case-insensitively", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ voices: [{ voice_id: VOICE_ID, name: "British Football Announcer" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveVoiceId("key", "british football announcer")).toBe(VOICE_ID);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/v2/voices?search=british");
    expect(init.headers["xi-api-key"]).toBe("key");
  });
});

describe("synthesize", () => {
  it("POSTs the text + model and returns the audio bytes", async () => {
    const audio = new TextEncoder().encode("mp3").buffer;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => audio });
    vi.stubGlobal("fetch", fetchMock);

    const out = await synthesize({
      apiKey: "key",
      voice: VOICE_ID, // id form → no voice lookup, single TTS call
      model: "eleven_v3",
      text: "Argentina has SCORED!",
    });
    expect(out.equals(Buffer.from("mp3"))).toBe(true);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
    );
    expect(init.method).toBe("POST");
    expect(init.headers["xi-api-key"]).toBe("key");
    expect(JSON.parse(init.body)).toEqual({ text: "Argentina has SCORED!", model_id: "eleven_v3" });
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "bad key",
      }),
    );
    await expect(
      synthesize({ apiKey: "k", voice: VOICE_ID, model: "eleven_v3", text: "x" }),
    ).rejects.toThrow(/tts 401/);
  });
});
