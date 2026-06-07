/**
 * The prevAIl banner — ported from the cockpit (fd-apps-prevail-cli/src/
 * branding.tsx). Same ASCII PREVAIL wordmark, mascot, and status column.
 *
 * The only change for the thin client: the framework / lens / web defaults
 * are passed in as props (client-side state in app.tsx) instead of being read
 * from the engine's on-disk config — the contract doesn't expose those yet.
 */
import { Chip } from "./chip.tsx";
import { type FrameworkId, getFramework } from "./framework.ts";
import { type LensSelection, getLens } from "./lens.ts";
import { theme } from "./theme.ts";
import { useLayoutTier } from "./use-layout-tier.ts";

export interface CliHealth {
  kind: string;
  label: string;
  ok: boolean | null;
}

interface Props {
  domainCount: number;
  totalLoops: number;
  appCount: number;
  vaultLabel: string;
  engineVersion: string;
  now: number;
  councilOn: boolean;
  framework: FrameworkId | null;
  lens: LensSelection;
  webOn: boolean;
  onToggleCouncil?: () => void;
  onCycleFramework?: () => void;
  onCycleLens?: () => void;
  onToggleWeb?: () => void;
  onConfigure?: () => void;
  onBench?: () => void;
  onTools?: () => void;
  cliHealth?: CliHealth[];
}

// configure / bench / tools — the three clickable banner buttons.
function ToolButtons(props: Props) {
  return (
    <box flexDirection="row">
      <box paddingLeft={2} paddingRight={1} onMouseDown={props.onConfigure}>
        <text fg={theme.aiAccent}>◇ configure</text>
      </box>
      <box paddingRight={1} onMouseDown={props.onBench}>
        <text fg={theme.aiAccent} attributes={1}>
          ◈ bench
        </text>
      </box>
      <box paddingRight={1} onMouseDown={props.onTools}>
        <text fg={theme.aiAccent} attributes={1}>
          ▸ tools
        </text>
      </box>
    </box>
  );
}

function fwLabelOf(framework: FrameworkId | null): string {
  return framework ? (getFramework(framework)?.label ?? framework) : "none";
}
function lensLabelOf(lens: LensSelection): string {
  if (lens === null) return "none";
  if (lens === "all") return "all (×5)";
  return getLens(lens)?.label ?? "none";
}

export function Branding(props: Props) {
  const now = new Date(props.now);
  const dateLabel = now
    .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    .toUpperCase();
  const yearLabel = now.getFullYear();
  const timeLabel = formatTime(now);
  const { tier } = useLayoutTier();

  if (tier === "compact")
    return <CompactBranding {...props} dateLabel={dateLabel} timeLabel={timeLabel} />;

  return (
    <box
      flexDirection="column"
      height={9}
      border={["bottom"]}
      borderColor={theme.gold}
      backgroundColor={theme.bg}
      paddingTop={1}
      paddingBottom={0}
    >
      <box flexDirection="row" flexGrow={1} paddingLeft={3} paddingRight={3}>
        <BrandColumn />
        <Separator />
        <StatusColumn
          {...props}
          dateLabel={dateLabel}
          yearLabel={yearLabel}
          timeLabel={timeLabel}
        />
      </box>
    </box>
  );
}

function CompactBranding(props: Props & { dateLabel: string; timeLabel: string }) {
  const { dateLabel, timeLabel, domainCount, appCount, totalLoops, vaultLabel } = props;
  return (
    <box
      flexDirection="column"
      height={3}
      border={["bottom"]}
      borderColor={theme.gold}
      backgroundColor={theme.bg}
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row" height={1}>
        <text fg={theme.gold} attributes={1}>
          ◈ prev
        </text>
        <text fg={theme.aiAccent} attributes={1}>
          AI
        </text>
        <text fg={theme.gold} attributes={1}>
          l
        </text>
        <text fg={theme.goldDim}>{` v${props.engineVersion}`}</text>
        <text fg={theme.fgFaint}>{"  ·  "}</text>
        <text fg={theme.gold}>{dateLabel}</text>
        <text fg={theme.fgFaint}>{"  "}</text>
        <text fg={theme.fgDim}>{timeLabel}</text>
        <text fg={theme.fgFaint}>{"  ·  "}</text>
        <text fg={theme.fgDim}>
          <span fg={theme.fg}>{domainCount}</span>
          {"d "}
          <span fg={theme.fg}>{appCount}</span>
          {"a "}
          <span fg={totalLoops > 0 ? theme.warn : theme.fg}>{totalLoops}</span>
          {"o"}
        </text>
        <box flexGrow={1} />
        <CliHealthRow cliHealth={props.cliHealth} compact />
      </box>
      <box flexDirection="row" height={1}>
        <text fg={theme.fgFaint}>defaults</text>
        <DefaultsChips {...props} paddingLeft={1} />
        <box flexGrow={1} />
        <text fg={theme.fgFaint}>{vaultLabel}</text>
      </box>
      <box flexDirection="row" height={1}>
        <text fg={theme.fgFaint}>{"tools  "}</text>
        <ToolButtons {...props} />
      </box>
    </box>
  );
}

