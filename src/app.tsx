import { useKeyboard, useRenderer } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Branding, type CliHealth } from "./branding.tsx";
import { type ChatMsg, ChatView } from "./chat.tsx";
import type {
  ChatEvent,
  CliKind,
  ContextScore,
  DecisionRecord,
  DomainManifest,
  DomainSummary,
  LifeScore,
  ModesState,
  ScoreHistory,
  SurfaceResult,
} from "./contract.ts";
import { runCouncil } from "./council.ts";
import {
  type EngineOpts,
  type ModesPatch,
  councilFeedback,
  engineVersion,
  getManifest,
  getModes,
  getPrivacy,
  listDecisions,
  probeClis,
  readMemory,
  scoreAll,
  scoreDomain,
  scoreHistory,
  searchHistory,
  setManifest,
  setModes,
  setPrivacy,
  streamChat,
  surface,
} from "./engine.ts";
import { scoreColor, shortenPath } from "./format.ts";
import { FRAMEWORKS, type FrameworkId, buildFrameworkPreamble, getFramework } from "./framework.ts";
import { LENSES, type LensSelection, buildLensPreamble, getLens } from "./lens.ts";
import { Overlay } from "./overlay.tsx";
import {
  HistoryView,
  InsightsView,
  type ManifestEdit,
  ManifestView,
  ScoreView,
  StateView,
} from "./panes.tsx";
import { Sidebar } from "./sidebar.tsx";
import { theme } from "./theme.ts";
import { type DomainDocs, readDomainDocs, readDomainPrompts } from "./vault.ts";

