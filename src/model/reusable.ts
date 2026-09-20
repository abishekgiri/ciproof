/**
 * Caller-side reusable-workflow call.
 *
 * Phase 7 resolves LOCAL same-repository calls (`./.github/workflows/x.yml`)
 * into a nested normalized model. External calls (`owner/repo/...@ref`) are
 * represented but not fetched — they remain a limitation.
 */

import type { WorkflowModel } from "./workflow.js";

export type ReusableTarget =
  { kind: "local"; path: string } | { kind: "external"; raw: string };

export interface ReusableWorkflowCall {
  target: ReusableTarget;
  /** Literal-resolved `with:` inputs passed to the called workflow. */
  with: Record<string, string | number | boolean>;
  /** Input names whose passed value could not be statically resolved. */
  unresolvedInputs: string[];
  /** Secrets: `inherit`, or an explicit set of forwarded secret names. */
  secrets: "inherit" | { names: string[] };
  /** The normalized called workflow, for a successfully-resolved local target. */
  resolved?: WorkflowModel;
  /** Why a local target could not be resolved (missing/cycle/depth/parse). */
  resolutionError?: string;
}

/** Conservative max nesting depth for local reusable-workflow chains. */
export const MAX_REUSABLE_DEPTH = 10;
