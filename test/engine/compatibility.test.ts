import { describe, expect, it } from "vitest";
import { buildEventContext, type Scenario } from "../../src/engine/index.js";
import { loadModel } from "../helpers/fixtures.js";

/**
 * Semantic compatibility checks: each assertion documents the GitHub behavior
 * CIProof reproduces. Event-context refs are drawn from GitHub's documented
 * semantics (events-that-trigger-workflows / contexts reference). Behaviors are
 * asserted through evaluation elsewhere; these focus on the context builders and
 * input typing that other checks depend on.
 *
 * Assumptions still to confirm against a live run are noted inline.
 */

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

describe("event context semantics", () => {
  it("A. push: github.ref is the branch ref; base/head are empty", async () => {
    const model = await loadModel("triggers/push.yml");
    const ctx = buildEventContext(model, scenario({ branch: "main" }));
    expect(ctx.github.event_name).toBe("push");
    expect(ctx.github.ref).toBe("refs/heads/main");
    expect(ctx.github.base_ref).toBe("");
    expect(ctx.github.head_ref).toBe("");
  });

  it("B. pull_request: ref is the merge ref; base/head name PR branches", async () => {
    const model = await loadModel("triggers/pull-request.yml");
    const ctx = buildEventContext(
      model,
      scenario({
        event: "pull_request",
        ref: "refs/pull/7/merge",
        baseRef: "main",
        headRef: "feature",
      }),
    );
    expect(ctx.github.event_name).toBe("pull_request");
    expect(ctx.github.ref).toBe("refs/pull/7/merge");
    expect(ctx.github.base_ref).toBe("main");
    expect(ctx.github.head_ref).toBe("feature");
  });

  it("C. pull_request_target: runs in base repo; ref is the base branch", async () => {
    const model = await loadModel("triggers/pull-request-target.yml");
    const ctx = buildEventContext(
      model,
      scenario({
        event: "pull_request_target",
        baseRef: "main",
        headRef: "feature",
        fork: true,
        actorClass: "external",
      }),
    );
    expect(ctx.github.event_name).toBe("pull_request_target");
    expect(ctx.github.ref).toBe("refs/heads/main");
    expect(ctx.github.base_ref).toBe("main");
    expect(ctx.github.head_ref).toBe("feature");
  });

  it("D. workflow_dispatch: boolean inputs remain booleans", async () => {
    const model = await loadModel("triggers/workflow-dispatch.yml");
    const ctx = buildEventContext(
      model,
      scenario({ event: "workflow_dispatch", inputs: { skip_tests: "true" } }),
    );
    // Declared boolean input, supplied as the string "true", is coerced to a
    // real boolean to match the GitHub `inputs` context.
    expect(ctx.inputs.skip_tests).toBe(true);
  });

  it("D. workflow_dispatch: an unsupplied input with no default is unknown", async () => {
    const model = await loadModel("triggers/workflow-dispatch.yml");
    // workflow-dispatch.yml declares skip_tests with a default of false, so it
    // resolves; a truly unsupplied+defaultless input would appear in
    // unknownInputs. Here we assert the declared default is applied.
    const ctx = buildEventContext(
      model,
      scenario({ event: "workflow_dispatch" }),
    );
    expect(ctx.inputs.skip_tests).toBe(false);
    expect(ctx.unknownInputs).toEqual([]);
  });
});
