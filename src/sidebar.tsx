/**
 * Life-domains sidebar — a pure render driven by props from app.tsx: the score
 * map comes from `score --all`, open-loop counts from the domains listing.
 * Rows are clickable (onSelect) and carry a labeled column header so the two
 * numbers (readiness score · open loops) are self-explanatory.
 */
import type { DomainSummary } from "./contract.ts";
import { scoreColor } from "./format.ts";
import { theme } from "./theme.ts";

export function Sidebar({
  domains,
  domainIdx,
  focused,
  scores,
  streaming,
  onSelect,
}: {
  domains: DomainSummary[];
  domainIdx: number;
  focused: boolean;
  scores: Record<string, number | undefined>;
  streaming: Set<string>;
  onSelect: (i: number) => void;
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
      {/* column header so the two numbers are legible */}
      <box flexDirection="row" backgroundColor={theme.bgPanel}>
        <text fg={theme.fgFaint} bg={theme.bgPanel}>
          {"   domain         scr  ◌"}
        </text>
      </box>
      {domains.map((d, i) => {
        const active = i === domainIdx;
        const score = scores[d.name];
        const bg = active ? theme.selBg : theme.bgPanel;
        const glyph = streaming.has(d.name) ? "◉" : d.emoji ? d.emoji : "◆";
        return (
          <box
            key={d.name}
            flexDirection="row"
            backgroundColor={bg}
            onMouseDown={() => onSelect(i)}
          >
            <text fg={active ? theme.gold : theme.fgFaint} bg={bg}>
              {active ? "› " : "  "}
            </text>
            <text fg={streaming.has(d.name) ? theme.gold : active ? theme.selFg : theme.fg} bg={bg}>
              {`${glyph} `}
            </text>
            <text fg={active ? theme.selFg : theme.fg} bg={bg}>
              {(d.label ?? d.name).padEnd(13).slice(0, 13)}
            </text>
            {/* readiness score */}
            {score === undefined ? (
              <text fg={theme.fgFaint} bg={bg}>
                {" ··"}
              </text>
            ) : (
              <text fg={scoreColor(score)} bg={bg}>
                {String(score).padStart(3)}
              </text>
            )}
            {/* open loops */}
            <text fg={d.openLoopCount > 0 ? theme.warn : theme.fgFaint} bg={bg}>
              {d.openLoopCount > 0 ? ` ${String(d.openLoopCount).padStart(2)}` : "   "}
            </text>
          </box>
        );
      })}
    </box>
  );
}
