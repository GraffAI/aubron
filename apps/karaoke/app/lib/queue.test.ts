import { describe, expect, it } from "vitest";

import { addEntry, moveEntry, removeEntry, setSinger, type QueueEntry } from "./queue";

const song = (n: number) => ({ id: `song-${n}`, title: `Song ${n}`, artist: "A" });

function build(n: number): QueueEntry[] {
  let list: QueueEntry[] = [];
  for (let i = 1; i <= n; i++) list = addEntry(list, song(i));
  return list;
}

describe("queue list operations", () => {
  it("appends with a fresh entry id — the same song can queue twice", () => {
    const list = addEntry(addEntry([], song(1)), song(1));
    expect(list).toHaveLength(2);
    expect(list[0]!.songId).toBe("song-1");
    expect(list[0]!.id).not.toBe(list[1]!.id);
    expect(list[0]!.singer).toBe("");
  });

  it("moves entries up and down, clamping at the edges", () => {
    const list = build(3);
    const ids = list.map((e) => e.id);
    expect(moveEntry(list, ids[2]!, -1).map((e) => e.id)).toEqual([ids[0], ids[2], ids[1]]);
    expect(moveEntry(list, ids[1]!, 1).map((e) => e.id)).toEqual([ids[0], ids[2], ids[1]]);
    // Edges and unknown ids are no-ops, not crashes.
    expect(moveEntry(list, ids[0]!, -1)).toBe(list);
    expect(moveEntry(list, ids[2]!, 1)).toBe(list);
    expect(moveEntry(list, "nope", 1)).toBe(list);
  });

  it("removes by entry id, leaving duplicates of the song alone", () => {
    const list = addEntry(addEntry([], song(1)), song(1));
    const after = removeEntry(list, list[0]!.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(list[1]!.id);
  });

  it("sets the singer on one entry only", () => {
    const list = build(2);
    const after = setSinger(list, list[1]!.id, "Alex");
    expect(after[0]!.singer).toBe("");
    expect(after[1]!.singer).toBe("Alex");
  });
});
