/**
 * Council, orchestrated client-side.
 *
 * The CLI's `chat --domain X --json` is single-CLI. The in-process cockpit has
 * a richer `runCouncilOneShot()` that the --json contract does NOT expose yet.
 * Rather than block on a CLI change (that repo is owned by another process),
 * we reproduce council at THIS layer: fan the same prompt out to each panelist
 * via streamChat, collect their replies, then run one synthesis ("chair") turn
 * that reads the panel and writes a verdict.
 *
 * When the engine later ships `prevail council --json`, swap this module's body
 * for a single streamed call — the public API here stays the same.
 */
import type { ChatEvent, CliKind } from "./contract.ts";
import { type EngineOpts, streamChat } from "./engine.ts";

export interface Panelist {
  cli: CliKind;
  model?: string;
}

export interface PanelReply {
  cli: CliKind;
  model?: string;
  text: string;
  ms: number;
  ok: boolean;
  error?: string;
}

export interface CouncilResult {
  panel: PanelReply[];
  verdict: string;
  chair: Panelist;
  degraded: boolean;
}

export interface CouncilArgs {
  domain: string;
  prompt: string;
  panelists: Panelist[];
  chair: Panelist;
  localOnly?: boolean;
  /** streamed chunk from a specific panelist (by index) */
  onPanelChunk?: (idx: number, delta: string) => void;
  /** streamed chunk from the chair's synthesis */
  onVerdictChunk?: (delta: string) => void;
}

function accumulate(onDelta?: (s: string) => void) {
  let text = "";
  const onEvent = (e: ChatEvent) => {
    if (e.type === "delta" && e.text) {
      text += e.text;
      onDelta?.(e.text);
    } else if (e.type === "assistant" && e.text) {
      // final assistant text is authoritative if no deltas were streamed
      if (!text) text = e.text;
    }
  };
  return { onEvent, get: () => text };
}

async function runPanelist(
  args: CouncilArgs,
  p: Panelist,
  idx: number,
  opts?: EngineOpts,
): Promise<PanelReply> {
  const startedAt = Date.now();
  const acc = accumulate((d) => args.onPanelChunk?.(idx, d));
  try {
    await streamChat(
      {
        domain: args.domain,
        message: args.prompt,
        cli: p.cli,
        model: p.model,
        localOnly: args.localOnly,
      },
      acc.onEvent,
      opts,
    );
    return { cli: p.cli, model: p.model, text: acc.get(), ms: Date.now() - startedAt, ok: true };
  } catch (err) {
    return {
      cli: p.cli,
      model: p.model,
      text: acc.get(),
      ms: Date.now() - startedAt,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildChairPrompt(question: string, panel: PanelReply[]): string {
  const blocks = panel
    .filter((r) => r.ok && r.text.trim())
    .map(
      (r, i) => `### Panelist ${i + 1} — ${r.cli}${r.model ? `:${r.model}` : ""}\n${r.text.trim()}`,
    )
    .join("\n\n");
  return [
    "You are the chair of a council. Below are independent answers from several",
    "AI panelists to the same question. Read them all, then write ONE decisive",
    "verdict for the user. Lead with the recommendation (BLUF). Then add a short",
    "'Where panelists disagreed' note if they diverged. Be concise.",
    "",
    `## Question\n${question}`,
    "",
    `## Panel\n${blocks}`,
  ].join("\n");
}

export async function runCouncil(args: CouncilArgs, opts?: EngineOpts): Promise<CouncilResult> {
  // 1. Fan out — every panelist answers the same prompt in parallel.
  const panel = await Promise.all(args.panelists.map((p, i) => runPanelist(args, p, i, opts)));

  const answered = panel.filter((r) => r.ok && r.text.trim());
  const degraded = answered.length < args.panelists.length;

  // 2. Synthesize — the chair reads the panel and writes the verdict.
  if (answered.length === 0) {
    return { panel, verdict: "", chair: args.chair, degraded: true };
  }
  const acc = accumulate(args.onVerdictChunk);
  await streamChat(
    {
      domain: args.domain,
      message: buildChairPrompt(args.prompt, panel),
      cli: args.chair.cli,
      model: args.chair.model,
      localOnly: args.localOnly,
    },
    acc.onEvent,
    opts,
  );

  return { panel, verdict: acc.get(), chair: args.chair, degraded };
}
