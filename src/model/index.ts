/**
 * Public entry point for CIProof's normalized semantic model.
 *
 * Everything the rest of CIProof needs about a workflow's declared structure is
 * re-exported here. These are CIProof-owned types only; nothing from
 * `@actions/*` is exposed through this module.
 */

export type { SourcePosition, SourceLocation } from "./source.js";
export { notTruth, andTruth, orTruth, type Truth } from "./truth.js";
export {
  ModelDiagnosticCode,
  type ModelDiagnostic,
  type ModelDiagnosticSeverity,
} from "./diagnostic.js";
export type { ConditionModel, ConditionParseState } from "./condition.js";
export {
  UNSPECIFIED_PERMISSIONS,
  type PermissionModel,
  type PermissionMode,
  type PermissionLevel,
} from "./permissions.js";
export type {
  TriggerModel,
  SupportedTriggerEvent,
  BranchPathFilters,
  PushTrigger,
  PullRequestTrigger,
  PullRequestTargetTrigger,
  WorkflowDispatchTrigger,
  DispatchInputModel,
  DispatchInputType,
  ScheduleTrigger,
  ScheduleEntry,
  WorkflowRunTrigger,
  WorkflowRunActivity,
} from "./trigger.js";
export type {
  MatrixModel,
  StaticMatrixModel,
  DynamicMatrixModel,
  MatrixCombination,
  MatrixValue,
} from "./matrix.js";
export { MAX_MATRIX_JOBS } from "./matrix.js";
export { expandMatrix } from "./matrix-expand.js";
export type { JobModel, JobKind } from "./job.js";
export type { WorkflowModel, UnsupportedConstruct } from "./workflow.js";
export { getDependencies, getDependents, validateNeeds } from "./needs.js";
