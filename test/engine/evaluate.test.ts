import { describe, expect, it } from "vitest";
import {
  evaluateWorkflowScenario,
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

describe("evaluateWorkflowScenario", () => {
  it("THE SPIKE: skip_tests=true -> test SKIPPED, deploy RUN via always()", async () => {
    const model = await loadModel("needs/always-needs.yml");
    const result = evaluateWorkflowScenario(
      model,
      scenario({ event: "workflow_dispatch", inputs: { skip_tests: true } }),
    );
    expect(result.trigger).toBe("matched");
    expect(result.jobs.get("test")?.state).toBe("skipped");
    expect(result.jobs.get("deploy")?.state).toBe("run");
  });

  it("skip_tests=false -> both run", async () => {
    const model = await loadModel("needs/always-needs.yml");
    const result = evaluateWorkflowScenario(
      model,
      scenario({ event: "workflow_dispatch", inputs: { skip_tests: false } }),
    );
    expect(result.jobs.get("test")?.state).toBe("run");
    expect(result.jobs.get("deploy")?.state).toBe("run");
  });

  it("propagates a successful needs chain", async () => {
    const model = await loadModel("needs/chain-needs.yml");
    const result = evaluateWorkflowScenario(
      model,
      scenario({ branch: "main" }),
    );
    expect([...result.jobs.values()].map((j) => j.state)).toEqual([
      "run",
      "run",
      "run",
    ]);
  });

  it("skips a dependent job when its (non-always) need is skipped", async () => {
    // skipped-needs: test gated on inputs.run_tests; deploy needs test (no if).
    const model = await loadModel("needs/skipped-needs.yml");
    const result = evaluateWorkflowScenario(
      model,
      scenario({ event: "workflow_dispatch", inputs: { run_tests: false } }),
    );
    expect(result.jobs.get("test")?.state).toBe("skipped");
    expect(result.jobs.get("deploy")?.state).toBe("skipped");
  });

  it("evaluates an ordinary job.if to SKIPPED when false", async () => {
    const model = await loadModel("conditions/event-name.yml");
    const result = evaluateWorkflowScenario(
      model,
      scenario({ event: "pull_request", baseRef: "main" }),
    );
    expect(result.jobs.get("deploy")?.state).toBe("skipped");
  });

  it("evaluates an ordinary job.if to RUN when true", async () => {
    const model = await loadModel("conditions/event-name.yml");
    const result = evaluateWorkflowScenario(
      model,
      scenario({ branch: "main" }),
    );
    expect(result.jobs.get("deploy")?.state).toBe("run");
  });

  it("runs a job with no explicit if (implicit success())", async () => {
    const model = await loadModel("triggers/push.yml");
    const result = evaluateWorkflowScenario(
      model,
      scenario({ branch: "main" }),
    );
    expect(result.jobs.get("build")?.state).toBe("run");
  });

  it("yields UNKNOWN for !cancelled() (unmodeled status function)", async () => {
    const model = await loadModel("conditions/not-cancelled.yml");
    const result = evaluateWorkflowScenario(
      model,
      scenario({ branch: "main" }),
    );
    expect(result.jobs.get("build")?.state).toBe("run");
    expect(result.jobs.get("notify")?.state).toBe("unknown");
  });

  it("skips all jobs when the trigger does not match", async () => {
    const model = await loadModel("filters/branches.yml");
    const result = evaluateWorkflowScenario(
      model,
      scenario({ branch: "feature/x" }),
    );
    expect(result.trigger).toBe("not-matched");
    expect(result.jobs.get("build")?.state).toBe("skipped");
  });

  it("attaches evidence to every job outcome", async () => {
    const model = await loadModel("needs/always-needs.yml");
    const result = evaluateWorkflowScenario(
      model,
      scenario({ event: "workflow_dispatch", inputs: { skip_tests: true } }),
    );
    for (const job of result.jobs.values()) {
      expect(job.evidence.length).toBeGreaterThan(0);
    }
  });
});
