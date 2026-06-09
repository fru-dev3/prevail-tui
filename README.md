# prevail-tui

[![ci](https://github.com/fru-dev3/prevail-tui/actions/workflows/ci.yml/badge.svg)](https://github.com/fru-dev3/prevail-tui/actions/workflows/ci.yml)

A terminal cockpit for the **prevail** engine — built as a **thin subprocess
client** of the `prevail … --json` / NDJSON contract.

This is the same decoupled architecture the **desktop app** uses
(`fd-apps-prevail-desktop` → `src-tauri/src/engine.rs`): the engine
(`fd-apps-prevail-cli`) is the single source of truth, and every frontend
drives it over the JSON contract rather than importing it in-process.

```
                 ┌─────────────────────────────┐
                 │   prevail (engine + CLI)     │   fd-apps-prevail-cli
                 │   `prevail … --json` / NDJSON │   (do not edit here)
                 └──────────────┬──────────────┘
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
     prevail (cmds)     desktop (Tauri)       prevail-tui   ◄── this repo
                       engine.rs seam      engine.ts seam
```

> **Why not import the engine in-process** (like the original cockpit does)?
> Decoupling matches the desktop, keeps the engine the single contract owner,
> and means a TUI can be rewritten in any language later. The cost is one
> subprocess hop per call — negligible for a cockpit.

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- The `prevail` binary installed and on PATH (or in `~/.local/bin`,
  `~/.bun/bin`, `/opt/homebrew/bin`). Build it from `fd-apps-prevail-cli`.

## Run

```bash
bun install
bun run dev                 # uses ~/.prevail/config.json's vaultPath
bun run dev -- --vault /path/to/vault
bun run build               # → dist/prevail-tui (single binary, bun --compile)
```

## What it does

A six-tab cockpit over every life domain in the vault:

- **Sidebar** — all domains with a color-coded readiness **score badge** and
  open-loop count; the streaming domain is marked. Header shows the
  **life-readiness** aggregate, a live clock, the vault path, and a **Bunker**
  chip when local-only mode is on.
- **Chat** — streaming chat (NDJSON). With Council on (or `/council <q>`), the
  turn fans out to the engine's council. Engine label, `↑/↓` recall, slash
  commands, and a config bar (web/save/serendipity/auto + framework/lens) that
  **persists to the engine**.
- **Insights** — the engine's proactive **surface** (questions + next actions,
  `a` to (re)generate), the **decision log** with the `↑/↓` feedback the council
  learns from, and the domain's distilled **long-term memory**.
- **Score** — the headline score, the six breakdown dimensions as bars with
  their detail, the domain **relevance** rubric, surfaced gaps by severity,
  and the cached LLM assessment. `a` runs a fresh `score --audit`.
- **State** — read-only vault markdown (`state.md`/`_state.md` + open-loops).
- **Manifest** — identity + config; `e`/`m` edit label/summary inline.
- **History** — sparkline of `score history` + delta + recent samples.

### Keys

| Context | Keys |
|---------|------|
| Sidebar | `↑/↓` (or `j/k`) domain · `g/G` first/last · `←/→` (or `tab`, `1`–`6`) switch tab · `i`/`⏎` focus chat · `a` audit (score) / surface (insights) · `e`/`m` edit label/summary (manifest) · `r` refresh · `q` quit |
| Chat | type · `⏎` send · `↑/↓` recall · `esc` → domains |
| Manifest edit | `⏎` save · `esc` cancel |

Slash commands: `/council <q>` · `/quorum <n\|off>` · `/feedback up\|down [note]` ·
`/bunker on\|off` · `/search <text>` · `/insights` · `/surface` · `/score` ·
`/audit` · `/state` · `/manifest` · `/history` · `/clear` · `/help` · `/exit`.
`ctrl+c` quits from anywhere.

## Architecture

| File | Role |
|------|------|
| `src/contract.ts` | Typed mirror of the engine's `--json`/NDJSON shapes (see `fd-apps-prevail-cli/docs/schemas`). |
| `src/engine.ts` | **The only seam to the engine.** Binary resolution + env enrichment + `runJson()` (request/response) + `streamChat()` (NDJSON). Ported from the desktop's `engine.rs`. |
| `src/council.ts` | Thin adapter over the engine's `council run --json` NDJSON stream (panel + chair + quorum + persisted decision). The engine owns the fan-out. |
| `src/format.ts` | Pure presentation helpers: score color, bars, sparkline, relative time, severity. |
| `src/sidebar.tsx` | Header banner + life-domains sidebar. |
| `src/panes.tsx` | Insights / Score / State / Manifest / History detail panes. |
| `src/chat.tsx` | Chat transcript + message rows + input. |
| `src/app.tsx` | OpenTUI + React orchestrator: layout, tabs, state, keyboard. |
| `src/index.tsx` | Entry: resolve vault, prefetch `score --all`, load domains, boot the renderer. |

### Contract used (engine v1.7.0+)

Request/response `--json`: `domains`, `score [--audit]`, `score --all`,
`score history`, `manifest get/set`, `onboard recommend/apply`, `vault …`,
`heartbeat …`, `gateway status`, and the v1.7.0 additions —
`council feedback`, `decisions list`, `memory read`, `surface`,
`frameworks/lenses list`, `modes get/set`, `privacy get/set`, `search`,
`bench list`, `connectors list`. Failure envelope: `{ ok:false, error, code }`.

Streaming (NDJSON, message on stdin):
- `chat --domain <d> --json`: `start → user → delta* → assistant → usage → done`.
- `council run --domain <d> --json`: `start → panel → delta* → panelist* →
  chair → verdict-delta* → verdict → decision → done` (or `error`).

## Engine seam

Everything goes through `src/engine.ts` — the only place this TUI talks to the
`prevail` binary, the same decoupled architecture the desktop uses (`engine.rs`).
The engine (v1.7.0+) now owns council orchestration, the decision log, surface,
modes, privacy, and search, so the TUI carries **no** business logic of its own —
it reads and writes the same `--json` contract the desktop does, against the
same vault files.

## Status

Full working cockpit driven entirely over the `--json` contract: domains
sidebar with live score badges + life-readiness aggregate, streaming chat,
**engine-driven council** (quorum + verdict feedback), the **Insights** tab
(surface + decision log + long-term memory), per-domain **modes** and global
**Bunker** that persist to the engine, framework/lens, and Score / State /
Manifest / History detail tabs. Not yet surfaced: a dedicated benchmark page
and the onboarding wizard (the engine exposes `bench list` / `onboard` for both).
