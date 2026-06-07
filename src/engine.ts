/**
 * Engine seam — the ONLY place this TUI talks to the prevail engine.
 *
 * Mirrors the desktop app's integration (fd-apps-prevail-desktop:
 * src-tauri/src/engine.rs): resolve the `prevail` binary, enrich the
 * environment so model CLIs are findable, then drive the engine purely
 * through its `--json` (request/response) and NDJSON (streaming chat)
 * contract. No in-process import of the engine — same decoupled
 * architecture the desktop uses, so all three frontends (cli, desktop,
 * tui) share one engine surface.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type ChatEvent,
  type ChatRequest,
  type ContextScore,
  type DomainManifest,
  type DomainSummary,
  type JsonError,
  type LifeScore,
  type ManifestPatch,
  type ScoreHistory,
  isJsonError,
} from "./contract.ts";

// ── Binary resolution ────────────────────────────────────────────────────────
// Same precedence as engine.rs: well-known install dirs first, then PATH.
function candidateBins(): string[] {
  const home = homedir();
  return [
    join(home, ".local/bin/prevail"),
    join(home, ".bun/bin/prevail"),
    "/opt/homebrew/bin/prevail",
    "/usr/local/bin/prevail",
    "/usr/bin/prevail",
    "prevail", // fall back to PATH resolution
  ];
}

let cachedBin: string | null = null;
export function resolvePrevailBin(): string {
  if (cachedBin) return cachedBin;
  for (const c of candidateBins()) {
    if (c === "prevail" || existsSync(c)) {
      cachedBin = c;
      return c;
    }
  }
  cachedBin = "prevail";
  return cachedBin;
}

// ── Environment enrichment ───────────────────────────────────────────────────
// GUI/launchd-spawned processes get a minimal PATH; terminals are usually fine,
// but we enrich anyway so the engine can always find claude/codex/agy/ollama,
// and we set USER/LOGNAME (claude CLI needs them to find Keychain creds).
function buildEnv(): Record<string, string> {
  const home = homedir();
  const extra = [
    join(home, ".local/bin"),
    join(home, ".bun/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].join(":");
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  env.PATH = `${extra}:${env.PATH ?? ""}`;
  if (!env.USER) env.USER = home.split("/").pop() ?? "user";
  if (!env.LOGNAME) env.LOGNAME = env.USER;
  return env;
}

// ── Low-level invokers ───────────────────────────────────────────────────────
export interface EngineOpts {
  /** Vault root; passed as `--vault <path>` when set. */
  vault?: string;
  signal?: AbortSignal;
}

function baseArgs(opts: EngineOpts | undefined, rest: string[]): string[] {
  const args: string[] = [];
  if (opts?.vault) args.push("--vault", opts.vault);
  args.push(...rest);
  return args;
}

export class EngineError extends Error {
  code: string;
  constructor(message: string, code = "ENGINE_ERROR") {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

/** Run a `--json` command that returns a single JSON value on stdout. */
export async function runJson<T>(args: string[], opts?: EngineOpts, stdin?: string): Promise<T> {
  const proc = Bun.spawn([resolvePrevailBin(), ...baseArgs(opts, args)], {
    stdin: stdin !== undefined ? new TextEncoder().encode(stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: buildEnv(),
    signal: opts?.signal,
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const trimmed = out.trim();
  if (!trimmed) {
    throw new EngineError(err.trim() || `prevail exited ${code} with no output`, "NO_OUTPUT");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new EngineError(`prevail returned non-JSON: ${trimmed.slice(0, 200)}`, "BAD_JSON");
  }
  if (isJsonError(parsed)) {
    throw new EngineError((parsed as JsonError).error, (parsed as JsonError).code);
  }
  return parsed as T;
}

// ── Typed command wrappers ───────────────────────────────────────────────────
export function listDomains(opts?: EngineOpts): Promise<DomainSummary[]> {
  return runJson<DomainSummary[]>(["domains", "--json"], opts);
}

export function scoreDomain(
  domain: string,
  audit = false,
  opts?: EngineOpts,
): Promise<ContextScore> {
  const args = ["score", domain];
  if (audit) args.push("--audit");
  args.push("--json");
  return runJson<ContextScore>(args, opts);
}

export function scoreAll(opts?: EngineOpts): Promise<LifeScore> {
  return runJson<LifeScore>(["score", "--all", "--json"], opts);
}

export function scoreHistory(domain: string, opts?: EngineOpts): Promise<ScoreHistory> {
  return runJson<ScoreHistory>(["score", "history", domain, "--json"], opts);
}

export function getManifest(domain: string, opts?: EngineOpts): Promise<DomainManifest> {
  return runJson<DomainManifest>(["manifest", "get", domain, "--json"], opts);
}

export function setManifest(
  domain: string,
  patch: ManifestPatch,
  opts?: EngineOpts,
): Promise<DomainManifest> {
  return runJson<DomainManifest>(
    ["manifest", "set", domain, "--json"],
    opts,
    JSON.stringify(patch),
  );
}

// ── Streaming chat (NDJSON) ──────────────────────────────────────────────────
/**
 * Drive a single-CLI chat turn. The message is written to stdin; each NDJSON
 * line on stdout is parsed into a ChatEvent and handed to `onEvent`. Resolves
 * when the process exits.
 *
 * Council mode is built ON TOP of this (see council.ts) by fanning out one
 * streamChat per panelist plus a synthesis turn — the CLI's `chat --json`
 * path is single-CLI only today.
 */
export async function streamChat(
  req: ChatRequest,
  onEvent: (e: ChatEvent) => void,
  opts?: EngineOpts,
): Promise<number> {
  const args = ["chat", "--domain", req.domain];
  if (req.cli) args.push("--cli", req.cli);
  if (req.model) args.push("--model", req.model);
  if (req.session) args.push("--session", req.session);
  if (req.localOnly) args.push("--local-only");
  args.push("--json");

  const proc = Bun.spawn([resolvePrevailBin(), ...baseArgs(opts, args)], {
    stdin: new TextEncoder().encode(req.message),
    stdout: "pipe",
    stderr: "pipe",
    env: buildEnv(),
    signal: opts?.signal,
  });

  const decoder = new TextDecoder();
  let buf = "";
  const pump = (chunk: string) => {
    buf += chunk;
    let nl = buf.indexOf("\n");
    while (nl !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line) as ChatEvent);
        } catch {
          // ignore malformed lines (e.g. stray logging)
        }
      }
      nl = buf.indexOf("\n");
    }
  };

  // @ts-expect-error Bun's ReadableStream is async-iterable at runtime.
  for await (const bytes of proc.stdout) {
    pump(decoder.decode(bytes as Uint8Array, { stream: true }));
  }
  if (buf.trim()) pump(`${buf}\n`);

  const code = await proc.exited;
  return code;
}
