/**
 * The prevail engine's --json / NDJSON contract, typed.
 *
 * These shapes mirror the CLI's frozen contract (see the prevail-cli repo:
 * docs/schemas/*.json and docs/ENGINE-JSON-API.md). This TUI is a thin
 * subprocess client of that contract — the SAME seam the desktop app uses
 * (src-tauri/src/engine.rs). We never import the engine in-process.
 *
 * Source of truth (read-only reference, do not edit that repo):
 *   fd-apps-prevail-cli/src/chat-json.ts        -> ChatEvent
 *   fd-apps-prevail-cli/docs/schemas/*.json     -> the rest
 */

// ─────────────────────────────────────────────────────────────────────────────
// Error envelope — every --json command emits this shape on failure.
export interface JsonError {
  ok: false;
  error: string;
  code: string;
}

export function isJsonError(v: unknown): v is JsonError {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { ok?: unknown }).ok === false &&
    typeof (v as { error?: unknown }).error === "string"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// chat --domain <d> --json  →  NDJSON stream of ChatEvent
// (single-CLI today; council is orchestrated client-side, see council.ts)
export type ChatEventType =
  | "start"
  | "user"
  | "delta"
  | "assistant"
  | "tool"
  | "usage"
  | "error"
  | "done";

export interface ChatUsage {
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
}

export interface ChatEvent {
  type: ChatEventType;
  thread: string;
  ts: number;
  domain?: string;
  role?: "user" | "assistant" | "system" | "tool";
  /** full text on assistant/user; an incremental chunk on delta */
  text?: string;
  tool?: { name?: string; input?: unknown; output?: unknown };
  usage?: ChatUsage;
  /** e.g. "claude:opus-4-8" — present on start/assistant */
  engine?: string;
  error?: string;
}

export interface ChatRequest {
  domain: string;
  message: string;
  cli?: CliKind;
  model?: string;
  /** resume an existing thread; omit to start a new one */
  session?: string;
  localOnly?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// domains --json
export interface DomainSummary {
  name: string;
  path: string;
  hasState: boolean;
  openLoopCount: number;
  stateMtime: number | null;
  summary?: string;
  label?: string;
  emoji?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// score <domain> [--audit] --json  →  ContextScore
export interface MissingItem {
  label: string;
  severity?: "low" | "medium" | "high" | string;
  kind?: string;
}

export interface ContextScore {
  domain: string;
  score: number;
  breakdown?: Record<string, number>;
  relevance?: number;
  missing?: MissingItem[];
  assessment?: string | null;
  audit_source?: string | null;
  ts?: number;
}

// score --all --json
export interface LifeScore {
  lifeReadiness: number;
  domains: ContextScore[];
}

// score history <domain> --json
export type ScoreHistory = Array<{ ts: number; score: number }>;

// ─────────────────────────────────────────────────────────────────────────────
// manifest get/set <domain> --json  →  DomainManifest (loose; CLI may add fields)
export interface DomainManifest {
  name?: string;
  label?: string;
  emoji?: string;
  summary?: string;
  archived?: boolean;
  archived_at?: string | null;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine CLIs the prevail binary can drive.
export type CliKind = "claude" | "codex" | "antigravity" | "gemini" | "ollama";
