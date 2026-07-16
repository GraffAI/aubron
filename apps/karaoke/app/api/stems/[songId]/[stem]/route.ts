import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getJson, getObjectStream, isStorageConfigured } from "../../../../lib/storage";
import type { StoredLibraryEntry } from "../../../../lib/types";

/**
 * The only road from the private bucket to a browser. Auth happens in the
 * middleware (this route is inside the gate); here we just resolve the
 * manifest entry and stream the object — storage URLs and credentials never
 * reach the client.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ songId: string; stem: string }> },
) {
  const { songId, stem } = await params;
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "library storage not configured" }, { status: 503 });
  }
  const extraMatch = /^backing(\d+)$/.exec(stem);
  if (stem !== "vocals" && stem !== "instrumental" && stem !== "full" && !extraMatch) {
    return NextResponse.json({ error: "unknown stem" }, { status: 404 });
  }
  const entries = (await getJson<StoredLibraryEntry[]>("library/index.json")) ?? [];
  const entry = entries.find((e) => e.id === songId);
  // backing2 → extras[0], backing3 → extras[1], …
  const key = extraMatch
    ? entry?.stems.extras?.[Number(extraMatch[1]) - 2]
    : entry?.stems[stem as "vocals" | "instrumental" | "full"];
  if (!key) return NextResponse.json({ error: "not found" }, { status: 404 });
  const object = await getObjectStream(key);
  if (!object) return NextResponse.json({ error: "stem object missing" }, { status: 404 });
  return new Response(object.stream, {
    headers: {
      "Content-Type": object.contentType,
      ...(object.contentLength ? { "Content-Length": String(object.contentLength) } : {}),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
