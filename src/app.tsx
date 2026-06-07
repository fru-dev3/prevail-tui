import { useKeyboard, useRenderer } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Branding, type CliHealth } from "./branding.tsx";
import { type ChatMsg, ChatView } from "./chat.tsx";
import type {
  ChatEvent,
  CliKind,
  ContextScore,
  DomainManifest,
  DomainSummary,
  LifeScore,
  ScoreHistory,
} from "./contract.ts";
import { runCouncil } from "./council.ts";
import {
  type EngineOpts,
  engineVersion,
  getManifest,
  probeClis,
  scoreAll,
  scoreDomain,
  scoreHistory,
  setManifest,
  streamChat,
} from "./engine.ts";
import { scoreColor, shortenPath } from "./format.ts";
import { FRAMEWORKS, type FrameworkId, buildFrameworkPreamble, getFramework } from "./framework.ts";
import { LENSES, type LensSelection, buildLensPreamble, getLens } from "./lens.ts";
import { Overlay } from "./overlay.tsx";
import { HistoryView, type ManifestEdit, ManifestView, ScoreView, StateView } from "./panes.tsx";
import { Sidebar } from "./sidebar.tsx";
import { theme } from "./theme.ts";
import { type DomainDocs, readDomainDocs, readDomainPrompts } from "./vault.ts";

type Tab = "chat" | "state" | "score" | "manifest" | "history";
const TABS: Tab[] = ["chat", "state", "score", "manifest", "history"];
type Focus = "sidebar" | "chat" | "manifest-edit";

const CLI_KINDS: CliKind[] = ["claude", "codex", "antigravity", "gemini", "ollama"];

interface CliChoice {
  cli?: CliKind;
  model?: string;
}

const SLASH_HELP = [
  "/claude [model]   switch this domain's chat to claude (codex|gemini|antigravity|ollama too)",
  "/model <name>     set the model on the current cli · /model default clears it",
  "/council <q>      fan the question out to the panel + chair synthesis",
  "/state            jump to the state tab (read-only vault markdown)",
  "/score            jump to the score tab",
  "/audit            run a fresh LLM audit of this domain",
  "/manifest         jump to the manifest tab",
  "/history          jump to the score-history tab",
  "/clear            reset this domain's conversation",
  "/help             show this list",
  "/exit             return focus to the domain list (same as esc)",
].join("\n");

let nextId = 1;

