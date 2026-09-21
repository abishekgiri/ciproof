import { describe, expect, it } from "vitest";
import { normalizeWorkflow } from "../../src/github/normalize.js";
import { exploreWorkflow } from "../../src/engine/index.js";
import {
  buildBehaviorSnapshot,
  type AnalyzedWorkflow,
  type BehaviorSnapshot,
} from "../../src/diff/snapshot.js";
import { compareBehavior } from "../../src/diff/compare.js";

/**
 * Build a behavior snapshot from workflow YAML strings, using the real analyzer
 * (normalize + explore). No git is involved — the comparator is a pure function
 * of two snapshots.
 */
async function snapshot(
  files: Record<string, string>,
): Promise<BehaviorSnapshot> {
  const analyzed: AnalyzedWorkflow[] = [];
  for (const [file, content] of Object.entries(files)) {
    const { model } = await normalizeWorkflow({ filename: file, content });
    analyzed.push(
      model ? { file, model, exploration: exploreWorkflow(model) } : { file },
    );
  }
  return buildBehaviorSnapshot("test", analyzed);
}

const CI = ".github/workflows/ci.yml";

function pushOnMain(jobBody: string): string {
  return `on:\n  push:\n    branches: [main]\njobs:\n${jobBody}`;
}

describe("compareBehavior — no-op textual change (A)", () => {
  it("reports no changes when text differs but modeled behavior is identical", async () => {
    const before = await snapshot({
      [CI]: `on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`,
    });
    // Reordered keys, added comment, quoted scalar, block-style list.
    const after = await snapshot({
      [CI]: `# continuous integration
jobs:
  build:
    steps:
      - run: echo hi
    runs-on: "ubuntu-latest"
on:
  push:
    branches:
      - main
`,
    });
    expect(compareBehavior(before, after)).toEqual([]);
  });
});

