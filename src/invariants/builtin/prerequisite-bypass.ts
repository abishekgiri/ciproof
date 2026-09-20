/**
 * CP002 — prerequisite bypass.
 *
 * Based on EXPLICIT intent (a PrerequisiteRule), never guessed from job names.
 * Violated when some explored scenario runs the target job while a required job
 * did not complete (RUN is the only "completed" state; SKIPPED does not satisfy
 * it; UNKNOWN cannot decide it).
 */

import { evidence, type ScenarioOutcome } from "../../engine/index.js";
import type { CheckContext, Finding, PrerequisiteRule } from "../types.js";

export const CP002_ID = "CP002";

export function checkPrerequisiteBypass(
  context: CheckContext,
  rules: PrerequisiteRule[],
): Finding[] {
  return rules.map((rule) => checkRule(context, rule));
}

function checkRule(context: CheckContext, rule: PrerequisiteRule): Finding {
  const { model, exploration } = context;

  const undefinedJobs = [rule.targetJob, ...rule.requiredCompletedJobs].filter(
    (id) => !model.jobs.has(id),
  );
  if (undefinedJobs.length > 0) {
    return {
      id: CP002_ID,
      title: rule.name,
      severity: "error",
      verdict: "unknown",
      message: `rule "${rule.name}" references undefined job(s): ${undefinedJobs.join(", ")}`,
      evidence: [
        evidence(
          "unknown",
          "configuration references a job that does not exist",
        ),
      ],
      limitations: [],
    };
  }

  let firstViolation: ScenarioOutcome | undefined;
  let sawUnknown = false;

  for (const outcome of exploration.evaluations) {
    if (outcome.jobs[rule.targetJob] !== "run") {
      continue;
    }
    const skipped = rule.requiredCompletedJobs.filter(
      (job) => outcome.jobs[job] === "skipped",
    );
    const unknown = rule.requiredCompletedJobs.filter(
      (job) => outcome.jobs[job] === "unknown",
    );
    if (skipped.length > 0) {
      firstViolation ??= outcome;
    } else if (unknown.length > 0) {
      sawUnknown = true;
    }
  }

  if (firstViolation) {
    const missing = rule.requiredCompletedJobs.filter(
      (job) => firstViolation?.jobs[job] !== "run",
    );
    return {
      id: CP002_ID,
      title: rule.name,
      severity: "error",
      verdict: "violated",
      message: `job "${rule.targetJob}" can run while required job(s) did not complete: ${missing.join(", ")}`,
      jobId: rule.targetJob,
      scenario: firstViolation.scenario,
      evidence: [
        evidence("pass", `target job "${rule.targetJob}" ran`),
        ...missing.map((job) =>
          evidence(
            "fail",
            `required job "${job}" did not complete (${firstViolation?.jobs[job] ?? "unknown"})`,
          ),
        ),
      ],
      limitations: [],
    };
  }

  if (sawUnknown) {
    return {
      id: CP002_ID,
      title: rule.name,
      severity: "error",
      verdict: "unknown",
      message: `cannot determine whether "${rule.targetJob}" bypasses its prerequisites; a required job's state is UNKNOWN`,
      jobId: rule.targetJob,
      evidence: [
        evidence(
          "unknown",
          "a required job's completion depends on unmodeled state",
        ),
      ],
      limitations: exploration.limitations,
    };
  }

  return {
    id: CP002_ID,
    title: rule.name,
    severity: "error",
    verdict: "not-violated",
    message: `no scenario runs "${rule.targetJob}" without its required job(s) completing`,
    jobId: rule.targetJob,
    evidence: [
      evidence(
        "pass",
        `across explored scenarios, "${rule.targetJob}" only ran when prerequisites completed`,
      ),
    ],
    limitations: [],
  };
}
