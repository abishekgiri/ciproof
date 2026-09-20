/**
 * Concrete scenario evaluation: WorkflowModel + one Scenario -> per-job results.
 *
 * This evaluates exactly ONE explicit scenario. It does not enumerate or
 * generate scenarios, search for counterexamples, or check invariants. No
 * workflow code is executed.
 */

import { validateNeeds, type WorkflowModel } from "../model/index.js";
import type { Truth } from "../model/truth.js";
import {
  evidence,
  type Evidence,
  type JobExecution,
  type JobResult,
  type WorkflowEvaluation,
  type EvaluationDiagnostic,
} from "./evidence.js";
import { validateScenario, type Scenario } from "./scenario.js";
import { evaluateTrigger } from "./trigger.js";
import { buildEventContext } from "./context.js";
import { successOfNeeds, orderJobs } from "./needs.js";
import { evaluateEffectiveCondition } from "./condition.js";

export type { Scenario } from "./scenario.js";

/** Evaluate one concrete scenario against one workflow model. */
export function evaluateWorkflowScenario(
  model: WorkflowModel,
  scenario: Scenario,
): WorkflowEvaluation {
  const diagnostics: EvaluationDiagnostic[] = validateScenario(scenario);
  for (const need of validateNeeds(model)) {
    diagnostics.push({
      code: need.code,
      message: need.message,
      severity: need.severity,
      ...(need.source ? { source: need.source } : {}),
    });
  }

  const triggerEval = evaluateTrigger(model, scenario);
  const jobs = new Map<string, JobResult>();

  if (triggerEval.match !== "matched") {
    const state: JobExecution =
      triggerEval.match === "unknown" ? "unknown" : "skipped";
    const reason =
      triggerEval.match === "unknown"
        ? "workflow trigger match is unknown"
        : "workflow trigger did not match; job does not run";
    for (const id of model.jobs.keys()) {
      jobs.set(id, { jobId: id, state, evidence: [evidence("info", reason)] });
    }
    return {
      file: model.file,
      trigger: triggerEval.match,
      triggerEvidence: triggerEval.evidence,
      jobs,
      diagnostics,
    };
  }

  const context = buildEventContext(model, scenario);
  const { order, unordered } = orderJobs(model);

  for (const id of order) {
    const job = model.jobs.get(id);
    if (!job) {
      continue;
    }
    const success = successOfNeeds(job.needs, model, jobs);
    const condition = evaluateEffectiveCondition(job, context, success.value);
    const ev: Evidence[] = [...success.evidence, ...condition.evidence];
    jobs.set(id, {
      jobId: id,
      state: truthToState(condition.effective),
      evidence: ev,
    });
  }

  for (const id of unordered) {
    jobs.set(id, {
      jobId: id,
      state: "unknown",
      evidence: [
        evidence("unknown", "job is in a dependency cycle; cannot evaluate"),
      ],
    });
  }

  return {
    file: model.file,
    trigger: "matched",
    triggerEvidence: triggerEval.evidence,
    jobs,
    diagnostics,
  };
}

function truthToState(truth: Truth): JobExecution {
  if (truth === "true") {
    return "run";
  }
  return truth === "false" ? "skipped" : "unknown";
}
