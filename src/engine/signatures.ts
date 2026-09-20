/**
 * Deterministic behavior signatures.
 *
 * A signature captures only the observable semantic outcome (trigger state and
 * each job's execution state), never evidence text or source locations. Two
 * scenarios with the same signature are the same execution plan.
 */

import type { WorkflowEvaluation } from "./evidence.js";

/**
 * Build a stable signature: `trigger=<state>;<jobId>=<state>;...` with job ids
 * sorted so the result is independent of Map insertion order.
 */
export function behaviorSignature(evaluation: WorkflowEvaluation): string {
  const jobs = [...evaluation.jobs.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => `${id}=${evaluation.jobs.get(id)?.state ?? "unknown"}`);
  return [`trigger=${evaluation.trigger}`, ...jobs].join(";");
}