type Tab = "chat" | "insights" | "state" | "score" | "manifest" | "history";
const TABS: Tab[] = ["chat", "insights", "state", "score", "manifest", "history"];
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
  "/quorum <n|off>   stop a council once n panelists answer (a stuck one can't block)",
  "/feedback up|down [note]   rate the last council verdict (feeds learning)",
  "/bunker on|off    Bunker Mode — keep every turn on a local model",
  "/search <text>    full-text search across your chat history",
  "/insights         jump to the insights tab (surface · decisions · memory)",
  "/surface          regenerate proactive questions + next actions for this domain",
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
  // Bunker Mode (global local-only privacy switch) — synced with the engine so
  // the TUI shares one source of truth with the desktop. When on, every turn
  // (single + council) is forced local.
  const [bunkerOn, setBunkerOn] = useState(false);
  // Council quorum: stop waiting once N panelists answer (null = wait for all).
  const [quorum, setQuorum] = useState<number | null>(null);
  // The last persisted council verdict, so `/feedback up|down` can rate it.
  const lastDecision = useRef<{ id: string; domain: string } | null>(null);

  // insights tab caches (lazy, per domain)
  const [surfaces, setSurfaces] = useState<Record<string, SurfaceResult>>({});
  const [decisions, setDecisions] = useState<Record<string, DecisionRecord[]>>({});
  const [memories, setMemories] = useState<Record<string, string>>({});
  const [surfacing, setSurfacing] = useState<Set<string>>(new Set());

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

  // ── privacy (Bunker Mode) — read the persisted global switch once on boot ─────
  useEffect(() => {
    let cancelled = false;
    getPrivacy(opts)
      .then((p) => {
        if (!cancelled) setBunkerOn(p.bunker);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [opts]);

  // ── sync the config bar with the engine's per-domain modes on domain change ───
  // The banner toggles (web/save/serendipity/auto/framework/lens) are real,
  // engine-persisted state — load them so the TUI reflects (and shares) the
  // same config the desktop writes, instead of drifting client-side.
  useEffect(() => {
    if (!domain) return;
    let cancelled = false;
    getModes(domain.name, opts)
      .then((m: ModesState) => {
        if (cancelled) return;
        setWebOn(m.web === "allow");
        setSaveOn(m.save);
        setSerendipityOn(m.serendipity);
        setAuto(m.auto === "auto" ? "AUTO" : m.auto === "suggest" ? "SUGGEST" : "OFF");
        setFramework((m.framework.id as FrameworkId | null) ?? null);
        setLens((m.lens.sel as LensSelection) ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [domain, opts]);

  // Persist a modes patch for the active domain (fire-and-forget; the banner
  // already updated optimistically). Keeps the engine config in lock-step.
  const persistModes = (patch: ModesPatch) => {
    const name = domain?.name;
    if (!name) return;
    setModes(name, patch, opts).catch(() => {});
  };

  // Cycle the framework: none → bluf → … → none. Persisted to the engine.
  const cycleFramework = () => {
    const ids = FRAMEWORKS.map((f) => f.id);
    const next = framework === null ? (ids[0] ?? null) : (ids[ids.indexOf(framework) + 1] ?? null);
    setFramework(next);
    persistModes({ framework: next ?? "off" });
  };
  // Cycle the lens: none → all → each lens → none. Persisted to the engine.
  const cycleLens = () => {
    const ids = LENSES.map((l) => l.id);
    let next: LensSelection;
    if (lens === null) next = "all";
    else if (lens === "all") next = ids[0] ?? null;
    else next = ids[ids.indexOf(lens as (typeof ids)[number]) + 1] ?? null;
    setLens(next);
    persistModes({ lens: next === null ? "off" : next });
  };
  const cycleAuto = () => {
    const next = auto === "OFF" ? "SUGGEST" : auto === "SUGGEST" ? "AUTO" : "OFF";
    setAuto(next);
    persistModes({ auto: next.toLowerCase() as "off" | "suggest" | "auto" });
  };
  const toggleWeb = () => {
    const next = !webOn;
    setWebOn(next);
    persistModes({ web: next ? "allow" : "deny" });
  };
  const toggleSave = () => {
    const next = !saveOn;
    setSaveOn(next);
    persistModes({ save: next ? "on" : "off" });
  };
  const toggleSerendipity = () => {
    const next = !serendipityOn;
    setSerendipityOn(next);
    persistModes({ serendipity: next ? "on" : "off" });
  };

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
        } else if (tab === "insights") {
          // Decisions + long-term memory are cheap reads; load them if missing.
          if (!decisions[name]) {
            const d = await listDecisions(name, 12, opts);
            if (!cancelled) setDecisions((m) => ({ ...m, [name]: d }));
          }
          if (memories[name] === undefined) {
            const mem = await readMemory(name, opts);
            if (!cancelled) setMemories((m) => ({ ...m, [name]: mem.text }));
          }
        }
      } catch {
        // leave the pane in its loading state; a refresh (r) retries.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [domain, tab, scores, manifests, histories, docs, decisions, memories, opts]);

  // Generate (or regenerate) the proactive surface for a domain. Cached 6h by
  // the engine; --force re-runs. Runs local under Bunker.
  async function runSurface(name: string, force = false) {
    if (surfacing.has(name)) return;
    setSurfacing((s) => new Set(s).add(name));
    try {
      const r = await surface(name, force, { ...opts });
      setSurfaces((m) => ({ ...m, [name]: r }));
    } catch {
      // leave whatever's cached; the pane shows a hint to retry
    } finally {
      setSurfacing((s) => {
        const n = new Set(s);
        n.delete(name);
        return n;
      });
    }
  }

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
          // Bunker forces local; otherwise web-off also means local-only.
          localOnly: bunkerOn || !webOn,
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

  // The council panel override the user configured (CLIs / chair) in the
  // Configure overlay. The ENGINE owns the actual fan-out now; this just lets
  // the user restrict which CLI kinds participate. null = let the engine use
  // its saved council config.
  function resolvePanel(): { panelists: { cli: CliKind }[]; chair: { cli: CliKind } } {
    const healthy = cliHealth.filter((h) => h.ok).map((h) => h.kind as CliKind);
    const base = councilClis ?? (healthy.length ? healthy : (["claude", "codex"] as CliKind[]));
    const chairCli = councilChair ?? base[0] ?? "claude";
    return { panelists: base.map((cli) => ({ cli })), chair: { cli: chairCli } };
  }

  // Council, driven by the engine's `council run --json` NDJSON stream. The
  // panel is created reactively from the engine's `panel` event (the engine
  // decides the panel from its config), each panelist streams into its own
  // bubble, the chair's verdict streams into a final bubble, and the persisted
  // decision id is captured so `/feedback` can rate the verdict.
  async function sendCouncil(name: string, prompt: string) {
    pushMsg(name, { id: nextId++, role: "user", text: prompt });
    const sysId = nextId++;
    pushMsg(name, { id: sysId, role: "system", cli: "council", text: "convening the council…" });
    const panelIds: Record<number, number> = {};
    let verdictId: number | null = null;
    const ensureVerdict = (): number => {
      if (verdictId === null) {
        verdictId = nextId++;
        pushMsg(name, { id: verdictId, role: "council", text: "", streaming: true });
      }
      return verdictId;
    };
    markStreaming(name, true);
    try {
      const result = await runCouncil(
        {
          domain: name,
          prompt,
          quorum: quorum ?? undefined,
          lens,
          framework,
          clis: councilClis ?? undefined,
          localOnly: bunkerOn || !webOn,
          onPanel: (panelists) => {
            patchMsg(name, sysId, {
              text: `council of ${panelists.length}: ${panelists
                .map((p) => `${p.cli}${p.lens ? ` [${p.lens}]` : ""}`)
                .join(", ")}`,
            });
            for (const p of panelists) {
              const id = nextId++;
              panelIds[p.idx] = id;
              pushMsg(name, {
                id,
                role: "assistant",
                cli: `panelist ${p.cli}${p.lens ? ` [${p.lens}]` : ""}`,
                text: "",
                streaming: true,
              });
            }
          },
          onPanelChunk: (idx, delta) => {
            const id = panelIds[idx];
            if (id) appendToMsg(name, id, delta);
          },
          onPanelDone: (idx, ok, ms) => {
            const id = panelIds[idx];
            if (!id) return;
            setMsgs((m) => ({
              ...m,
              [name]: (m[name] ?? []).map((x) =>
                x.id === id
                  ? {
                      ...x,
                      streaming: false,
                      cli: ok
                        ? `${(x.cli ?? "panelist").replace(/ [✓·].*/, "")} ✓ ${(ms / 1000).toFixed(1)}s`
                        : "skipped",
                      text:
                        !ok && !x.text ? "(no response — skipped for quorum or failed)" : x.text,
                    }
                  : x,
              ),
            }));
          },
          onChair: () => ensureVerdict(),
          onVerdictChunk: (delta) => appendToMsg(name, ensureVerdict(), delta),
          onDecision: (id) => {
            lastDecision.current = { id, domain: name };
          },
        },
        opts,
      );
      const vid = ensureVerdict();
      if (!result.verdict) {
        patchMsg(name, vid, {
          text: result.error
            ? `⚠ ${result.error}`
            : result.degraded
              ? "(panel degraded — no verdict)"
              : "(no verdict)",
          cli: result.error ? "error" : undefined,
        });
      } else if (lastDecision.current?.domain === name) {
        // Hint how to rate the freshly-saved verdict.
        pushMsg(name, {
          id: nextId++,
          role: "system",
          cli: "help",
          text: "verdict saved · rate it with /feedback up  or  /feedback down [note]",
        });
      }
    } catch (err) {
      patchMsg(name, ensureVerdict(), { text: `⚠ ${errMsg(err)}`, cli: "error" });
    } finally {
      for (const id of Object.values(panelIds)) patchMsg(name, id, { streaming: false });
      if (verdictId !== null) patchMsg(name, verdictId, { streaming: false });
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
        case "quorum": {
          if (arg === "off" || arg === "0" || arg === "") {
            setQuorum(null);
            pushMsg(name, {
              id: nextId++,
              role: "system",
              cli: "system",
              text: "quorum off — council waits for every panelist",
            });
          } else {
            const n = Number.parseInt(arg, 10);
            if (Number.isNaN(n) || n < 1) {
              pushMsg(name, {
                id: nextId++,
                role: "system",
                cli: "error",
                text: "usage: /quorum <n|off>",
              });
            } else {
              setQuorum(n);
              pushMsg(name, {
                id: nextId++,
                role: "system",
                cli: "system",
                text: `quorum → ${n} (stop once ${n} answer; a stuck panelist can't block)`,
              });
            }
          }
          return;
        }
        case "feedback": {
          const decision = lastDecision.current;
          const [rating, ...noteParts] = arg.split(" ");
          const note = noteParts.join(" ").trim() || undefined;
          if (!decision) {
            pushMsg(name, {
              id: nextId++,
              role: "system",
              cli: "error",
              text: "no recent council verdict to rate",
            });
            return;
          }
          if (rating !== "up" && rating !== "down" && rating !== "clear") {
            pushMsg(name, {
              id: nextId++,
              role: "system",
              cli: "error",
              text: "usage: /feedback up|down|clear [note]",
            });
            return;
          }
          councilFeedback(decision.domain, decision.id, rating, note, opts)
            .then(() =>
              pushMsg(name, {
                id: nextId++,
                role: "system",
                cli: "help",
                text: `verdict rated ${rating}${note ? ` · "${note}"` : ""} — the council will learn from it`,
              }),
            )
            .catch((err) =>
              pushMsg(name, {
                id: nextId++,
                role: "system",
                cli: "error",
                text: `feedback failed: ${errMsg(err)}`,
              }),
            );
          return;
        }
        case "bunker": {
          const on = arg === "on" || arg === "true" || arg === "1";
          const off = arg === "off" || arg === "false" || arg === "0";
          if (!on && !off) {
            pushMsg(name, {
              id: nextId++,
              role: "system",
              cli: "error",
              text: "usage: /bunker on|off",
            });
            return;
          }
          setBunkerOn(on);
          setPrivacy(on, opts)
            .then(() =>
              pushMsg(name, {
                id: nextId++,
                role: "system",
                cli: on ? "council" : "system",
                text: on
                  ? "Bunker Mode ON — every turn stays on a local model"
                  : "Bunker Mode off — cloud engines available again",
              }),
            )
            .catch(() => {});
          return;
        }
        case "search": {
          if (!arg) {
            pushMsg(name, {
              id: nextId++,
              role: "system",
              cli: "error",
              text: "usage: /search <text>",
            });
            return;
          }
          pushMsg(name, {
            id: nextId++,
            role: "system",
            cli: "system",
            text: `searching for "${arg}"…`,
          });
          searchHistory(arg, 12, opts)
            .then((hits) => {
              if (hits.length === 0) {
                pushMsg(name, {
                  id: nextId++,
                  role: "system",
                  cli: "help",
                  text: `no matches for "${arg}"`,
                });
                return;
              }
              const body = hits
                .map(
                  (h) =>
                    `· [${h.domain}/${h.role}] ${h.content.replace(/\s+/g, " ").slice(0, 120)}`,
                )
                .join("\n");
              pushMsg(name, {
                id: nextId++,
                role: "system",
                cli: "help",
                text: `${hits.length} match${hits.length === 1 ? "" : "es"}:\n${body}`,
              });
            })
            .catch((err) =>
              pushMsg(name, {
                id: nextId++,
                role: "system",
                cli: "error",
                text: `search failed: ${errMsg(err)}`,
              }),
            );
          return;
        }
        case "insights":
          setTab("insights");
          return;
        case "surface":
          setTab("insights");
          runSurface(name, true);
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
      case "6":
        setTab(TABS[Number(name) - 1]);
        break;
      case "i":
      case "return":
        setTab("chat");
        setFocus("chat");
        break;
      case "a":
        if (tab === "score" && domain) runAudit(domain.name);
        else if (tab === "insights" && domain) runSurface(domain.name, true);
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
        bunkerOn={bunkerOn}
        onToggleCouncil={() => setCouncilOn((c) => !c)}
        onCycleFramework={cycleFramework}
        onCycleLens={cycleLens}
        onToggleWeb={toggleWeb}
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
                  onToggleWeb: toggleWeb,
                  onToggleSave: toggleSave,
                  onToggleSerendipity: toggleSerendipity,
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
            ) : tab === "insights" ? (
              <InsightsView
                surface={surfaces[domain.name]}
                surfacing={surfacing.has(domain.name)}
                decisions={decisions[domain.name]}
                memory={memories[domain.name]}
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
