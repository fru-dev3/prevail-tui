import { useKeyboard, useRenderer } from "@opentui/react";
import { useRef, useState } from "react";
import type { ChatEvent, DomainSummary } from "./contract.ts";
import { runCouncil } from "./council.ts";
import { type EngineOpts, streamChat } from "./engine.ts";
import { theme } from "./theme.ts";

type Role = "user" | "assistant" | "system" | "council";
interface ChatMsg {
  id: number;
  role: Role;
  text: string;
  cli?: string;
  streaming?: boolean;
}

// A small default panel for /council. The CLI's --json chat is single-CLI, so
// council is fanned out client-side (see council.ts); panelists that aren't
// installed simply degrade out.
const DEFAULT_PANEL = [
  { cli: "claude" as const },
  { cli: "codex" as const },
  { cli: "gemini" as const },
];
const DEFAULT_CHAIR = { cli: "claude" as const };

let nextId = 1;

export function App({
  vaultPath,
  domains,
}: {
  vaultPath: string;
  domains: DomainSummary[];
}) {
  const renderer = useRenderer();
  const [domainIdx, setDomainIdx] = useState(0);
  const [focus, setFocus] = useState<"domains" | "input">("input");
  const [busy, setBusy] = useState(false);
  const [msgsByDomain, setMsgs] = useState<Record<string, ChatMsg[]>>({});
  const sessions = useRef<Record<string, string>>({});
  const inputRef = useRef<{
    value?: string;
    setText?: (s: string) => void;
    focus?: () => void;
  } | null>(null);

  const domain = domains[domainIdx];
  const opts: EngineOpts = { vault: vaultPath };
  const msgs = (domain && msgsByDomain[domain.name]) || [];

  const pushMsg = (name: string, msg: ChatMsg) =>
    setMsgs((m) => ({ ...m, [name]: [...(m[name] ?? []), msg] }));

  const patchMsg = (name: string, id: number, patch: Partial<ChatMsg>) =>
    setMsgs((m) => ({
      ...m,
      [name]: (m[name] ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }));

  // Append a streamed delta to a message (functional update — never reads
  // stale closure state, which the streaming callback would otherwise capture).
  const appendToMsg = (name: string, id: number, delta: string) =>
    setMsgs((m) => ({
      ...m,
      [name]: (m[name] ?? []).map((x) => (x.id === id ? { ...x, text: x.text + delta } : x)),
    }));

  async function sendSingle(name: string, text: string) {
    pushMsg(name, { id: nextId++, role: "user", text });
    const aid = nextId++;
    pushMsg(name, { id: aid, role: "assistant", text: "", streaming: true });
    const onEvent = (e: ChatEvent) => {
      if (e.type === "start" && e.thread) sessions.current[name] = e.thread;
      else if (e.type === "delta" && e.text) appendToMsg(name, aid, e.text);
      else if (e.type === "assistant") {
        // If deltas already streamed the body, keep it; otherwise use the
        // final text. Always record which engine answered.
        const finalText = e.text;
        setMsgs((m) => ({
          ...m,
          [name]: (m[name] ?? []).map((x) =>
            x.id === aid ? { ...x, cli: e.engine, text: x.text || finalText || x.text } : x,
          ),
        }));
      } else if (e.type === "error" && e.error)
        patchMsg(name, aid, { text: `⚠ ${e.error}`, cli: "error" });
    };
    try {
      await streamChat(
        { domain: name, message: text, session: sessions.current[name] },
        onEvent,
        opts,
      );
    } catch (err) {
      patchMsg(name, aid, { text: `⚠ ${errMsg(err)}`, cli: "error" });
    } finally {
      patchMsg(name, aid, { streaming: false });
    }
  }

  async function sendCouncil(name: string, prompt: string) {
    pushMsg(name, { id: nextId++, role: "user", text: `/council ${prompt}` });
    const cid = nextId++;
    pushMsg(name, { id: cid, role: "council", text: "convening…", streaming: true });
    let verdict = "";
    try {
      const result = await runCouncil(
        {
          domain: name,
          prompt,
          panelists: DEFAULT_PANEL,
          chair: DEFAULT_CHAIR,
          onVerdictChunk: (d) => {
            verdict += d;
            patchMsg(name, cid, { text: verdict });
          },
        },
        opts,
      );
      const panelLine = result.panel.map((p) => `${p.ok ? "✓" : "✗"} ${p.cli}`).join("  ");
      patchMsg(name, cid, {
        text: `${result.verdict || "(no verdict)"}\n\n— panel: ${panelLine}${result.degraded ? " (degraded)" : ""}`,
      });
    } catch (err) {
      patchMsg(name, cid, { text: `⚠ ${errMsg(err)}`, cli: "error" });
    } finally {
      patchMsg(name, cid, { streaming: false });
    }
  }

  function submit(raw: string) {
    const text = raw.trim();
    if (!text || busy || !domain) return;
    inputRef.current?.setText?.("");
    setBusy(true);
    const run = text.startsWith("/council ")
      ? sendCouncil(domain.name, text.slice("/council ".length).trim())
      : sendSingle(domain.name, text);
    run.finally(() => setBusy(false));
  }

  useKeyboard((evt) => {
    const name = evt.name;
    if (evt.ctrl && name === "c") {
      renderer?.destroy?.();
      process.exit(0);
    }
    if (focus === "input") {
      if (name === "escape") setFocus("domains");
      return; // input owns the rest
    }
    // sidebar focus
    if (name === "up") setDomainIdx((i) => Math.max(0, i - 1));
    else if (name === "down") setDomainIdx((i) => Math.min(domains.length - 1, i + 1));
    else if (name === "tab" || name === "return" || name === "i") setFocus("input");
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.bg}>
      {/* header */}
      <box flexDirection="row" paddingLeft={1} paddingRight={1}>
        <text fg={theme.ai} attributes={1}>
          prev
        </text>
        <text fg={theme.gold} attributes={1}>
          AI
        </text>
        <text fg={theme.ai} attributes={1}>
          l
        </text>
        <text fg={theme.fgFaint}> · tui · {shorten(vaultPath)}</text>
      </box>

      <box flexDirection="row" flexGrow={1}>
        {/* sidebar */}
        <box
          flexDirection="column"
          width={28}
          border
          borderColor={focus === "domains" ? theme.borderFocus : theme.border}
          backgroundColor={theme.bgPanel}
          bottomTitle=" LIFE DOMAINS "
        >
          {domains.map((d, i) => {
            const active = i === domainIdx;
            return (
              <text
                key={d.name}
                fg={active ? theme.selFg : theme.fg}
                bg={active ? theme.selBg : theme.bgPanel}
              >
                {active ? "› " : "  "}
                {d.emoji ? `${d.emoji} ` : "◆ "}
                {d.label ?? d.name}
              </text>
            );
          })}
        </box>

        {/* chat */}
        <box flexDirection="column" flexGrow={1} border borderColor={theme.border}>
          <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
            {msgs.length === 0 ? (
              <text fg={theme.fgFaint}>
                Ask {domain?.label ?? domain?.name ?? "a domain"} anything. Use
                {"  /council <question>  "}
                to convene the panel.
              </text>
            ) : (
              msgs.map((m) => <MessageRow key={m.id} msg={m} />)
            )}
          </box>
          <box paddingLeft={1} paddingRight={1}>
            <text fg={theme.gold}>{busy ? "… " : "› "}</text>
            <input
              ref={inputRef as never}
              focused={focus === "input"}
              placeholder={
                domain ? `message ${domain.name} · enter sends · esc → domains` : "no domains"
              }
              onSubmit={((v: string) => submit(v)) as never}
            />
          </box>
        </box>
      </box>

      {/* footer */}
      <box paddingLeft={1}>
        <text fg={theme.fgFaint}>↑/↓ domain · tab/i chat · esc back · /council · ctrl+c quit</text>
      </box>
    </box>
  );
}

function MessageRow({ msg }: { msg: ChatMsg }) {
  const tag =
    msg.role === "user"
      ? { label: "you", color: theme.ai }
      : msg.role === "council"
        ? { label: "council", color: theme.gold }
        : { label: msg.cli ?? "assistant", color: theme.goldBright };
  return (
    <box flexDirection="column">
      <text fg={tag.color} attributes={1}>
        {msg.role === "council" ? "◆ " : ""}
        {tag.label}
        {msg.streaming ? " ▌" : ""}
      </text>
      <text fg={msg.cli === "error" ? theme.err : theme.fg}>{msg.text}</text>
      <text> </text>
    </box>
  );
}

function shorten(p: string): string {
  const home = process.env.HOME ?? "";
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
