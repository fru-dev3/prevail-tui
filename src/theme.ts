// prevAIl brand palette — ported from the cockpit so the TUI matches it.
// Gold #C4A35A is the brand; the "AI" in the wordmark is electric cyan.
export const theme = {
  gold: "#C4A35A",
  goldDim: "#8A7340",
  goldBright: "#F5E0A8",
  // aiAccent: high-contrast electric cyan — the "AI" inside the prevAIl
  // wordmark, and the highlight on active chips.
  aiAccent: "#3CD8FF",
  aiAccentDim: "#1A9DC8",
  ai: "#3CD8FF", // alias used by older call sites
  bg: "#0E0E0E",
  bgPanel: "#161616",
  fg: "#E6E6E6",
  fgDim: "#9A9A9A",
  fgFaint: "#5A5A5A",
  accent: "#C4A35A",
  warn: "#E08A3C", // amber — mid scores, warn severity
  ok: "#7BB369", // green — healthy scores, present items
  err: "#E06C75", // red — low scores, critical severity, errors
  assistant: "#8FB7CF", // slate — assistant message tag
  selBg: "#2A2418",
  selFg: "#F2E2B6",
  border: "#3A3A3A",
  borderFocus: "#C4A35A",
  inputBorder: "#5F7A8C",
} as const;

export const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export function spinnerChar(tick: number): string {
  return SPINNER[tick % SPINNER.length] ?? "·";
}

const THINKING_WORDS = [
  "thinking",
  "pondering",
  "cogitating",
  "ruminating",
  "synthesizing",
  "deliberating",
  "percolating",
  "reasoning",
  "weighing",
  "distilling",
  "composing",
  "considering",
  "calibrating",
  "drafting",
] as const;

const WORD_TICKS = 12;

export function thinkingWord(tick: number): string {
  return THINKING_WORDS[Math.floor(tick / WORD_TICKS) % THINKING_WORDS.length] ?? "thinking";
}
