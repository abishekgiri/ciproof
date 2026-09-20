import { describe, expect, it } from "vitest";
import { exploreWorkflow } from "../../src/engine/index.js";
import { loadModel } from "../helpers/fixtures.js";

/**
 * Real-world corpus smoke (§29). The samples are representative CI workflows
 * (documented, non-executable — not scraped). The goal is only to confirm that
 * exploration terminates, plan counts stay reasonable, and partial/UNKNOWN
 * results remain honest.
 */
describe("corpus smoke", () => {
  it("node-ci explores to a small, bounded set of plans", async () => {
    const model = await loadModel("corpus/node-ci.yml");
    const start = performance.now();
    const result = exploreWorkflow(model);
    const elapsed = performance.now() - start;

    expect(result.scenariosEvaluated).toBeLessThan(50);
    expect(result.plans.length).toBeGreaterThan(0);
    expect(result.plans.length).toBeLessThan(10);
    expect(result.truncated).toBe(false);
    expect(elapsed).toBeLessThan(1000);
  });

  it("release explores choice x boolean inputs and stays honest", async () => {
    const model = await loadModel("corpus/release.yml");
    const result = exploreWorkflow(model);

    // 2 choices x 2 booleans = 4 dispatch scenarios.
    expect(result.scenariosEvaluated).toBe(4);
    // apply runs only when dry_run is false -> at least two distinct plans.
    expect(result.plans.length).toBeGreaterThanOrEqual(2);
    const applyRuns = result.plans.some((p) => p.jobs.apply === "run");
    const applySkips = result.plans.some((p) => p.jobs.apply === "skipped");
    expect(applyRuns).toBe(true);
    expect(applySkips).toBe(true);
  });
});