function DefaultsChips(props: Props & { paddingLeft?: number }) {
  return (
    <>
      <Chip
        label="⚖ C:"
        value={props.councilOn ? "ON" : "OFF"}
        active={props.councilOn}
        activeFg={theme.gold}
        onMouseDown={props.onToggleCouncil}
        paddingLeft={props.paddingLeft ?? 1}
      />
      <Chip
        label="◆ F:"
        value={fwLabelOf(props.framework)}
        active={!!props.framework}
        onMouseDown={props.onCycleFramework}
      />
      <Chip
        label="◇ L:"
        value={lensLabelOf(props.lens)}
        active={!!props.lens}
        onMouseDown={props.onCycleLens}
      />
      <Chip
        label="⬡ W:"
        value={props.webOn ? "ON" : "OFF"}
        active={props.webOn}
        onMouseDown={props.onToggleWeb}
      />
    </>
  );
}

function CliHealthRow({ cliHealth, compact }: { cliHealth?: CliHealth[]; compact?: boolean }) {
  if (!cliHealth || cliHealth.length === 0) return null;
  return (
    <box flexDirection="row">
      {!compact ? <text fg={theme.fgFaint}>cli</text> : null}
      {cliHealth.map((h) => {
        const glyph = h.ok === true ? "✓" : h.ok === false ? "!" : "·";
        const fgC = h.ok === true ? theme.ok : h.ok === false ? theme.warn : theme.fgDim;
        return (
          <box key={h.kind} flexDirection="row" paddingLeft={compact ? 1 : 2}>
            <text fg={fgC}>{glyph}</text>
            <text
              fg={compact ? theme.fgDim : theme.fg}
            >{` ${compact ? h.label.toLowerCase() : h.label}`}</text>
          </box>
        );
      })}
    </box>
  );
}

type Glyph = readonly [string, string, string, string, string, string, string];

// ANSI Shadow-style 3D letters, each normalized to a 10×7 box so the
// wordmark spaces uniformly. Lifted verbatim from the cockpit.
const G: Record<string, Glyph> = {
  P: [
    "██████╗   ",
    "██╔══██╗  ",
    "██████╔╝  ",
    "██╔═══╝   ",
    "██║       ",
    "██║       ",
    "╚═╝       ",
  ],
  R: [
    "██████╗   ",
    "██╔══██╗  ",
    "██████╔╝  ",
    "██╔══██╗  ",
    "██║  ██║  ",
    "██║  ██║  ",
    "╚═╝  ╚═╝  ",
  ],
  E: [
    "███████╗  ",
    "██╔════╝  ",
    "█████╗    ",
    "██╔══╝    ",
    "██║       ",
    "███████╗  ",
    "╚══════╝  ",
  ],
  V: [
    "██╗   ██╗ ",
    "██║   ██║ ",
    "██║   ██║ ",
    "╚██╗ ██╔╝ ",
    " ╚████╔╝  ",
    "  ╚██╔╝   ",
    "   ╚═╝    ",
  ],
  A: [
    "  █████╗  ",
    " ██╔══██╗ ",
    " ███████╗ ",
    " ██╔══██║ ",
    " ██║  ██║ ",
    " ██║  ██║ ",
    " ╚═╝  ╚═╝ ",
  ],
  I: [
    "██████╗   ",
    "╚═██╔═╝   ",
    "  ██║     ",
    "  ██║     ",
    "  ██║     ",
    "██████╗   ",
    "╚═════╝   ",
  ],
  L: [
    "██╗       ",
    "██║       ",
    "██║       ",
    "██║       ",
    "██║       ",
    "███████╗  ",
    "╚══════╝  ",
  ],
};

