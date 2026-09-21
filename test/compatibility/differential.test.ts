import { describe, expect, it } from "vitest";
import { normalizeWorkflow } from "../../src/github/normalize.js";
import { evaluateWorkflowScenario } from "../../src/engine/index.js";
import { CASES, type Expected } from "./cases.js";

type Classification =
  "MATCH" | "FALSE_RUN" | "FALSE_SKIP" | "FALSE_BLOCK" | "MISMATCH";

const STATE_TO_EXPECTED: Record<string, Expected> = {
  run: "RUN",
  skipped: "SKIPPED",
  blocked: "BLOCKED",
  unknown: "UNKNOWN",
};

/**
 * Differential validation: compare CIProof's predicted job state against the
 * independently-recorded GitHub-semantics ground truth. A false RUN is the most
 * serious outcome (it can create a false counterexample).
 */
function classify(predicted: Expected, expected: Expected): Classification {
  if (predicted === expected) {
    return "MATCH";
  }
  if (predicted === "RUN") {
    return "FALSE_RUN";
  }
  if (predicted === "SKIPPED") {
    return "FALSE_SKIP";
  }
  if (predicted === "BLOCKED") {
    return "FALSE_BLOCK";
  }
  return "MISMATCH";
}

describe("semantic compatibility (differential validation)", () => {
  for (const testCase of CASES) {
    it(`${testCase.name}: matches GitHub semantics`, async () => {
      const { model } = await normalizeWorkflow({
        filename: ".github/workflows/ci.yml",
        content: testCase.workflow,
      });
      expect(model, `case ${testCase.name} should parse`).toBeDefined();
      const evaluation = evaluateWorkflowScenario(model!, testCase.scenario);

      for (const [jobId, expected] of Object.entries(testCase.expected)) {
        const state = evaluation.jobs.get(jobId)?.state ?? "unknown";
        const predicted = STATE_TO_EXPECTED[state] ?? "UNKNOWN";
        const verdict = classify(predicted, expected);
        expect(
          verdict,
          `${testCase.name}/${jobId}: predicted ${predicted}, expected ${expected} (${testCase.oracle})`,
        ).toBe("MATCH");
      }
    });
  }

  it("covers the core modeled semantic areas", () => {
    // Guards against silently dropping coverage from this suite.
    expect(CASES.length).toBeGreaterThanOrEqual(15);
    const names = CASES.map((c) => c.name).join(" ");
    for (const area of [
      "if-",
      "needs-",
      "always-",
      "success-",
      "failure-",
      "cancelled-",
      "dispatch-",
      "branch-filter",
      "tag-filter",
      "pull-request-target",
      "path-filter",
    ]) {
      expect(names, `missing coverage for ${area}`).toContain(area);
    }
  });
});
