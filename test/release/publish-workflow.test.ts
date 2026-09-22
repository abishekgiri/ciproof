import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readWorkflow(name: string): {
  text: string;
  doc: Record<string, unknown>;
} {
  const text = readFileSync(
    join(repoRoot, ".github", "workflows", name),
    "utf8",
  );
  return { text, doc: parseYaml(text) as Record<string, unknown> };
}

/** `on:` can parse as the string "on" or the boolean true depending on schema. */
function triggers(doc: Record<string, unknown>): Record<string, unknown> {
  return (doc.on ??
    (doc as Record<string, unknown>)[true as unknown as string] ??
    {}) as Record<string, unknown>;
}

describe("publish workflow (trusted publishing)", () => {
  const { text, doc } = readWorkflow("publish.yml");

  it("A. exists and is valid YAML", () => {
    expect(doc).toBeTruthy();
    expect(doc.name).toBeDefined();
  });

  it("C. triggers only on version tags — never PRs or plain main pushes", () => {
    const on = triggers(doc);
    const push = on.push as
      { tags?: string[]; branches?: string[] } | undefined;
    expect(push?.tags).toContain("v*");
    expect(push?.branches).toBeUndefined();
    expect(on.pull_request).toBeUndefined();
    expect(on.workflow_dispatch).toBeUndefined();
  });

  it("B. requests only read + id-token:write permissions", () => {
    const perms = doc.permissions as Record<string, string>;
    expect(perms.contents).toBe("read");
    expect(perms["id-token"]).toBe("write");
    expect(perms["packages"]).toBeUndefined();
    expect(perms["pull-requests"]).toBeUndefined();
    expect(text).not.toMatch(/contents:\s*write/);
  });

  it("E. never references a long-lived npm token", () => {
    expect(text).not.toMatch(/NPM_TOKEN/);
    expect(text).not.toMatch(/NODE_AUTH_TOKEN/);
  });

  it("D. publishes only after the verification gate and version guard", () => {
    const publishIdx = text.indexOf("npm publish");
    const guardIdx = text.indexOf("check-release-version.mjs");
    const testIdx = text.indexOf("npm test");
    const releaseCheckIdx = text.indexOf("npm run release:check");
    expect(publishIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(publishIdx);
    expect(testIdx).toBeLessThan(publishIdx);
    expect(releaseCheckIdx).toBeLessThan(publishIdx);
  });

  it("refuses to overwrite an already-published version", () => {
    expect(text).toMatch(/already published/);
    expect(text).not.toMatch(/--force/);
  });
});

describe("public-smoke workflow", () => {
  const { text, doc } = readWorkflow("public-smoke.yml");

  it("is manual, read-only, and publishes nothing", () => {
    const on = triggers(doc);
    expect(on.workflow_dispatch).toBeDefined();
    expect((doc.permissions as Record<string, string>).contents).toBe("read");
    expect(text).not.toMatch(/npm publish/);
    expect(text).toMatch(/smoke-public-package\.mjs/);
  });
});

describe("F. version/tag guard script", () => {
  it("accepts a tag matching package.json", () => {
    const version = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ).version as string;
    const out = execFileSync(
      "node",
      ["scripts/check-release-version.mjs", `v${version}`],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(out).toMatch(/matches/);
  });

  it("rejects a mismatched tag with a non-zero exit", () => {
    expect(() =>
      execFileSync("node", ["scripts/check-release-version.mjs", "v9.9.9"], {
        cwd: repoRoot,
        stdio: "ignore",
      }),
    ).toThrow();
  });
});

describe("G. public-smoke script argument validation (no network)", () => {
  function runArgs(args: string[]): number {
    try {
      execFileSync("node", ["scripts/smoke-public-package.mjs", ...args], {
        cwd: repoRoot,
        stdio: "ignore",
      });
      return 0;
    } catch (err) {
      return (err as { status?: number }).status ?? 1;
    }
  }

  it("rejects a missing version argument", () => {
    expect(runArgs([])).toBe(2);
  });

  it("rejects a malformed version argument", () => {
    expect(runArgs(["not-a-version"])).toBe(2);
  });
});

describe("H. issue forms", () => {
  const dir = join(repoRoot, ".github", "ISSUE_TEMPLATE");
  const forms = readdirSync(dir).filter(
    (f) => f.endsWith(".yml") && f !== "config.yml",
  );

  it("includes the expected forms", () => {
    expect(forms).toContain("false_counterexample.yml");
    expect(forms).toContain("unexpected_unknown.yml");
    expect(forms).toContain("bug_report.yml");
    expect(forms).toContain("feature_request.yml");
  });

  it("every form is valid YAML with name, description, and a non-empty body", () => {
    for (const file of forms) {
      const doc = parseYaml(readFileSync(join(dir, file), "utf8")) as {
        name?: string;
        description?: string;
        body?: unknown[];
      };
      expect(doc.name, `${file} name`).toBeTruthy();
      expect(doc.description, `${file} description`).toBeTruthy();
      expect(
        Array.isArray(doc.body) && doc.body.length > 0,
        `${file} body`,
      ).toBe(true);
    }
  });

  it("config.yml disables blank issues and links to the security policy", () => {
    const config = parseYaml(readFileSync(join(dir, "config.yml"), "utf8")) as {
      blank_issues_enabled?: boolean;
      contact_links?: { url: string }[];
    };
    expect(config.blank_issues_enabled).toBe(false);
    expect(
      config.contact_links?.some((l) => /security\/advisories/.test(l.url)),
    ).toBe(true);
  });
});
