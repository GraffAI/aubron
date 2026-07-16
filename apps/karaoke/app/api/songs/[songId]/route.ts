import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ingestReportKey } from "../../../lib/ingest";
import { deleteObject, getJson, isStorageConfigured, putJson } from "../../../lib/storage";
import type { IngestReport, StoredLibraryEntry } from "../../../lib/types";

/**
 * Remove a song completely: manifest entry, stem objects, the ingest report,
 * the retained original, and the job record. Object deletes are best-effort
 * (a missing key is already deleted); the manifest update is what makes the
 * song disappear.
 */
export async function DELETE(
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
  const keys = [
    ...Object.values(entry.stems).filter((k): k is string => typeof k === "string"),
    ingestReportKey(songId),
    ...(report?.originalKey ? [report.originalKey] : []),
    ...(report?.jobId && report.jobId !== "unknown" ? [`jobs/${report.jobId}.json`] : []),
  ];
  await Promise.all(keys.map(deleteObject));
  await putJson(
    "library/index.json",
    entries.filter((e) => e.id !== songId),
  );
  return NextResponse.json({ deleted: songId });
}
