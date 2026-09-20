import { describe, expect, it } from "vitest";
import { exploreWorkflow } from "../../src/engine/index.js";
import { loadModel } from "../helpers/fixtures.js";

describe("exploreWorkflow", () => {
  it("A. explores a single-scenario workflow", async () => {
    const model = await loadModel("triggers/push.yml");
    const result = exploreWorkflow(model);
    expect(result.scenariosEvaluated).toBe(1);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]?.jobs.build).toBe("run");
  });

  it("B/C. collapses equal behavior and separates distinct behavior", async () => {
    const model = await loadModel("filters/branches.yml");
    const result = exploreWorkflow(model);
    // main and release/<witness> both match -> one plan; non-match -> another.
    expect(result.plans).toHaveLength(2);
    const matched = result.plans.find((p) => p.trigger === "matched");
    const notMatched = result.plans.find((p) => p.trigger === "not-matched");
    expect(matched?.scenarioCount).toBeGreaterThanOrEqual(2);
    expect(notMatched).toBeDefined();
  });

  it("D. preserves an UNKNOWN plan", async () => {
    const model = await loadModel("filters/paths.yml");
    const result = exploreWorkflow(model);
    expect(
      result.plans.some(
        (p) =>
          p.trigger === "unknown" || Object.values(p.jobs).includes("unknown"),
      ),
    ).toBe(true);
    expect(result.completeness).toBe("partial");
  });

  it("E/I. is deterministic across runs (order + representatives)", async () => {
    const model = await loadModel("explore/canonical.yml");
    const a = exploreWorkflow(model);
    const b = exploreWorkflow(model);
    expect(a.plans.map((p) => p.signature)).toEqual(
      b.plans.map((p) => p.signature),
    );
    expect(a.plans.map((p) => JSON.stringify(p.representative))).toEqual(
      b.plans.map((p) => JSON.stringify(p.representative)),
    );
  });

  it("F/G. enforces the scenario cap and reports truncation", async () => {
    const model = await loadModel("explore/canonical.yml");
    const result = exploreWorkflow(model, { maxScenarios: 1 });
    expect(result.scenariosEvaluated).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.completeness).toBe("partial");
  });

  it("H. reports partial completeness with an unsupported input", async () => {
    const model = await loadModel("conditions/choice-input.yml");
    const result = exploreWorkflow(model);
    expect(result.completeness).toBe("partial");
    expect(result.limitations.length).toBeGreaterThan(0);
  });

  it("J. discovers the canonical spike plans from generated scenarios", async () => {
    const model = await loadModel("explore/canonical.yml");
    const result = exploreWorkflow(model);

    const skipTrue = result.plans.find(
      (p) => p.jobs.test === "skipped" && p.jobs.deploy === "run",
    );
    const bothRun = result.plans.find(
      (p) => p.jobs.test === "run" && p.jobs.deploy === "run",
    );

    expect(skipTrue, "expected a test=skipped, deploy=run plan").toBeDefined();
    expect(bothRun, "expected a test=run, deploy=run plan").toBeDefined();
    expect(skipTrue?.representative.inputs.skip_tests).toBe(true);
    expect(result.completeness).toBe("complete-within-supported-model");
  });
});
