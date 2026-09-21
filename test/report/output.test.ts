import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "../../src/check.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function repo(workflow: string, config?: string): string {
  const root = mkdtempSync(join(tmpdir(), "ciproof-report-"));
  dirs.push(root);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), workflow);
  if (config !== undefined) {
    writeFileSync(join(root, "ciproof.yml"), config);
  }
  return root;
}

const FORK_REACHES = `on: pull_request_target
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`;
const FORKS_CANNOT_PUBLISH = `version: 1
invariants:
  - id: forks-cannot-publish
    require:
      job-not-reachable:
        job: publish
        trust: fork
`;

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
const UNKNOWN_WORKFLOW = `on: pull_request_target
jobs:
  prep:
    runs-on: ubuntu-latest
    steps:
      - id: g
        run: echo "go=true" >> "$GITHUB_OUTPUT"
    outputs:
      go: \${{ steps.g.outputs.go }}
  publish:
    needs: prep
    if: \${{ needs.prep.outputs.go == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - run: echo
`;

describe("JSON report", () => {
  it("A/B. emits valid JSON with a version field", async () => {
    const root = repo(FORK_REACHES, FORKS_CANNOT_PUBLISH);
    const { output } = await runCheck({ root, format: "json" });
    const parsed = JSON.parse(output);
    expect(parsed.version).toBe(1);
    expect(parsed.summary).toBeDefined();
    expect(Array.isArray(parsed.results)).toBe(true);
  });

  it("C. a refuted result carries id, verdict, workflow, job, counterexample", async () => {
    const root = repo(FORK_REACHES, FORKS_CANNOT_PUBLISH);
    const { output, exitCode } = await runCheck({ root, format: "json" });
    const parsed = JSON.parse(output);
    const r = parsed.results[0];
    expect(r.id).toBe("forks-cannot-publish");
    expect(r.verdict).toBe("refuted");
    expect(r.workflow).toBe(".github/workflows/ci.yml");
    expect(r.job).toBe("publish");
    expect(r.counterexample.scenario.fork).toBe("true");
    expect(exitCode).toBe(1);
  });

  it("D. an unknown result carries unknownReasons and is not a pass", async () => {
    const root = repo(UNKNOWN_WORKFLOW, FORKS_CANNOT_PUBLISH);
    const { output, exitCode } = await runCheck({ root, format: "json" });
    const parsed = JSON.parse(output);
    expect(parsed.summary).toEqual({ refuted: 0, unknown: 1, passed: 0 });
    expect(parsed.results[0].verdict).toBe("unknown");
    expect(parsed.results[0].unknownReasons.length).toBeGreaterThan(0);
    expect(exitCode).toBe(4);
  });

  it("E. a passing config reports a correct summary and no actionable results", async () => {
    const root = repo(
      `on:
  push:
    branches: [main]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`,
      FORKS_CANNOT_PUBLISH,
    );
    const { output, exitCode } = await runCheck({ root, format: "json" });
    const parsed = JSON.parse(output);
    expect(parsed.summary).toEqual({ refuted: 0, unknown: 0, passed: 1 });
    expect(parsed.results).toEqual([]);
    expect(exitCode).toBe(0);
  });

  it("F. mixed results: summary and exit 1 (violation wins)", async () => {
    const root = repo(MIXED_WORKFLOW, MIXED_CONFIG);
    const { output, exitCode } = await runCheck({ root, format: "json" });
    const parsed = JSON.parse(output);
    expect(parsed.summary).toEqual({ refuted: 1, unknown: 1, passed: 1 });
    expect(exitCode).toBe(1);
  });

  it("G. stdout is pure JSON (no preamble)", async () => {
    const root = repo(FORK_REACHES, FORKS_CANNOT_PUBLISH);
    const { output } = await runCheck({ root, format: "json" });
    expect(output.trimStart().startsWith("{")).toBe(true);
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).not.toMatch(/CIProof/);
  });

  it("routes config errors to stderr, keeping stdout empty", async () => {
    const root = repo(FORK_REACHES, "version: 2\ninvariants: []\n");
    const { output, exitCode, stream } = await runCheck({
      root,
      format: "json",
    });
    expect(stream).toBe("stderr");
    expect(exitCode).toBe(2);
    expect(() => JSON.parse(output)).toThrow(); // human diagnostic, not JSON
  });
});

