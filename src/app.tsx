import { useKeyboard, useRenderer } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type ChatMsg, ChatView } from "./chat.tsx";
import type {
  ChatEvent,
  ContextScore,
  DomainManifest,
  DomainSummary,
  LifeScore,
  ScoreHistory,
} from "./contract.ts";
import { runCouncil } from "./council.ts";
import {
  type EngineOpts,
  getManifest,
  scoreAll,
  scoreDomain,
  scoreHistory,
  setManifest,
  streamChat,
} from "./engine.ts";
import { HistoryView, type ManifestEdit, ManifestView, ScoreView, StateView } from "./panes.tsx";
import { Header, Sidebar } from "./sidebar.tsx";
import { theme } from "./theme.ts";
import { type DomainDocs, readDomainDocs } from "./vault.ts";

type Tab = "chat" | "state" | "score" | "manifest" | "history";
const TABS: Tab[] = ["chat", "state", "score", "manifest", "history"];
type Focus = "sidebar" | "chat" | "manifest-edit";

// A small default panel for /council — fanned out client-side (see council.ts);
// panelists that aren't installed simply degrade out.
const DEFAULT_PANEL = [
  { cli: "claude" as const },
  { cli: "codex" as const },
  { cli: "gemini" as const },
];
const DEFAULT_CHAIR = { cli: "claude" as const };

const SLASH_HELP = [
  "/council <q>   fan the question out to the panel + chair synthesis",
  "/state         jump to the state tab (read-only vault markdown)",
  "/score         jump to the score tab",
  "/audit         run a fresh LLM audit of this domain",
  "/manifest      jump to the manifest tab",
  "/history       jump to the score-history tab",
  "/clear         reset this domain's conversation",
  "/help          show this list",
  "/exit          return focus to the domain list (same as esc)",
].join("\n");

let nextId = 1;

