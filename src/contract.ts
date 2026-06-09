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
//
// Severity ladder the engine emits across missing items + relevance items.
export type Severity = "critical" | "warn" | "info" | string;

/** One of the six frozen scoring dimensions: { score 0–100, human detail }. */
export interface ScoreDimension {
  score: number;
  detail: string;
}

/** A gap the engine surfaced (a missing file, structure, config, or audit note). */
export interface MissingItem {
  label: string;
  severity?: Severity;
  /** "file" | "structure" | "config" | "audit" | … */
  kind?: string;
}

/** One expected, domain-specific item from the relevance rubric (e.g. wealth → net worth). */
export interface RelevanceItem {
  id: string;
  label: string;
  present: boolean;
  stale: boolean;
  severity?: Severity;
  detail?: string;
  recommend?: string;
}

/** The per-domain relevance layer — only populated when a rubric matched the domain. */
export interface Relevance {
  matched: string;
  score: number;
  detail?: string;
  items: RelevanceItem[];
}

export interface ContextScore {
  domain: string;
  score: number;
  /** Six frozen dimensions: coverage, density, freshness, structure, activity, config_completeness. */
  breakdown?: Record<string, ScoreDimension>;
  relevance?: Relevance | null;
  missing?: MissingItem[];
  /** LLM narrative from the last audit (may be cached even without --audit). */
  assessment?: string | null;
  /** e.g. "claude:claude-opus-4-7" — which CLI produced the assessment. */
  audit_source?: string | null;
  freshness_secs?: number;
  computed_at?: string | null;
  audited_at?: string | null;
}

// score --all --json
export interface LifeScore {
  lifeReadiness: number;
  domains: ContextScore[];
}

// score history <domain> --json
export type ScoreHistory = Array<{ ts: number; score: number }>;

// ─────────────────────────────────────────────────────────────────────────────
// manifest get/set <domain> --json  →  DomainManifest
//
// The manifest is nested (identity / config / …); `set` deep-merges a partial
// patch (e.g. {"identity":{"summary":"…"}}) and returns the merged result.
export interface ManifestIdentity {
  name?: string;
  label?: string;
  emoji?: string;
  summary?: string;
  created?: string;
}

export interface ManifestConfig {
  cli?: CliKind | string;
  model?: string;
  framework?: string | null;
  lens?: string | null;
  skills?: string[];
  autoState?: boolean;
}

export interface DomainManifest {
  schema?: number;
  identity?: ManifestIdentity;
  config?: ManifestConfig;
  context_score?: ContextScore;
  goals?: unknown;
  heartbeat?: unknown;
  routing?: unknown;
  sandbox?: unknown;
  privacy?: unknown;
  archived?: boolean;
  archived_at?: string | null;
  [key: string]: unknown;
}

/** A deep-merge patch accepted by `manifest set`. */
export interface ManifestPatch {
  identity?: Partial<ManifestIdentity>;
  config?: Partial<ManifestConfig>;
  archived?: boolean;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// council run --domain <d> --json  →  NDJSON stream of CouncilEvent
//
// The engine now owns the orchestrator (prevail-cli: src/council-json.ts). The
// panel fans out in parallel; the chair synthesizes; the verdict is persisted to
// <domain>/_decisions.jsonl so the council learns. We stream the same NDJSON the
// desktop consumes.
export type CouncilEventType =
  | "start"
  | "panel"
  | "delta"
  | "panelist"
  | "chair"
  | "verdict-delta"
  | "verdict"
  | "decision"
  | "done"
  | "error";

export interface CouncilPanelistInfo {
  idx: number;
  cli: string;
  model: string;
  lens: string | null;
}

export interface CouncilEvent {
  type: CouncilEventType;
  thread: string;
  ts: number;
  domain?: string;
  quorum?: number;
  localOnly?: boolean;
  /** present on `panel` — every panelist by stream index */
  panelists?: CouncilPanelistInfo[];
  /** present on `delta`/`panelist` — the panelist's stream index */
  idx?: number;
  /** token text on delta / verdict-delta; full verdict on `verdict` */
  text?: string;
  /** settled status on `panelist` */
  ok?: boolean;
  ms?: number;
  /** chair label on `chair`/`verdict` */
  chair?: string;
  chairLabel?: string;
  degraded?: boolean;
  /** decision id on `decision` (key for council feedback) */
  id?: string;
  error?: string;
}

export interface CouncilRunRequest {
  domain: string; // "" / "general" → General
  message: string;
  quorum?: number;
  /** lens id, "all", or null/"off" — the engine resolves config when omitted */
  lens?: string | null;
  framework?: string | null;
  clis?: CliKind[];
  localOnly?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// decisions list / council run — the persisted decision record.
export interface DecisionFeedback {
  rating: "up" | "down";
  note?: string | null;
}

export interface DecisionRecord {
  id: string;
  ts: number;
  type: string;
  domain?: string | null;
  prompt?: string;
  verdict?: string;
  chair?: string;
  panel?: { cli: string; model: string; lens: string | null; ok: boolean; ms: number }[];
  degraded?: boolean;
  source?: string;
  feedback?: DecisionFeedback;
  [key: string]: unknown;
}

// surface [<domain>] --json
export interface SurfaceResult {
  questions: string[];
  actions: string[];
  generated_at: number;
  stale: boolean;
}

// frameworks list / lenses list --json
export interface CatalogItem {
  id: string;
  label: string;
  blurb: string;
}

// modes get/set [<domain>] --json
export interface ModesState {
  domain: string;
  web: "allow" | "deny";
  save: boolean;
  serendipity: boolean;
  auto: "off" | "suggest" | "auto";
  framework: { id: string | null; scope: "domain" | "global" | "none" };
  lens: { sel: string | null; scope: "domain" | "global" | "none" };
}

// privacy get/set --json
export interface PrivacyState {
  bunker: boolean;
}

// search <query> --json
export interface SearchHit {
  domain: string;
  session_id: string;
  role: string;
  content: string;
  ts: number;
}

// bench list --json
export interface BenchQuestionInfo {
  id: string;
  domain: string;
  stakes: string;
  verifiable: boolean;
  prompt: string;
}

// connectors list --json
export interface ConnectorInfo {
  id: string;
  title: string;
  integration: string;
  path: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine CLIs the prevail binary can drive.
export type CliKind = "claude" | "codex" | "antigravity" | "gemini" | "ollama";
