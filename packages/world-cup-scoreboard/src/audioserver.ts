/**
 * A tiny HTTP server that hands each freshly-built goal clip to the Cast device.
 *
 * Home Assistant tells the Nest Hub to play a URL, and the Hub fetches it
 * *itself* — so the audio has to live somewhere on the LAN the Hub can reach.
 * Rather than drop files into HA's `www`, the daemon serves them straight from
 * memory: `publish()` stashes a buffer under a fresh URL, keeping only the last
 * few so memory stays bounded. Cast probes with a Range request before playing,
 * so we honour `Range` (206) as well as plain GET/HEAD.
 */
import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";

/** First non-internal IPv4 address — the LAN IP the Hub can reach us on. */
export function lanAddress(): string {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return "127.0.0.1";
}

export class GoalAudioServer {
  private readonly server: Server;
  private readonly clips = new Map<string, Buffer>();
  private seq = 0;
  private readonly keep: number;
  /** Actual listening port (== `port`, unless `port` was 0 for an ephemeral one). */
  private bound = 0;

  constructor(
    private readonly host: string,
    private readonly port: number,
    keep = 4,
  ) {
    this.keep = keep;
    this.server = createServer((req, res) =>
      this.handle(req.url ?? "", req.method ?? "GET", req.headers.range, res),
    );
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, () => {
        const addr = this.server.address();
        this.bound = typeof addr === "object" && addr ? addr.port : this.port;
        resolve();
      });
    });
  }

  close(): void {
    this.server.close();
  }

  /** Stash a clip and return the URL the Hub should fetch. */
  publish(mp3: Buffer): string {
    const id = `${++this.seq}`;
    this.clips.set(id, mp3);
    // Evict the oldest once we're over the cap (Map preserves insertion order).
    for (const k of this.clips.keys()) {
      if (this.clips.size <= this.keep) break;
      this.clips.delete(k);
    }
    return `http://${this.host}:${this.bound || this.port}/goal/${id}.mp3`;
  }

  private handle(
    url: string,
    method: string,
    range: string | undefined,
    res: import("node:http").ServerResponse,
  ): void {
    const id = /^\/goal\/(\d+)\.mp3$/.exec(url)?.[1];
    const clip = id ? this.clips.get(id) : undefined;
    if (!clip) {
      res.writeHead(404).end();
      return;
    }
    const head = { "content-type": "audio/mpeg", "accept-ranges": "bytes" };
    if (method === "HEAD") {
      res.writeHead(200, { ...head, "content-length": clip.length }).end();
      return;
    }
    const m = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : clip.length - 1;
      res
        .writeHead(206, {
          ...head,
          "content-range": `bytes ${start}-${end}/${clip.length}`,
          "content-length": end - start + 1,
        })
        .end(clip.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { ...head, "content-length": clip.length }).end(clip);
  }
}
