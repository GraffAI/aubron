import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findLyrics } from "../../lib/pipeline";

/** Timed-lyrics lookup (LRCLIB), proxied so the client stays same-origin.
 *  Returns the full lookup report — status, source, and per-request attempts —
 *  so failures are diagnosable, not just absent. */
export async function GET(request: NextRequest) {
  const artist = request.nextUrl.searchParams.get("artist")?.trim();
  const title = request.nextUrl.searchParams.get("title")?.trim();
  const duration = Number(request.nextUrl.searchParams.get("duration")) || undefined;
  if (!artist || !title) {
    return NextResponse.json({ error: "artist and title are required" }, { status: 400 });
  }
  const report = await findLyrics(artist, title, duration);
  return NextResponse.json({ found: report.synced !== null || report.plain !== null, ...report });
}
