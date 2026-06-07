import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDomainDoc, readDomainDocs } from "./vault.ts";

const dirs: string[] = [];
async function domainDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prevail-tui-vault-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), body, "utf8");
  }
  return dir;
}

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe("readDomainDoc", () => {
  test("reads the v1 filename (state.md)", async () => {
    const dir = await domainDir({ "state.md": "# hi" });
    expect(await readDomainDoc(dir, "state")).toBe("# hi");
  });

  test("falls back to the v2 filename (_state.md)", async () => {
    const dir = await domainDir({ "_state.md": "# v2" });
    expect(await readDomainDoc(dir, "state")).toBe("# v2");
  });

  test("prefers earlier candidate when both exist", async () => {
    const dir = await domainDir({ "state.md": "v1", "_state.md": "v2" });
    expect(await readDomainDoc(dir, "state")).toBe("v1");
  });

  test("skips an empty file and tries the next candidate", async () => {
    const dir = await domainDir({ "state.md": "   \n", "_state.md": "real" });
    expect(await readDomainDoc(dir, "state")).toBe("real");
  });

  test("returns null when no candidate exists", async () => {
    const dir = await domainDir({ "other.md": "x" });
    expect(await readDomainDoc(dir, "state")).toBeNull();
    expect(await readDomainDoc(dir, "openloops")).toBeNull();
  });
});

describe("readDomainDocs", () => {
  test("reads state + open-loops together", async () => {
    const dir = await domainDir({ "state.md": "S", "open-loops.md": "O" });
    expect(await readDomainDocs(dir)).toEqual({ state: "S", openloops: "O" });
  });
});
