/**
 * Needs propagation for one scenario.
 *
 * Computes `success()` for a job from the modeled outcomes of its dependencies,
 * and provides a deterministic topological order. This models only the
 * success/skipped abstraction: a scheduled (RUN) job is treated as "succeeded"
 * for dependency flow; step-level failures and cancellation are not modeled.
 */

import type { WorkflowModel } from "../model/index.js";
import { andTruth, type Truth } from "../model/truth.js";
import { evidence, type Evidence, type JobResult } from "./evidence.js";

export interface SuccessComputation {
  value: Truth;
  evidence: Evidence[];
}

/**
 * Value of `success()` for a job with the given dependencies, based on the
 * already-computed results of those dependencies.
 */
export function successOfNeeds(
  needs: string[],
  model: WorkflowModel,
  results: Map<string, JobResult>,
): SuccessComputation {
  if (needs.length === 0) {
    return {
      value: "true",
      evidence: [evidence("pass", "no dependencies; success() -> true")],
    };
  }

  const contributions: Truth[] = [];
  const ev: Evidence[] = [];

  for (const need of needs) {
    if (!model.jobs.has(need)) {
      contributions.push("unknown");
      ev.push(evidence("unknown", `needs "${need}", which is not defined`));
      continue;
    }
    const result = results.get(need);
    switch (result?.state) {
      case "run":
        contributions.push("true");
        ev.push(evidence("pass", `needs "${need}" completed`));
        break;
      case "skipped":
        contributions.push("false");
        ev.push(evidence("fail", `needs "${need}" was skipped`));
        break;
      default:
        contributions.push("unknown");
        ev.push(evidence("unknown", `needs "${need}" is unknown`));
        break;
    }
  }

  return { value: andTruth(contributions), evidence: ev };
}

export interface JobOrdering {
  /** Jobs in a valid evaluation order (dependencies first). */
  order: string[];
  /** Jobs that could not be ordered because they are in a dependency cycle. */
  unordered: string[];
}

/**
 * Deterministic topological order over the `needs` graph (Kahn's algorithm,
 * preserving declaration order among ready jobs). Edges to unknown jobs are
 * ignored here (reported separately); cycle-involved jobs are returned in
 * `unordered`.
 */
export function orderJobs(model: WorkflowModel): JobOrdering {
  const ids = [...model.jobs.keys()];
  const indegree = new Map<string, number>();
  for (const id of ids) {
    indegree.set(id, 0);
  }
  for (const id of ids) {
    for (const need of model.jobs.get(id)?.needs ?? []) {
      if (need !== id && model.jobs.has(need)) {
        indegree.set(id, (indegree.get(id) ?? 0) + 1);
      }
    }
  }

  const order: string[] = [];
  const resolved = new Set<string>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const id of ids) {
      if (resolved.has(id) || (indegree.get(id) ?? 0) > 0) {
        continue;
      }
      order.push(id);
      resolved.add(id);
      progress = true;
      for (const other of ids) {
        if (
          !resolved.has(other) &&
          (model.jobs.get(other)?.needs ?? []).includes(id)
        ) {
          indegree.set(other, (indegree.get(other) ?? 0) - 1);
        }
      }
    }
  }

  const unordered = ids.filter((id) => !resolved.has(id));
  return { order, unordered };
}
