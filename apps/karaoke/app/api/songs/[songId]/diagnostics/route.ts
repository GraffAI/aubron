import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ingestReportKey } from "../../../../lib/ingest";
import { getJson, isStorageConfigured } from "../../../../lib/storage";
import type { IngestReport, StoredLibraryEntry } from "../../../../lib/types";

/**
 * Everything the pipeline knows about one stored song — the manifest entry
 * plus the ingest report (lyric lookup attempts and outcome, separation
 * note, stem inventory). This is what the player's info panel renders, so
 * "did lyrics work, and if not why" is answerable from a phone.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ songId: string }> },
) {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "library storage not configured" }, { status: 503 });
  }
  const { songId } = await params;
  const entries = (await getJson<StoredLibraryEntry[]>("library/index.json")) ?? [];
  const entry = entries.find((e) => e.id === songId);
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  const report = await getJson<IngestReport>(ingestReportKey(songId)).catch(() => null);
  return NextResponse.json({
    song: {
      id: entry.id,
      title: entry.title,
      artist: entry.artist,
      duration: entry.duration,
      addedAt: entry.addedAt,
      lyricsStatus: entry.lyricsStatus ?? (entry.lrc ? "synced" : "not-found"),
      lyricLines: entry.lrc ? entry.lrc.split("\n").filter((l) => l.trim()).length : 0,
      stems: Object.keys(entry.stems).filter(
        (k) => entry.stems[k as keyof typeof entry.stems] !== undefined,
      ),
    },
    ingest: report,
  });
}
