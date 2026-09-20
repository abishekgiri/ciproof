/**
 * Job model.
 *
 * Phase 1 normalizes job identity, dependencies, condition, and permissions.
 * It does NOT model steps semantically or interpret them, and it does not
 * decide whether a job runs.
 */

import type { ConditionModel } from "./condition.js";
import type { MatrixModel } from "./matrix.js";
import type { PermissionModel } from "./permissions.js";
import type { SourceLocation } from "./source.js";
import type { UnsupportedConstruct } from "./workflow.js";

/** A regular job, or a reusable-workflow call (the latter is unsupported in v0.1). */
export type JobKind = "job" | "reusableWorkflowJob";

export interface JobModel {
  id: string;
  name?: string;
  kind: JobKind;
  /** Declared dependencies, in declared order (normalized from string or list). */
  needs: string[];
  /**
   * The declared `if` condition, present only when the workflow explicitly
   * declares one. When absent, GitHub applies an implicit `success()` default;
   * CIProof records absence rather than inventing that default here.
   */
  condition?: ConditionModel;
  permissions: PermissionModel;
  /** Strategy matrix, when declared (static = modeled; dynamic = unsupported). */
  matrix?: MatrixModel;
  /** Environment name, when declared as a simple string. */
  environment?: string;
  source?: SourceLocation;
  /** Job-scoped constructs outside v0.1 (kept visible, not modeled). */
  unsupported: UnsupportedConstruct[];
}
