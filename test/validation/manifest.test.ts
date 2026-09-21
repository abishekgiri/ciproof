import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  validateManifest,
  validateAudit,
  isSafeCacheEntry,
} from "../../validation/manifest.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHA = "0".repeat(40);

describe("validateManifest (A, B)", () => {
  it("accepts a well-formed manifest", () => {
    expect(
      validateManifest({
        version: 1,
        repositories: [{ repo: "owner/name", commit: SHA, category: "cli" }],
      }),
    ).toEqual([]);
  });

  it("A. rejects a malformed entry and an unsupported version", () => {
    const issues = validateManifest({
      version: 2,
      repositories: [{ repo: "not-a-repo", commit: "abc" }],
    });
    expect(issues.some((i) => /version/.test(i))).toBe(true);
    expect(issues.some((i) => /owner\/name/.test(i))).toBe(true);
    expect(issues.some((i) => /40-char/.test(i))).toBe(true);
  });

  it("B. rejects duplicate repositories", () => {
    const issues = validateManifest({
      version: 1,
      repositories: [
        { repo: "a/b", commit: SHA },
        { repo: "a/b", commit: SHA },
      ],
    });
    expect(issues.some((i) => /duplicate/.test(i))).toBe(true);
  });

  it("validates the committed manifest.json", () => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, "validation", "manifest.json"), "utf8"),
    );
    expect(validateManifest(manifest)).toEqual([]);
    expect(manifest.repositories.length).toBeGreaterThanOrEqual(50);
  });
});

describe("validateAudit (G)", () => {
  it("accepts valid verdicts and rejects invalid ones", () => {
    const base = {
      version: 1,
      method: "manual",
      findings: [
        {
          repo: "a/b",
          commit: SHA,
          workflow: "ci.yml",
          rule: "CP003",
          verdict: "TRUE_POSITIVE",
          evidence: [],
        },
      ],
    };
    expect(validateAudit(base)).toEqual([]);
    const bad = {
      ...base,
      findings: [{ ...base.findings[0], verdict: "LOOKS_BAD" }],
    };
    expect(validateAudit(bad).some((i) => /verdict/.test(i))).toBe(true);
  });

  it("validates the committed audit.json", () => {
    const audit = JSON.parse(
      readFileSync(join(repoRoot, "validation", "audit.json"), "utf8"),
    );
    expect(validateAudit(audit)).toEqual([]);
  });
});

describe("isSafeCacheEntry (H)", () => {
  it("accepts in-tree relative paths", () => {
    expect(isSafeCacheEntry("cache/owner__repo/ci.yml")).toBe(true);
  });

  it("rejects traversal and absolute paths", () => {
    expect(isSafeCacheEntry("../secrets")).toBe(false);
    expect(isSafeCacheEntry("cache/../../etc/passwd")).toBe(false);
    expect(isSafeCacheEntry("/etc/passwd")).toBe(false);
    expect(isSafeCacheEntry("")).toBe(false);
  });
});
