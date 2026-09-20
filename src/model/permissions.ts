/**
 * Representation of workflow-level or job-level `permissions`.
 *
 * Phase 1 records what the workflow DECLARES. It does NOT compute the effective
 * `GITHUB_TOKEN` permissions, which depend on repository/org defaults and event
 * trust and were flagged in the Phase 0 report as requiring validation.
 *
 * Crucially, "not specified" (`unspecified`) is distinct from "explicitly set":
 * they are never treated as equivalent.
 */

import type { SourceLocation } from "./source.js";

export type PermissionLevel = "none" | "read" | "write";

export type PermissionMode =
  /** An explicit `permissions:` mapping of scope -> level. */
  | "explicit"
  /** The `read-all` shorthand. */
  | "read-all"
  /** The `write-all` shorthand. */
  | "write-all"
  /** No `permissions:` key was declared at this level. */
  | "unspecified";

export interface PermissionModel {
  mode: PermissionMode;
  /**
   * Present only when `mode === "explicit"`. Maps a permission scope
   * (e.g. `contents`, `packages`) to its declared level. An empty object means
   * `permissions: {}` was declared (all scopes set to none by GitHub).
   */
  scopes?: Record<string, PermissionLevel>;
  /** Location of the `permissions:` block, when declared. */
  source?: SourceLocation;
}

/** The shared representation for a level at which no permissions were declared. */
export const UNSPECIFIED_PERMISSIONS: PermissionModel = { mode: "unspecified" };
