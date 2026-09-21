/**
 * Public entry point for CIProof configuration handling.
 *
 * Configuration is declarative, untrusted data: discovered deterministically,
 * parsed as plain YAML, and validated. Nothing here evaluates or executes it.
 */

export {
  loadConfig,
  CONFIG_FILENAMES,
  type ConfigLoad,
  type LoadConfigOptions,
} from "./load.js";
export {
  validateConfig,
  type ConfigIssue,
  type ConfigValidation,
} from "./schema.js";
export {
  SUPPORTED_CONFIG_VERSION,
  type CiproofConfig,
  type Invariant,
  type JobRef,
  type TrustContext,
  type RefKind,
  type JobRequiresJobInvariant,
  type JobNotReachableInvariant,
  type JobOnlyReachableInvariant,
} from "./types.js";
