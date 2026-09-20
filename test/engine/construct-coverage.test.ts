import { describe, expect, it } from "vitest";
import { exploreWorkflow } from "../../src/engine/index.js";
import { loadModel } from "../helpers/fixtures.js";

describe("schedule support", () => {
  it("A/H. normalizes schedule entries in order", async () => {
    const m = await loadModel("schedule/multi.yml");
    const t = m.triggers.find((x) => x.event === "schedule");
    expect(t?.event).toBe("schedule");
    if (t?.event === "schedule") {
      expect(t.schedules.map((s) => s.cron)).toEqual([
        "0 0 * * *",
        "0 12 * * *",
      ]);
    }
  });

  it("B/C/D. distinct plans per cron via github.event.schedule", async () => {
    const m = await loadModel("schedule/multi.yml");
    const r = exploreWorkflow(m);
    expect(r.completeness).toBe("complete-within-supported-model");
    const nightlyRuns = r.plans.some((p) => p.jobs.nightly === "run");
    const nightlySkips = r.plans.some((p) => p.jobs.nightly === "skipped");
    expect(nightlyRuns).toBe(true);
    expect(nightlySkips).toBe(true);
  });

  it("I. a schedule-only workflow is complete (no unsupported markers)", async () => {
    const m = await loadModel("schedule/single.yml");
    const r = exploreWorkflow(m);
    expect(r.completeness).toBe("complete-within-supported-model");
    expect(r.plans[0]?.jobs.build).toBe("run");
  });
});

describe("workflow_run support", () => {
  it("A/B/E/F. normalizes workflow_run with names, types, branches", async () => {
    const m = await loadModel("workflow-run/full.yml");
    const t = m.triggers.find((x) => x.event === "workflow_run");
    if (t?.event === "workflow_run") {
      expect(t.workflows).toEqual(["Build", "Test"]);
      expect(t.types).toEqual(["completed"]);
      expect(t.branches).toEqual(["main"]);
    }
  });

  it("G/H. conclusion condition produces distinct plans", async () => {
    const m = await loadModel("workflow-run/full.yml");
    const r = exploreWorkflow(m);
    expect(r.plans.some((p) => p.jobs.deploy === "run")).toBe(true);
    expect(r.plans.some((p) => p.jobs.deploy === "skipped")).toBe(true);
  });

  it("C. requested activity (no conclusion) is complete", async () => {
    const m = await loadModel("workflow-run/requested.yml");
    const r = exploreWorkflow(m);
    expect(r.completeness).toBe("complete-within-supported-model");
    expect(r.plans[0]?.jobs.notify).toBe("run");
  });

  it("defaults to all activity types when omitted", async () => {
    const m = await loadModel("workflow-run/no-types.yml");
    const t = m.triggers.find((x) => x.event === "workflow_run");
    if (t?.event === "workflow_run") {
      expect(t.types).toEqual(["requested", "in_progress", "completed"]);
    }
  });
});

describe("matrix support", () => {
  it("J. a static matrix no longer marks the workflow partial", async () => {
    const m = await loadModel("matrix/include-exclude.yml");
    const build = m.jobs.get("build");
    expect(build?.matrix?.kind).toBe("static");
    const r = exploreWorkflow(m);
    expect(r.completeness).toBe("complete-within-supported-model");
    expect(r.plans[0]?.jobs.build).toBe("run");
  });

  it("static matrix does not explode the scenario space", async () => {
    const m = await loadModel("matrix/include-exclude.yml");
    const r = exploreWorkflow(m);
    // push, no filters -> a single job-outcome plan regardless of matrix size.
    expect(r.scenariosEvaluated).toBeLessThan(5);
  });

  it("K/M. a dynamic matrix remains unsupported/partial", async () => {
    const m = await loadModel("matrix/dynamic.yml");
    const build = m.jobs.get("build");
    expect(build?.matrix?.kind).toBe("dynamic");
    expect(build?.unsupported.some((u) => u.kind === "matrix-strategy")).toBe(
      true,
    );
    const r = exploreWorkflow(m);
    expect(r.completeness).toBe("partial");
  });
});
