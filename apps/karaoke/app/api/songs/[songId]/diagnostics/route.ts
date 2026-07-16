import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { storedStemUrls } from "../../../../lib/catalog";
import { ingestReportKey, pipelineCommit } from "../../../../lib/ingest";
import { isAlignmentConfigured } from "../../../../lib/pipeline";
import { getJson, headObject, isStorageConfigured } from "../../../../lib/storage";
import type { IngestReport, StoredLibraryEntry } from "../../../../lib/types";

/**
 * Everything the pipeline knows about one stored song — the manifest entry,
 * the ingest report (lyric lookup attempts, separation input/output, notes),
 * and a LIVE storage inventory: every stem key HEADed right now, with byte
 * sizes and an audition URL. That last part exists to answer "where did the
 * drums go" definitively — is the part missing from storage (separation-side
 * bug), or stored fine but not reaching the speakers (playback/cache bug)?
 * Solo each stem in the ⓘ panel and hear exactly what was stored.
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

  const urls = storedStemUrls(entry);
  const rows: { stem: string; key: string; url: string }[] = [
    { stem: "backing", key: entry.stems.instrumental, url: urls.instrumental },
    ...(entry.stems.extras ?? []).map((key, i) => ({
      stem: `backing${i + 2}`,
      key,
      url: urls.extras?.[i] ?? "",
    })),
    ...(entry.stems.vocals ? [{ stem: "vocals", key: entry.stems.vocals, url: urls.vocals! }] : []),
    ...(entry.stems.full ? [{ stem: "full", key: entry.stems.full, url: urls.full! }] : []),
  ];
  const storage = await Promise.all(
    rows.map(async (row) => {
      const head = await headObject(row.key).catch(() => null);
      return { ...row, bytes: head?.bytes ?? null, contentType: head?.contentType ?? null };
    }),
  );

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
    storage,
    /** The code serving THIS request — compare with ingest.commit. */
    deployedCommit: pipelineCommit() ?? null,
    ingest: report,
    alignmentAvailable: isAlignmentConfigured() && entry.stems.vocals !== undefined,
  });
}
