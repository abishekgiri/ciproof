import { describe, expect, it } from "vitest";
import {
  evaluateTrigger,
  matchesFilterPattern,
  type Scenario,
} from "../../src/engine/index.js";
import { loadModel } from "../helpers/fixtures.js";

function scenario(over: Partial<Scenario>): Scenario {
  return {
    event: "push",
    fork: false,
    actorClass: "internal",
    changedFiles: [],
    inputs: {},
    ...over,
  };
}

describe("GitHub filter-pattern matching", () => {
  it("matches literal and wildcard branch patterns", () => {
    expect(matchesFilterPattern("main", ["main"])).toBe(true);
    expect(matchesFilterPattern("feature/x", ["feature/*"])).toBe(true);
    expect(matchesFilterPattern("feature/x/y", ["feature/*"])).toBe(false);
    expect(matchesFilterPattern("release/1.0", ["release/**"])).toBe(true);
    expect(matchesFilterPattern("main", ["release/**"])).toBe(false);
  });

  it("matches path patterns with ** across slashes", () => {
    expect(matchesFilterPattern("src/auth.ts", ["src/**"])).toBe(true);
    expect(matchesFilterPattern("src/auth.ts", ["**.ts"])).toBe(true);
    expect(matchesFilterPattern("docs/readme.md", ["src/**"])).toBe(false);
  });
});

describe("evaluateTrigger", () => {
  it("matches an event with no filters", async () => {
    const model = await loadModel("triggers/push.yml");
    expect(evaluateTrigger(model, scenario({ branch: "any" })).match).toBe(
      "matched",
    );
  });

  it("does not match a different event", async () => {
    const model = await loadModel("triggers/push.yml");
    expect(
      evaluateTrigger(
        model,
        scenario({ event: "pull_request", baseRef: "main" }),
      ).match,
    ).toBe("not-matched");
  });

  it("applies branch filters (match)", async () => {
    const model = await loadModel("filters/branches.yml");
    expect(evaluateTrigger(model, scenario({ branch: "main" })).match).toBe(
      "matched",
    );
    expect(
      evaluateTrigger(model, scenario({ branch: "release/2" })).match,
    ).toBe("matched");
  });

  it("applies branch filters (mismatch)", async () => {
    const model = await loadModel("filters/branches.yml");
    expect(
      evaluateTrigger(model, scenario({ branch: "feature/x" })).match,
    ).toBe("not-matched");
  });

  it("applies path filters against changed files", async () => {
    const model = await loadModel("filters/paths.yml");
    expect(
      evaluateTrigger(
        model,
        scenario({ branch: "main", changedFiles: ["src/a.ts"] }),
      ).match,
    ).toBe("matched");
    expect(
      evaluateTrigger(
        model,
        scenario({ branch: "main", changedFiles: ["README"] }),
      ).match,
    ).toBe("not-matched");
  });

  it("returns unknown for a path filter with no changed files supplied", async () => {
    const model = await loadModel("filters/paths.yml");
    expect(evaluateTrigger(model, scenario({ branch: "main" })).match).toBe(
      "unknown",
    );
  });

  it("matches workflow_dispatch regardless of branch filters", async () => {
    const model = await loadModel("triggers/workflow-dispatch.yml");
    expect(
      evaluateTrigger(model, scenario({ event: "workflow_dispatch" })).match,
    ).toBe("matched");
  });
});
