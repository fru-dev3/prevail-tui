import { describe, expect, test } from "bun:test";
import {
  bar,
  isoToMs,
  relativeTime,
  scoreColor,
  severityColor,
  severityGlyph,
  shortenPath,
  sparkline,
  titleCase,
} from "./format.ts";
import { theme } from "./theme.ts";

describe("scoreColor", () => {
  test("green at/above 70", () => {
    expect(scoreColor(70)).toBe(theme.ok);
    expect(scoreColor(100)).toBe(theme.ok);
  });
  test("amber in [40,70)", () => {
    expect(scoreColor(40)).toBe(theme.warn);
    expect(scoreColor(69)).toBe(theme.warn);
  });
  test("red below 40", () => {
    expect(scoreColor(0)).toBe(theme.err);
    expect(scoreColor(39)).toBe(theme.err);
  });
});

describe("bar", () => {
  test("empty and full", () => {
    expect(bar(0, 10)).toBe("░░░░░░░░░░");
    expect(bar(100, 10)).toBe("██████████");
  });
  test("half fills five of ten", () => {
    expect(bar(50, 10)).toBe("█████░░░░░");
  });
  test("clamps out-of-range values", () => {
    expect(bar(-20, 4)).toBe("░░░░");
    expect(bar(999, 4)).toBe("████");
  });
});

describe("sparkline", () => {
  test("empty series → empty string", () => {
    expect(sparkline([])).toBe("");
  });
  test("low → bottom tick, high → top tick", () => {
    expect(sparkline([0])).toBe("▁");
    expect(sparkline([100])).toBe("█");
  });
  test("length matches input", () => {
    expect(sparkline([10, 50, 90]).length).toBe(3);
  });
});

describe("relativeTime", () => {
  const now = 1_000_000_000_000;
  test("null/undefined → never", () => {
    expect(relativeTime(null, now)).toBe("never");
    expect(relativeTime(undefined, now)).toBe("never");
  });
  test("recent → just now", () => {
    expect(relativeTime(now - 1000, now)).toBe("just now");
  });
  test("minutes / hours / days", () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});

describe("isoToMs", () => {
  test("parses an ISO string", () => {
    expect(isoToMs("2026-01-01T00:00:00.000Z")).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });
  test("null-safe + rejects garbage", () => {
    expect(isoToMs(null)).toBeNull();
    expect(isoToMs(undefined)).toBeNull();
    expect(isoToMs("not-a-date")).toBeNull();
  });
});

describe("severity", () => {
  test("colors", () => {
    expect(severityColor("critical")).toBe(theme.err);
    expect(severityColor("warn")).toBe(theme.warn);
    expect(severityColor("info")).toBe(theme.fgDim);
    expect(severityColor(undefined)).toBe(theme.fgDim);
  });
  test("glyphs", () => {
    expect(severityGlyph("critical")).toBe("▲");
    expect(severityGlyph("warn")).toBe("◆");
    expect(severityGlyph("info")).toBe("·");
  });
});

describe("shortenPath", () => {
  test("replaces $HOME with ~", () => {
    const home = process.env.HOME ?? "";
    if (home) expect(shortenPath(`${home}/x/y`)).toBe("~/x/y");
    expect(shortenPath("/etc/hosts")).toBe("/etc/hosts");
  });
});

describe("titleCase", () => {
  test("kebab + snake → spaced Title Case", () => {
    expect(titleCase("real-estate")).toBe("Real Estate");
    expect(titleCase("config_completeness")).toBe("Config Completeness");
    expect(titleCase("wealth")).toBe("Wealth");
  });
});
