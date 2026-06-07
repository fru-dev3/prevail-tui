# prevail-tui

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

Keys: `↑/↓` select domain · `tab`/`i` focus chat · `esc` back to domains ·
`/council <q>` convene the panel · `ctrl+c` quit.

## Architecture

| File | Role |
|------|------|
| `src/contract.ts` | Typed mirror of the engine's `--json`/NDJSON shapes (see `fd-apps-prevail-cli/docs/schemas`). |
| `src/engine.ts` | **The only seam to the engine.** Binary resolution + env enrichment + `runJson()` (request/response) + `streamChat()` (NDJSON). Ported from the desktop's `engine.rs`. |
| `src/council.ts` | Client-side council: fans one prompt to N panelists via `streamChat`, then a chair synthesis turn. |
| `src/app.tsx` | OpenTUI + React UI: domains sidebar + streaming chat. |
| `src/index.tsx` | Entry: resolve vault, load domains over the contract, boot the renderer. |

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
| **Domain views** (state / open-loops / quickstart / prompts / skills) | read off disk | (planned) read the vault markdown directly, read-only |
| **Frameworks / lenses** list+select | hardcoded in binary; no flag on `chat --json` | (planned) prepend the framework/lens preamble to the message client-side |
| **Session history / full-text search** | no `--json` surface | (planned) read `_threads/*.jsonl` from the vault directly |
| **CLI/model detection** | human-only `doctor` | (planned) probe, or add `prevail clis --json` upstream |

**Recommended upstream additions** (for whoever owns the CLI): a real
`prevail council --domain <d> --json` NDJSON stream (panelist-tagged deltas +
verdict), `prevail domain <d> view <v> --json`, and `prevail clis --json`.
Those would let this TUI drop every stopgap above.

## Status

v0.1 — wiring + domains sidebar + streaming single-CLI chat + client-side
council. Not yet implemented: domain-view tabs, benchmark overlay, session
history, framework/lens pickers, onboarding wizard. See the gap table.
