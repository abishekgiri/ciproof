import { describe, expect, it } from "vitest";
import { normalizeWorkflow } from "../../src/github/normalize.js";
import { exploreWorkflow } from "../../src/engine/index.js";
import { evaluateUserInvariants } from "../../src/invariants/user.js";
import type { AnalyzedWorkflow } from "../../src/invariants/user.js";
import { validateConfig } from "../../src/config/schema.js";
import type { CiproofConfig } from "../../src/config/types.js";

async function analyze(
  files: Record<string, string>,
): Promise<AnalyzedWorkflow[]> {
  const analyzed: AnalyzedWorkflow[] = [];
  for (const [file, content] of Object.entries(files)) {
    const { model } = await normalizeWorkflow({ filename: file, content });
    if (model) {
      analyzed.push({ file, model, exploration: exploreWorkflow(model) });
    }
  }
  return analyzed;
}

function config(raw: unknown): CiproofConfig {
  const result = validateConfig(raw);
  if (!result.ok) {
    throw new Error(`invalid config: ${JSON.stringify(result.issues)}`);
  }
  return result.config;
}

const CI = ".github/workflows/ci.yml";

const DEPLOY_ALWAYS = `on:
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
`;

const DEPLOY_STRICT = `on: workflow_dispatch
jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
      - run: echo
  deploy:
    needs: tests
    runs-on: ubuntu-latest
    steps:
      - run: echo
`;

describe("job-requires-job (I, J, K)", () => {
  it("J. REFUTED with a counterexample when deploy can run without tests", async () => {
    const workflows = await analyze({ [CI]: DEPLOY_ALWAYS });
    const cfg = config({
      version: 1,
      invariants: [
        {
          id: "deploy-needs-tests",
          require: { "when-job-runs": "deploy", "job-must-have-run": "tests" },
        },
      ],
    });
    const result = evaluateUserInvariants(cfg, workflows);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const r = result.results[0]!;
      expect(r.verdict).toBe("violated");
      expect(r.scenario?.inputs).toMatchObject({ skip_tests: true });
      expect(r.execution).toMatchObject({ deploy: "run", tests: "skipped" });
    }
  });

  it("I. NO VIOLATION when every deploy run includes tests", async () => {
    const workflows = await analyze({ [CI]: DEPLOY_STRICT });
    const cfg = config({
      version: 1,
      invariants: [
        {
          id: "deploy-needs-tests",
          require: { "when-job-runs": "deploy", "job-must-have-run": "tests" },
        },
      ],
    });
    const result = evaluateUserInvariants(cfg, workflows);
    if (result.ok) {
      expect(result.results[0]?.verdict).toBe("not-violated");
    }
  });

  it("K. UNKNOWN when a required job's state depends on unmodeled semantics", async () => {
    const workflows = await analyze({
      [CI]: `on: push
jobs:
  tests:
    if: \${{ failure() }}
    runs-on: ubuntu-latest
    steps:
      - run: echo
  deploy:
    needs: tests
    if: \${{ always() }}
    runs-on: ubuntu-latest
    steps:
      - run: echo
`,
    });
    const cfg = config({
      version: 1,
      invariants: [
        {
          id: "deploy-needs-tests",
          require: { "when-job-runs": "deploy", "job-must-have-run": "tests" },
        },
      ],
    });
    const result = evaluateUserInvariants(cfg, workflows);
    if (result.ok) {
      expect(result.results[0]?.verdict).toBe("unknown");
    }
  });
});

describe("job-not-reachable (L, M, N)", () => {
  const forkReaches = `on: pull_request_target
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`;
  const pushOnly = `on:
  push:
    branches: [main]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`;

  it("L. NO VIOLATION when forks cannot reach the job", async () => {
    const workflows = await analyze({ [CI]: pushOnly });
    const cfg = config({
      version: 1,
      invariants: [
        {
          id: "forks-cannot-publish",
          require: { "job-not-reachable": { job: "publish", trust: "fork" } },
        },
      ],
    });
    const result = evaluateUserInvariants(cfg, workflows);
    if (result.ok) {
      expect(result.results[0]?.verdict).toBe("not-violated");
    }
  });

  it("M. REFUTED with a fork witness when a fork reaches the job", async () => {
    const workflows = await analyze({ [CI]: forkReaches });
    const cfg = config({
      version: 1,
      invariants: [
        {
          id: "forks-cannot-publish",
          require: { "job-not-reachable": { job: "publish", trust: "fork" } },
        },
      ],
    });
    const result = evaluateUserInvariants(cfg, workflows);
    if (result.ok) {
      const r = result.results[0]!;
      expect(r.verdict).toBe("violated");
      expect(r.scenario?.fork).toBe(true);
      expect(r.execution?.publish).toBe("run");
    }
  });

  it("N. UNKNOWN (not pass) when the target job is UNKNOWN in a fork scenario", async () => {
    const workflows = await analyze({
      [CI]: `on: pull_request_target
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
`,
    });
    const cfg = config({
      version: 1,
      invariants: [
        {
          id: "forks-cannot-publish",
          require: { "job-not-reachable": { job: "publish", trust: "fork" } },
        },
      ],
    });
    const result = evaluateUserInvariants(cfg, workflows);
    if (result.ok) {
      expect(result.results[0]?.verdict).toBe("unknown");
    }
  });

  it("UNKNOWN (not pass) when an unsupported trigger could hide a matching event", async () => {
    const workflows = await analyze({
      [CI]: `on: merge_group
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`,
    });
    const cfg = config({
      version: 1,
      invariants: [
        {
          id: "forks-cannot-publish",
          require: { "job-not-reachable": { job: "publish", trust: "fork" } },
        },
      ],
    });
    const result = evaluateUserInvariants(cfg, workflows);
    if (result.ok) {
      expect(result.results[0]?.verdict).toBe("unknown");
    }
  });

  it("supports an event filter (no manual production)", async () => {
    const workflows = await analyze({
      [CI]: `on: [push, workflow_dispatch]
jobs:
  deploy-production:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`,
    });
    const cfg = config({
      version: 1,
      invariants: [
        {
          id: "no-manual-production",
          require: {
            "job-not-reachable": {
              job: "deploy-production",
              event: "workflow_dispatch",
            },
          },
        },
      ],
    });
    const result = evaluateUserInvariants(cfg, workflows);
    if (result.ok) {
      expect(result.results[0]?.verdict).toBe("violated");
      expect(result.results[0]?.scenario?.event).toBe("workflow_dispatch");
    }
  });
});

