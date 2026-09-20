/**
 * CP001 — unreachable job.
 *
 * A job is unreachable if no explored scenario runs it. The strong claim is
 * only made when exploration is complete-within-supported-model and the job's
 * reachability does not depend on unmodeled semantics; otherwise the verdict is
 * `unknown` (CIProof prefers a missing finding over a false unreachable claim).
 */

import { evidence } from "../../engine/index.js";
import type { CheckContext, Finding } from "../types.js";

export const CP001_ID = "CP001";

export function checkUnreachableJob(context: CheckContext): Finding[] {
  const { model, exploration } = context;
  const findings: Finding[] = [];

  for (const [jobId, job] of model.jobs) {
    const ranSomewhere = exploration.evaluations.some(
      (e) => e.jobs[jobId] === "run",
    );
    if (ranSomewhere) {
      continue; // reachable — no finding
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

    const baseEvidence = [
      evidence("info", `scenarios explored: ${exploration.scenariosEvaluated}`),
      evidence("info", `observed RUN states for "${jobId}": 0`),
    ];

    if (strongClaimPossible) {
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
          observedUnknown
            ? evidence("unknown", `"${jobId}" is UNKNOWN in at least one plan`)
            : evidence(
                "unknown",
                dependsOnUnsupported
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
