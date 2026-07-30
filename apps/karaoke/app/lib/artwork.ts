/**
 * Album artwork lookup — two keyless sources that between them cover both
 * ends of a music library:
 *
 * 1. iTunes Search API — the record-label side. Every storefront release,
 *    strong Arabic/Japanese coverage, and the artwork URL scales to
 *    print-quality by rewriting the size segment. No key, no auth.
 * 2. MusicBrainz → Cover Art Archive — the weird side. Community-built, so
 *    it has the bootlegs, self-released and regional pressings storefronts
 *    never carried, and its art is explicitly free to cache forever. No key;
 *    just a descriptive User-Agent and a 1 req/s courtesy.
 *
 * The winner's bytes are cached into the private bucket next to the stems —
 * each provider is hit once per song, ever.
 */

const itunesBase = () => process.env.ITUNES_API_BASE ?? "https://itunes.apple.com";
const musicbrainzBase = () => process.env.MUSICBRAINZ_API_BASE ?? "https://musicbrainz.org";
const coverartBase = () => process.env.COVERART_API_BASE ?? "https://coverartarchive.org";

/** Storefronts to try in order; regional storefronts catch releases the US
 *  store doesn't list. Override with ITUNES_COUNTRIES="us,jp,ae". */
const itunesCountries = () =>
  (process.env.ITUNES_COUNTRIES ?? "us,jp")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

const USER_AGENT = "aubron-karaoke/1.0 (+https://github.com/GraffAI/aubron)";

export interface ArtworkResult {
  /** Downloaded image. */
  bytes: Uint8Array;
  contentType: string;
  /** Which provider path won, e.g. "itunes (us)" or "coverartarchive". */
  source: string;
}

export interface ArtworkReport {
  used: boolean;
  source: string | null;
  /** One line per provider request, mirroring the lyric-lookup report. */
  attempts: string[];
}

/** Case/diacritic fold for match scoring (mirrors the catalogue search). */
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

interface ItunesHit {
  artistName?: string;
  trackName?: string;
  collectionName?: string;
  artworkUrl100?: string;
}

/** Prefer a hit whose artist matches; among those, one whose title matches.
 *  Exported for unit tests. */
export function pickItunesMatch(
  hits: ItunesHit[],
  artist: string,
  title: string,
): ItunesHit | null {
  const fa = fold(artist);
  const ft = fold(title);
  const scored = hits
    .filter((h) => typeof h.artworkUrl100 === "string" && h.artworkUrl100.length > 0)
    .map((h) => {
      const ha = fold(h.artistName ?? "");
      const ht = fold(h.trackName ?? "");
      let score = 0;
      if (ha === fa) score += 4;
      else if (ha.includes(fa) || fa.includes(ha)) score += 2;
      if (ht === ft) score += 2;
      else if (ht.includes(ft) || ft.includes(ht)) score += 1;
      return { h, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  // An artwork result with zero name overlap is a different song entirely.
  return best && best.score >= 2 ? best.h : null;
}

/** iTunes serves tiny thumbnails by default; the size segment in the URL is
 *  freely rewritable up to source resolution. Exported for unit tests. */
export function upsizeItunesArt(url: string, px = 1200): string {
  return url.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/, `/${px}x${px}$1.$2`);
}

async function providerFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json, image/*" },
    signal: AbortSignal.timeout(8000),
  });
}

async function download(url: string, source: string): Promise<ArtworkResult | null> {
  const res = await providerFetch(url);
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.length > 0 ? { bytes, contentType, source } : null;
}

async function fromItunes(
  artist: string,
  title: string,
  attempts: string[],
): Promise<ArtworkResult | null> {
  for (const country of itunesCountries()) {
    const url = `${itunesBase()}/search?term=${encodeURIComponent(`${artist} ${title}`)}&entity=song&limit=8&country=${country}`;
    try {
      const res = await providerFetch(url);
      if (!res.ok) {
        attempts.push(`itunes (${country}) → ${res.status}`);
        continue;
      }
      const body = (await res.json()) as { results?: ItunesHit[] };
      const match = pickItunesMatch(body.results ?? [], artist, title);
      if (!match) {
        attempts.push(`itunes (${country}) → no match in ${body.results?.length ?? 0} results`);
        continue;
      }
      const art = await download(upsizeItunesArt(match.artworkUrl100!), `itunes (${country})`);
      attempts.push(
        art
          ? `itunes (${country}) → "${match.collectionName ?? match.trackName}" ✓`
          : `itunes (${country}) → matched but artwork download failed`,
      );
      if (art) return art;
    } catch (err) {
      attempts.push(`itunes (${country}) → ${err instanceof Error ? err.message : "error"}`);
    }
  }
  return null;
}

interface MbRecording {
  score?: number;
  releases?: { id: string; title?: string }[];
}

async function fromCoverArtArchive(
  artist: string,
  title: string,
  attempts: string[],
): Promise<ArtworkResult | null> {
  const query = `recording:"${title}" AND artist:"${artist}"`;
  const url = `${musicbrainzBase()}/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=5`;
  try {
    const res = await providerFetch(url);
    if (!res.ok) {
      attempts.push(`musicbrainz → ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { recordings?: MbRecording[] };
    // Releases across the top-scored recordings, best matches first.
    const releases = (body.recordings ?? []).flatMap((r) => r.releases ?? []).slice(0, 6);
    if (releases.length === 0) {
      attempts.push("musicbrainz → no releases found");
      return null;
    }
    for (const release of releases) {
      // 307-redirects to the Internet Archive when art exists; 404 when not.
      const art = await download(
        `${coverartBase()}/release/${release.id}/front-500`,
        "coverartarchive",
      ).catch(() => null);
      if (art) {
        attempts.push(`coverartarchive → "${release.title ?? release.id}" ✓`);
        return art;
      }
    }
    attempts.push(`coverartarchive → no front cover on ${releases.length} releases`);
    return null;
  } catch (err) {
    attempts.push(`musicbrainz → ${err instanceof Error ? err.message : "error"}`);
    return null;
  }
}

/**
 * Find one cover image: label catalogues first, community archive for the
 * long tail. Never throws — art is a garnish, and an outage or miss must not
 * fail an ingest. The attempts log lands in the per-song report.
 */
export async function findArtwork(
  artist: string,
  title: string,
): Promise<{ art: ArtworkResult | null; report: ArtworkReport }> {
  const attempts: string[] = [];
  const art =
    (await fromItunes(artist, title, attempts)) ??
    (await fromCoverArtArchive(artist, title, attempts));
  return { art, report: { used: art !== null, source: art?.source ?? null, attempts } };
}
