"use client";

import { useEffect, useState } from "react";

/**
 * The party queue: who sings what, in what order. It lives in localStorage on
 * the device driving the screen — a karaoke queue belongs to the room, not an
 * account — and survives reloads and trips through the ingest flow.
 *
 * The player never autoplays from it. When a song ends it LOADS the head
 * entry (navigates, decodes stems, parks at 0:00) and waits: nobody wants
 * their intro rolling while they're still walking to the mic. Pressing play
 * stays a human decision.
 */

export interface QueueEntry {
  /** Entry id, not song id — the same song can be queued twice. */
  id: string;
  songId: string;
  title: string;
  artist: string;
  /** Who grabbed the mic — optional, editable in the queue panel. */
  singer: string;
}

const KEY = "aubron-karaoke-queue";
const EVENT = "aubron-karaoke-queue-changed";
/** Hand-off note to the next player page: "you were loaded by the queue". */
const UP_NEXT_KEY = "aubron-karaoke-up-next";

// ── pure list operations (unit-tested; the storage wrapper stays trivial) ──

export function addEntry(
  list: QueueEntry[],
  song: { id: string; title: string; artist: string },
): QueueEntry[] {
  return [
    ...list,
    {
      id: crypto.randomUUID(),
      songId: song.id,
      title: song.title,
      artist: song.artist,
      singer: "",
    },
  ];
}

export function removeEntry(list: QueueEntry[], entryId: string): QueueEntry[] {
  return list.filter((e) => e.id !== entryId);
}

/** Shift an entry up (-1) or down (+1); out-of-range moves are no-ops. */
export function moveEntry(list: QueueEntry[], entryId: string, delta: -1 | 1): QueueEntry[] {
  const from = list.findIndex((e) => e.id === entryId);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry!);
  return next;
}

export function setSinger(list: QueueEntry[], entryId: string, singer: string): QueueEntry[] {
  return list.map((e) => (e.id === entryId ? { ...e, singer } : e));
}

// ── storage ────────────────────────────────────────────────────────────────

function isEntry(value: unknown): value is QueueEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.songId === "string" &&
    typeof e.title === "string" &&
    typeof e.artist === "string" &&
    typeof e.singer === "string"
  );
}

export function readQueue(): QueueEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function writeQueue(list: QueueEntry[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
  // localStorage's own event only fires in OTHER tabs; poke this one too.
  window.dispatchEvent(new Event(EVENT));
}

export function updateQueue(fn: (list: QueueEntry[]) => QueueEntry[]): void {
  writeQueue(fn(readQueue()));
}

/** Take the head entry off the queue (the "song ended, who's next" call). */
export function popNext(): QueueEntry | null {
  const [head, ...rest] = readQueue();
  if (!head) return null;
  writeQueue(rest);
  return head;
}

/** Live queue for components; empty until mounted so SSR markup matches. */
export function useQueue(): QueueEntry[] {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  useEffect(() => {
    const sync = () => setEntries(readQueue());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return entries;
}

// ── the hand-off between songs ─────────────────────────────────────────────

export function stashUpNext(entry: QueueEntry): void {
  try {
    sessionStorage.setItem(
      UP_NEXT_KEY,
      JSON.stringify({ title: entry.title, singer: entry.singer }),
    );
  } catch {
    /* private mode etc. — the banner is a nicety, not a requirement */
  }
}

/** Read-and-clear: the freshly loaded player shows the banner exactly once. */
export function takeUpNext(): { title: string; singer: string } | null {
  try {
    const raw = sessionStorage.getItem(UP_NEXT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(UP_NEXT_KEY);
    const parsed = JSON.parse(raw) as { title?: unknown; singer?: unknown };
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      singer: typeof parsed.singer === "string" ? parsed.singer : "",
    };
  } catch {
    return null;
  }
}
