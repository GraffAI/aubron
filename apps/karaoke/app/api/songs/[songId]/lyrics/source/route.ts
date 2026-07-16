import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getJson, isStorageConfigured, putJson } from "../../../../../lib/storage";
import type { StoredLibraryEntry } from "../../../../../lib/types";

/**
 * Flip a song's active lyrics between the provider sheet and the AI timing.
 * Both are retained on the entry, so this is instant and reversible — the
 * "actually, Whisper struggled with this one, keep LRCLIB's timing" switch.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ songId: string }> },
) {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "library storage not configured" }, { status: 503 });
  }
  const { songId } = await params;
  let body: { source?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (body.source !== "provider" && body.source !== "ai") {
    return NextResponse.json({ error: 'source must be "provider" or "ai"' }, { status: 400 });
  }
  const entries = (await getJson<StoredLibraryEntry[]>("library/index.json")) ?? [];
  const entry = entries.find((e) => e.id === songId);
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  const lrc = body.source === "provider" ? entry.providerLrc : entry.aiLrc;
  if (!lrc) {
    return NextResponse.json(
      { error: `no ${body.source} lyrics stored for this song` },
      { status: 409 },
    );
  }
  entry.lrc = lrc;
  entry.lrcSource = body.source;
  entry.lyricsStatus = "synced";
  await putJson("library/index.json", entries);
  return NextResponse.json({ songId, source: body.source });
}
