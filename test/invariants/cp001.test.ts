import { describe, expect, it } from "vitest";
import { checkUnreachableJob } from "../../src/invariants/index.js";
import { contextFor } from "./helpers.js";

describe("CP001 — unreachable job", () => {
  it("A. reachable job produces no finding", async () => {
    const context = await contextFor("triggers/push.yml");
    expect(checkUnreachableJob(context)).toEqual([]);
  });

  it("B. never-run job with complete exploration -> violated", async () => {
    const context = await contextFor("invariants/unreachable.yml");
    const findings = checkUnreachableJob(context);
    const never = findings.find((f) => f.jobId === "never");
    expect(never?.verdict).toBe("violated");
    expect(never?.id).toBe("CP001");
    // reachable jobs (build) are not reported
    expect(findings.find((f) => f.jobId === "build")).toBeUndefined();
  });

  it("C/D. never-run job with UNKNOWN state -> unknown", async () => {
    const context = await contextFor("conditions/not-cancelled.yml");
    const notify = checkUnreachableJob(context).find(
      (f) => f.jobId === "notify",
    );
    expect(notify?.verdict).toBe("unknown");
  });

  it("E. unsupported-construct job -> unknown, never a false unreachable", async () => {
    const context = await contextFor("unsupported/reusable-workflow.yml");
    const findings = checkUnreachableJob(context);
    // reusable job never "runs" in the model, but must not be called unreachable
    expect(findings.every((f) => f.verdict !== "violated")).toBe(true);
  });

  it("F. is deterministic", async () => {
    const context = await contextFor("invariants/unreachable.yml");
    const a = checkUnreachableJob(context).map(
      (f) => `${f.jobId}:${f.verdict}`,
    );
    const b = checkUnreachableJob(context).map(
      (f) => `${f.jobId}:${f.verdict}`,
    );
    expect(a).toEqual(b);
  });
});
