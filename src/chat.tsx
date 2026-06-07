/**
 * Chat view: transcript rendering + the message input. Conversation state and
 * the engine streaming live in app.tsx; this file is presentation + the input
 * seam. Council replies render as a distinct gold-tagged role.
 */
import type { DomainSummary } from "./contract.ts";
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
  // Render engine replies (assistant/council) as markdown; keep the user's own
  // text, system notes, and errors literal.
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

export function ChatView({
  domain,
  msgs,
  busy,
  engineLabel,
  inputRef,
  inputFocused,
  onSubmit,
}: {
  domain: DomainSummary;
  msgs: ChatMsg[];
  busy: boolean;
  /** active cli/model for this domain, e.g. "claude" or "codex · gpt-5". */
  engineLabel: string;
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
            <text fg={theme.fgDim}>{`Ask ${domain.label ?? domain.name} anything.`}</text>
            <text fg={theme.fgFaint}>{"/council <q> · /score · /audit · /clear · /help"}</text>
          </box>
        ) : (
          msgs.map((m) => <MessageRow key={m.id} msg={m} />)
        )}
      </scrollbox>

      {/* status line */}
      <box flexDirection="row" paddingLeft={1}>
        <text fg={theme.fgFaint}>
          {turns > 0 ? `${turns} turn${turns === 1 ? "" : "s"}` : "new thread"}
          {`  ·  ${engineLabel}`}
          {busy ? "  ·  streaming…" : ""}
        </text>
      </box>

      {/* input */}
      <box paddingLeft={1} paddingRight={1}>
        <text fg={theme.gold}>{busy ? "… " : "› "}</text>
        <input
          ref={inputRef as never}
          focused={inputFocused}
          placeholder={`message ${domain.name} · enter sends · esc → domains`}
          onSubmit={((v: string) => onSubmit(v)) as never}
        />
      </box>
    </box>
  );
}
