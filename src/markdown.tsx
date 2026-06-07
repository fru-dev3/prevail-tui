/**
 * A tiny line-oriented markdown renderer for the read-only vault views. Mirrors
 * the original cockpit's markdown-lite (headings, checkboxes, bullets, quotes,
 * bold-key meta) so the TUI reads the vault the same way the desktop does.
 */
import { theme } from "./theme.ts";

function stripInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function MarkdownLine({ line }: { line: string }) {
  if (line.trim().length === 0) return <text> </text>;

  const h1 = line.match(/^#\s+(.*)$/);
  if (h1)
    return (
      <text fg={theme.gold} attributes={1}>
        {h1[1]}
      </text>
    );
  const h2 = line.match(/^##\s+(.*)$/);
  if (h2) return <text fg={theme.gold}>{h2[1]}</text>;
  const h3 = line.match(/^###\s+(.*)$/);
  if (h3) return <text fg={theme.goldDim}>{h3[1]}</text>;

  if (/^\s*>\s*/.test(line)) {
    return <text fg={theme.fgFaint}>{`│ ${line.replace(/^\s*>\s?/, "")}`}</text>;
  }

  const unchecked = line.match(/^(\s*)[-*]\s*\[\s\]\s*(.*)$/);
  if (unchecked)
    return <text fg={theme.warn}>{`${unchecked[1]}◯ ${stripInline(unchecked[2])}`}</text>;
  const checked = line.match(/^(\s*)[-*]\s*\[x\]\s*(.*)$/i);
  if (checked) return <text fg={theme.ok}>{`${checked[1]}● ${stripInline(checked[2])}`}</text>;

  const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
  if (bullet) return <text fg={theme.fg}>{`${bullet[1]}• ${stripInline(bullet[2])}`}</text>;

  if (/^\s*\|.*\|\s*$/.test(line) || /^\s*\|?\s*-{3,}/.test(line)) {
    return <text fg={theme.fgDim}>{line}</text>;
  }
  if (/^\s*```/.test(line)) return <text fg={theme.fgFaint}>{line}</text>;

  const meta = line.match(/^\*\*(.+?):\*\*\s*(.*)$/);
  if (meta) {
    return (
      <text fg={theme.fg}>
        <span fg={theme.gold}>{`${meta[1]}: `}</span>
        {stripInline(meta[2])}
      </text>
    );
  }

  return <text fg={theme.fg}>{stripInline(line)}</text>;
}

export function Markdown({ content }: { content: string }) {
  return (
    <box flexDirection="column">
      {content.split("\n").map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: line order is stable for a static doc
        <MarkdownLine key={`ln-${i}`} line={line} />
      ))}
    </box>
  );
}
