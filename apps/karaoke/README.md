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
- **In-browser transcoding** — a lossless (FLAC/WAV/AIFF) or surround upload
  is downmixed to stereo and encoded to MP3 (LAME compiled to WebAssembly,
  `wasm-media-encoders`) _in the browser_ before anything is uploaded — a
  600 MB 6-channel FLAC leaves the tab as a few stereo megabytes. Compressed
  stereo files (MP3/AAC/OGG/Opus) pass through untouched; a failed conversion
  falls back to the original bytes. Decision logic lives in
  `app/lib/transcode.ts` (`transcodePlan`), unit-tested; the conversion is
  reported in the draft card so nobody wonders where their surround mix went.
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

**Nothing is lost to separation.** Demucs's two stems don't sum exactly back
to the mix (the model leaves a residual, and stems are re-encoded), so the
untouched original is always stored as a `full` stem and the player's vocal
fader is a linear **full ↔ instrumental crossfade**: at max you hear the
original bit-exact, at zero pure instrumental. The vocal stem is still kept —
it's the input for forced alignment and a future practice mode.

**Word timing.** Two providers, both listening to the **isolated vocal stem**
(far more accurate than the full mix), auto-selected in this order:

1. **ElevenLabs** (`ELEVENLABS_API_KEY`) — preferred. True forced alignment:
   the chosen lyric text goes to the model with the audio, and every word of
   that text comes back timestamped — the model never gets to disagree about
   the words. The no-sheet path uses Scribe transcription (word-level
   timestamps, heuristic line breaks). Synchronous API, cents per song.
2. **WhisperX on Replicate** (`REPLICATE_WHISPERX_VERSION`) — fallback. It
   transcribes (audio-only), and the pipeline transplants its timestamps onto
   the chosen text via sequence alignment (`lib/retime.ts`), rejecting when
   under 35% of words anchor.

Word timing runs automatically when no synced lyrics were chosen, on demand at
ingest ("Retime this sheet" checkbox — even on an LRCLIB hit), or
retroactively from the ⓘ panel (`POST /api/songs/<id>/align`). It runs _after_
the song is live and can only upgrade it — a failure keeps whatever lyrics
existed, and provider ↔ AI timing stays switchable per song. The job flow is
`separating → aligning → done`, polled on the same `GET /api/ingest/<jobId>`.

**Ingest shows its work.** The add-song flow renders staged progress — upload
percentage, the lyric-lookup verdict the moment it lands, elapsed timers for
separation and word timing — and finishes with an **in-flow preview**
(`GET /api/songs/<id>/manifest`): the processed stems + timed lyrics in a mini
player, so timing can be judged before leaving the page.

**Every ingest is diagnosable.** A per-song `ingest.json` report records the
lyric lookup (query, provider endpoints hit, outcome or error), the separation
note, and the alignment outcome. The player's ⓘ panel renders it —
phone-friendly — and can **re-run the lyric search with corrected
artist/title** (`POST /api/songs/<id>/lyrics`), since metadata mismatch is the
usual cause of a miss. Library rows badge each song: `word-timed` / `timed` /
`untimed` / `no lyrics`.

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
`STORAGE_*` variables below, and add a CORS rule allowing `PUT` from **every
origin you actually browse the app on** — the custom domain AND the
`*.vercel.app` URL if you use it. A missed origin surfaces as Safari's opaque
"Load failed" on upload (the app now names the origin to add).

```json
[
  {
    "AllowedOrigins": ["https://karaoke.aubron.io", "https://karaoke-graff.vercel.app"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

There is also a static tier — `public/library/` with an `index.json`, baked
into the deploy and served behind the same middleware — useful for a fixed
starter collection without any bucket at all.

## Environment

| Variable                     | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KARAOKE_PASSCODE`           | Enables auth; also the session-cookie signing secret (rotating it logs everyone out).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `STORAGE_ENDPOINT`           | S3-compatible endpoint (e.g. `https://<account>.r2.cloudflarestorage.com`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `STORAGE_BUCKET`             | Bucket name. Keep it **private** — no public access, ever.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `STORAGE_ACCESS_KEY_ID`      | Credentials scoped to that bucket.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `STORAGE_SECRET_ACCESS_KEY`  | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `STORAGE_REGION`             | Optional (default `us-east-1`; R2 uses `auto`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `STORAGE_FORCE_PATH_STYLE`   | Set for R2/MinIO.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `REPLICATE_API_TOKEN`        | Enables the separation step of `/api/ingest`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `REPLICATE_DEMUCS_VERSION`   | Pinned demucs version: the bare hash after the colon in `owner/model:hash`. The input dialect matches `ryan5453/demucs` (`two_stems: "vocals"`).                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `REPLICATE_SEPARATION_INPUT` | JSON merged into the separation input. **Recommended:** `{"model_name":"htdemucs_ft","shifts":2}` — the default `htdemucs` is the fast baseline and bleeds vocal-adjacent instruments (synth leads, guitars, sax) into the vocal stem; the fine-tuned model + shifts separates noticeably cleaner at ~4× GPU time (still well under a dollar per song). `"$AUDIO_URL"` substitutes the presigned URL and `null` deletes a default key, so a different deployment's dialect (e.g. a BS/Mel-RoFormer port — current separation SOTA) can be pinned via `REPLICATE_DEMUCS_VERSION` without code changes. |
| `ELEVENLABS_API_KEY`         | Preferred word-timing provider: true forced alignment + Scribe transcription.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `REPLICATE_WHISPERX_VERSION` | Fallback word-timing: pinned WhisperX version (bare hash). Input dialect matches `victor-upmeet/whisperx` (`audio_file`, `align_output: true`).                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

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
