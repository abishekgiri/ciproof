/**
 * Output types for concrete scenario evaluation: evidence, per-job results, and
 * the whole-workflow evaluation. Every user-visible conclusion carries
 * evidence, never a score.
 */

import type { SourceLocation } from "../model/source.js";
import type { Truth } from "../model/truth.js";

export type { Truth };

/**
 * A job's modeled execution outcome for one scenario.
 *
 * `run` = GitHub would schedule the job (NOT "the job succeeded").
 * `skipped` = the job's effective condition is false (own `if` false, or a
 *   needed job did not succeed and no status function overrides it).
 * `unknown` = the outcome depends on something CIProof does not model.
 * `blocked` = reserved; not emitted in v0.1 (GitHub reports dependency-driven
 *   non-execution as `skipped`, so CIProof does too).
 */
export type JobExecution = "run" | "skipped" | "blocked" | "unknown";

/** One piece of evidence backing a conclusion. */
export interface Evidence {
  /** `pass` ✓, `fail` ✗, `unknown` ?, `info` •. */
  outcome: "pass" | "fail" | "unknown" | "info";
  message: string;
  source?: SourceLocation;
}

export interface JobResult {
  jobId: string;
  state: JobExecution;
  evidence: Evidence[];
}

export type TriggerMatch = "matched" | "not-matched" | "unknown";

export interface EvaluationDiagnostic {
  code: string;
  message: string;
  severity: "error" | "warning";
  source?: SourceLocation;
}

export interface WorkflowEvaluation {
  file: string;
  trigger: TriggerMatch;
  triggerEvidence: Evidence[];
  jobs: Map<string, JobResult>;
  diagnostics: EvaluationDiagnostic[];
}

/** Convenience constructor that omits `source` when absent (exactOptional). */
export function evidence(
  outcome: Evidence["outcome"],
  message: string,
  source?: SourceLocation,
): Evidence {
  return source ? { outcome, message, source } : { outcome, message };
}