const LETTER_GAP = " ";
function compose(letters: readonly string[]): readonly string[] {
  const rows: string[] = ["", "", "", "", "", "", ""];
  for (let i = 0; i < letters.length; i++) {
    const g = G[letters[i]];
    for (let r = 0; r < 7; r++) {
      rows[r] += g[r];
      if (i < letters.length - 1) rows[r] += LETTER_GAP;
    }
  }
  return rows;
}
const LOGO_PREV = compose(["P", "R", "E", "V"]);
const LOGO_AI = compose(["A", "I"]);
const LOGO_L = compose(["L"]);

function BrandColumn() {
  return (
    <box flexDirection="row" width={88}>
      <Mascot />
      <box flexDirection="column" paddingLeft={2}>
        {LOGO_PREV.map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed 7-row logo, stable order
          <text key={`logo-${i}`} attributes={1}>
            <span fg={theme.gold} attributes={1}>
              {LOGO_PREV[i]}
            </span>
            <span fg={theme.gold} attributes={1}>
              {LETTER_GAP}
            </span>
            <span fg={theme.aiAccent} attributes={1}>
              {LOGO_AI[i]}
            </span>
            <span fg={theme.gold} attributes={1}>
              {LETTER_GAP}
            </span>
            <span fg={theme.gold} attributes={1}>
              {LOGO_L[i]}
            </span>
          </text>
        ))}
      </box>
    </box>
  );
}

function Mascot() {
  return (
    <box flexDirection="column" width={9} paddingTop={1}>
      <text fg={theme.goldDim}> ╲ │ ╱ </text>
      <text fg={theme.gold} attributes={1}>
        {" "}
        ─ ◈ ─{" "}
      </text>
      <text fg={theme.goldDim}> ╱ │ ╲ </text>
      <text> </text>
      <text fg={theme.fgFaint}>EST 2026</text>
    </box>
  );
}

function Separator() {
  return (
    <box flexDirection="column" width={3} paddingLeft={1} paddingRight={1}>
      {Array.from({ length: 7 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed 7-row separator
        <text key={`sep-${i}`} fg={theme.border}>
          │
        </text>
      ))}
    </box>
  );
}

function StatusColumn(props: Props & { dateLabel: string; yearLabel: number; timeLabel: string }) {
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={2}>
      <box flexDirection="row" height={1}>
        <text fg={theme.gold} attributes={1}>
          {props.dateLabel}
        </text>
        <text fg={theme.goldDim}>{`  ·  ${props.yearLabel}`}</text>
        <box flexGrow={1} />
        <text fg={theme.fgDim}>
          <span fg={theme.fg}>{props.domainCount}</span>
          {" dom · "}
          <span fg={theme.fg}>{props.appCount}</span>
          {" apps · "}
          <span fg={props.totalLoops > 0 ? theme.warn : theme.fg}>{props.totalLoops}</span>
          {" open"}
        </text>
      </box>
      <text
        fg={theme.fgDim}
      >{`${props.timeLabel}  ·  prevail v${props.engineVersion}  ·  opentui`}</text>
      <box flexDirection="row" height={1}>
        <text fg={theme.fgFaint}>{"vault   "}</text>
        <text fg={theme.fg}>{props.vaultLabel}</text>
      </box>
      <box flexDirection="row" height={1}>
        <text fg={theme.fgFaint}>defaults</text>
        <Chip
          label="⚖ Council:"
          value={props.councilOn ? "ON" : "OFF"}
          active={props.councilOn}
          activeFg={theme.gold}
          onMouseDown={props.onToggleCouncil}
          paddingLeft={2}
        />
        <Chip
          label="◆ Framework:"
          value={fwLabelOf(props.framework)}
          active={!!props.framework}
          onMouseDown={props.onCycleFramework}
        />
        <Chip
          label="◇ Lens:"
          value={lensLabelOf(props.lens)}
          active={!!props.lens}
          onMouseDown={props.onCycleLens}
        />
      </box>
      <box flexDirection="row" height={1}>
        <text fg={theme.fgFaint}>{"        "}</text>
        <Chip
          label="⬡ Web:"
          value={props.webOn ? "ON" : "OFF"}
          active={props.webOn}
          onMouseDown={props.onToggleWeb}
          paddingLeft={2}
        />
        <ToolButtons {...props} />
      </box>
      <CliHealthRow cliHealth={props.cliHealth} />
    </box>
  );
}

function formatTime(d: Date): string {
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
