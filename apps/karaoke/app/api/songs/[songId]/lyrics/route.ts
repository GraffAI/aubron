import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ingestReportKey } from "../../../../lib/ingest";
import { findLyrics } from "../../../../lib/pipeline";
import { getJson, isStorageConfigured, putJson } from "../../../../lib/storage";
import type { IngestReport, StoredLibraryEntry } from "../../../../lib/types";

/**
 * Re-run the lyric lookup for a stored song, optionally with corrected
 * artist/title — metadata mismatch is the usual reason a lookup missed. A
 * synced result replaces the stored LRC; either way the manifest status and
 * the ingest report are updated, so the diagnostics panel always reflects
 * the latest attempt.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ songId: string }> },
) {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "library storage not configured" }, { status: 503 });
  }
  const { songId } = await params;
  const entries = (await getJson<StoredLibraryEntry[]>("library/index.json")) ?? [];
  const entry = entries.find((e) => e.id === songId);
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });

  let overrides: { artist?: string; title?: string } = {};
  try {
    overrides = (await request.json()) as typeof overrides;
  } catch {
    /* empty body = retry with stored metadata */
  }
  const artist = overrides.artist?.trim() || entry.artist;
  const title = overrides.title?.trim() || entry.title;

  const report = await findLyrics(artist, title, entry.duration || undefined);
  const updated = report.synced !== null;
  if (updated) entry.lrc = report.synced;
  // Only overwrite the badge when we found something or had nothing before —
  // a failed retry shouldn't demote existing synced lyrics.
  if (updated || !entry.lrc) entry.lyricsStatus = report.status;
  await putJson("library/index.json", entries);

  const ingest = (await getJson<IngestReport>(ingestReportKey(songId)).catch(() => null)) ?? {
    jobId: "unknown",
    originalKey: "",
    addedAt: entry.addedAt,
    lyrics: null,
    separation: { used: entry.stems.vocals !== undefined, note: "report predates diagnostics" },
    stems: entry.stems,
  };
  ingest.lyrics = report;
  await putJson(ingestReportKey(songId), ingest);

  return NextResponse.json({ updated, ...report });
}
