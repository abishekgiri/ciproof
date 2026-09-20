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
import { runExplain, type ExplainOptions } from "../src/explain.js";
import { FIXTURES_DIR } from "./helpers/fixtures.js";

const created: string[] = [];

function repoWith(fixtures: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ciproof-explain-"));
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

function options(
  over: Partial<ExplainOptions> & Pick<ExplainOptions, "root" | "job">,
): ExplainOptions {
  return {
    event: "workflow_dispatch",
    fork: false,
    changedFiles: [],
    inputs: {},
    ...over,
  };
}

afterEach(() => {
  while (created.length) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe("runExplain", () => {
  it("explains the canonical spike (deploy RUN via always())", async () => {
    const root = repoWith({ "ci.yml": "needs/always-needs.yml" });
    const { output, exitCode } = await runExplain(
      options({ root, job: "deploy", inputs: { skip_tests: true } }),
    );
    expect(exitCode).toBe(0);
    expect(output).toContain("test");
    expect(output).toContain("SKIPPED");
    expect(output).toContain("deploy");
    expect(output).toContain("RUN");
    expect(output).toContain("always() -> true");
    expect(output).toContain("One concrete scenario evaluated.");
  });

  it("returns exit 2 when the job is not found", async () => {
    const root = repoWith({ "ci.yml": "needs/always-needs.yml" });
    const { exitCode, output } = await runExplain(
      options({ root, job: "nonexistent" }),
    );
    expect(exitCode).toBe(2);
    expect(output).toContain("No workflow defines a job");
  });

  it("emits JSON when requested", async () => {
    const root = repoWith({ "ci.yml": "needs/always-needs.yml" });
    const { output } = await runExplain(
      options({
        root,
        job: "deploy",
        inputs: { skip_tests: true },
        json: true,
      }),
    );
    const parsed = JSON.parse(output);
    expect(parsed.job).toBe("deploy");
    expect(parsed.workflows[0].jobs.deploy.state).toBe("run");
  });

  it("explains a pull_request_target scenario", async () => {
    const root = repoWith({ "prt.yml": "trust/pull-request-target.yml" });
    const { output, exitCode } = await runExplain(
      options({
        root,
        job: "publish-preview",
        event: "pull_request_target",
        baseRef: "main",
        headRef: "feature",
        fork: true,
      }),
    );
    expect(exitCode).toBe(0);
    expect(output).toContain("publish-preview");
    expect(output).toContain("RUN");
  });
});