export function App({
  vaultPath,
  domains,
  initialScores,
  appCount,
  engineVer,
}: {
  vaultPath: string;
  domains: DomainSummary[];
  initialScores: LifeScore | null;
  appCount: number;
  engineVer: string;
}) {
  const renderer = useRenderer();
  // Stable across renders so it's safe as an effect/callback dependency.
  const opts = useMemo<EngineOpts>(() => ({ vault: vaultPath }), [vaultPath]);

  const [domainIdx, setDomainIdx] = useState(0);
  const [focus, setFocus] = useState<Focus>("sidebar");
  const [tab, setTab] = useState<Tab>("chat");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  // banner defaults — client-side (the --json contract doesn't expose these).
  // Framework/lens preambles are prepended to the prompt; council toggles the
  // next turn to a panel fan-out; web is surfaced for parity (display-only).
  const [councilOn, setCouncilOn] = useState(false);
  const [framework, setFramework] = useState<FrameworkId | null>(null);
  const [lens, setLens] = useState<LensSelection>(null);
  const [webOn, setWebOn] = useState(true);
  const [saveOn, setSaveOn] = useState(true);
  const [serendipityOn, setSerendipityOn] = useState(false);
  const [auto, setAuto] = useState<"OFF" | "SUGGEST" | "AUTO">("OFF");
  const [cliHealth, setCliHealth] = useState<CliHealth[]>([]);

  // council composition — null = auto (every healthy CLI); a list overrides it.
  const [councilClis, setCouncilClis] = useState<CliKind[] | null>(null);
  const [councilChair, setCouncilChair] = useState<CliKind | null>(null);
  // which heavy panel is open as an overlay (configure / bench / tools), if any.
  const [overlay, setOverlay] = useState<"configure" | "bench" | "tools" | null>(null);

  // chat
  const [msgsByDomain, setMsgs] = useState<Record<string, ChatMsg[]>>({});
  const sessions = useRef<Record<string, string>>({});
  const [cliByDomain, setCliByDomain] = useState<Record<string, CliChoice>>({});
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
  const [prompts, setPrompts] = useState<Record<string, string[]>>({});
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

  // ── CLI health (probe once on boot; cheap `<cli> --version` each) ─────────────
  useEffect(() => {
    let cancelled = false;
    probeClis()
      .then((h) => {
        if (!cancelled) setCliHealth(h);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Cycle the framework: none → bluf → … → none.
  const cycleFramework = () =>
    setFramework((cur) => {
      const ids = FRAMEWORKS.map((f) => f.id);
      if (cur === null) return ids[0];
      const next = ids[ids.indexOf(cur) + 1];
      return next ?? null;
    });
  // Cycle the lens: none → all → each lens → none.
  const cycleLens = () =>
    setLens((cur) => {
      const ids = LENSES.map((l) => l.id);
      if (cur === null) return "all";
      if (cur === "all") return ids[0];
      const next = ids[ids.indexOf(cur as (typeof ids)[number]) + 1];
      return next ?? null;
    });
  const cycleAuto = () =>
    setAuto((a) => (a === "OFF" ? "SUGGEST" : a === "SUGGEST" ? "AUTO" : "OFF"));

  // ── starter prompts for the empty chat (cheap; load per domain on select) ─────
  useEffect(() => {
    if (!domain || prompts[domain.name]) return;
    const name = domain.name;
    let cancelled = false;
    readDomainPrompts(domain.path)
      .then((p) => {
        if (!cancelled) setPrompts((m) => ({ ...m, [name]: p }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [domain, prompts]);

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
    const choice = cliByDomain[name] ?? {};
    // Prepend the active framework + lens as bracket preambles (the cockpit's
    // approach — the contract has no flag for these).
    const preamble =
      buildFrameworkPreamble(getFramework(framework)) +
      buildLensPreamble(lens && lens !== "all" ? getLens(lens) : null);
    try {
      await streamChat(
        {
          domain: name,
          message: preamble + text,
          session: sessions.current[name],
          cli: choice.cli,
          model: choice.model,
          localOnly: !webOn,
        },
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

  // The council panel: an explicit override, else every healthy CLI, else a
  // claude+codex fallback. The chair is the override, else the first panelist.
  function resolvePanel(): { panelists: { cli: CliKind }[]; chair: { cli: CliKind } } {
    const healthy = cliHealth.filter((h) => h.ok).map((h) => h.kind as CliKind);
    const base = councilClis ?? (healthy.length ? healthy : (["claude", "codex"] as CliKind[]));
    const chairCli = councilChair ?? base[0] ?? "claude";
    return { panelists: base.map((cli) => ({ cli })), chair: { cli: chairCli } };
  }

  async function sendCouncil(name: string, prompt: string) {
    pushMsg(name, { id: nextId++, role: "user", text: prompt });
    const { panelists, chair } = resolvePanel();
    pushMsg(name, {
      id: nextId++,
      role: "system",
      cli: "council",
      text: `convening ${panelists.length} panelist${panelists.length === 1 ? "" : "s"} (${panelists
        .map((p) => p.cli)
        .join(", ")}) · chair ${chair.cli}`,
    });
    // one streaming bubble per panelist, then the chair's verdict bubble.
    const panelIds = panelists.map(() => nextId++);
    for (const [i, p] of panelists.entries()) {
      pushMsg(name, {
        id: panelIds[i],
        role: "assistant",
        cli: `panelist ${p.cli}`,
        text: "",
        streaming: true,
      });
    }
    const vid = nextId++;
    pushMsg(name, { id: vid, role: "council", text: "", streaming: true });
    markStreaming(name, true);
    try {
      const result = await runCouncil(
        {
          domain: name,
          prompt,
          panelists,
          chair,
          onPanelChunk: (idx, delta) => appendToMsg(name, panelIds[idx], delta),
          onVerdictChunk: (delta) => appendToMsg(name, vid, delta),
        },
        opts,
      );
      // finalize each panelist bubble with its authoritative text + status.
      for (const [i, p] of result.panel.entries()) {
        if (p.ok) {
          patchMsg(name, panelIds[i], {
            text: p.text || "(empty)",
            cli: `panelist ${p.cli} ✓`,
            streaming: false,
          });
        } else {
          patchMsg(name, panelIds[i], {
            text: `(no response${p.error ? `: ${p.error}` : ""})`,
            cli: "error",
            streaming: false,
          });
        }
      }
      if (!result.verdict) {
        patchMsg(name, vid, {
          text: result.degraded ? "(panel degraded — no verdict)" : "(no verdict)",
        });
      }
    } catch (err) {
      patchMsg(name, vid, { text: `⚠ ${errMsg(err)}`, cli: "error" });
    } finally {
      for (const id of panelIds) patchMsg(name, id, { streaming: false });
      patchMsg(name, vid, { streaming: false });
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

      // CLI switch: /claude /codex /gemini /antigravity /ollama [model]
      if ((CLI_KINDS as string[]).includes(cmd)) {
        const cli = cmd as CliKind;
        const model = arg || undefined;
        setCliByDomain((m) => ({ ...m, [name]: { cli, model } }));
        pushMsg(name, {
          id: nextId++,
          role: "system",
          text: `engine → ${cli}${model ? ` · ${model}` : ""}`,
          cli: "system",
        });
        return;
      }
      if (cmd === "model") {
        const model = arg && arg !== "default" ? arg : undefined;
        setCliByDomain((m) => ({ ...m, [name]: { ...(m[name] ?? {}), model } }));
        pushMsg(name, {
          id: nextId++,
          role: "system",
          text: model ? `model → ${model}` : "model cleared (cli default)",
          cli: "system",
        });
        return;
      }

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
    // With Council ON, every turn fans out to the panel + chair (the banner
    // toggle is the global default; /council always forces it too).
    const run = councilOn ? sendCouncil(name, text) : sendSingle(name, text);
    run.finally(() => setBusy(false));
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
    // An open overlay captures esc (close) and otherwise swallows keys.
    if (overlay) {
      if (name === "escape") setOverlay(null);
      return;
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
      case "tab":
        setTab((t) => TABS[(TABS.indexOf(t) + 1) % TABS.length]);
        break;
      case "left":
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
      <Branding
        domainCount={domains.length}
        totalLoops={openLoops}
        appCount={appCount}
        vaultLabel={shortenPath(vaultPath)}
        engineVersion={engineVer}
        now={now}
        councilOn={councilOn}
        framework={framework}
        lens={lens}
        webOn={webOn}
        onToggleCouncil={() => setCouncilOn((c) => !c)}
        onCycleFramework={cycleFramework}
        onCycleLens={cycleLens}
        onToggleWeb={() => setWebOn((w) => !w)}
        onConfigure={() => setOverlay("configure")}
        onBench={() => setOverlay("bench")}
        onTools={() => setOverlay("tools")}
        cliHealth={cliHealth}
      />

      <box flexDirection="row" flexGrow={1}>
        <Sidebar
          domains={domains}
          domainIdx={domainIdx}
          focused={focus === "sidebar"}
          scores={badges}
          streaming={streaming}
          onSelect={(i) => {
            setDomainIdx(i);
            setFocus("sidebar");
          }}
        />

        {/* detail pane — or a heavy panel overlay */}
        {overlay ? (
          <Overlay
            kind={overlay}
            onClose={() => setOverlay(null)}
            cliHealth={cliHealth}
            panel={resolvePanel().panelists.map((p) => p.cli)}
            chair={resolvePanel().chair.cli}
            onTogglePanelist={(cli) =>
              setCouncilClis((cur) => {
                const base = cur ?? resolvePanel().panelists.map((p) => p.cli);
                return base.includes(cli) ? base.filter((c) => c !== cli) : [...base, cli];
              })
            }
            onSetChair={(cli) => setCouncilChair(cli)}
            scores={domains.map((d) => ({ name: d.name, score: badges[d.name] }))}
            lifeReadiness={lifeReadiness}
            engineVer={engineVer}
            vaultLabel={shortenPath(vaultPath)}
            domainCount={domains.length}
            appCount={appCount}
          />
        ) : (
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
            <TabStrip
              tab={tab}
              cliHealth={cliHealth}
              activeCli={cliByDomain[domain?.name ?? ""]?.cli ?? "claude"}
              onSelectTab={(t) => {
                setTab(t);
                setFocus(t === "chat" ? "chat" : "sidebar");
              }}
              onSelectCli={(kind) => {
                if (!domain) return;
                setCliByDomain((m) => ({
                  ...m,
                  [domain.name]: { ...(m[domain.name] ?? {}), cli: kind },
                }));
              }}
            />
            {!domain ? (
              <box paddingLeft={1} paddingTop={1}>
                <text fg={theme.fgDim}>No domains.</text>
              </box>
            ) : tab === "chat" ? (
              <ChatView
                domain={domain}
                msgs={msgs}
                busy={busy}
                engineLabel={engineLabel(cliByDomain[domain.name])}
                suggestions={prompts[domain.name] ?? []}
                controls={{
                  councilOn,
                  framework,
                  lens,
                  webOn,
                  saveOn,
                  serendipityOn,
                  auto,
                  onToggleCouncil: () => setCouncilOn((c) => !c),
                  onCycleFramework: cycleFramework,
                  onCycleLens: cycleLens,
                  onToggleWeb: () => setWebOn((w) => !w),
                  onToggleSave: () => setSaveOn((s) => !s),
                  onToggleSerendipity: () => setSerendipityOn((s) => !s),
                  onCycleAuto: cycleAuto,
                }}
                inputRef={chatInputRef}
                inputFocused={focus === "chat"}
                onSubmit={submitChat}
                onFocusChat={() => setFocus("chat")}
                onPickSuggestion={(s) => {
                  setFocus("chat");
                  submitChat(s);
                }}
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
        )}
      </box>

      <Footer focus={focus} tab={tab} lifeReadiness={lifeReadiness} />
    </box>
  );
}

function TabStrip({
  tab,
  cliHealth,
  activeCli,
  onSelectTab,
  onSelectCli,
}: {
  tab: Tab;
  cliHealth: CliHealth[];
  activeCli: string;
  onSelectTab: (t: Tab) => void;
  onSelectCli: (kind: CliKind) => void;
}) {
  return (
    <box flexDirection="row" paddingLeft={1} paddingRight={1}>
      {TABS.map((t, i) => (
        <box key={t} onMouseDown={() => onSelectTab(t)}>
          <text fg={t === tab ? theme.gold : theme.fgDim} attributes={t === tab ? 1 : 0}>
            {`${i > 0 ? "  " : ""}${t === tab ? "[" : " "}${t}${t === tab ? "]" : " "}`}
          </text>
        </box>
      ))}
      <box flexGrow={1} />
      {/* CLI chips: health glyph + name; the active engine is marked ▸. Click to switch. */}
      {cliHealth.map((h) => {
        const on = h.ok === true;
        const isActive = h.kind === activeCli;
        const glyph = on ? "✓" : h.ok === false ? "⚠" : "·";
        const color = on ? theme.ok : h.ok === false ? theme.warn : theme.fgDim;
        return (
          <box
            key={h.kind}
            flexDirection="row"
            paddingLeft={1}
            onMouseDown={() => onSelectCli(h.kind as CliKind)}
          >
            <text fg={color}>{`${glyph} `}</text>
            <text fg={isActive ? theme.gold : theme.fgDim} attributes={isActive ? 1 : 0}>
              {`${isActive ? "▸" : ""}${h.label}`}
            </text>
          </box>
        );
      })}
    </box>
  );
}

function Footer({
  focus,
  tab,
  lifeReadiness,
}: {
  focus: Focus;
  tab: Tab;
  lifeReadiness: number | null;
}) {
  let hint: string;
  if (focus === "chat") hint = "enter send · ↑/↓ recall · /help commands · esc → domains";
  else if (focus === "manifest-edit") hint = "enter save · esc cancel";
  else if (tab === "score") hint = "↑/↓ domain · ←/→ tab · a audit · i chat · r refresh · q quit";
  else if (tab === "manifest")
    hint = "↑/↓ domain · ←/→ tab · e label · m summary · i chat · q quit";
  else hint = "↑/↓ domain · ←/→ tab (1-5) · i/⏎ chat · r refresh · q quit";
  return (
    <box flexDirection="row" paddingLeft={1} paddingRight={1}>
      <text fg={theme.fgFaint}>{hint}</text>
      <box flexGrow={1} />
      <text fg={theme.fgFaint}>life </text>
      {lifeReadiness === null ? (
        <text fg={theme.fgFaint}>··</text>
      ) : (
        <text fg={scoreColor(lifeReadiness)} attributes={1}>
          {String(lifeReadiness)}
        </text>
      )}
    </box>
  );
}

function engineLabel(choice: CliChoice | undefined): string {
  if (!choice?.cli) return "default cli";
  return choice.model ? `${choice.cli} · ${choice.model}` : choice.cli;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
