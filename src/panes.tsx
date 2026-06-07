/**
 * Read-only detail panes for the right side of the cockpit: Score, Manifest,
 * History. Each is a pure render of contract data — all engine I/O and state
 * live in app.tsx. The Manifest pane renders an inline <input> when the parent
 * hands it an `edit` descriptor.
 */
import type {
  ContextScore,
  DomainManifest,
  MissingItem,
  Relevance,
  ScoreDimension,
  ScoreHistory,
} from "./contract.ts";
import {
  bar,
  isoToMs,
  relativeTime,
  scoreColor,
  severityColor,
  severityGlyph,
  sparkline,
} from "./format.ts";
import { Markdown } from "./markdown.tsx";
import { theme } from "./theme.ts";
import type { DomainDocs } from "./vault.ts";

// Pretty labels for the six frozen dimensions (object key → display).
const DIM_LABEL: Record<string, string> = {
  coverage: "Coverage",
  density: "Density",
  freshness: "Freshness",
  structure: "Structure",
  activity: "Activity",
  config_completeness: "Config",
};

function Loading({ what }: { what: string }) {
  return (
    <box paddingLeft={1} paddingTop={1}>
      <text fg={theme.fgDim}>loading {what}…</text>
    </box>
  );
}

// ── Score ────────────────────────────────────────────────────────────────────
export function ScoreView({
  score,
  auditing,
}: {
  score: ContextScore | undefined;
  auditing: boolean;
}) {
  if (!score) return <Loading what="score" />;
  const dims = Object.entries(score.breakdown ?? {});
  const computed = relativeTime(isoToMs(score.computed_at));
  return (
    <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
      {/* headline */}
      <box flexDirection="row" paddingTop={1}>
        <text fg={scoreColor(score.score)} attributes={1}>
          {String(score.score).padStart(3)} / 100
        </text>
        <text fg={theme.fgFaint}>{"   context readiness"}</text>
        {auditing ? <text fg={theme.gold}>{"   ⠿ auditing…"}</text> : null}
      </box>
      <text fg={theme.fgFaint}>{`computed ${computed}  ·  press a to run a fresh LLM audit`}</text>
      <text> </text>

      {/* breakdown */}
      <text fg={theme.gold} attributes={1}>
        BREAKDOWN
      </text>
      {dims.map(([key, dim]: [string, ScoreDimension]) => (
        <box key={key} flexDirection="column">
          <box flexDirection="row">
            <text fg={theme.fg}>{(DIM_LABEL[key] ?? key).padEnd(10)}</text>
            <text fg={scoreColor(dim.score)}>{bar(dim.score)}</text>
            <text fg={scoreColor(dim.score)}>{` ${String(dim.score).padStart(3)}`}</text>
          </box>
          <text fg={theme.fgFaint}>{`           ${dim.detail}`}</text>
        </box>
      ))}
      <text> </text>

      {/* relevance */}
      {score.relevance ? <RelevanceBlock relevance={score.relevance} /> : null}

      {/* missing */}
      {score.missing && score.missing.length > 0 ? <MissingBlock missing={score.missing} /> : null}

      {/* assessment */}
      {score.assessment ? (
        <box flexDirection="column">
          <text fg={theme.gold} attributes={1}>
            ASSESSMENT
          </text>
          {score.audit_source ? (
            <text fg={theme.fgFaint}>{`via ${score.audit_source}`}</text>
          ) : null}
          <text fg={theme.fg}>{score.assessment}</text>
          <text> </text>
        </box>
      ) : null}
    </scrollbox>
  );
}

function RelevanceBlock({ relevance }: { relevance: Relevance }) {
  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text fg={theme.gold} attributes={1}>
          RELEVANCE
        </text>
        <text
          fg={theme.fgFaint}
        >{`  ${relevance.matched} rubric · ${relevance.detail ?? ""}`}</text>
      </box>
      {relevance.items.map((it) => {
        const mark = !it.present ? "✗" : it.stale ? "~" : "✓";
        const color = !it.present ? theme.err : it.stale ? theme.warn : theme.ok;
        return (
          <box key={it.id} flexDirection="row">
            <text fg={color}>{` ${mark} `}</text>
            <text fg={it.present ? theme.fg : theme.fgDim}>{it.label.padEnd(26)}</text>
            <text fg={theme.fgFaint}>{it.detail ?? ""}</text>
          </box>
        );
      })}
      <text> </text>
    </box>
  );
}

function MissingBlock({ missing }: { missing: MissingItem[] }) {
  return (
    <box flexDirection="column">
      <text fg={theme.gold} attributes={1}>
        {`GAPS (${missing.length})`}
      </text>
      {missing.map((m, i) => (
        <box key={`${m.kind}-${i}`} flexDirection="row">
          <text fg={severityColor(m.severity)}>{` ${severityGlyph(m.severity)} `}</text>
          <text fg={theme.fgDim}>{m.label}</text>
        </box>
      ))}
      <text> </text>
    </box>
  );
}

