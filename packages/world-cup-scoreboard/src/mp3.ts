/**
 * Minimal MP3 surgery so we can stitch the goal horn and a synthesized line into
 * one clip in pure Node — no ffmpeg, keeping the daemon dependency-free.
 *
 * MP3 is a stream of self-describing MPEG frames, so concatenating two clips is
 * just dropping the metadata tags (which would otherwise sit mid-stream as
 * garbage) and joining the frame data. This is safe as long as the parts share a
 * sample rate and bitrate — we guarantee that by requesting the TTS as
 * `mp3_44100_128`, matching the horn (128 kbps / 44.1 kHz). A per-frame mono↔
 * stereo switch at the seam is fine; decoders read the mode from each frame.
 */

/** Decode a 4-byte ID3 "synchsafe" integer (7 bits per byte). */
function synchsafe(b: Buffer, o: number): number {
  return (b[o]! << 21) | (b[o + 1]! << 14) | (b[o + 2]! << 7) | b[o + 3]!;
}

/**
 * Strip a leading ID3v2 tag and a trailing ID3v1 tag, returning just the audio
 * frames. Leaves the buffer untouched if no tags are present.
 */
export function stripId3(buf: Buffer): Buffer {
  let start = 0;
  let end = buf.length;
  // ID3v2: "ID3" + version(2) + flags(1) + synchsafe size(4); +10 for a footer.
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const hasFooter = (buf[5]! & 0x10) !== 0;
    start = 10 + synchsafe(buf, 6) + (hasFooter ? 10 : 0);
  }
  // ID3v1: a fixed 128-byte trailer beginning with "TAG".
  if (
    end - start > 128 &&
    buf[end - 128] === 0x54 &&
    buf[end - 127] === 0x41 &&
    buf[end - 126] === 0x47
  ) {
    end -= 128;
  }
  return buf.subarray(start, end);
}

/** Concatenate MP3 clips into one playable stream (tags stripped from each). */
export function concatMp3(parts: Buffer[]): Buffer {
  return Buffer.concat(parts.map(stripId3));
}
