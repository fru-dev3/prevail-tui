/**
 * Header banner + life-domains sidebar. Both are pure renders driven by props
 * from app.tsx: the score map comes from `score --all`, open-loop counts from
 * the domains listing, and the live clock from a timestamp the app ticks.
 */
import type { DomainSummary } from "./contract.ts";
import { scoreColor, shortenPath } from "./format.ts";
import { theme } from "./theme.ts";

function formatClock(now: number): string {
  const d = new Date(now);
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const mons = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${days[d.getDay()]} ${mons[d.getMonth()]} ${d.getDate()} · ${hh}:${mm}`;
}

export function Header({
  vaultPath,
  lifeReadiness,
  domainCount,
  openLoops,
  now,
}: {
  vaultPath: string;
  lifeReadiness: number | null;
  domainCount: number;
  openLoops: number;
  now: number;
}) {
  return (
    <box flexDirection="row" paddingLeft={1} paddingRight={1}>
      {/* wordmark */}
      <text fg={theme.ai} attributes={1}>
        prev
      </text>
      <text fg={theme.gold} attributes={1}>
        AI
      </text>
      <text fg={theme.ai} attributes={1}>
        l
      </text>
      <text fg={theme.fgFaint}>{`  · ${formatClock(now)}  ·  `}</text>
      {/* life readiness */}
      <text fg={theme.fgDim}>life </text>
      {lifeReadiness === null ? (
        <text fg={theme.fgFaint}>··</text>
      ) : (
        <text fg={scoreColor(lifeReadiness)} attributes={1}>
          {String(lifeReadiness)}
        </text>
      )}
      <text fg={theme.fgFaint}>{`  ·  ${domainCount}d`}</text>
      <text fg={openLoops > 0 ? theme.warn : theme.fgFaint}>{` ${openLoops}o`}</text>
      <text fg={theme.fgFaint}>{`  ·  ${shortenPath(vaultPath)}`}</text>
    </box>
  );
}

export function Sidebar({
  domains,
  domainIdx,
  focused,
  scores,
  streaming,
}: {
  domains: DomainSummary[];
  domainIdx: number;
  focused: boolean;
  scores: Record<string, number | undefined>;
  streaming: Set<string>;
}) {
  return (
    <box
      flexDirection="column"
      width={30}
      border
      borderColor={focused ? theme.borderFocus : theme.border}
      backgroundColor={theme.bgPanel}
      bottomTitle=" LIFE DOMAINS "
    >
      {domains.map((d, i) => {
        const active = i === domainIdx;
        const score = scores[d.name];
        const glyph = streaming.has(d.name) ? "◉" : d.emoji ? d.emoji : "◆";
        return (
          <box
            key={d.name}
            flexDirection="row"
            backgroundColor={active ? theme.selBg : theme.bgPanel}
          >
            <text
              fg={active ? theme.gold : theme.fgFaint}
              bg={active ? theme.selBg : theme.bgPanel}
            >
              {active ? "› " : "  "}
            </text>
            <text
              fg={streaming.has(d.name) ? theme.gold : active ? theme.selFg : theme.fg}
              bg={active ? theme.selBg : theme.bgPanel}
            >
              {`${glyph} `}
            </text>
            <text fg={active ? theme.selFg : theme.fg} bg={active ? theme.selBg : theme.bgPanel}>
              {(d.label ?? d.name).padEnd(15).slice(0, 15)}
            </text>
            {/* score badge */}
            {score === undefined ? (
              <text fg={theme.fgFaint} bg={active ? theme.selBg : theme.bgPanel}>
                {" ··"}
              </text>
            ) : (
              <text fg={scoreColor(score)} bg={active ? theme.selBg : theme.bgPanel}>
                {String(score).padStart(3)}
              </text>
            )}
            {/* open loops */}
            <text
              fg={d.openLoopCount > 0 ? theme.warn : theme.fgFaint}
              bg={active ? theme.selBg : theme.bgPanel}
            >
              {d.openLoopCount > 0 ? ` ${d.openLoopCount}○` : "   "}
            </text>
          </box>
        );
      })}
    </box>
  );
}
