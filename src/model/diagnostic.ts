/**
 * Model-level diagnostics produced by CIProof's normalization step.
 *
 * These are distinct from parser diagnostics (`ParseDiagnostic` in
 * `src/github/types.ts`): parser diagnostics come from GitHub's validator,
 * model diagnostics come from CIProof's own structural checks (e.g. an unknown
 * `needs` target). Both are surfaced; neither is swallowed.
 */

import type { SourceLocation } from "./source.js";

export type ModelDiagnosticSeverity = "error" | "warning";

export interface ModelDiagnostic {
  /** Stable machine code, e.g. `CIPROOF_UNKNOWN_NEED`. */
  code: string;
  /** Human-readable message. */
  message: string;
  severity: ModelDiagnosticSeverity;
  /** Location, when one is available. */
  source?: SourceLocation;
}

/** Stable diagnostic codes emitted by the model layer. */
export const ModelDiagnosticCode = {
  /** A job's `needs` references a job that does not exist. */
  UnknownNeed: "CIPROOF_UNKNOWN_NEED",
  /** A job lists itself in `needs`. */
  SelfDependency: "CIPROOF_SELF_DEPENDENCY",
  /** The `needs` graph contains a cycle. */
  NeedsCycle: "CIPROOF_NEEDS_CYCLE",
  /** GitHub's converter reported an error while building the template. */
  ConvertError: "CIPROOF_CONVERT_ERROR",
  /** CIProof failed to normalize the parsed workflow. */
  NormalizeError: "CIPROOF_NORMALIZE_ERROR",
} as const;
