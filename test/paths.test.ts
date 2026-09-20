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
import { runPaths } from "../src/paths.js";
import { FIXTURES_DIR } from "./helpers/fixtures.js";

const created: string[] = [];

function repoWith(fixtures: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ciproof-paths-"));
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

describe("runPaths", () => {
  it("reports distinct plans for the canonical workflow", async () => {
    const root = repoWith({ "ci.yml": "explore/canonical.yml" });
    const { output, exitCode } = await runPaths({ root });
    expect(exitCode).toBe(0);
    expect(output).toContain("distinct plans: 2");
    expect(output).toContain("PLAN 1");
    expect(output).toContain("PLAN 2");
    expect(output).toContain("No invariants checked.");
    expect(output).toContain("No counterexamples searched.");
  });

  it("reports truncation loudly when the cap is hit", async () => {
    const root = repoWith({ "ci.yml": "explore/canonical.yml" });
    const { output } = await runPaths({ root, maxScenarios: 1 });
    expect(output).toContain("truncated");
    expect(output).toContain("partial");
  });

  it("reports partial analysis for an unsupported input", async () => {
    const root = repoWith({ "ci.yml": "conditions/choice-input.yml" });
    const { output } = await runPaths({ root });
    expect(output).toContain("partial");
  });

  it("emits JSON when requested", async () => {
    const root = repoWith({ "ci.yml": "explore/canonical.yml" });
    const { output } = await runPaths({ root, json: true });
    const parsed = JSON.parse(output);
    expect(parsed.workflows).toHaveLength(1);
    expect(parsed.workflows[0].analysis.plans.length).toBe(2);
    expect(parsed.workflows[0].analysis.completeness).toBe(
      "complete-within-supported-model",
    );
  });

  it("handles a repo with no workflows", async () => {
    const root = mkdtempSync(join(tmpdir(), "ciproof-nopaths-"));
    created.push(root);
    const { output, exitCode } = await runPaths({ root });
    expect(exitCode).toBe(0);
    expect(output).toContain("No workflows found");
  });
});
