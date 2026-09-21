/**
 * CP001 — unreachable job.
 *
 * A job is unreachable if no explored scenario runs it. The strong claim is
 * only made when exploration is complete-within-supported-model and the job's
 * reachability does not depend on unmodeled semantics; otherwise the verdict is
 * `unknown` (CIProof prefers a missing finding over a false unreachable claim).
 */

import { classifyJobReachability, evidence } from "../../engine/index.js";
import type { CheckContext, Finding } from "../types.js";

export const CP001_ID = "CP001";

export function checkUnreachableJob(context: CheckContext): Finding[] {
  const { model, exploration } = context;
  const findings: Finding[] = [];

  // No scenario-generating trigger (e.g. a workflow_call-only reusable workflow,
  // or only unsupported events): jobs are call-only or untriggerable standalone,
  // so CIProof has no basis to claim any job is unreachable.
  if (exploration.evaluations.length === 0) {
    return findings;
  }

  for (const [jobId, job] of model.jobs) {
    const { reachability, reason } = classifyJobReachability(
      jobId,
      job,
      exploration,
    );
    if (reachability === "reachable") {
      continue; // reachable — no finding
    }

    const baseEvidence = [
      evidence("info", `scenarios explored: ${exploration.scenariosEvaluated}`),
      evidence("info", `observed RUN states for "${jobId}": 0`),
    ];

    if (reachability === "unreachable") {
      findings.push({
        id: CP001_ID,
        title: "unreachable job",
        severity: "warning",
        verdict: "violated",
        message: `job "${jobId}" is unreachable within the supported CIProof model`,
        jobId,
        evidence: baseEvidence,
        limitations: [],
      });
    } else {
      findings.push({
        id: CP001_ID,
        title: "unreachable job",
        severity: "warning",
        verdict: "unknown",
        message: `job "${jobId}" was never observed running, but its reachability depends on state CIProof does not model`,
        jobId,
        evidence: [
          ...baseEvidence,
          reason === "observed-unknown"
            ? evidence("unknown", `"${jobId}" is UNKNOWN in at least one plan`)
            : evidence(
                "unknown",
                reason === "unsupported-construct"
                  ? `"${jobId}" involves constructs outside the supported model`
                  : "exploration is partial",
              ),
        ],
        limitations: exploration.limitations,
      });
    }
  }

  return findings;
}
