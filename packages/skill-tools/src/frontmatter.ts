/**
 * Minimal YAML-frontmatter reader for SKILL.md files. SKILL.md frontmatter is
 * intentionally simple (scalars + the occasional list), so we parse just enough
 * to validate it without pulling in a YAML dependency.
 */

export interface Frontmatter {
  data: Record<string, string | string[]>;
  body: string;
}

const stripQuotes = (s: string): string => {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
};

/**
 * Split a `---`-delimited frontmatter block from a markdown document. Returns
 * `data: {}` when no frontmatter is present.
 */
export function parseFrontmatter(content: string): Frontmatter {
  const normalized = content.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(normalized);
  if (!match) return { data: {}, body: normalized };

  const data: Record<string, string | string[]> = {};
  let currentKey: string | null = null;

  for (const rawLine of match[1]!.split(/\r?\n/)) {
    if (rawLine.trim() === "" || rawLine.trim().startsWith("#")) continue;

    // List item belonging to the previous key (`  - value`).
    const listItem = /^\s*-\s+(.*)$/.exec(rawLine);
    if (listItem && currentKey) {
      const arr = Array.isArray(data[currentKey]) ? (data[currentKey] as string[]) : [];
      arr.push(stripQuotes(listItem[1]!));
      data[currentKey] = arr;
      continue;
    }

    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(rawLine);
    if (kv) {
      currentKey = kv[1]!;
      const value = kv[2]!;
      // `key:` with no inline value introduces a list (or block) for `key`.
      data[currentKey] = value.trim() === "" ? [] : stripQuotes(value);
    }
  }

  return { data, body: match[2] ?? "" };
}

/** Coerce a frontmatter value to a single string (first item of a list). */
export function asString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}
