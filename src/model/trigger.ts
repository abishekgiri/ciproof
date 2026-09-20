/**
 * Trigger models for the four v0.1 supported events.
 *
 * Unsupported events (schedule, workflow_run, …) are NOT represented as
 * triggers; they are recorded as `UnsupportedConstruct` entries on the
 * workflow so they stay visible without pretending to be modeled.
 *
 * Phase 1 preserves declared filter patterns and their order. It does not
 * evaluate glob matching — that is Phase 2/3.
 */

import type { SourceLocation } from "./source.js";

export type SupportedTriggerEvent =
  | "push"
  | "pull_request"
  | "pull_request_target"
  | "workflow_dispatch"
  | "schedule"
  | "workflow_run";

/** Branch/path filters shared by push and pull-request-family events. */
export interface BranchPathFilters {
  branches?: string[];
  branchesIgnore?: string[];
  paths?: string[];
  pathsIgnore?: string[];
}

export interface PushTrigger {
  event: "push";
  filters: BranchPathFilters;
  source?: SourceLocation;
}

export interface PullRequestTrigger {
  event: "pull_request";
  filters: BranchPathFilters;
  source?: SourceLocation;
}

export interface PullRequestTargetTrigger {
  event: "pull_request_target";
  filters: BranchPathFilters;
  source?: SourceLocation;
}

/** A `workflow_dispatch` input type CIProof can enumerate in v0.1. */
export type DispatchInputType = "boolean" | "choice" | "unsupported";

export interface DispatchInputModel {
  name: string;
  /** CIProof's classification (boolean/choice supported; others unsupported). */
  type: DispatchInputType;
  /** The originally declared GitHub input type (e.g. `string`, `environment`). */
  rawType: string;
  required?: boolean;
  /** Declared default value, preserved but NOT evaluated in Phase 1. */
  default?: string | number | boolean;
  /** Declared options, present for `choice` inputs. */
  options?: string[];
  description?: string;
}

export interface WorkflowDispatchTrigger {
  event: "workflow_dispatch";
  inputs: DispatchInputModel[];
  source?: SourceLocation;
}

/** A single `schedule` cron entry. */
export interface ScheduleEntry {
  cron: string;
  /** Declared timezone, when present (GitHub supports it on some plans). */
  timezone?: string;
}

export interface ScheduleTrigger {
  event: "schedule";
  /** Declared cron entries, in order. */
  schedules: ScheduleEntry[];
  source?: SourceLocation;
}

/** `workflow_run` activity types. */
export type WorkflowRunActivity = "requested" | "in_progress" | "completed";

export interface WorkflowRunTrigger {
  event: "workflow_run";
  /** Upstream workflow names (OR semantics). */
  workflows: string[];
  /** Activity types (defaults to all documented types when omitted). */
  types: WorkflowRunActivity[];
  /** Branch filters, matched against the triggering (upstream) run's branch. */
  branches?: string[];
  branchesIgnore?: string[];
  source?: SourceLocation;
}

export type TriggerModel =
  | PushTrigger
  | PullRequestTrigger
  | PullRequestTargetTrigger
  | WorkflowDispatchTrigger
  | ScheduleTrigger
  | WorkflowRunTrigger;
