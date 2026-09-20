import { describe, expect, it } from "vitest";
import {
  evaluateTrigger,
  exploreWorkflow,
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

describe("push tag refs", () => {
  it("A/B/C. models tag filters and distinguishes tag from branch pushes", async () => {
    const model = await loadModel("tags/tag-only.yml");
    // A tag push that matches triggers.
    expect(
      evaluateTrigger(
        model,
        scenario({ refKind: "tag", ref: "refs/tags/v1.0" }),
      ).match,
    ).toBe("matched");
    // A branch push does NOT trigger a tag-only filter.
    expect(
      evaluateTrigger(model, scenario({ refKind: "branch", branch: "main" }))
        .match,
    ).toBe("not-matched");
  });

  it("D. ordered positive/negative/positive tag patterns (last-match-wins)", () => {
    const patterns = ["v*", "!v*-beta", "v-special-beta"];
    expect(matchesFilterPattern("v1.0", patterns)).toBe(true);
    expect(matchesFilterPattern("v1.0-beta", patterns)).toBe(false);
    expect(matchesFilterPattern("v-special-beta", patterns)).toBe(true);
  });

  it("generates tag scenarios and explores them", async () => {
    const model = await loadModel("tags/ordered.yml");
    const result = exploreWorkflow(model);
    expect(result.evaluations.some((e) => e.scenario.refKind === "tag")).toBe(
      true,
    );
  });

  it("I. path filters are ignored for tag pushes", async () => {
    const model = await loadModel("invariants/tag-gated.yml"); // branches+tags, no paths
    const result = exploreWorkflow(model);
    // release (if refs/tags/) runs on a tag push
    expect(
      result.evaluations.some(
        (e) => e.scenario.refKind === "tag" && e.jobs.release === "run",
      ),
    ).toBe(true);
  });
});

describe("concurrency reclassification", () => {
  it("F. concurrency alone does not make analysis partial", async () => {
    const model = await loadModel("concurrency/workflow.yml");
    const result = exploreWorkflow(model);
    expect(result.completeness).toBe("complete-within-supported-model");
  });

  it("G. structural reachability is unchanged (build runs)", async () => {
    const model = await loadModel("concurrency/workflow.yml");
    const result = exploreWorkflow(model);
    expect(result.plans.some((p) => p.jobs.build === "run")).toBe(true);
  });

  it("H. the concurrency limitation is still surfaced as informational", async () => {
    const model = await loadModel("concurrency/workflow.yml");
    const result = exploreWorkflow(model);
    const note = result.limitations.find((l) => l.kind === "concurrency");
    expect(note?.informational).toBe(true);
  });
});
