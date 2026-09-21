import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "../src/check.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function repo(workflow: string, config?: string): string {
  const root = mkdtempSync(join(tmpdir(), "ciproof-check-"));
  dirs.push(root);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), workflow);
  if (config !== undefined) {
    writeFileSync(join(root, "ciproof.yml"), config);
  }
  return root;
}

const MIXED_WORKFLOW = `on:
  workflow_dispatch:
    inputs:
      skip_tests:
        type: boolean
jobs:
  tests:
    if: \${{ !inputs.skip_tests }}
    runs-on: ubuntu-latest
    steps:
      - run: echo
  deploy:
    needs: tests
    if: \${{ always() }}
    runs-on: ubuntu-latest
    steps:
      - run: echo
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: echo
  audit:
    if: \${{ failure() }}
    runs-on: ubuntu-latest
    steps:
      - run: echo
`;

const MIXED_CONFIG = `version: 1
invariants:
  - id: deploy-needs-tests
    require:
      when-job-runs: deploy
      job-must-have-run: tests
  - id: forks-cannot-publish
    require:
      job-not-reachable:
        job: publish
        trust: fork
  - id: audit-unknown
    require:
      job-not-reachable:
        job: audit
        event: workflow_dispatch
`;

describe("ciproof check — config-driven invariants (Q)", () => {
  it("renders mixed results in declaration order with a violation exit code", async () => {
    const root = repo(MIXED_WORKFLOW, MIXED_CONFIG);
    const { output, exitCode } = await runCheck({ root });

    // Status lines in declaration order.
    const statusBlock = output.slice(0, output.indexOf("refuted"));
    expect(statusBlock.indexOf("deploy-needs-tests")).toBeLessThan(
      statusBlock.indexOf("forks-cannot-publish"),
    );
    expect(statusBlock.indexOf("forks-cannot-publish")).toBeLessThan(
      statusBlock.indexOf("audit-unknown"),
    );

    expect(output).toContain("1 refuted");
    expect(output).toContain("1 passed within modeled scenarios");
    expect(output).toContain("1 unknown");
    // A refuted invariant establishes a concrete violation -> exit 1 wins.
    expect(exitCode).toBe(1);
  });

  it("exits 4 when the only unresolved result is UNKNOWN", async () => {
    const root = repo(
      MIXED_WORKFLOW,
      `version: 1
invariants:
  - id: audit-unknown
    require:
      job-not-reachable:
        job: audit
        event: workflow_dispatch
`,
    );
    const { output, exitCode } = await runCheck({ root });
    expect(output).toContain("1 unknown");
    expect(exitCode).toBe(4);
  });

  it("exits 0 when all invariants pass", async () => {
    const root = repo(
      MIXED_WORKFLOW,
      `version: 1
invariants:
  - id: forks-cannot-publish
    require:
      job-not-reachable:
        job: publish
        trust: fork
`,
    );
    const { exitCode, output } = await runCheck({ root });
    expect(output).toContain("1 passed within modeled scenarios");
    expect(exitCode).toBe(0);
  });

  it("R. produces identical output across runs", async () => {
    const root = repo(MIXED_WORKFLOW, MIXED_CONFIG);
    const a = await runCheck({ root });
    const b = await runCheck({ root });
    expect(a.output).toBe(b.output);
    expect(a.exitCode).toBe(b.exitCode);
  });
});

describe("ciproof check — config errors (exit 2)", () => {
  it("reports a bad config version with exit 2", async () => {
    const root = repo(MIXED_WORKFLOW, "version: 2\ninvariants: []\n");
    const { output, exitCode } = await runCheck({ root });
    expect(exitCode).toBe(2);
    expect(output).toContain("Configuration error");
  });

  it("reports a reference error (missing job) with exit 2", async () => {
    const root = repo(
      MIXED_WORKFLOW,
      `version: 1
invariants:
  - id: ghost
    require:
      job-not-reachable:
        job: nonexistent
`,
    );
    const { output, exitCode } = await runCheck({ root });
    expect(exitCode).toBe(2);
    expect(output).toMatch(/unknown job/);
  });
});

describe("ciproof check — config-free regression (S)", () => {
  it("retains built-in check behavior when no config is present", async () => {
    const root = repo(`on:
  push:
    branches: [main]
jobs:
  ghost:
    if: \${{ false }}
    runs-on: ubuntu-latest
    steps:
      - run: echo
`);
    const { output, exitCode } = await runCheck({ root });
    // Built-in findings format, not the invariant summary.
    expect(output).toContain("CP001");
    expect(output).toContain("Summary:");
    expect(output).not.toContain("passed within modeled scenarios");
    expect(exitCode).toBe(1);
  });

  it("produces the plain no-violation built-in output on a clean workflow", async () => {
    const root = repo(`on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`);
    const { exitCode } = await runCheck({ root });
    expect(exitCode).toBe(0);
  });
});

describe("ciproof check — explicit --config (T)", () => {
  it("loads a config from an explicit path", async () => {
    const root = repo(MIXED_WORKFLOW);
    writeFileSync(
      join(root, "custom.yml"),
      `version: 1
invariants:
  - id: forks-cannot-publish
    require:
      job-not-reachable:
        job: publish
        trust: fork
`,
    );
    const { output, exitCode } = await runCheck({
      root,
      configPath: "custom.yml",
    });
    expect(output).toContain("forks-cannot-publish");
    expect(exitCode).toBe(0);
  });
});
