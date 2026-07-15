/**
 * Passcode auth, kept deliberately tiny: the library is for the household that
 * lawfully owns the music, so access is gated behind a shared passcode
 * (KARAOKE_PASSCODE). Sessions are HMAC-signed cookies — Web Crypto only, so
 * this runs in the edge middleware and in server actions alike.
 *
 * When no passcode is configured the app runs open, but the only playable
 * content is the built-in public-domain demo song — set the passcode before
 * deploying a real library.
 */

export const SESSION_COOKIE = "karaoke_session";
const SESSION_DAYS = 30;

export function passcode(): string | undefined {
  return process.env.KARAOKE_PASSCODE || undefined;
}

export function isAuthEnabled(): boolean {
  return passcode() !== undefined;
}

async function hmacKey(): Promise<CryptoKey> {
  // Derive the signing key from the passcode itself: one env var, and rotating
  // the passcode invalidates every outstanding session.
  const material = new TextEncoder().encode(`aubron-karaoke:${passcode() ?? ""}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function createSessionValue(now = Date.now()): Promise<string> {
  const expires = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(),
    new TextEncoder().encode(String(expires)),
  );
  return `${expires}.${toHex(sig)}`;
}

export async function verifySessionValue(
  value: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot < 0) return false;
  const expires = value.slice(0, dot);
  if (!/^\d+$/.test(expires) || Number(expires) < now) return false;
  const sigHex = value.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(sigHex)) return false;
  const sig = Uint8Array.from(sigHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", await hmacKey(), sig, new TextEncoder().encode(expires));
}
