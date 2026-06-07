/**
 * The three heavy panels the banner opens: configure (council composition),
 * bench (a readiness leaderboard over the live scores), and tools
 * (diagnostics). Rendered as a modal over the detail pane; esc or the ✕ closes.
 */
import type { CliHealth } from "./branding.tsx";
import type { CliKind } from "./contract.ts";
import { scoreColor } from "./format.ts";
import { theme } from "./theme.ts";

export type OverlayKind = "configure" | "bench" | "tools";

function Frame({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      border
      borderColor={theme.gold}
      backgroundColor={theme.bgPanel}
      title={` ${title} `}
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row">
        <box flexGrow={1} />
        <box onMouseDown={onClose}>
          <text fg={theme.fgDim}>✕ close (esc)</text>
        </box>
      </box>
      {children}
    </box>
  );
}

// ── configure: council composition ───────────────────────────────────────────
function ConfigurePanel({
  cliHealth,
  panel,
  chair,
  onTogglePanelist,
  onSetChair,
}: {
  cliHealth: CliHealth[];
  panel: CliKind[];
  chair: CliKind;
  onTogglePanelist: (cli: CliKind) => void;
  onSetChair: (cli: CliKind) => void;
}) {
  return (
    <box flexDirection="column" paddingTop={1}>
      <text fg={theme.gold} attributes={1}>
        COUNCIL
      </text>
      <text fg={theme.fgFaint}>
        click a CLI to add/remove it from the panel · click ★ to make it the chair
      </text>
      <text> </text>
      {cliHealth.map((h) => {
        const cli = h.kind as CliKind;
        const inPanel = panel.includes(cli);
        const isChair = chair === cli;
        const healthGlyph = h.ok === true ? "✓" : h.ok === false ? "⚠" : "·";
        const healthColor = h.ok === true ? theme.ok : h.ok === false ? theme.warn : theme.fgDim;
        return (
          <box key={h.kind} flexDirection="row">
            <box flexDirection="row" onMouseDown={() => onTogglePanelist(cli)}>
              <text fg={inPanel ? theme.ok : theme.fgFaint}>{inPanel ? "[✓] " : "[ ] "}</text>
              <text fg={healthColor}>{`${healthGlyph} `}</text>
              <text fg={inPanel ? theme.fg : theme.fgDim}>{h.label.padEnd(14)}</text>
            </box>
            <box onMouseDown={() => onSetChair(cli)}>
              <text fg={isChair ? theme.gold : theme.fgFaint}>
                {isChair ? "★ chair" : "☆ chair"}
              </text>
            </box>
          </box>
        );
      })}
      <text> </text>
      <text fg={theme.fgFaint}>
        {`panel: ${panel.length ? panel.join(", ") : "(auto — all healthy)"} · chair: ${chair}`}
      </text>
      <text fg={theme.fgFaint}>turn Council ON in the banner/config bar, then send a message.</text>
    </box>
  );
}

// ── bench: readiness leaderboard over the live scores ────────────────────────
function BenchPanel({
  scores,
  lifeReadiness,
}: {
  scores: { name: string; score: number | undefined }[];
  lifeReadiness: number | null;
}) {
  const ranked = [...scores]
    .filter((s) => s.score !== undefined)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return (
    <box flexDirection="column" paddingTop={1}>
      <box flexDirection="row">
        <text fg={theme.gold} attributes={1}>
          READINESS LEADERBOARD
        </text>
        <text fg={theme.fgFaint}>{"   life "}</text>
        {lifeReadiness === null ? (
          <text fg={theme.fgFaint}>··</text>
        ) : (
          <text fg={scoreColor(lifeReadiness)} attributes={1}>
            {String(lifeReadiness)}
          </text>
        )}
      </box>
      <text fg={theme.fgFaint}>every domain scored by the engine, ranked</text>
      <text> </text>
      {ranked.map((s, i) => (
        <box key={s.name} flexDirection="row">
          <text fg={theme.fgFaint}>{`${String(i + 1).padStart(2)}. `}</text>
          <text fg={theme.fg}>{s.name.padEnd(16)}</text>
          <text fg={scoreColor(s.score ?? 0)}>{String(s.score).padStart(3)}</text>
        </box>
      ))}
    </box>
  );
}

// ── tools: diagnostics ───────────────────────────────────────────────────────
function ToolsPanel({
  engineVer,
  vaultLabel,
  domainCount,
  appCount,
  cliHealth,
}: {
  engineVer: string;
  vaultLabel: string;
  domainCount: number;
  appCount: number;
  cliHealth: CliHealth[];
}) {
  const row = (k: string, v: string) => (
    <box flexDirection="row">
      <text fg={theme.fgFaint}>{k.padEnd(14)}</text>
      <text fg={theme.fg}>{v}</text>
    </box>
  );
  return (
    <box flexDirection="column" paddingTop={1}>
      <text fg={theme.gold} attributes={1}>
        DIAGNOSTICS
      </text>
      <text> </text>
      {row("engine", `prevail v${engineVer}`)}
      {row("vault", vaultLabel)}
      {row("domains", String(domainCount))}
      {row("apps", String(appCount))}
      <text> </text>
      <text fg={theme.fgFaint}>cli health</text>
      {cliHealth.map((h) => (
        <box key={h.kind} flexDirection="row">
          <text fg={h.ok === true ? theme.ok : h.ok === false ? theme.warn : theme.fgDim}>
            {`  ${h.ok === true ? "✓" : h.ok === false ? "⚠" : "·"} `}
          </text>
          <text fg={theme.fg}>{h.label}</text>
        </box>
      ))}
    </box>
  );
}

export interface OverlayProps {
  kind: OverlayKind;
  onClose: () => void;
  // configure
  cliHealth: CliHealth[];
  panel: CliKind[];
  chair: CliKind;
  onTogglePanelist: (cli: CliKind) => void;
  onSetChair: (cli: CliKind) => void;
  // bench
  scores: { name: string; score: number | undefined }[];
  lifeReadiness: number | null;
  // tools
  engineVer: string;
  vaultLabel: string;
  domainCount: number;
  appCount: number;
}

export function Overlay(p: OverlayProps) {
  const title = p.kind === "configure" ? "configure" : p.kind === "bench" ? "bench" : "tools";
  return (
    <Frame title={title} onClose={p.onClose}>
      {p.kind === "configure" ? (
        <ConfigurePanel
          cliHealth={p.cliHealth}
          panel={p.panel}
          chair={p.chair}
          onTogglePanelist={p.onTogglePanelist}
          onSetChair={p.onSetChair}
        />
      ) : p.kind === "bench" ? (
        <BenchPanel scores={p.scores} lifeReadiness={p.lifeReadiness} />
      ) : (
        <ToolsPanel
          engineVer={p.engineVer}
          vaultLabel={p.vaultLabel}
          domainCount={p.domainCount}
          appCount={p.appCount}
          cliHealth={p.cliHealth}
        />
      )}
    </Frame>
  );
}
