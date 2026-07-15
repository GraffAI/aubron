# karaoke

Modern cloud-native karaoke — stem-split playback, live mic mixing, word-timed
lyrics, and a retro CD+G mode with all the downsides lovingly preserved.

An **app** in the aubron monorepo: not published to npm, deployed to the open
internet by CI (Vercel) at `karaoke.aubron.io`. See the repo README's "Apps"
section for the deploy model.

## What it does

- **Library** — the song collection: a built-in demo song plus whatever the
  deployed library manifest lists (see "Library format").
- **Player** — a single Web Audio graph mixes the separated **vocal** and
  **instrumental** stems against any number of **live microphones**. Faders for
  guide vocals / instrumental / master, per-mic level + feedback-delay echo,
  live level meters. Two mics at once is just two channels — the web is fine
  with it (one `getUserMedia` stream per `deviceId`). Echo cancellation, AGC
  and noise suppression are disabled per mic; they're built for speech calls
  and mangle singing.
- **Lyrics** — LRC (line-timed) and enhanced LRC (word-timed) parsing; the
  modern view does a smooth word sweep, the **CD+G 1992** mode does a chunky
  16-color, 300×216, quantized-wipe rendition on a scanlined CRT, glitches
  included.
- **Drop an MP3** — reads ID3 metadata locally, looks up timed lyrics, and
  starts a session-local sing. The audio never leaves the browser. No
  separation happens client-side, so the full mix rides the instrumental fader.
- **Auth** — set `KARAOKE_PASSCODE` and every page _and every stem file_ sits
  behind an HMAC-signed session cookie (`middleware.ts`). The library is for
  the household that lawfully owns the music; lawfully acquired ≠ lawfully
  redistributed. Without a passcode the app runs open, which is fine only
  because the only bundled content is public-domain.

## The demo song

The chorus of **"Daisy Bell"** (Harry Dacre, 1892 — public domain) is
synthesized in the browser with an `OfflineAudioContext`: separate vocal and
instrumental stems, with word-timed lyrics derived from the same note schedule
(`app/lib/daisy.ts`). The app is therefore fully playable with zero audio
assets in the repo and zero copyright exposure.

## Ingestion pipeline

"Load in a lawfully acquired MP3, get a karaoke-ready song" is three provider
slots (`app/lib/pipeline.ts`), exercised by `POST /api/ingest`:

| Step           | What                                                                                                                                                                                                | Status                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Lyrics**     | [LRCLIB](https://lrclib.net) — free, keyless, community-synced LRC (often word-timed).                                                                                                              | implemented (`/api/lyrics` proxies it)                        |
| **Separation** | Source separation (_not_ diarization — that's "who spoke when"; we want stems): Demucs/htdemucs on Replicate. Same interface fits LALAL.AI, Music.AI (Moises), AudioShake, or self-hosted demucs.   | wired; set `REPLICATE_API_TOKEN` + `REPLICATE_DEMUCS_VERSION` |
| **Alignment**  | When only untimed lyrics exist: forced alignment (WhisperX / stable-ts) run over the **isolated vocal stem** — far more accurate than aligning against the full mix — seeded with the plain lyrics. | stubbed, documented                                           |

Ingest is **autonomous** once storage is configured: drop a file → it uploads
straight to the private bucket (one-shot presigned PUT) → `POST /api/ingest`
finds lyrics and starts separation → polling `GET /api/ingest/<jobId>`
finalizes: stems are copied into the bucket, the manifest is updated, and the
song appears in the collection. With no separation provider the song still
lands (full mix as backing, vocal fader inert) and can be re-ingested later.

## Storage (the private library)

The system of record is a **private S3-compatible bucket** — Cloudflare R2
(recommended: free egress), AWS S3, MinIO, Backblaze B2. Nothing in it is ever
public and no long-lived URLs exist:

- Browsers get stems only through `GET /api/stems/<songId>/<stem>`, a
  streaming proxy **inside the auth gate**. Storage URLs and credentials never
  reach the client.
- The only presigned URLs are short-lived: a 10-minute one-shot PUT for an
  upload, and a read URL handed to the separation provider for one original.
- Bucket layout: `originals/<uuid>.<ext>` (uploads), `library/index.json`
  (the manifest, `StoredLibraryEntry[]`), `library/<songId>/{vocals,backing}.*`
  (stems), `jobs/<uuid>.json` (ingest job state, so any serverless instance
  can carry a poll forward).

Setup (R2 example): create a bucket, create an API token scoped to it, set the
`STORAGE_*` variables below, and add a CORS rule allowing `PUT` from the app's
origin (needed for direct-to-bucket uploads).

There is also a static tier — `public/library/` with an `index.json`, baked
into the deploy and served behind the same middleware — useful for a fixed
starter collection without any bucket at all.

## Environment

| Variable                    | Purpose                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `KARAOKE_PASSCODE`          | Enables auth; also the session-cookie signing secret (rotating it logs everyone out). |
| `STORAGE_ENDPOINT`          | S3-compatible endpoint (e.g. `https://<account>.r2.cloudflarestorage.com`).           |
| `STORAGE_BUCKET`            | Bucket name. Keep it **private** — no public access, ever.                            |
| `STORAGE_ACCESS_KEY_ID`     | Credentials scoped to that bucket.                                                    |
| `STORAGE_SECRET_ACCESS_KEY` | —                                                                                     |
| `STORAGE_REGION`            | Optional (default `us-east-1`; R2 uses `auto`).                                       |
| `STORAGE_FORCE_PATH_STYLE`  | Set for R2/MinIO.                                                                     |
| `REPLICATE_API_TOKEN`       | Enables the separation step of `/api/ingest`.                                         |
| `REPLICATE_DEMUCS_VERSION`  | Pinned demucs model version id on Replicate.                                          |

## Develop

```bash
pnpm --filter karaoke dev        # next dev
pnpm --filter karaoke build      # next build
pnpm --filter karaoke lint
pnpm --filter karaoke typecheck
pnpm --filter karaoke test       # vitest: lrc/id3/auth
```

Mic capture needs a secure context: `localhost` counts, plain LAN IPs don't.
Use headphones or keep the speakers modest — live mics through speakers feed
back (the echo slider is _reverb for the singer_, not a feedback fix).
