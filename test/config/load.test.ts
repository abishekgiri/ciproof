import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config/load.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ciproof-cfg-"));
  dirs.push(root);
  return root;
}

const GOOD = `version: 1
invariants:
  - id: forks-cannot-publish
    require:
      job-not-reachable:
        job: publish
        trust: fork
`;

describe("loadConfig — discovery", () => {
  it("returns 'none' when no config exists", () => {
    expect(loadConfig({ root: tempRoot() }).status).toBe("none");
  });

  it("loads ciproof.yml", () => {
    const root = tempRoot();
    writeFileSync(join(root, "ciproof.yml"), GOOD);
    const result = loadConfig({ root });
    expect(result.status).toBe("ok");
  });

  it("accepts ciproof.yaml as an alias", () => {
    const root = tempRoot();
    writeFileSync(join(root, "ciproof.yaml"), GOOD);
    expect(loadConfig({ root }).status).toBe("ok");
  });

  it("errors deterministically when both files exist", () => {
    const root = tempRoot();
    writeFileSync(join(root, "ciproof.yml"), GOOD);
    writeFileSync(join(root, "ciproof.yaml"), GOOD);
    const result = loadConfig({ root });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.issues[0]?.message).toMatch(/multiple config files/);
    }
  });

  it("T. honors an explicit --config path", () => {
    const root = tempRoot();
    writeFileSync(join(root, "custom.yml"), GOOD);
    const result = loadConfig({ root, configPath: "custom.yml" });
    expect(result.status).toBe("ok");
  });

  it("errors when an explicit config path is missing", () => {
    const result = loadConfig({ root: tempRoot(), configPath: "nope.yml" });
    expect(result.status).toBe("error");
  });
});

describe("loadConfig — parse and content errors", () => {
  it("B. reports a clean error for malformed YAML", () => {
    const root = tempRoot();
    writeFileSync(join(root, "ciproof.yml"), "version: 1\ninvariants: [ :::\n");
    const result = loadConfig({ root });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.issues[0]?.path).toBe("(yaml)");
    }
  });

  it("reports an error for an empty config file", () => {
    const root = tempRoot();
    writeFileSync(join(root, "ciproof.yml"), "\n");
    const result = loadConfig({ root });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.issues[0]?.message).toMatch(/empty/);
    }
  });

  it("surfaces schema issues with a file path", () => {
    const root = tempRoot();
    writeFileSync(join(root, "ciproof.yml"), "version: 2\ninvariants: []\n");
    const result = loadConfig({ root });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.path).toBe(join(root, "ciproof.yml"));
    }
  });
});
