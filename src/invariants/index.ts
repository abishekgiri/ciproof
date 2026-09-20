/**
 * Public entry point for CIProof's invariant/checking layer (Phase 4).
 *
 * Operates over Phase 3 exploration results; it does not regenerate scenarios,
 * re-evaluate conditions, or re-implement matching. Discovers CP001/CP002/CP003
 * findings only — no semantic diff, no required-check deadlock, no DSL.
 */

export {
  type Finding,
  type InvariantVerdict,
  type CheckContext,
  type BuiltinCheck,
  type PrerequisiteRule,
} from "./types.js";
export { runChecks, type CheckOptions } from "./evaluate.js";
export { checkUnreachableJob, CP001_ID } from "./builtin/unreachable-job.js";
export {
  checkPrerequisiteBypass,
  CP002_ID,
} from "./builtin/prerequisite-bypass.js";
export {
  checkUntrustedPrivilegedPath,
  CP003_ID,
} from "./builtin/untrusted-privileged-path.js";
export {
  highlightForPrerequisite,
  highlightForPrivilege,
  type ScenarioHighlight,
} from "./counterexample.js";
