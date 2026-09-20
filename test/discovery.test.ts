import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverWorkflowFiles } from "../src/discovery.js";

const created: string[] = [];

function makeRepo(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "ciproof-disco-"));
  created.push(root);
  const dir = join(root, ".github", "workflows");
  mkdirSync(dir, { recursive: true });
  for (const name of files) {
    writeFileSync(join(dir, name), "on: push\n");
  }
  return root;
}

afterEach(() => {
  while (created.length) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe("discoverWorkflowFiles", () => {
  it("finds .yml and .yaml files, sorted deterministically", () => {
    const root = makeRepo(["b.yml", "a.yaml", "c.yml"]);
    const found = discoverWorkflowFiles(root).map((f) => f.path);
    expect(found).toEqual([
      ".github/workflows/a.yaml",
      ".github/workflows/b.yml",
      ".github/workflows/c.yml",
    ]);
  });

  it("ignores non-workflow files", () => {
    const root = makeRepo(["ci.yml", "README.md", "notes.txt"]);
    const found = discoverWorkflowFiles(root).map((f) => f.path);
    expect(found).toEqual([".github/workflows/ci.yml"]);
  });

  it("returns an empty list when no workflows directory exists", () => {
    const root = mkdtempSync(join(tmpdir(), "ciproof-empty-"));
    created.push(root);
    expect(discoverWorkflowFiles(root)).toEqual([]);
  });
});
