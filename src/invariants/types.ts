/**
 * Invariant/finding types.
 *
 * Findings are judgments over Phase 3 exploration results. Honesty is
 * paramount: `not-violated` means "no violation found within the modeled
 * scenarios", never "safe" or "proven". When exploration is partial and the
 * missing state could affect a property, the verdict is `unknown`.
 */

import type { Evidence } from "../engine/index.js";
import type {
  AnalysisLimitation,
  ExecutionPlan,
  ExplorationResult,
  Scenario,
} from "../engine/index.js";
import type { WorkflowModel } from "../model/index.js";

export type InvariantVerdict = "violated" | "not-violated" | "unknown";

export interface Finding {
  /** Stable check id, e.g. `CP001`. */
  id: string;
  title: string;
  severity: "error" | "warning" | "info";
  verdict: InvariantVerdict;
  message: string;
  jobId?: string;
  /** A concrete, already-explored counterexample scenario (never fabricated). */
  scenario?: Scenario;
  plan?: ExecutionPlan;
  evidence: Evidence[];
  limitations: AnalysisLimitation[];
}

export interface CheckContext {
  model: WorkflowModel;
  exploration: ExplorationResult;
}

export interface BuiltinCheck {
  id: string;
  run(context: CheckContext): Finding[];
}

/**
 * Explicit prerequisite intent for CP002. CIProof never guesses prerequisites
 * from job names; the user (or a test) states them.
 */
export interface PrerequisiteRule {
  name: string;
  targetJob: string;
  requiredCompletedJobs: string[];
}