describe("compareBehavior — reachability transitions (B, C)", () => {
  it("B. detects a newly reachable job (unreachable -> reachable)", async () => {
    const before = await snapshot({
      [CI]: pushOnMain(
        "  deploy:\n    if: ${{ false }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const after = await snapshot({
      [CI]: pushOnMain(
        "  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const changes = compareBehavior(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.category).toBe("added-reachability");
    expect(changes[0]?.job).toBe("deploy");
    expect(changes[0]?.addedScenarios).toContain("push → refs/heads/main");
  });

  it("C. detects lost reachability (reachable -> unreachable)", async () => {
    const before = await snapshot({
      [CI]: pushOnMain(
        "  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const after = await snapshot({
      [CI]: pushOnMain(
        "  deploy:\n    if: ${{ false }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const changes = compareBehavior(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.category).toBe("removed-reachability");
    expect(changes[0]?.removedScenarios).toContain("push → refs/heads/main");
  });
});

describe("compareBehavior — scenario-level change (D)", () => {
  it("reports the added modeled scenario, not a textual diff", async () => {
    const before = await snapshot({
      [CI]: `on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`,
    });
    const after = await snapshot({
      [CI]: `on:
  push:
    branches: [main, release]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo
`,
    });
    const changes = compareBehavior(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.category).toBe("changed-reachability");
    expect(changes[0]?.job).toBe("build");
    expect(changes[0]?.addedScenarios).toEqual(["push → refs/heads/release"]);
    expect(changes[0]?.removedScenarios).toBeUndefined();
  });
});

describe("compareBehavior — additions and removals (E, F)", () => {
  it("E. detects an added workflow", async () => {
    const before = await snapshot({});
    const after = await snapshot({
      ".github/workflows/release.yml": pushOnMain(
        "  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const changes = compareBehavior(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.category).toBe("added-workflow");
    expect(changes[0]?.workflow).toBe(".github/workflows/release.yml");
    expect(changes[0]?.details?.some((d) => d.includes("publish"))).toBe(true);
  });

  it("E. detects an added job in an existing workflow", async () => {
    const before = await snapshot({
      [CI]: pushOnMain(
        "  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const after = await snapshot({
      [CI]: pushOnMain(
        "  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n" +
          "  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const changes = compareBehavior(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.category).toBe("added-job");
    expect(changes[0]?.job).toBe("test");
  });

  it("F. detects a removed workflow and a removed job", async () => {
    const releaseYaml = pushOnMain(
      "  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
    );
    const removedWf = compareBehavior(
      await snapshot({ ".github/workflows/release.yml": releaseYaml }),
      await snapshot({}),
    );
    expect(removedWf).toHaveLength(1);
    expect(removedWf[0]?.category).toBe("removed-workflow");

    const removedJob = compareBehavior(
      await snapshot({
        [CI]: pushOnMain(
          "  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n" +
            "  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
        ),
      }),
      await snapshot({
        [CI]: pushOnMain(
          "  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
        ),
      }),
    );
    expect(removedJob).toHaveLength(1);
    expect(removedJob[0]?.category).toBe("removed-job");
    expect(removedJob[0]?.job).toBe("test");
  });
});

describe("compareBehavior — UNKNOWN transitions (G)", () => {
  it("G. reports MODELED -> UNKNOWN, not removed reachability", async () => {
    const before = await snapshot({
      [CI]: pushOnMain(
        "  gate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const after = await snapshot({
      [CI]: pushOnMain(
        "  gate:\n    if: ${{ failure() }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const changes = compareBehavior(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.category).toBe("modeled-to-unknown");
    expect(changes[0]?.before).toBe("reachable");
    expect(changes[0]?.after).toBe("unknown");
  });

  it("reports UNKNOWN -> MODELED", async () => {
    const before = await snapshot({
      [CI]: pushOnMain(
        "  gate:\n    if: ${{ failure() }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const after = await snapshot({
      [CI]: pushOnMain(
        "  gate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const changes = compareBehavior(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.category).toBe("unknown-to-modeled");
    expect(changes[0]?.after).toBe("reachable");
  });

  it("does NOT collapse unreachable -> unknown into added reachability", async () => {
    // before: unreachable (if false); after: unknown (failure()).
    const before = await snapshot({
      [CI]: pushOnMain(
        "  gate:\n    if: ${{ false }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const after = await snapshot({
      [CI]: pushOnMain(
        "  gate:\n    if: ${{ failure() }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const changes = compareBehavior(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.category).toBe("modeled-to-unknown");
    expect(changes[0]?.before).toBe("unreachable");
    expect(changes[0]?.after).toBe("unknown");
  });
});

describe("compareBehavior — modeled security dimensions", () => {
  it("reports a declared write-privilege change", async () => {
    const before = await snapshot({
      [CI]: pushOnMain(
        "  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const after = await snapshot({
      [CI]: pushOnMain(
        "  build:\n    permissions:\n      contents: write\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const changes = compareBehavior(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.category).toBe("privilege-changed");
    expect(changes[0]?.before).toBe("none");
    expect(changes[0]?.after).toBe("contents");
  });

  it("does not emit a spurious trust-exposure change when a job becomes UNKNOWN", async () => {
    const before = await snapshot({
      [CI]:
        "on: pull_request_target\njobs:\n" +
        "  label:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
    });
    const after = await snapshot({
      [CI]:
        "on: pull_request_target\njobs:\n" +
        "  label:\n    if: ${{ failure() }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
    });
    const changes = compareBehavior(before, after);
    expect(changes.map((c) => c.category)).toEqual(["modeled-to-unknown"]);
  });
});

describe("compareBehavior — determinism", () => {
  it("produces identical output across repeated runs", async () => {
    const before = await snapshot({
      [CI]: pushOnMain(
        "  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n" +
          "  b:\n    if: ${{ false }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const after = await snapshot({
      [CI]: pushOnMain(
        "  a:\n    if: ${{ false }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n" +
          "  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
      ),
    });
    const first = JSON.stringify(compareBehavior(before, after));
    const second = JSON.stringify(compareBehavior(before, after));
    expect(first).toBe(second);
  });
});
