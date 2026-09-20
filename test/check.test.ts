import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "../src/check.js";
import { FIXTURES_DIR } from "./helpers/fixtures.js";

const created: string[] = [];

function repoWith(fixtures: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ciproof-check-"));
  created.push(root);
  const dir = join(root, ".github", "workflows");
  mkdirSync(dir, { recursive: true });
  for (const [name, fixture] of Object.entries(fixtures)) {
    writeFileSync(
      join(dir, name),
      readFileSync(join(FIXTURES_DIR, fixture), "utf8"),
    );
  }
  return root;
}

afterEach(() => {
  while (created.length) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe("runCheck", () => {
  it("reports the canonical CP002 bypass with exit 1", async () => {
    const root = repoWith({ "ci.yml": "explore/canonical.yml" });
    const { output, exitCode } = await runCheck({
      root,
      prerequisiteRules: [
        {
          name: "deploy-needs-test",
          targetJob: "deploy",
          requiredCompletedJobs: ["test"],
        },
      ],
    });
    expect(exitCode).toBe(1);
    expect(output).toContain("CP002");
    expect(output).toContain("skip_tests: true");
    expect(output).not.toContain("safe");
  });

  it("reports CP003 for an external privileged path with exit 1", async () => {
    const root = repoWith({ "ci.yml": "security/prt-write.yml" });
    const { output, exitCode } = await runCheck({ root });
    expect(exitCode).toBe(1);
    expect(output).toContain("CP003");
    expect(output).toContain("Limitation:");
  });

  it("reports no violations without claiming safety (complete)", async () => {
    const root = repoWith({ "ci.yml": "needs/chain-needs.yml" });
    const { output, exitCode } = await runCheck({ root });
    expect(exitCode).toBe(0);
    expect(output).toContain("No violations found across");
    expect(output).not.toContain("safe");
  });

  it("marks a no-violation partial analysis as PARTIAL", async () => {
    const root = repoWith({ "ci.yml": "conditions/choice-input.yml" });
    const { output, exitCode } = await runCheck({ root });
    expect(exitCode).toBe(0);
    expect(output).toContain("Analysis is PARTIAL");
  });

  it("emits JSON with stable finding ids", async () => {
    const root = repoWith({ "ci.yml": "security/prt-write.yml" });
    const { output } = await runCheck({ root, json: true });
    const parsed = JSON.parse(output);
    expect(parsed.workflows[0].findings[0].id).toBe("CP003");
    expect(parsed.workflows[0].findings[0].verdict).toBe("violated");
  });
});
