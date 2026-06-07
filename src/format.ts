/**
 * Pure presentation helpers — no engine or React deps. Kept separate so the
 * views stay declarative and these stay unit-testable.
 */
import type { Severity } from "./contract.ts";
import { theme } from "./theme.ts";

// ── Paths & time ─────────────────────────────────────────────────────────────
export function shortenPath(p: string): string {
  const home = process.env.HOME ?? "";
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** "3d ago", "2h ago", "just now" — from an epoch-ms timestamp (or null). */
export function relativeTime(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

/** Parse the engine's ISO `computed_at`/`audited_at` to epoch ms (null-safe). */
export function isoToMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

// ── Scores ───────────────────────────────────────────────────────────────────
/** Color a 0–100 score: red < 40, amber < 70, green ≥ 70. */
export function scoreColor(score: number): string {
  if (score >= 70) return theme.ok;
  if (score >= 40) return theme.warn;
  return theme.err;
}

/** A fixed-width bar like "████████░░" for a 0–100 value. */
export function bar(value: number, width = 10): string {
  const filled = Math.round((Math.max(0, Math.min(100, value)) / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** A compact unicode sparkline from a series of 0–100 scores. */
export function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const ticks = "▁▂▃▄▅▆▇█";
  return values.map((v) => ticks[Math.max(0, Math.min(7, Math.round((v / 100) * 7)))]).join("");
}

// ── Severity ─────────────────────────────────────────────────────────────────
export function severityColor(sev: Severity | undefined): string {
  switch (sev) {
    case "critical":
      return theme.err;
    case "warn":
      return theme.warn;
    default:
      return theme.fgDim;
  }
}

export function severityGlyph(sev: Severity | undefined): string {
  switch (sev) {
    case "critical":
      return "▲";
    case "warn":
      return "◆";
    default:
      return "·";
  }
}

// ── Misc ─────────────────────────────────────────────────────────────────────
/** Title-case a domain key for display when no manifest label exists. */
export function titleCase(s: string): string {
  return s.replace(/(^|[-_\s])(\w)/g, (_, sep, ch) => (sep ? " " : "") + ch.toUpperCase());
}
