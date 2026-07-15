/**
 * Minimal ID3 tag reader — just enough to prefill title/artist/album from a
 * dropped MP3 without pulling in a metadata library. Handles ID3v2.3/2.4 text
 * frames (TIT2/TPE1/TALB) and falls back to the ID3v1 trailer.
 */

export interface Id3Tags {
  title?: string;
  artist?: string;
  album?: string;
}

function syncsafe(view: DataView, offset: number): number {
  return (
    ((view.getUint8(offset) & 0x7f) << 21) |
    ((view.getUint8(offset + 1) & 0x7f) << 14) |
    ((view.getUint8(offset + 2) & 0x7f) << 7) |
    (view.getUint8(offset + 3) & 0x7f)
  );
}

function decodeText(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const encoding = bytes[0];
  const body = bytes.subarray(1);
  let label: string;
  if (encoding === 0) label = "latin1";
  else if (encoding === 1)
    label = "utf-16"; // BOM decides endianness
  else if (encoding === 2) label = "utf-16be";
  else label = "utf-8";
  try {
    return new TextDecoder(label).decode(body).replace(/\0+$/, "").trim();
  } catch {
    return "";
  }
}

function readId3v1(buffer: ArrayBuffer): Id3Tags {
  if (buffer.byteLength < 128) return {};
  const trailer = new Uint8Array(buffer, buffer.byteLength - 128, 128);
  if (trailer[0] !== 0x54 || trailer[1] !== 0x41 || trailer[2] !== 0x47) return {}; // "TAG"
  const latin1 = new TextDecoder("latin1");
  const field = (start: number, len: number) =>
    latin1
      .decode(trailer.subarray(start, start + len))
      .replace(/\0.*$/, "")
      .trim();
  const tags: Id3Tags = {};
  const title = field(3, 30);
  const artist = field(33, 30);
  const album = field(63, 30);
  if (title) tags.title = title;
  if (artist) tags.artist = artist;
  if (album) tags.album = album;
  return tags;
}

export function readId3(buffer: ArrayBuffer): Id3Tags {
  const view = new DataView(buffer);
  if (
    buffer.byteLength < 10 ||
    view.getUint8(0) !== 0x49 || // "I"
    view.getUint8(1) !== 0x44 || // "D"
    view.getUint8(2) !== 0x33 // "3"
  ) {
    return readId3v1(buffer);
  }
  const major = view.getUint8(3);
  const flags = view.getUint8(5);
  const tagSize = syncsafe(view, 6);
  let offset = 10;
  if (flags & 0x40) offset += (major === 4 ? syncsafe(view, 10) : view.getUint32(10)) + 4; // extended header
  const end = Math.min(10 + tagSize, buffer.byteLength);
  const tags: Id3Tags = {};
  const wanted: Record<string, keyof Id3Tags> = { TIT2: "title", TPE1: "artist", TALB: "album" };
  while (offset + 10 <= end) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding reached
    const size = major === 4 ? syncsafe(view, offset + 4) : view.getUint32(offset + 4);
    if (size <= 0 || offset + 10 + size > end) break;
    const key = wanted[id];
    if (key && !tags[key]) {
      const text = decodeText(new Uint8Array(buffer, offset + 10, size));
      if (text) tags[key] = text;
    }
    offset += 10 + size;
    if (tags.title && tags.artist && tags.album) break;
  }
  // v2 tags may be present but empty; v1 can still fill gaps.
  const v1 = tags.title && tags.artist ? {} : readId3v1(buffer);
  return { ...v1, ...tags };
}