export function App({
  vaultPath,
  domains,
  initialScores,
}: {
  vaultPath: string;
  domains: DomainSummary[];
  initialScores: LifeScore | null;
}) {
  const renderer = useRenderer();
  // Stable across renders so it's safe as an effect/callback dependency.
  const opts = useMemo<EngineOpts>(() => ({ vault: vaultPath }), [vaultPath]);

  const [domainIdx, setDomainIdx] = useState(0);
  const [focus, setFocus] = useState<Focus>("sidebar");
  const [tab, setTab] = useState<Tab>("chat");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  // chat
  const [msgsByDomain, setMsgs] = useState<Record<string, ChatMsg[]>>({});
  const sessions = useRef<Record<string, string>>({});
  const promptHistory = useRef<Record<string, string[]>>({});
  const recallIdx = useRef<number>(-1);
  const chatInputRef = useRef<{ value?: string; setText?: (s: string) => void } | null>(null);
  const [streaming, setStreaming] = useState<Set<string>>(new Set());

  // detail caches (lazy, per domain)
  const [scores, setScores] = useState<Record<string, ContextScore>>({});
  const [badges, setBadges] = useState<Record<string, number>>(() =>
    Object.fromEntries((initialScores?.domains ?? []).map((d) => [d.domain, d.score])),
  );
  const [lifeReadiness, setLifeReadiness] = useState<number | null>(
    initialScores?.lifeReadiness ?? null,
  );
  const [manifests, setManifests] = useState<Record<string, DomainManifest>>({});
  const [histories, setHistories] = useState<Record<string, ScoreHistory>>({});
  const [docs, setDocs] = useState<Record<string, DomainDocs>>({});
  const [auditing, setAuditing] = useState<Set<string>>(new Set());

  // manifest editing
  const [manifestEdit, setManifestEdit] = useState<ManifestEdit | null>(null);
  const manifestInputRef = useRef<{ value?: string } | null>(null);

  const domain = domains[domainIdx];
  const msgs = (domain && msgsByDomain[domain.name]) || [];
  const openLoops = domains.reduce((n, d) => n + (d.openLoopCount || 0), 0);

  // ── live clock ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ── lazy-load the data the active tab needs for the active domain ─────────────
  useEffect(() => {
    if (!domain) return;
    const name = domain.name;
    let cancelled = false;
    (async () => {
      try {
        if (tab === "state" && !docs[name]) {
          const d = await readDomainDocs(domain.path);
          if (!cancelled) setDocs((m) => ({ ...m, [name]: d }));
        } else if (tab === "score" && !scores[name]) {
          const s = await scoreDomain(name, false, opts);
          if (!cancelled) {
            setScores((m) => ({ ...m, [name]: s }));
            setBadges((m) => ({ ...m, [name]: s.score }));
          }
        } else if (tab === "manifest" && !manifests[name]) {
          const mf = await getManifest(name, opts);
          if (!cancelled) setManifests((m) => ({ ...m, [name]: mf }));
        } else if (tab === "history" && !histories[name]) {
          const h = await scoreHistory(name, opts);
          if (!cancelled) setHistories((m) => ({ ...m, [name]: h }));
        }
      } catch {
        // leave the pane in its loading state; a refresh (r) retries.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [domain, tab, scores, manifests, histories, docs, opts]);

  // ── chat helpers ──────────────────────────────────────────────────────────────
  const pushMsg = (name: string, msg: ChatMsg) =>
    setMsgs((m) => ({ ...m, [name]: [...(m[name] ?? []), msg] }));
  const patchMsg = (name: string, id: number, patch: Partial<ChatMsg>) =>
    setMsgs((m) => ({
      ...m,
      [name]: (m[name] ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }));
  const appendToMsg = (name: string, id: number, delta: string) =>
    setMsgs((m) => ({
      ...m,
      [name]: (m[name] ?? []).map((x) => (x.id === id ? { ...x, text: x.text + delta } : x)),
    }));

  const markStreaming = (name: string, on: boolean) =>
    setStreaming((s) => {
      const next = new Set(s);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });

  async function sendSingle(name: string, text: string) {
    pushMsg(name, { id: nextId++, role: "user", text });
    const aid = nextId++;
    pushMsg(name, { id: aid, role: "assistant", text: "", streaming: true });
    markStreaming(name, true);
    const onEvent = (e: ChatEvent) => {
      if (e.type === "start" && e.thread) sessions.current[name] = e.thread;
      else if (e.type === "delta" && e.text) appendToMsg(name, aid, e.text);
      else if (e.type === "assistant") {
        setMsgs((m) => ({
          ...m,
          [name]: (m[name] ?? []).map((x) =>
            x.id === aid ? { ...x, cli: e.engine, text: x.text || e.text || x.text } : x,
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
      markStreaming(name, false);
    }
  }

  async function sendCouncil(name: string, prompt: string) {
    pushMsg(name, { id: nextId++, role: "user", text: `/council ${prompt}` });
    const cid = nextId++;
    pushMsg(name, { id: cid, role: "council", text: "convening the panel…", streaming: true });
    markStreaming(name, true);
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
        text: `${result.verdict || "(no verdict — every panelist failed)"}\n\n— panel: ${panelLine}${result.degraded ? " (degraded)" : ""}`,
      });
    } catch (err) {
      patchMsg(name, cid, { text: `⚠ ${errMsg(err)}`, cli: "error" });
    } finally {
      patchMsg(name, cid, { streaming: false });
      markStreaming(name, false);
    }
  }

  // ── score audit ───────────────────────────────────────────────────────────────
  async function runAudit(name: string) {
    if (auditing.has(name)) return;
    setAuditing((s) => new Set(s).add(name));
    try {
      const s = await scoreDomain(name, true, opts);
      setScores((m) => ({ ...m, [name]: s }));
      setBadges((m) => ({ ...m, [name]: s.score }));
    } catch {
      // ignore; the cached score stays visible
    } finally {
      setAuditing((set) => {
        const next = new Set(set);
        next.delete(name);
        return next;
      });
    }
  }

  // Re-roll life readiness + every sidebar badge from a fresh `score --all`.
  async function refreshAll() {
    try {
      const all = await scoreAll(opts);
      setLifeReadiness(all.lifeReadiness);
      setBadges(Object.fromEntries(all.domains.map((d) => [d.domain, d.score])));
    } catch {
      // keep the stale aggregate on failure
    }
  }

  // ── manifest editing ────────────────────────────────────────────────────────────
  function beginEdit(field: ManifestEdit["field"]) {
    if (!manifests[domain?.name ?? ""]) return;
    setManifestEdit({ field });
    setFocus("manifest-edit");
  }
  async function commitEdit(value: string) {
    const name = domain?.name;
    const field = manifestEdit?.field;
    setManifestEdit(null);
    setFocus("sidebar");
    if (!name || !field) return;
    const v = value.trim();
    try {
      const mf = await setManifest(name, { identity: { [field]: v } }, opts);
      setManifests((m) => ({ ...m, [name]: mf }));
    } catch {
      // ignore — manifest stays as-is
    }
  }

  // ── command routing ─────────────────────────────────────────────────────────────
  function submitChat(raw: string) {
    const text = raw.trim();
    if (!text || busy || !domain) return;
    chatInputRef.current?.setText?.("");
    const name = domain.name;
    if (!promptHistory.current[name]) promptHistory.current[name] = [];
    if (!text.startsWith("/")) promptHistory.current[name].push(text);
    recallIdx.current = -1;

    if (text.startsWith("/")) {
      const [cmd, ...rest] = text.slice(1).split(" ");
      const arg = rest.join(" ").trim();
      switch (cmd) {
        case "council":
          if (arg) {
            setBusy(true);
            sendCouncil(name, arg).finally(() => setBusy(false));
          }
          return;
        case "state":
          setTab("state");
          return;
        case "score":
          setTab("score");
          return;
        case "audit":
          setTab("score");
          runAudit(name);
          return;
        case "manifest":
          setTab("manifest");
          return;
        case "history":
          setTab("history");
          return;
        case "clear":
          setMsgs((m) => ({ ...m, [name]: [] }));
          delete sessions.current[name];
          return;
        case "help":
          pushMsg(name, { id: nextId++, role: "system", text: SLASH_HELP, cli: "help" });
          return;
        case "exit":
          setFocus("sidebar");
          return;
        default:
          pushMsg(name, {
            id: nextId++,
            role: "system",
            text: `unknown command /${cmd} — try /help`,
            cli: "error",
          });
          return;
      }
    }
    setBusy(true);
    sendSingle(name, text).finally(() => setBusy(false));
  }

  function recall(dir: -1 | 1) {
    const name = domain?.name;
    if (!name) return;
    const hist = promptHistory.current[name] ?? [];
    if (hist.length === 0) return;
    if (recallIdx.current === -1) recallIdx.current = hist.length;
    recallIdx.current = Math.max(0, Math.min(hist.length, recallIdx.current + dir));
    const value = recallIdx.current >= hist.length ? "" : hist[recallIdx.current];
    chatInputRef.current?.setText?.(value);
  }

  // ── keyboard ────────────────────────────────────────────────────────────────────
  useKeyboard((evt) => {
    const name = evt.name;
    if (evt.ctrl && name === "c") {
      renderer?.destroy?.();
      process.exit(0);
    }
    if (focus === "manifest-edit") {
      if (name === "escape") {
        setManifestEdit(null);
        setFocus("sidebar");
      }
      return; // input owns the rest
    }
    if (focus === "chat") {
      if (name === "escape") setFocus("sidebar");
      else if (name === "up") recall(-1);
      else if (name === "down") recall(1);
      return; // input owns typing + enter
    }

    // sidebar focus
    switch (name) {
      case "up":
      case "k":
        setDomainIdx((i) => Math.max(0, i - 1));
        break;
      case "down":
      case "j":
        setDomainIdx((i) => Math.min(domains.length - 1, i + 1));
        break;
      case "g":
        setDomainIdx(0);
        break;
      case "G":
        setDomainIdx(domains.length - 1);
        break;
      case "right":
      case "l":
      case "tab":
        setTab((t) => TABS[(TABS.indexOf(t) + 1) % TABS.length]);
        break;
      case "left":
      case "h":
        setTab((t) => TABS[(TABS.indexOf(t) + TABS.length - 1) % TABS.length]);
        break;
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
        setTab(TABS[Number(name) - 1]);
        break;
      case "i":
      case "return":
        setTab("chat");
        setFocus("chat");
        break;
      case "a":
        if (tab === "score" && domain) runAudit(domain.name);
        break;
      case "e":
        if (tab === "manifest") beginEdit("label");
        break;
      case "m":
        if (tab === "manifest") beginEdit("summary");
        break;
      case "r":
        if (domain) {
          // drop caches for this domain so the active tab refetches, and
          // re-roll the life-readiness aggregate + all sidebar badges.
          setScores((m) => {
            const n = { ...m };
            delete n[domain.name];
            return n;
          });
          setManifests((m) => {
            const n = { ...m };
            delete n[domain.name];
            return n;
          });
          setHistories((m) => {
            const n = { ...m };
            delete n[domain.name];
            return n;
          });
          setDocs((m) => {
            const n = { ...m };
            delete n[domain.name];
            return n;
          });
          refreshAll();
        }
        break;
      case "q":
        renderer?.destroy?.();
        process.exit(0);
        break;
    }
  });

  // ── render ──────────────────────────────────────────────────────────────────────
  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.bg}>
      <Header
        vaultPath={vaultPath}
        lifeReadiness={lifeReadiness}
        domainCount={domains.length}
        openLoops={openLoops}
        now={now}
      />

      <box flexDirection="row" flexGrow={1}>
        <Sidebar
          domains={domains}
          domainIdx={domainIdx}
          focused={focus === "sidebar"}
          scores={badges}
          streaming={streaming}
        />

        {/* detail pane */}
        <box
          flexDirection="column"
          flexGrow={1}
          border
          borderColor={focus === "chat" ? theme.borderFocus : theme.border}
          title={domain ? ` ${domain.label ?? domain.name} ` : " — "}
          bottomTitle={
            domain
              ? ` updated ${domain.openLoopCount} open · ${domain.hasState ? "state ✓" : "no state"} `
              : ""
          }
        >
          <TabStrip tab={tab} />
          {!domain ? (
            <box paddingLeft={1} paddingTop={1}>
              <text fg={theme.fgDim}>No domains.</text>
            </box>
          ) : tab === "chat" ? (
            <ChatView
              domain={domain}
              msgs={msgs}
              busy={busy}
              inputRef={chatInputRef}
              inputFocused={focus === "chat"}
              onSubmit={submitChat}
            />
          ) : tab === "state" ? (
            <StateView docs={docs[domain.name]} />
          ) : tab === "score" ? (
            <ScoreView score={scores[domain.name]} auditing={auditing.has(domain.name)} />
          ) : tab === "manifest" ? (
            <ManifestView
              manifest={manifests[domain.name]}
              editing={manifestEdit}
              inputRef={manifestInputRef}
              onSubmit={commitEdit}
            />
          ) : (
            <HistoryView history={histories[domain.name]} />
          )}
        </box>
      </box>

      <Footer focus={focus} tab={tab} />
    </box>
  );
}

function TabStrip({ tab }: { tab: Tab }) {
  return (
    <box flexDirection="row" paddingLeft={1}>
      {TABS.map((t, i) => (
        <text key={t} fg={t === tab ? theme.gold : theme.fgFaint} attributes={t === tab ? 1 : 0}>
          {`${i > 0 ? "  " : ""}${t === tab ? "[" : " "}${t}${t === tab ? "]" : " "}`}
        </text>
      ))}
    </box>
  );
}

function Footer({ focus, tab }: { focus: Focus; tab: Tab }) {
  let hint: string;
  if (focus === "chat") hint = "enter send · ↑/↓ recall · /help commands · esc → domains";
  else if (focus === "manifest-edit") hint = "enter save · esc cancel";
  else if (tab === "score") hint = "↑/↓ domain · ←/→ tab · a audit · i chat · r refresh · q quit";
  else if (tab === "manifest")
    hint = "↑/↓ domain · ←/→ tab · e label · m summary · i chat · q quit";
  else hint = "↑/↓ domain · ←/→ tab (1-5) · i/⏎ chat · r refresh · q quit";
  return (
    <box paddingLeft={1}>
      <text fg={theme.fgFaint}>{hint}</text>
    </box>
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
