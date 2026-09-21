/**
 * Internal, strongly-typed representation of a CIProof configuration.
 *
 * The user-facing YAML (see `schema.ts`) is intentionally prettier than this;
 * the loader validates the YAML and lowers it into these discriminated unions,
 * which the evaluator consumes. This is declarative data only — never code.
 */

import type { SupportedTriggerEvent } from "../model/index.js";

/** The only supported configuration version. */
export const SUPPORTED_CONFIG_VERSION = 1;

/** Trust context a rule can constrain. */
export type TrustContext = "fork" | "internal";

/** Ref kind a rule can constrain (push refs). */
export type RefKind = "branch" | "tag";

/**
 * A reference to a job. Job ids are NOT globally unique across workflows, so a
 * reference may be qualified with a workflow. Shorthand (workflow omitted) is
 * allowed only when the id resolves uniquely.
 */
export interface JobRef {
  /** Workflow file path or basename (e.g. `deploy.yml`); omitted = any. */
  workflow?: string;
  id: string;
}

/** Whenever `target` runs, every job in `requires` must have run. */
export interface JobRequiresJobInvariant {
  kind: "job-requires-job";
  id: string;
  description?: string;
  target: JobRef;
  requires: JobRef;
}

/** `job` must not run in any scenario matching the given trust/event filter. */
export interface JobNotReachableInvariant {
  kind: "job-not-reachable";
  id: string;
  description?: string;
  job: JobRef;
  /** Only scenarios matching these constraints are considered (all optional). */
  trust?: TrustContext;
  event?: SupportedTriggerEvent;
}

/** Every scenario that runs `job` must satisfy the allowed context. */
export interface JobOnlyReachableInvariant {
  kind: "job-only-reachable";
  id: string;
  description?: string;
  job: JobRef;
  /** Allowed events (empty = any event allowed). */
  events: SupportedTriggerEvent[];
  /** Allowed push ref kinds (empty = any ref kind allowed). */
  refs: RefKind[];
}

export type Invariant =
  | JobRequiresJobInvariant
  | JobNotReachableInvariant
  | JobOnlyReachableInvariant;

export interface CiproofConfig {
  version: number;
  invariants: Invariant[];
}
