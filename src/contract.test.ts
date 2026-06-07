import { describe, expect, test } from "bun:test";
import { isJsonError } from "./contract.ts";

describe("isJsonError", () => {
  test("matches the engine's failure envelope", () => {
    expect(isJsonError({ ok: false, error: "boom", code: "X" })).toBe(true);
  });
  test("rejects success-shaped values", () => {
    expect(isJsonError({ ok: true })).toBe(false);
    expect(isJsonError({ domain: "wealth", score: 73 })).toBe(false);
    expect(isJsonError([{ ts: 1, score: 50 }])).toBe(false);
  });
  test("rejects non-objects and a missing error string", () => {
    expect(isJsonError(null)).toBe(false);
    expect(isJsonError("nope")).toBe(false);
    expect(isJsonError({ ok: false })).toBe(false);
    expect(isJsonError({ ok: false, error: 42 })).toBe(false);
  });
});
