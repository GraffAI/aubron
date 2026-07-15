import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isStorageConfigured, presignPut } from "../../lib/storage";

/**
 * Hand the (already-authenticated — see middleware) client a one-shot
 * presigned PUT so the original audio goes straight into the PRIVATE bucket,
 * bypassing serverless body limits. The URL expires in minutes and grants
 * exactly one key; nothing about the bucket is public.
 */
export async function POST(request: NextRequest) {
  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: "library storage not configured (see README: Storage)" },
      { status: 503 },
    );
  }
  let body: { fileName?: string; contentType?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const ext = /\.([a-z0-9]{1,5})$/i.exec(body.fileName ?? "")?.[1]?.toLowerCase() ?? "mp3";
  const key = `originals/${crypto.randomUUID()}.${ext}`;
  const url = await presignPut(key, body.contentType || "application/octet-stream");
  return NextResponse.json({ key, url });
}
