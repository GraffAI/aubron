import { getJson, getObjectBytes, putJson, putObject } from "./storage";
import type { IngestJob, StoredLibraryEntry } from "./types";

/**
 * The write side of the library: turn a finished ingest job (uploaded
 * original + optional separated-stem URLs + lyrics) into stem objects under
 * `library/<songId>/` and a manifest entry. Everything lands in the private
 * bucket; nothing is ever exposed by URL.
 */

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "song"
  );
}

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/opus",
  flac: "audio/flac",
  webm: "audio/webm",
};

export function audioExt(urlOrKey: string): { ext: string; mime: string } {
  const path = urlOrKey.split("?")[0] ?? urlOrKey;
  const ext = /\.([a-z0-9]{1,5})$/i.exec(path)?.[1]?.toLowerCase() ?? "mp3";
  return { ext, mime: MIME_BY_EXT[ext] ?? "audio/mpeg" };
}

const jobKey = (jobId: string) => `jobs/${jobId}.json`;

export async function readJob(jobId: string): Promise<IngestJob | null> {
  if (!/^[0-9a-f-]{36}$/.test(jobId)) return null;
  return getJson<IngestJob>(jobKey(jobId));
}

export async function writeJob(job: IngestJob): Promise<void> {
  await putJson(jobKey(job.id), job);
}

async function storeStem(songId: string, stem: string, url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`stem download failed (${res.status})`);
  const { ext, mime } = audioExt(url);
  const key = `library/${songId}/${stem}.${ext}`;
  await putObject(key, new Uint8Array(await res.arrayBuffer()), mime);
  return key;
}

/**
 * Persist stems + manifest entry and mark the job done. With no separated
 * stems (provider unconfigured or unrecognized output) the uploaded original
 * becomes the backing track — degraded but singable; re-ingest later for the
 * vocal fader. Idempotent enough for racing pollers: same keys, and the
 * manifest update replaces by id.
 */
export async function finalizeJob(
  job: IngestJob,
  stemUrls: { vocals?: string; instrumental?: string },
): Promise<IngestJob> {
  const songId = `${slugify(`${job.artist} ${job.title}`)}-${job.id.slice(0, 6)}`;
  const stems: StoredLibraryEntry["stems"] = { instrumental: "" };

  if (stemUrls.instrumental) {
    stems.instrumental = await storeStem(songId, "backing", stemUrls.instrumental);
  } else {
    // No separation: copy the original within the bucket as the backing track.
    const original = await getObjectBytes(job.key);
    if (!original) throw new Error("uploaded original disappeared from storage");
    const { ext, mime } = audioExt(job.key);
    stems.instrumental = `library/${songId}/backing.${ext}`;
    await putObject(stems.instrumental, original, mime);
  }
  if (stemUrls.vocals) {
    stems.vocals = await storeStem(songId, "vocals", stemUrls.vocals);
  }

  const entry: StoredLibraryEntry = {
    id: songId,
    title: job.title,
    artist: job.artist,
    duration: job.duration,
    stems,
    lrc: job.lrc,
    addedAt: new Date().toISOString(),
  };
  const index = (await getJson<StoredLibraryEntry[]>("library/index.json")) ?? [];
  await putJson("library/index.json", [...index.filter((e) => e.id !== songId), entry]);

  const done: IngestJob = { ...job, status: "done", songId };
  await writeJob(done);
  return done;
}
