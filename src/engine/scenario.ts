/**
 * CIProof-owned concrete execution scenario, plus validation.
 *
 * A scenario is ONE explicit execution context. Phase 2 evaluates exactly one
 * scenario; it never enumerates or generates scenarios. Validation refuses
 * combinations that cannot occur for the given event so the engine never
 * silently reasons about an impossible run.
 */

import type { SupportedTriggerEvent } from "../model/index.js";
import type { EvaluationDiagnostic } from "./evidence.js";

export interface Scenario {
  event: SupportedTriggerEvent;
  /** The git ref for the run (e.g. `refs/heads/main`, `refs/pull/12/merge`). */
  ref?: string;
  /** Convenience branch name; for push it is the pushed branch. */
  branch?: string;
  /** Base branch (pull_request / pull_request_target). */
  baseRef?: string;
  /** Head (source) branch (pull_request / pull_request_target). */
  headRef?: string;
  /** Whether the triggering PR comes from a fork. */
  /** For push: whether the pushed ref is a branch or a tag. Defaults to branch. */
  refKind?: "branch" | "tag";
  fork: boolean;
  actorClass: "internal" | "external";
  /** Files changed in the event; used for path filters (explicit, not derived). */
  changedFiles: string[];
  /** workflow_dispatch inputs supplied for this run. */
  inputs: Record<string, boolean | string>;
  /** The declared cron that triggered a `schedule` run (github.event.schedule). */
  schedule?: string;
  /** The triggering upstream run, for `workflow_run` scenarios. */
  workflowRun?: WorkflowRunContext;
}

export interface WorkflowRunContext {
  workflowName: string;
  activity: "requested" | "in_progress" | "completed";
  /** Branch of the triggering (upstream) run. */
  branch: string;
  /** Present only for the `completed` activity. */
  conclusion?:
    | "success"
    | "failure"
    | "cancelled"
    | "skipped"
    | "neutral"
    | "timed_out"
    | "action_required"
    | "stale";
}

/**
 * Validate that a scenario is internally consistent for its event. Returns
 * warnings/errors; callers may still evaluate, but impossible combinations are
 * surfaced rather than silently accepted.
 */
export function validateScenario(scenario: Scenario): EvaluationDiagnostic[] {
  const diagnostics: EvaluationDiagnostic[] = [];

  const isPr =
    scenario.event === "pull_request" ||
    scenario.event === "pull_request_target";

  const isDefaultBranchEvent =
    scenario.event === "push" ||
    scenario.event === "workflow_dispatch" ||
    scenario.event === "schedule" ||
    scenario.event === "workflow_run";

  if (isDefaultBranchEvent) {
    if (scenario.fork) {
      diagnostics.push({
        code: "CIPROOF_SCENARIO_INCONSISTENT",
        message: `fork has no meaning for a ${scenario.event} scenario`,
        severity: "warning",
      });
    }
    if (scenario.baseRef !== undefined || scenario.headRef !== undefined) {
      diagnostics.push({
        code: "CIPROOF_SCENARIO_INCONSISTENT",
        message: `base/head refs have no meaning for a ${scenario.event} scenario`,
        severity: "warning",
      });
    }
  }

  if (
    scenario.event !== "workflow_dispatch" &&
    Object.keys(scenario.inputs).length > 0
  ) {
    diagnostics.push({
      code: "CIPROOF_SCENARIO_INCONSISTENT",
      message: `inputs are only available for workflow_dispatch, not ${scenario.event}`,
      severity: "warning",
    });
  }

  if (isPr && scenario.baseRef === undefined) {
    diagnostics.push({
      code: "CIPROOF_SCENARIO_INCOMPLETE",
      message: `${scenario.event} scenario has no baseRef; branch filters will be unknown`,
      severity: "warning",
    });
  }

  return diagnostics;
}
