import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { storedStemUrls } from "../../../../lib/catalog";
import { getJson, isStorageConfigured } from "../../../../lib/storage";
import type { StoredLibraryEntry } from "../../../../lib/types";

/**
 * One stored song's playable manifest — title, LRC text, and the authed stem
 * proxy URLs. Powers the in-flow ingest preview, which mounts a mini player
 * right after processing so timing can be judged before anyone leaves the
 * page. Same auth gate as everything else.
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
  return NextResponse.json({
    id: entry.id,
    title: entry.title,
    artist: entry.artist,
    duration: entry.duration,
    lrc: entry.lrc,
    lyricsStatus: entry.lyricsStatus ?? (entry.lrc ? "synced" : "not-found"),
    lrcSource: entry.lrcSource ?? (entry.lrc ? "provider" : undefined),
    hasProvider: Boolean(entry.providerLrc),
    hasAi: Boolean(entry.aiLrc),
    urls: storedStemUrls(entry),
  });
}
