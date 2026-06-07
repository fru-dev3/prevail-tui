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

A four-tab cockpit over every life domain in the vault:

- **Sidebar** — all domains with a color-coded readiness **score badge** and
  open-loop count; the streaming domain is marked. Header shows the
  **life-readiness** aggregate, a live clock, and the vault path.
- **Chat** — streaming single-CLI chat (NDJSON), engine label, `↑/↓` prompt
  recall, and slash commands.
- **Score** — the headline score, the six breakdown dimensions as bars with
  their detail, the domain **relevance** rubric, surfaced gaps by severity,
  and the cached LLM assessment. `a` runs a fresh `score --audit`.
- **Manifest** — identity + config; `e`/`m` edit label/summary inline.
- **History** — sparkline of `score history` + delta + recent samples.

### Keys

| Context | Keys |
|---------|------|
| Sidebar | `↑/↓` (or `j/k`) domain · `g/G` first/last · `←/→` (or `tab`, `1`–`4`) switch tab · `i`/`⏎` focus chat · `a` audit (score tab) · `e`/`m` edit label/summary (manifest tab) · `r` refresh · `q` quit |
| Chat | type · `⏎` send · `↑/↓` recall · `esc` → domains |
| Manifest edit | `⏎` save · `esc` cancel |

Slash commands: `/council <q>` · `/score` · `/audit` · `/manifest` ·
`/history` · `/clear` · `/help` · `/exit`. `ctrl+c` quits from anywhere.

## Architecture

| File | Role |
|------|------|
| `src/contract.ts` | Typed mirror of the engine's `--json`/NDJSON shapes (see `fd-apps-prevail-cli/docs/schemas`). |
| `src/engine.ts` | **The only seam to the engine.** Binary resolution + env enrichment + `runJson()` (request/response) + `streamChat()` (NDJSON). Ported from the desktop's `engine.rs`. |
| `src/council.ts` | Client-side council: fans one prompt to N panelists via `streamChat`, then a chair synthesis turn. |
| `src/format.ts` | Pure presentation helpers: score color, bars, sparkline, relative time, severity. |
| `src/sidebar.tsx` | Header banner + life-domains sidebar. |
| `src/panes.tsx` | Score / Manifest / History detail panes. |
| `src/chat.tsx` | Chat transcript + message rows + input. |
| `src/app.tsx` | OpenTUI + React orchestrator: layout, tabs, state, keyboard. |
| `src/index.tsx` | Entry: resolve vault, prefetch `score --all`, load domains, boot the renderer. |

### Contract used today (read-only audit of the CLI)

Request/response `--json`: `domains`, `score [--audit]`, `score --all`,
`score history`, `manifest get/set`, `onboard recommend/apply`, `vault …`,
`heartbeat …`, `gateway status`. Failure envelope: `{ ok:false, error, code }`.

Streaming `chat --domain <d> --json` (NDJSON, message on stdin):
`start → user → delta* → assistant → usage → done` (or `error`).

## Gaps (engine work, owned by the CLI repo — not done here)

The cockpit needs a few things the `--json` contract does **not** expose yet.
This TUI works around each one client-side for now; when the engine ships the
endpoint, swap the workaround for the real call.

| Need | Engine status | This TUI's stopgap |
|------|---------------|--------------------|
| **Council streaming** (per-panelist deltas + chair verdict + disagreement) | in-process only (`runCouncilOneShot`) | `src/council.ts` fans out N single-CLI `chat --json` calls + a synthesis turn |
| **Domain markdown views** (state / quickstart / prompts / skills) | read off disk | (planned) read the vault markdown directly, read-only |
| **Frameworks / lenses** list+select | hardcoded in binary; no flag on `chat --json` | (planned) prepend the framework/lens preamble to the message client-side |
| **Session history / full-text search** | no `--json` surface | (planned) read `_threads/*.jsonl` from the vault directly |
| **CLI/model detection** | human-only `doctor` | (planned) probe, or add `prevail clis --json` upstream |

**Recommended upstream additions** (for whoever owns the CLI): a real
`prevail council --domain <d> --json` NDJSON stream (panelist-tagged deltas +
verdict), `prevail domain <d> view <v> --json`, and `prevail clis --json`.
Those would let this TUI drop every stopgap above.

## Status

Working cockpit: domains sidebar with live score badges + life-readiness
aggregate, streaming single-CLI chat, client-side council, and Score /
Manifest / History detail tabs — all driven over the `--json` contract.
Not yet implemented: domain markdown views (state/quickstart/prompts/skills),
benchmark overlay, session history, framework/lens pickers, onboarding
wizard. See the gap table.
