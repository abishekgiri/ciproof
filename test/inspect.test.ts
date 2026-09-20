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
import { runInspect } from "../src/inspect.js";
import { FIXTURES_DIR } from "./helpers/fixtures.js";

const created: string[] = [];

/** Build a temp repo whose .github/workflows holds the given fixtures. */
function repoWith(fixtures: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ciproof-inspect-"));
  created.push(root);
  const dir = join(root, ".github", "workflows");
  mkdirSync(dir, { recursive: true });
  for (const [name, fixture] of Object.entries(fixtures)) {
    const content = readFileSync(join(FIXTURES_DIR, fixture), "utf8");
    writeFileSync(join(dir, name), content);
  }
  return root;
}

afterEach(() => {
  while (created.length) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe("runInspect", () => {
  it("renders a supported workflow with exit 0", async () => {
    const root = repoWith({ "deploy.yml": "needs/always-needs.yml" });
    const { output, exitCode } = await runInspect({ root });
    expect(exitCode).toBe(0);
    expect(output).toContain("Workflow: always-needs");
    expect(output).toContain("if: always()");
    expect(output).toContain("No reachability analysis performed.");
  });

  it("reports unsupported constructs without treating them as errors", async () => {
    const root = repoWith({ "nightly.yml": "unsupported/schedule.yml" });
    const { output, exitCode } = await runInspect({ root });
    expect(exitCode).toBe(0);
    expect(output).toContain("Unsupported by CIProof v0.1:");
    expect(output).toContain("schedule");
  });

  it("shows the needs chain in the dependency graph", async () => {
    const root = repoWith({ "ci.yml": "needs/chain-needs.yml" });
    const { output } = await runInspect({ root });
    expect(output).toContain("build -> test");
    expect(output).toContain("test -> deploy");
  });

  it("produces a diagnostic (not a stack trace) for malformed input, exit 3", async () => {
    const root = repoWith({ "broken.yml": "invalid/malformed-yaml.yml" });
    const { output, exitCode } = await runInspect({ root });
    expect(exitCode).toBe(3);
    expect(output).toContain("No model (parse/validation errors).");
    expect(output).toContain("Diagnostics:");
  });

  it("emits JSON when requested", async () => {
    const root = repoWith({ "deploy.yml": "needs/always-needs.yml" });
    const { output } = await runInspect({ root, json: true });
    const parsed = JSON.parse(output);
    expect(parsed.workflows).toHaveLength(1);
    expect(parsed.workflows[0].model.name).toBe("always-needs");
    expect(parsed.workflows[0].model.jobs.deploy.needs).toEqual(["test"]);
  });

  it("handles a repo with no workflows", async () => {
    const root = mkdtempSync(join(tmpdir(), "ciproof-none-"));
    created.push(root);
    const { output, exitCode } = await runInspect({ root });
    expect(exitCode).toBe(0);
    expect(output).toContain("No workflows found");
  });
});
