import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findArtwork } from "../../../../lib/artwork";
import { ingestReportKey, storeArtwork } from "../../../../lib/ingest";
import { getJson, isStorageConfigured, putJson } from "../../../../lib/storage";
import type { IngestReport, StoredLibraryEntry } from "../../../../lib/types";

/**
 * Backfill (or refresh) cover art for an existing song without reprocessing:
 * re-run the iTunes → Cover Art Archive lookup with the entry's CURRENT
 * artist/title — so fixing metadata in the ⓘ panel and tapping "Fetch
 * artwork" is the recovery path for a wrong or missing cover.
 */
export async function POST(
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

  const { art, report } = await findArtwork(entry.artist, entry.title);
  if (art) {
    entry.art = await storeArtwork(songId, art);
    // Nudge addedAt-derived ?v so cached copies of a replaced cover expire.
    entry.addedAt = new Date().toISOString();
    await putJson("library/index.json", entries);
  }
  const ingestReport = await getJson<IngestReport>(ingestReportKey(songId)).catch(() => null);
  if (ingestReport) {
    ingestReport.artwork = report;
    await putJson(ingestReportKey(songId), ingestReport);
  }
  return NextResponse.json({ found: art !== null, ...report });
}
