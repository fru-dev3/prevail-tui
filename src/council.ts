/**
 * Council — now orchestrated by the ENGINE.
 *
 * The engine ships `prevail council run --domain X --json`: it fans the prompt
 * across the configured panel in parallel, has a chair synthesize one verdict,
 * supports quorum (a stuck panelist can't block the verdict), and persists the
 * verdict to <domain>/_decisions.jsonl so the council learns. All three
 * frontends (cli cockpit, desktop, this TUI) now share that one orchestrator.
 *
 * This module is a thin adapter: it reads the NDJSON CouncilEvent stream and
 * fans the events out to the caller's callbacks, then returns the assembled
 * result. (Previously this file reproduced the whole fan-out client-side.)
 */
import type { CliKind, CouncilEvent } from "./contract.ts";
import { type EngineOpts, streamCouncil } from "./engine.ts";

export interface CouncilPanelLive {
  idx: number;
  cli: string;
  model: string;
  lens: string | null;
  text: string;
  ok?: boolean;
  ms?: number;
}

export interface CouncilResult {
  panel: CouncilPanelLive[];
  verdict: string;
  chairLabel: string;
  degraded: boolean;
  decisionId?: string;
  error?: string;
}

export interface CouncilArgs {
  domain: string;
  prompt: string;
  quorum?: number;
  lens?: string | null;
  framework?: string | null;
  clis?: CliKind[];
  localOnly?: boolean;
  /** the engine resolved the panel — one entry per panelist, by stream index */
  onPanel?: (panelists: { idx: number; cli: string; model: string; lens: string | null }[]) => void;
  /** a panelist streamed a token */
  onPanelChunk?: (idx: number, delta: string) => void;
  /** a panelist settled (ok or failed/aborted) */
  onPanelDone?: (idx: number, ok: boolean, ms: number) => void;
  /** the chair began synthesizing */
  onChair?: (chair: string) => void;
  /** the chair streamed a verdict token */
  onVerdictChunk?: (delta: string) => void;
  /** the verdict was persisted — id keys council feedback */
  onDecision?: (id: string) => void;
}

export async function runCouncil(args: CouncilArgs, opts?: EngineOpts): Promise<CouncilResult> {
  const panel: Record<number, CouncilPanelLive> = {};
  let verdict = "";
  let chairLabel = "";
  let degraded = false;
  let decisionId: string | undefined;
  let error: string | undefined;

  const onEvent = (e: CouncilEvent) => {
    switch (e.type) {
      case "panel":
        if (e.panelists) {
          for (const p of e.panelists) panel[p.idx] = { ...p, text: "" };
          args.onPanel?.(e.panelists);
        }
        break;
      case "delta":
        if (typeof e.idx === "number" && e.text) {
          let p = panel[e.idx];
          if (!p) {
            p = { idx: e.idx, cli: "?", model: "", lens: null, text: "" };
            panel[e.idx] = p;
          }
          p.text += e.text;
          args.onPanelChunk?.(e.idx, e.text);
        }
        break;
      case "panelist":
        if (typeof e.idx === "number") {
          const p = panel[e.idx];
          if (p) {
            p.ok = e.ok;
            p.ms = e.ms;
          }
          args.onPanelDone?.(e.idx, !!e.ok, e.ms ?? 0);
        }
        break;
      case "chair":
        chairLabel = e.chair ?? "";
        args.onChair?.(chairLabel);
        break;
      case "verdict-delta":
        if (e.text) {
          verdict += e.text;
          args.onVerdictChunk?.(e.text);
        }
        break;
      case "verdict":
        if (e.text) verdict = e.text;
        chairLabel = e.chairLabel ?? chairLabel;
        degraded = !!e.degraded;
        break;
      case "decision":
        decisionId = e.id;
        if (e.id) args.onDecision?.(e.id);
        break;
      case "error":
        error = e.error ?? "council failed";
        break;
    }
  };

  try {
    await streamCouncil(
      {
        domain: args.domain,
        message: args.prompt,
        quorum: args.quorum,
        lens: args.lens ?? undefined,
        framework: args.framework ?? undefined,
        clis: args.clis,
        localOnly: args.localOnly,
      },
      onEvent,
      opts,
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const panelArr = Object.values(panel).sort((a, b) => a.idx - b.idx);
  return { panel: panelArr, verdict, chairLabel, degraded, decisionId, error };
}
