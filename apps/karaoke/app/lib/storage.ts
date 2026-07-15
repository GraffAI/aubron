import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * The library's system of record: a PRIVATE S3-compatible bucket — Cloudflare
 * R2, AWS S3, MinIO, Backblaze B2 all speak this dialect. Nothing in it is
 * ever public: the app server holds the only credentials, browsers get stems
 * through the authed /api/stems proxy, and the only presigned URLs that exist
 * are short-lived (a one-shot upload PUT, and a GET handed to the separation
 * provider so it can read one original). That's the whole copyright posture:
 * lawfully acquired audio, stored privately, played back only past auth.
 *
 * Bucket layout:
 *   originals/<id>.<ext>       the uploaded source audio
 *   library/index.json         StoredLibraryEntry[] — the catalog manifest
 *   library/<songId>/<stem>    separated stems (vocals / backing)
 *   jobs/<jobId>.json          ingest job state (serverless-friendly)
 */

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.STORAGE_ENDPOINT &&
    process.env.STORAGE_BUCKET &&
    process.env.STORAGE_ACCESS_KEY_ID &&
    process.env.STORAGE_SECRET_ACCESS_KEY,
  );
}

let cached: S3Client | null = null;

function client(): S3Client {
  cached ??= new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION ?? "us-east-1",
    // R2 and MinIO want path-style; AWS S3 doesn't care.
    forcePathStyle: Boolean(process.env.STORAGE_FORCE_PATH_STYLE),
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
    },
  });
  return cached;
}

const bucket = () => process.env.STORAGE_BUCKET!;

export async function putObject(
  key: string,
  body: Uint8Array | string,
  contentType: string,
): Promise<void> {
  await client().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
  );
}

/** null when the key doesn't exist; anything else throws. */
export async function getObjectBytes(key: string): Promise<Uint8Array | null> {
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return res.Body ? await res.Body.transformToByteArray() : null;
  } catch (err) {
    if (err instanceof Error && (err.name === "NoSuchKey" || err.name === "NotFound")) return null;
    throw err;
  }
}

/** Stream an object out (for the stems proxy) without buffering it. */
export async function getObjectStream(
  key: string,
): Promise<{ stream: ReadableStream; contentType: string; contentLength?: number } | null> {
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    if (!res.Body) return null;
    return {
      stream: res.Body.transformToWebStream(),
      contentType: res.ContentType ?? "application/octet-stream",
      contentLength: res.ContentLength,
    };
  } catch (err) {
    if (err instanceof Error && (err.name === "NoSuchKey" || err.name === "NotFound")) return null;
    throw err;
  }
}

export async function getJson<T>(key: string): Promise<T | null> {
  const bytes = await getObjectBytes(key);
  if (!bytes) return null;
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export async function putJson(key: string, value: unknown): Promise<void> {
  await putObject(key, JSON.stringify(value, null, 2), "application/json");
}

/** One-shot upload URL so browsers PUT originals straight to the bucket
 *  (dodges serverless body limits; the bucket needs a CORS rule for PUT). */
export async function presignPut(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
    { expiresIn: 10 * 60 },
  );
}

/** Short-lived read URL — only ever handed to the separation provider. */
export async function presignGet(key: string): Promise<string> {
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
    expiresIn: 2 * 60 * 60,
  });
}
