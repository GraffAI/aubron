import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getJson, getObjectStream, isStorageConfigured } from "../../../lib/storage";
import type { StoredLibraryEntry } from "../../../lib/types";

/**
 * Cover art out of the private bucket, same posture as the stems proxy:
 * inside the auth gate, storage never exposed. Long browser cache is fine —
 * art URLs carry the entry's ?v cache-buster like stem URLs do.
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
  if (!entry?.art) return NextResponse.json({ error: "no artwork" }, { status: 404 });
  const object = await getObjectStream(entry.art);
  if (!object) return NextResponse.json({ error: "artwork object missing" }, { status: 404 });
  return new Response(object.stream, {
    headers: {
      "Content-Type": object.contentType,
      ...(object.contentLength ? { "Content-Length": String(object.contentLength) } : {}),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
