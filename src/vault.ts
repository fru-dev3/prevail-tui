/**
 * Read-only vault reads.
 *
 * The engine's `--json` contract doesn't expose a domain's markdown body yet
 * (state / open-loops), so — exactly like the README gap table says — this TUI
 * reads those files straight off disk, read-only. It NEVER writes here: every
 * mutation still goes through the engine seam (engine.ts). When the CLI ships
 * `prevail domain <d> view <v> --json`, swap this for that call.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type DomainDocKind = "state" | "openloops";

// Candidate filenames per doc, in precedence order. Covers both the v1 layout
// (state.md / open-loops.md) and the v2 layout (_state.md / _tasks.md).
const CANDIDATES: Record<DomainDocKind, string[]> = {
  state: ["state.md", "_state.md", "soul.md"],
  openloops: ["open-loops.md", "_tasks.md"],
};

export interface DomainDocs {
  state: string | null;
  openloops: string | null;
}

async function readFirst(domainPath: string, names: string[]): Promise<string | null> {
  for (const name of names) {
    try {
      const text = await readFile(join(domainPath, name), "utf8");
      if (text.trim()) return text;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Read a single domain doc by kind, or null if none of its candidates exist. */
export function readDomainDoc(domainPath: string, kind: DomainDocKind): Promise<string | null> {
  return readFirst(domainPath, CANDIDATES[kind]);
}

/** Read the docs the State tab needs in one shot. */
export async function readDomainDocs(domainPath: string): Promise<DomainDocs> {
  const [state, openloops] = await Promise.all([
    readDomainDoc(domainPath, "state"),
    readDomainDoc(domainPath, "openloops"),
  ]);
  return { state, openloops };
}

/**
 * Pull a few starter-prompt titles from PROMPTS.md to seed an empty chat.
 * Entries look like `1. **Morning Daily Brief:** "…"`, so we lift the bold
 * label before the colon. Returns [] if there's no PROMPTS.md.
 */
export async function readDomainPrompts(domainPath: string, limit = 4): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(join(domainPath, "PROMPTS.md"), "utf8");
  } catch {
    return [];
  }
  const titles: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*\d+\.\s+\*\*(.+?):\*\*/);
    if (m) {
      titles.push(m[1].trim());
      if (titles.length >= limit) break;
    }
  }
  return titles;
}
