/**
 * Chat view: transcript + boxed suggestion cards + the per-chat config bar +
 * the message input. Conversation state and engine streaming live in app.tsx;
 * this file is presentation + the input seam. Council replies render as a
 * distinct gold-tagged role.
 */
import { Chip } from "./chip.tsx";
import type { DomainSummary } from "./contract.ts";
import { type FrameworkId, getFramework } from "./framework.ts";
import { type LensSelection, getLens } from "./lens.ts";
import { Markdown } from "./markdown.tsx";
import { theme } from "./theme.ts";

export type Role = "user" | "assistant" | "system" | "council";

export interface ChatMsg {
  id: number;
  role: Role;
  text: string;
  /** engine label on assistant rows, or "error" for failures, or a panel summary. */
  cli?: string;
  streaming?: boolean;
}

/** The per-chat knobs shown in the config bar (the cockpit's bottom row). */
export interface ChatControls {
  councilOn: boolean;
  framework: FrameworkId | null;
  lens: LensSelection;
  webOn: boolean;
  saveOn: boolean;
  serendipityOn: boolean;
  auto: "OFF" | "SUGGEST" | "AUTO";
  onToggleCouncil: () => void;
  onCycleFramework: () => void;
  onCycleLens: () => void;
  onToggleWeb: () => void;
  onToggleSave: () => void;
  onToggleSerendipity: () => void;
  onCycleAuto: () => void;
}

export function MessageRow({ msg }: { msg: ChatMsg }) {
  const tag =
    msg.role === "user"
      ? { label: "you", color: theme.ai, prefix: "› " }
      : msg.role === "council"
        ? { label: "council", color: theme.gold, prefix: "◆ " }
        : msg.role === "system"
          ? { label: msg.cli ?? "system", color: theme.fgFaint, prefix: "· " }
          : {
              label: msg.cli && msg.cli !== "error" ? msg.cli : "assistant",
              color: theme.assistant,
              prefix: "▸ ",
            };
  const isError = msg.cli === "error";
  const asMarkdown =
    !isError && (msg.role === "assistant" || msg.role === "council") && msg.text.length > 0;
  return (
    <box flexDirection="column" paddingTop={1}>
      <text fg={tag.color} attributes={1}>
        {tag.prefix}
        {tag.label}
        {msg.streaming ? " ▌" : ""}
      </text>
      {asMarkdown ? (
        <Markdown content={msg.text} />
      ) : (
        <text fg={isError ? theme.err : theme.fg}>{msg.text}</text>
      )}
    </box>
  );
}

// Boxed starter-prompt cards, like the cockpit's "try one to get started".
function SuggestionCards({ suggestions }: { suggestions: string[] }) {
  return (
    <box flexDirection="column" paddingTop={1}>
      <text fg={theme.fgFaint}>try one to get started · clicks tune future suggestions</text>
      <text> </text>
      {suggestions.map((s) => (
        <box
          key={s}
          flexDirection="row"
          border
          borderColor={theme.border}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme.gold}>{"▸ "}</text>
          <text fg={theme.fg}>{s}</text>
        </box>
      ))}
    </box>
  );
}

function ConfigBar({ c }: { c: ChatControls }) {
  const fwLabel = c.framework ? (getFramework(c.framework)?.label ?? c.framework) : "none";
  const lensLabel =
    c.lens === null ? "none" : c.lens === "all" ? "all (×5)" : (getLens(c.lens)?.label ?? "none");
  return (
    <box flexDirection="row" paddingLeft={1} paddingRight={1}>
      <Chip
        label="⚖ Council"
        value={c.councilOn ? "ON" : "OFF"}
        active={c.councilOn}
        activeFg={theme.gold}
        onMouseDown={c.onToggleCouncil}
        paddingLeft={0}
      />
      <text fg={theme.fgFaint}>{" │ "}</text>
      <Chip
        label="◆ Framework"
        value={fwLabel}
        active={!!c.framework}
        onMouseDown={c.onCycleFramework}
      />
      <Chip label="◇ Lens" value={lensLabel} active={!!c.lens} onMouseDown={c.onCycleLens} />
      <Chip
        label="⬡ Web"
        value={c.webOn ? "ON" : "OFF"}
        active={c.webOn}
        onMouseDown={c.onToggleWeb}
      />
      <Chip
        label="▣ Save"
        value={c.saveOn ? "ON" : "OFF"}
        active={c.saveOn}
        onMouseDown={c.onToggleSave}
      />
      <Chip
        label="◉ Serendipity"
        value={c.serendipityOn ? "ON" : "OFF"}
        active={c.serendipityOn}
        onMouseDown={c.onToggleSerendipity}
      />
      <Chip label="◐ Auto" value={c.auto} active={c.auto !== "OFF"} onMouseDown={c.onCycleAuto} />
    </box>
  );
}

export function ChatView({
  domain,
  msgs,
  busy,
  engineLabel,
  suggestions,
  controls,
  inputRef,
  inputFocused,
  onSubmit,
}: {
  domain: DomainSummary;
  msgs: ChatMsg[];
  busy: boolean;
  /** active cli/model for this domain, e.g. "claude" or "codex · gpt-5". */
  engineLabel: string;
  /** starter-prompt titles from PROMPTS.md, shown on an empty thread. */
  suggestions: string[];
  controls: ChatControls;
  inputRef: React.RefObject<unknown>;
  inputFocused: boolean;
  onSubmit: (value: string) => void;
}) {
  const turns = msgs.filter((m) => m.role === "user").length;
  return (
    <box flexDirection="column" flexGrow={1}>
      <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
        {msgs.length === 0 ? (
          <box flexDirection="column" paddingTop={1}>
            {suggestions.length > 0 ? (
              <SuggestionCards suggestions={suggestions} />
            ) : (
              <text fg={theme.fgDim}>{`Ask ${domain.label ?? domain.name} anything.`}</text>
            )}
          </box>
        ) : (
          msgs.map((m) => <MessageRow key={m.id} msg={m} />)
        )}
      </scrollbox>

      {/* status line */}
      <box flexDirection="row" paddingLeft={1}>
        <text fg={theme.fgFaint}>
          {`${turns} msg${turns === 1 ? "" : "s"}`}
          {`  ·  ${engineLabel}`}
          {busy ? "  ·  streaming…" : "  ·  ready"}
        </text>
      </box>

      {/* config bar — the per-chat knobs */}
      <ConfigBar c={controls} />

      {/* input */}
      <box
        border
        borderColor={inputFocused ? theme.borderFocus : theme.inputBorder}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={theme.gold}>{busy ? "… " : "› "}</text>
        <input
          ref={inputRef as never}
          focused={inputFocused}
          placeholder="ask anything · / for commands · enter sends · esc back"
          onSubmit={((v: string) => onSubmit(v)) as never}
        />
      </box>
    </box>
  );
}
