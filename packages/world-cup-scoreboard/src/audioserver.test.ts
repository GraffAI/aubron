import { afterEach, describe, expect, it } from "vitest";

import { GoalAudioServer } from "./audioserver.js";

let server: GoalAudioServer | undefined;
afterEach(() => server?.close());

async function publish(buf: Buffer): Promise<string> {
  server = new GoalAudioServer("127.0.0.1", 0);
  await server.start();
  return server.publish(buf);
}

const clip = Buffer.from("fake-mp3-bytes");

describe("GoalAudioServer", () => {
  it("serves a published clip as audio/mpeg", async () => {
    const res = await fetch(await publish(clip));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(Buffer.from(await res.arrayBuffer()).equals(clip)).toBe(true);
  });

  it("answers HEAD with the length and no body", async () => {
    const res = await fetch(await publish(clip), { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(clip.length));
  });

  it("honours a Range request with 206", async () => {
    const res = await fetch(await publish(clip), { headers: { range: "bytes=0-3" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-3/${clip.length}`);
    expect(Buffer.from(await res.arrayBuffer()).equals(clip.subarray(0, 4))).toBe(true);
  });

  it("404s an unknown clip", async () => {
    await publish(clip);
    const url = new URL(server!.publish(clip));
    const res = await fetch(`${url.origin}/goal/999.mp3`);
    expect(res.status).toBe(404);
  });
});
