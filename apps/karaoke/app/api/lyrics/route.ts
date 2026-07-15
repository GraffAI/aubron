import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findLyrics } from "../../lib/pipeline";

/** Timed-lyrics lookup (LRCLIB), proxied so the client stays same-origin. */
export async function GET(request: NextRequest) {
  const artist = request.nextUrl.searchParams.get("artist")?.trim();
  const title = request.nextUrl.searchParams.get("title")?.trim();
  const duration = Number(request.nextUrl.searchParams.get("duration")) || undefined;
  if (!artist || !title) {
    return NextResponse.json({ error: "artist and title are required" }, { status: 400 });
  }
  try {
    const result = await findLyrics(artist, title, duration);
    if (!result) return NextResponse.json({ found: false }, { status: 404 });
    return NextResponse.json({ found: true, ...result });
  } catch {
    return NextResponse.json({ error: "lyrics provider unreachable" }, { status: 502 });
  }
}
