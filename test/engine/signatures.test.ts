import { describe, expect, it } from "vitest";
import { behaviorSignature } from "../../src/engine/index.js";
import type { JobResult, WorkflowEvaluation } from "../../src/engine/index.js";

function evaluation(
  trigger: WorkflowEvaluation["trigger"],
  jobs: Record<string, JobResult["state"]>,
): WorkflowEvaluation {
  const map = new Map<string, JobResult>();
  for (const [id, state] of Object.entries(jobs)) {
    map.set(id, { jobId: id, state, evidence: [] });
  }
  return {
    file: "w.yml",
    trigger,
    triggerEvidence: [],
    jobs: map,
    diagnostics: [],
  };
}

describe("behaviorSignature", () => {
  it("is independent of job insertion order", () => {
    const a = evaluation("matched", { build: "run", deploy: "skipped" });
    const b = evaluation("matched", { deploy: "skipped", build: "run" });
    expect(behaviorSignature(a)).toBe(behaviorSignature(b));
  });

  it("differs when a job outcome differs", () => {
    const a = evaluation("matched", { build: "run", deploy: "run" });
    const b = evaluation("matched", { build: "run", deploy: "skipped" });
    expect(behaviorSignature(a)).not.toBe(behaviorSignature(b));
  });

  it("differs when the trigger differs", () => {
    const a = evaluation("matched", { build: "run" });
    const b = evaluation("not-matched", { build: "run" });
    expect(behaviorSignature(a)).not.toBe(behaviorSignature(b));
  });

  it("excludes evidence and is stable across calls", () => {
    const a = evaluation("matched", { build: "run" });
    a.jobs.get("build")?.evidence.push({ outcome: "pass", message: "x" });
    expect(behaviorSignature(a)).toBe("trigger=matched;build=run");
  });
});
