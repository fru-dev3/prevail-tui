/**
 * Life-domains sidebar — a simple clickable list of domains. A streaming domain
 * shows a ◉ so you can see which one is currently responding. (Scores live on
 * the Score tab; the sidebar stays uncluttered.)
 */
import type { DomainSummary } from "./contract.ts";
import { theme } from "./theme.ts";

export function Sidebar({
  domains,
  domainIdx,
  focused,
  streaming,
  onSelect,
}: {
  domains: DomainSummary[];
  domainIdx: number;
  focused: boolean;
  streaming: Set<string>;
  onSelect: (i: number) => void;
}) {
  return (
    <box
      flexDirection="column"
      width={26}
      border
      borderColor={focused ? theme.borderFocus : theme.border}
      backgroundColor={theme.bgPanel}
      bottomTitle=" LIFE DOMAINS "
    >
      {domains.map((d, i) => {
        const active = i === domainIdx;
        const isStreaming = streaming.has(d.name);
        const bg = active ? theme.selBg : theme.bgPanel;
        const glyph = isStreaming ? "◉" : d.emoji ? d.emoji : "◆";
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
            <text fg={isStreaming ? theme.gold : active ? theme.selFg : theme.fg} bg={bg}>
              {`${glyph} `}
            </text>
            <text fg={active ? theme.selFg : theme.fg} bg={bg}>
              {d.label ?? d.name}
            </text>
          </box>
        );
      })}
    </box>
  );
}