describe("job-only-reachable (O, P)", () => {
  it("O. NO VIOLATION when release only runs from a tag push", async () => {
    const workflows = await analyze({
      [".github/workflows/release.yml"]: `on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`,
    });
    const cfg = config({
      version: 1,
      invariants: [
        {
          id: "release-only-from-tags",
          require: {
            "job-only-reachable": { job: "release", event: "push", ref: "tag" },
          },
        },
      ],
    });
    const result = evaluateUserInvariants(cfg, workflows);
    if (result.ok) {
      expect(result.results[0]?.verdict).toBe("not-violated");
    }
  });

  it("P. REFUTED when a branch push reaches release", async () => {
    const workflows = await analyze({
      [".github/workflows/release.yml"]: `on:
  push:
    branches: [main]
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`,
    });
    const cfg = config({
      version: 1,
      invariants: [
        {
          id: "release-only-from-tags",
          require: {
            "job-only-reachable": { job: "release", event: "push", ref: "tag" },
          },
        },
      ],
    });
    const result = evaluateUserInvariants(cfg, workflows);
    if (result.ok) {
      const r = result.results[0]!;
      expect(r.verdict).toBe("violated");
      expect(r.scenario?.refKind).toBe("branch");
    }
  });
});

describe("reference resolution (G, H)", () => {
  it("G. reports a missing job as a reference error, not a pass", async () => {
    const workflows = await analyze({ [CI]: DEPLOY_STRICT });
    const cfg = config({
      version: 1,
      invariants: [
        {
          id: "ghost",
          require: { "job-not-reachable": { job: "does-not-exist" } },
        },
      ],
    });
    const result = evaluateUserInvariants(cfg, workflows);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.referenceErrors[0]?.message).toMatch(/unknown job/);
    }
  });

  it("H. reports an ambiguous job reference", async () => {
    const workflows = await analyze({
      ".github/workflows/a.yml": `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`,
      ".github/workflows/b.yml": `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`,
    });
    const cfg = config({
      version: 1,
      invariants: [
        { id: "amb", require: { "job-not-reachable": { job: "build" } } },
      ],
    });
    const result = evaluateUserInvariants(cfg, workflows);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.referenceErrors[0]?.message).toMatch(/ambiguous/);
    }
  });

  it("resolves an ambiguous id when qualified by workflow", async () => {
    const workflows = await analyze({
      ".github/workflows/a.yml": `on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`,
      ".github/workflows/b.yml": `on: pull_request_target
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`,
    });
    const cfg = config({
      version: 1,
      invariants: [
        {
          id: "a-build-no-fork",
          require: {
            "job-not-reachable": {
              job: { workflow: "a.yml", id: "build" },
              trust: "fork",
            },
          },
        },
      ],
    });
    const result = evaluateUserInvariants(cfg, workflows);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.results[0]?.workflow).toBe(".github/workflows/a.yml");
    }
  });
});

describe("determinism (R)", () => {
  it("produces identical results across repeated runs", async () => {
    const workflows = await analyze({ [CI]: DEPLOY_ALWAYS });
    const cfg = config({
      version: 1,
      invariants: [
        {
          id: "deploy-needs-tests",
          require: { "when-job-runs": "deploy", "job-must-have-run": "tests" },
        },
      ],
    });
    const a = JSON.stringify(evaluateUserInvariants(cfg, workflows));
    const b = JSON.stringify(evaluateUserInvariants(cfg, workflows));
    expect(a).toBe(b);
  });
});
