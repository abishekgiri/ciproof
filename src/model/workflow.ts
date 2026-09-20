/**
 * The normalized workflow model — CIProof's own semantic representation.
 *
 * It contains only CIProof-owned types; no GitHub parser tokens or AST nodes
 * leak through it. Phase 1 answers only "what does this workflow declare?" —
 * never "what runs?".
 */

import type { JobModel } from "./job.js";
import type { SourceLocation } from "./source.js";
import type { TriggerModel } from "./trigger.js";

/**
 * A valid GitHub construct that CIProof v0.1 does not model. Recorded so it
 * stays visible; its presence does NOT make the workflow invalid.
 */
export interface UnsupportedConstruct {
  /** Short stable kind, e.g. `schedule-trigger`, `reusable-workflow-job`. */
  kind: string;
  /** Human-readable explanation. */
  message: string;
  source?: SourceLocation;
}

export interface WorkflowModel {
  /** The workflow file this model was built from. */
  file: string;
  /** The workflow `name:`, when declared. */
  name?: string;
  /** Supported triggers, in declared order. */
  triggers: TriggerModel[];
  /** Jobs keyed by job id, preserving declared iteration order. */
  jobs: Map<string, JobModel>;
  source?: SourceLocation;
  /** Workflow-level unsupported constructs (kept visible, not modeled). */
  unsupported: UnsupportedConstruct[];
}
