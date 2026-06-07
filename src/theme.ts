// prevAIl brand palette (mirrors the cockpit). The accent reads yellow here.
export const theme = {
  gold: "#E6C229", // primary accent (cursor, headings, active) — yellow
  goldDim: "#8A7A2E", // muted accent (badges, dim labels)
  goldBright: "#FFE680", // emphasis
  ai: "#7AA2F7", // the "AI" blue in the wordmark
  bg: "#0A0A0C",
  bgPanel: "#161616",
  fg: "#E6E6E6",
  fgDim: "#9A9A9A",
  fgFaint: "#5A5A5A",
  selBg: "#2A2418",
  selFg: "#F2E2B6",
  border: "#3A3A3A",
  borderFocus: "#E6C229",
  ok: "#7BC47F", // green — healthy scores, present items
  warn: "#E0A33C", // amber — mid scores, warn severity
  err: "#E06C75", // red — low scores, critical severity
  assistant: "#8FB7CF", // slate — assistant message tag
} as const;
