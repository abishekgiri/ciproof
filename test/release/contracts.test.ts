import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSON_REPORT_VERSION } from "../../src/report/index.js";
import { SUPPORTED_CONFIG_VERSION } from "../../src/config/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
) as Record<string, unknown>;

describe("package metadata (release contract)", () => {
  it("is version 0.1.0", () => {
    expect(pkg.version).toBe("0.1.0");
  });

  it("ships only the built CLI via the files field", () => {
    expect(pkg.files).toEqual(["dist/cli.js"]);
  });

  it("exposes the ciproof bin from dist", () => {
    expect(pkg.bin).toEqual({ ciproof: "./dist/cli.js" });
  });

  it("declares an explicit Node engine and license", () => {
    expect((pkg.engines as { node: string }).node).toBe(">=20");
    expect(pkg.license).toBe("MIT");
  });

  it("points repository/homepage/bugs at the CIProof project", () => {
    const repository = pkg.repository as { url: string };
    expect(repository.url).toContain("abishekgiri/ciproof");
    expect(pkg.homepage).toContain("abishekgiri/ciproof");
    expect((pkg.bugs as { url: string }).url).toContain("abishekgiri/ciproof");
  });

  it("has no surprising install-time lifecycle scripts", () => {
    const scripts = (pkg.scripts as Record<string, string>) ?? {};
    for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
      expect(scripts[hook]).toBeUndefined();
    }
  });
});

describe("public versioned contracts", () => {
  it("keeps the JSON report at version 1", () => {
    expect(JSON_REPORT_VERSION).toBe(1);
  });

  it("keeps the ciproof.yml config at version 1", () => {
    expect(SUPPORTED_CONFIG_VERSION).toBe(1);
  });
});