// ── State (read-only vault markdown) ─────────────────────────────────────────
export function StateView({ docs }: { docs: DomainDocs | undefined }) {
  if (!docs) return <Loading what="state" />;
  if (!docs.state && !docs.openloops) {
    return (
      <box paddingLeft={1} paddingTop={1}>
        <text fg={theme.fgDim}>No state.md for this domain yet.</text>
      </box>
    );
  }
  return (
    <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
      {docs.state ? <Markdown content={docs.state} /> : null}
      {docs.openloops ? (
        <box flexDirection="column" paddingTop={1}>
          <text fg={theme.gold} attributes={1}>
            OPEN LOOPS
          </text>
          <Markdown content={docs.openloops} />
        </box>
      ) : null}
    </scrollbox>
  );
}

// ── Manifest ─────────────────────────────────────────────────────────────────
export interface ManifestEdit {
  field: "label" | "emoji" | "summary";
}

export function ManifestView({
  manifest,
  editing,
  inputRef,
  onSubmit,
}: {
  manifest: DomainManifest | undefined;
  editing: ManifestEdit | null;
  inputRef: React.RefObject<unknown>;
  onSubmit: (value: string) => void;
}) {
  if (!manifest) return <Loading what="manifest" />;
  const id = manifest.identity ?? {};
  const cfg = manifest.config ?? {};
  const rows: Array<{
    key: ManifestEdit["field"] | string;
    label: string;
    value: string;
    editable?: boolean;
  }> = [
    { key: "label", label: "Label", value: id.label ?? "—", editable: true },
    { key: "emoji", label: "Icon", value: id.emoji || "—" },
    { key: "summary", label: "Summary", value: id.summary || "—", editable: true },
    { key: "name", label: "Name", value: id.name ?? "—" },
    { key: "cli", label: "Default CLI", value: cfg.cli ?? "—" },
    { key: "model", label: "Model", value: cfg.model || "(cli default)" },
    { key: "skills", label: "Skills", value: String((cfg.skills ?? []).length) },
    { key: "archived", label: "Archived", value: manifest.archived ? "yes" : "no" },
  ];
  return (
    <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
      <text> </text>
      <text fg={theme.gold} attributes={1}>
        MANIFEST
      </text>
      <text fg={theme.fgFaint}>press e to edit label · m to edit summary</text>
      <text> </text>
      {rows.map((r) =>
        editing && editing.field === r.key ? (
          <box key={r.key} flexDirection="row">
            <text fg={theme.gold}>{`${r.label.padEnd(12)} › `}</text>
            <input
              ref={inputRef as never}
              focused
              placeholder={`new ${r.label.toLowerCase()}`}
              onSubmit={((v: string) => onSubmit(v)) as never}
            />
          </box>
        ) : (
          <box key={r.key} flexDirection="row">
            <text fg={r.editable ? theme.fg : theme.fgDim}>{r.label.padEnd(12)}</text>
            <text fg={r.editable ? theme.goldBright : theme.fgDim}>{r.value}</text>
          </box>
        ),
      )}
    </scrollbox>
  );
}

// ── History ──────────────────────────────────────────────────────────────────
export function HistoryView({ history }: { history: ScoreHistory | undefined }) {
  if (!history) return <Loading what="history" />;
  if (history.length === 0) {
    return (
      <box paddingLeft={1} paddingTop={1}>
        <text fg={theme.fgDim}>No score history yet for this domain.</text>
      </box>
    );
  }
  const scores = history.map((h) => h.score);
  const latest = scores[scores.length - 1];
  const first = scores[0];
  const delta = latest - first;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  // Show the last ~60 points so the sparkline fits a typical pane width.
  const tail = scores.slice(-60);
  return (
    <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
      <text> </text>
      <text fg={theme.gold} attributes={1}>
        SCORE HISTORY
      </text>
      <text fg={theme.fgFaint}>{`${history.length} samples · min ${min} · max ${max}`}</text>
      <text> </text>
      <text fg={scoreColor(latest)}>{sparkline(tail)}</text>
      <text> </text>
      <box flexDirection="row">
        <text fg={theme.fg}>{`now ${latest}`}</text>
        <text fg={delta >= 0 ? theme.ok : theme.err}>
          {`   ${delta >= 0 ? "▲" : "▼"} ${delta >= 0 ? "+" : ""}${delta} since first sample`}
        </text>
      </box>
      <text> </text>
      <text fg={theme.fgFaint}>recent</text>
      {history
        .slice(-10)
        .reverse()
        .map((h, i) => (
          <box key={`${h.ts}-${i}`} flexDirection="row">
            <text fg={theme.fgDim}>{relativeTime(h.ts).padEnd(10)}</text>
            <text fg={scoreColor(h.score)}>{String(h.score).padStart(3)}</text>
          </box>
        ))}
    </scrollbox>
  );
}
