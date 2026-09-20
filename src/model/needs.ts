/**
 * Structural utilities and validation over the `needs` dependency graph.
 *
 * Phase 1 validates STRUCTURE only. It does not propagate success/skip/failure
 * state — that is Phase 2. GitHub's converter already rejects some invalid
 * graphs (with a generic "must contain at least one job with no dependencies"
 * message); these checks add precise, stably-coded diagnostics on top.
 */

import { ModelDiagnosticCode, type ModelDiagnostic } from "./diagnostic.js";
import type { WorkflowModel } from "./workflow.js";

/** Direct dependencies (the job's own `needs`), in declared order. */
export function getDependencies(model: WorkflowModel, jobId: string): string[] {
  return model.jobs.get(jobId)?.needs ?? [];
}

/** Jobs that directly depend on `jobId`, in job declaration order. */
export function getDependents(model: WorkflowModel, jobId: string): string[] {
  const dependents: string[] = [];
  for (const [id, job] of model.jobs) {
    if (job.needs.includes(jobId)) {
      dependents.push(id);
    }
  }
  return dependents;
}

/**
 * Validate the `needs` graph.
 *
 * Detects: (A) references to unknown jobs, (B) self-dependencies, and
 * (C) dependency cycles. Returns a diagnostic per issue, each with a stable
 * code and (where available) the offending job's source location.
 */
export function validateNeeds(model: WorkflowModel): ModelDiagnostic[] {
  const diagnostics: ModelDiagnostic[] = [];

  for (const [id, job] of model.jobs) {
    for (const need of job.needs) {
      if (need === id) {
        diagnostics.push({
          code: ModelDiagnosticCode.SelfDependency,
          message: `Job "${id}" lists itself in needs.`,
          severity: "error",
          ...(job.source ? { source: job.source } : {}),
        });
        continue;
      }
      if (!model.jobs.has(need)) {
        diagnostics.push({
          code: ModelDiagnosticCode.UnknownNeed,
          message: `Job "${id}" needs "${need}", which is not defined.`,
          severity: "error",
          ...(job.source ? { source: job.source } : {}),
        });
      }
    }
  }

  for (const cycle of findCycles(model)) {
    const first = model.jobs.get(cycle[0] as string);
    diagnostics.push({
      code: ModelDiagnosticCode.NeedsCycle,
      message: `Dependency cycle: ${cycle.join(" -> ")}.`,
      severity: "error",
      ...(first?.source ? { source: first.source } : {}),
    });
  }

  return diagnostics;
}

/**
 * Return each dependency cycle as an ordered list of job ids ending back at the
 * start (e.g. `["a", "b", "a"]`). Only edges to known jobs are followed, so
 * unknown-need edges (reported separately) do not create phantom cycles.
 */
function findCycles(model: WorkflowModel): string[][] {
  const cycles: string[][] = [];
  const seenSignatures = new Set<string>();
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (id: string): void => {
    state.set(id, "visiting");
    stack.push(id);

    for (const need of model.jobs.get(id)?.needs ?? []) {
      if (need === id || !model.jobs.has(need)) {
        continue;
      }
      const needState = state.get(need);
      if (needState === "visiting") {
        const from = stack.indexOf(need);
        const cycle = [...stack.slice(from), need];
        const signature = canonicalCycle(cycle);
        if (!seenSignatures.has(signature)) {
          seenSignatures.add(signature);
          cycles.push(cycle);
        }
      } else if (needState === undefined) {
        visit(need);
      }
    }

    stack.pop();
    state.set(id, "done");
  };

  for (const id of model.jobs.keys()) {
    if (!state.has(id)) {
      visit(id);
    }
  }

  return cycles;
}

/** A rotation-independent signature so the same cycle is not reported twice. */
function canonicalCycle(cycle: string[]): string {
  const nodes = cycle.slice(0, -1);
  let minIndex = 0;
  for (let i = 1; i < nodes.length; i++) {
    if ((nodes[i] as string) < (nodes[minIndex] as string)) {
      minIndex = i;
    }
  }
  return [...nodes.slice(minIndex), ...nodes.slice(0, minIndex)].join(">");
}
