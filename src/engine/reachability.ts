/**
 * Sound per-job reachability classification.
 *
 * This is the single source of truth for "is a job reachable?" It is shared by
 * the CP001 unreachable-job check and the semantic behavior diff, so the two can
 * never disagree. The strong `unreachable` claim is made only when exploration
 * is complete within the supported model; anything less is `unknown`, preserving
 * the invariant that `unreachable != unknown`.
 */

import type { JobModel } from "../model/index.js";
import type { ExplorationResult } from "./explorer.js";

export type Reachability = "reachable" | "unreachable" | "unknown";

/** Why a job's reachability is `unknown` (absent when it is reachable/unreachable). */
export type UnknownReason =
  | "no-scenario-trigger"
  | "observed-unknown"
  | "unsupported-construct"
  | "partial-exploration";

export interface ReachabilityClassification {
  reachability: Reachability;
  reason?: UnknownReason;
}

/** Human-readable explanation for each unknown reason. */
export function describeUnknownReason(reason: UnknownReason): string {
  switch (reason) {
    case "no-scenario-trigger":
      return "no scenario-generating trigger (call-only or unsupported-event workflow)";
    case "observed-unknown":
      return "job outcome is UNKNOWN in at least one modeled scenario";
    case "unsupported-construct":
      return "job involves constructs outside the supported model";
    case "partial-exploration":
      return "exploration is partial";
  }
}

/**
 * Classify a single job's reachability from an exploration result.
 *
 * - a job that RUNs in any explored scenario is `reachable`;
 * - a job that never runs is `unreachable` ONLY when exploration is complete
 *   within the supported model and nothing about the job is unmodeled;
 * - otherwise the job is `unknown` (never falsely `unreachable`).
 */
export function classifyJobReachability(
  jobId: string,
  job: Pick<JobModel, "unsupported">,
  exploration: Pick<
    ExplorationResult,
    "evaluations" | "completeness" | "truncated"
  >,
): ReachabilityClassification {
  // No scenario-generating trigger (e.g. a workflow_call-only reusable workflow):
  // CIProof has no basis to claim the job is reachable or unreachable standalone.
  if (exploration.evaluations.length === 0) {
    return { reachability: "unknown", reason: "no-scenario-trigger" };
  }

  const ranSomewhere = exploration.evaluations.some(
    (e) => e.jobs[jobId] === "run",
  );
  if (ranSomewhere) {
    return { reachability: "reachable" };
  }

  const observedUnknown = exploration.evaluations.some(
    (e) => e.jobs[jobId] === "unknown",
  );
  const dependsOnUnsupported = job.unsupported.length > 0;
  const strongClaimPossible =
    exploration.completeness === "complete-within-supported-model" &&
    !exploration.truncated &&
    !observedUnknown &&
    !dependsOnUnsupported;

  if (strongClaimPossible) {
    return { reachability: "unreachable" };
  }
  if (observedUnknown) {
    return { reachability: "unknown", reason: "observed-unknown" };
  }
  if (dependsOnUnsupported) {
    return { reachability: "unknown", reason: "unsupported-construct" };
  }
  return { reachability: "unknown", reason: "partial-exploration" };
}