describe("SARIF report", () => {
  it("H. emits SARIF 2.1.0 essentials", async () => {
    const root = repo(FORK_REACHES, FORKS_CANNOT_PUBLISH);
    const { output } = await runCheck({ root, format: "sarif" });
    const sarif = JSON.parse(output);
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs.length).toBeGreaterThanOrEqual(1);
    expect(sarif.runs[0].tool.driver.name).toBe("CIProof");
    expect(Array.isArray(sarif.runs[0].tool.driver.rules)).toBe(true);
    expect(Array.isArray(sarif.runs[0].results)).toBe(true);
  });

  it("I. a refuted finding is a stable SARIF result with a location", async () => {
    const root = repo(FORK_REACHES, FORKS_CANNOT_PUBLISH);
    const { output } = await runCheck({ root, format: "sarif" });
    const result = JSON.parse(output).runs[0].results[0];
    expect(result.ruleId).toBe("ciproof/user/forks-cannot-publish");
    expect(result.level).toBe("error");
    expect(result.message.text).toContain("publish");
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe(
      ".github/workflows/ci.yml",
    );
    expect(result.partialFingerprints["ciproofFingerprint/v1"]).toMatch(
      /^[0-9a-f]{16}$/,
    );
  });

  it("J. a passing config yields no SARIF result", async () => {
    const root = repo(
      `on:
  push:
    branches: [main]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`,
      FORKS_CANNOT_PUBLISH,
    );
    const { output } = await runCheck({ root, format: "sarif" });
    expect(JSON.parse(output).runs[0].results).toEqual([]);
  });

  it("K. an unknown finding appears as a note result, never a pass", async () => {
    const root = repo(UNKNOWN_WORKFLOW, FORKS_CANNOT_PUBLISH);
    const { output } = await runCheck({ root, format: "sarif" });
    const result = JSON.parse(output).runs[0].results[0];
    expect(result.level).toBe("note");
    expect(result.properties.verdict).toBe("unknown");
    expect(result.message.text).toContain("UNKNOWN");
  });
});

describe("determinism (L)", () => {
  it("produces byte-identical JSON and SARIF across runs", async () => {
    const root = repo(MIXED_WORKFLOW, MIXED_CONFIG);
    const j1 = await runCheck({ root, format: "json" });
    const j2 = await runCheck({ root, format: "json" });
    const s1 = await runCheck({ root, format: "sarif" });
    const s2 = await runCheck({ root, format: "sarif" });
    expect(j1.output).toBe(j2.output);
    expect(s1.output).toBe(s2.output);
  });
});

describe("--output file support (M, N, O)", () => {
  it("M. writes a JSON report to a file with empty stdout", async () => {
    const root = repo(FORK_REACHES, FORKS_CANNOT_PUBLISH);
    const out = join(root, "report.json");
    const { output, exitCode } = await runCheck({
      root,
      format: "json",
      output: out,
    });
    expect(output).toBe("");
    expect(exitCode).toBe(1);
    expect(() => JSON.parse(readFileSync(out, "utf8"))).not.toThrow();
  });

  it("N. writes a SARIF report to a file", async () => {
    const root = repo(FORK_REACHES, FORKS_CANNOT_PUBLISH);
    const out = join(root, "ciproof.sarif");
    await runCheck({ root, format: "sarif", output: out });
    expect(JSON.parse(readFileSync(out, "utf8")).version).toBe("2.1.0");
  });

  it("O. fails cleanly when the destination is unwritable", async () => {
    const root = repo(FORK_REACHES, FORKS_CANNOT_PUBLISH);
    const out = join(root, "missing-dir", "report.json");
    const { output, exitCode, stream } = await runCheck({
      root,
      format: "json",
      output: out,
    });
    expect(exitCode).toBe(2);
    expect(stream).toBe("stderr");
    expect(output).toMatch(/cannot write report/);
  });
});

describe("exit-code parity (P)", () => {
  it("text, json, and sarif share an exit code for the same analysis", async () => {
    const root = repo(MIXED_WORKFLOW, MIXED_CONFIG);
    const text = await runCheck({ root, format: "text" });
    const json = await runCheck({ root, format: "json" });
    const sarif = await runCheck({ root, format: "sarif" });
    expect(text.exitCode).toBe(1);
    expect(json.exitCode).toBe(1);
    expect(sarif.exitCode).toBe(1);
  });
});

describe("both analysis paths (Q, R)", () => {
  const UNREACHABLE = `on:
  push:
    branches: [main]
jobs:
  ghost:
    if: \${{ false }}
    runs-on: ubuntu-latest
    steps:
      - run: echo
`;

  it("Q. built-in checks (no config) produce JSON and SARIF", async () => {
    const root = repo(UNREACHABLE);
    const json = JSON.parse((await runCheck({ root, format: "json" })).output);
    expect(json.results[0].ruleId).toBe("ciproof/builtin/CP001");
    const sarif = JSON.parse(
      (await runCheck({ root, format: "sarif" })).output,
    );
    expect(sarif.runs[0].tool.driver.rules[0].id).toBe("ciproof/builtin/CP001");
  });

  it("R. user invariants (config) produce JSON and SARIF", async () => {
    const root = repo(FORK_REACHES, FORKS_CANNOT_PUBLISH);
    const json = JSON.parse((await runCheck({ root, format: "json" })).output);
    expect(json.results[0].ruleId).toBe("ciproof/user/forks-cannot-publish");
    const sarif = JSON.parse(
      (await runCheck({ root, format: "sarif" })).output,
    );
    expect(sarif.runs[0].results[0].ruleId).toBe(
      "ciproof/user/forks-cannot-publish",
    );
  });
});
