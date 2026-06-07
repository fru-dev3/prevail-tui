#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app.tsx";
import type { DomainSummary, LifeScore } from "./contract.ts";
import { EngineError, listDomains, resolvePrevailBin, scoreAll } from "./engine.ts";

const HELP = `prevail-tui — terminal cockpit for the prevail engine

USAGE
  prevail-tui [--vault <path>]

OPTIONS
  --vault <path>   Vault root (defaults to ~/.prevail/config.json's vaultPath)
  -h, --help       Show this help
  -v, --version    Show version

This is a thin client: it drives the installed \`prevail\` binary through its
--json/NDJSON contract (the same seam the desktop app uses). It does not bundle
or reimplement the engine — \`prevail\` must be installed and on PATH.
`;

function parseArgs(argv: string[]): { vault: string | null; help: boolean; version: boolean } {
  let vault: string | null = null;
  let help = false;
  let version = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault") vault = argv[++i] ?? null;
    else if (a === "-h" || a === "--help") help = true;
    else if (a === "-v" || a === "--version") version = true;
  }
  return { vault, help, version };
}

function configuredVaultPath(): string | null {
  const cfgPath = join(homedir(), ".prevail", "config.json");
  if (!existsSync(cfgPath)) return null;
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as { vaultPath?: string };
    return cfg.vaultPath ?? null;
  } catch {
    return null;
  }
}

function die(msg: string, code = 1): never {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (args.version) {
    process.stdout.write("prevail-tui 0.1.0\n");
    process.exit(0);
  }

  const vaultPath = args.vault ?? configuredVaultPath();
  if (!vaultPath) {
    die(
      "No vault found. Pass --vault <path>, or run `prevail init` to configure one\n" +
        "(this TUI reads ~/.prevail/config.json for the default vault).",
    );
  }
  if (!existsSync(vaultPath)) {
    die(`Vault path does not exist: ${vaultPath}`);
  }

  // Load domains through the engine's --json contract. This also validates that
  // the prevail binary is installed and reachable.
  let domains: DomainSummary[];
  try {
    domains = await listDomains({ vault: vaultPath });
  } catch (err) {
    if (err instanceof EngineError) {
      die(`Engine error (${err.code}): ${err.message}`);
    }
    die(
      `Could not run the prevail engine ("${resolvePrevailBin()}").\nInstall it (see fd-apps-prevail-cli) and ensure it is on PATH.\nUnderlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (domains.length === 0) {
    die(`No domains in vault: ${vaultPath}\nCreate one with \`prevail\` or \`prevail onboard\`.`);
  }

  // Prefetch life-readiness + per-domain score badges so the cockpit opens
  // already populated. Non-fatal: the sidebar simply shows "··" until a tab
  // visit computes a domain's score on demand.
  let initialScores: LifeScore | null = null;
  try {
    initialScores = await scoreAll({ vault: vaultPath });
  } catch {
    initialScores = null;
  }

  const renderer = await createCliRenderer({
    targetFps: 60,
    exitOnCtrlC: true,
    useMouse: true,
  });
  createRoot(renderer).render(
    <App vaultPath={vaultPath} domains={domains} initialScores={initialScores} />,
  );
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
