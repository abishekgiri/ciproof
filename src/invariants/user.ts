/**
 * Evaluator for user-declared invariants (the Phase 9 DSL).
 *
 * Invariants are evaluated over the SAME analyzed behavior the built-in checks
 * use (models + exploration results) — never by inspecting YAML text. Each rule
 * type maps to a precisely defined semantic check with counterexample support,
 * and preserves the three-valued verdict:
 *
 *   a known counterexample exists          -> violated (REFUTED)
 *   otherwise unresolved relevant cases    -> unknown  (UNKNOWN)
 *   otherwise                              -> not-violated (NO VIOLATION FOUND)
 *
 * Reference resolution errors (unknown/ambiguous job) are configuration errors,
 * reported separately from verdicts.
 */

import { posix } from "node:path";
import type {
  JobExecution,
  ScenarioOutcome,
  Scenario,
} from "../engine/index.js";
import type { ExplorationResult } from "../engine/index.js";
import type { WorkflowModel } from "../model/index.js";
import { checkPrerequisiteBypass } from "./builtin/prerequisite-bypass.js";
import type {
  CiproofConfig,
  Invariant,
  JobNotReachableInvariant,
  JobOnlyReachableInvariant,
  JobRef,
  JobRequiresJobInvariant,
} from "../config/types.js";

/** One analyzed workflow (successfully modeled) available to the evaluator. */
export interface AnalyzedWorkflow {
  file: string;
  model: WorkflowModel;
  exploration: ExplorationResult;
}

export type UserVerdict = "violated" | "not-violated" | "unknown";

export interface InvariantResult {
  id: string;
  description?: string;
  verdict: UserVerdict;
  message: string;
  /** Resolved workflow the invariant was evaluated against. */
  workflow?: string;
  jobId?: string;
  /** Concrete, already-explored counterexample (never fabricated). */
  scenario?: Scenario;
  /** Job states for the counterexample scenario, for display. */
  execution?: Record<string, JobExecution>;
  /** Sorted, deduped reasons a verdict is UNKNOWN. */
  unknownReasons?: string[];
}

export interface ReferenceError {
  invariantId: string;
  message: string;
}

export type UserEvaluation =
  | { ok: true; results: InvariantResult[] }
  | { ok: false; referenceErrors: ReferenceError[] };

/**
 * Evaluate all invariants. If any reference cannot be resolved (unknown or
 * ambiguous job), returns those configuration errors instead of verdicts.
 */
export function evaluateUserInvariants(
  config: CiproofConfig,
  workflows: readonly AnalyzedWorkflow[],
): UserEvaluation {
  const referenceErrors: ReferenceError[] = [];
  const results: InvariantResult[] = [];

  for (const invariant of config.invariants) {
    const outcome = evaluateInvariant(invariant, workflows);
    if ("referenceError" in outcome) {
      referenceErrors.push({
        invariantId: invariant.id,
        message: outcome.referenceError,
      });
    } else {
      results.push(outcome.result);
    }
  }

  if (referenceErrors.length > 0) {
    return { ok: false, referenceErrors };
  }
  return { ok: true, results };
}

type InvariantOutcome =
  { result: InvariantResult } | { referenceError: string };

function evaluateInvariant(
  invariant: Invariant,
  workflows: readonly AnalyzedWorkflow[],
): InvariantOutcome {
  switch (invariant.kind) {
    case "job-requires-job":
      return evaluateRequires(invariant, workflows);
    case "job-not-reachable":
      return evaluateNotReachable(invariant, workflows);
    case "job-only-reachable":
      return evaluateOnlyReachable(invariant, workflows);
  }
}

// ---------------------------------------------------------------------------
// job-requires-job (reuses CP002 prerequisite-bypass logic)
// ---------------------------------------------------------------------------

function evaluateRequires(
  invariant: JobRequiresJobInvariant,
  workflows: readonly AnalyzedWorkflow[],
): InvariantOutcome {
  const target = resolveJob(invariant.target, workflows);
  if ("error" in target) {
    return { referenceError: target.error };
  }
  // The required job must live in the SAME workflow (needs are within-workflow).
  if (
    invariant.requires.workflow !== undefined &&
    !matchesWorkflow(target.workflow.file, invariant.requires.workflow)
  ) {
    return {
      referenceError: `"${invariant.requires.id}" must be in the same workflow as "${invariant.target.id}" (${target.workflow.file})`,
    };
  }
  if (!target.workflow.model.jobs.has(invariant.requires.id)) {
    return {
      referenceError: `required job "${invariant.requires.id}" is not in workflow ${target.workflow.file}`,
    };
  }

  const finding = checkPrerequisiteBypass(
    { model: target.workflow.model, exploration: target.workflow.exploration },
    [
      {
        name: invariant.id,
        targetJob: invariant.target.id,
        requiredCompletedJobs: [invariant.requires.id],
      },
    ],
  )[0]!;

  const base: InvariantResult = {
    id: invariant.id,
    ...(invariant.description !== undefined
      ? { description: invariant.description }
      : {}),
    verdict: finding.verdict,
    message: finding.message,
    workflow: target.workflow.file,
    jobId: invariant.target.id,
  };
  if (finding.scenario) {
    base.scenario = finding.scenario;
    const execution = outcomeFor(target.workflow, finding.scenario);
    if (execution !== undefined) {
      base.execution = execution;
    }
  }
  if (finding.verdict === "unknown") {
    base.unknownReasons = unknownReasons(target.workflow, [
      `state of required job "${invariant.requires.id}" is UNKNOWN in a relevant scenario`,
    ]);
  }
  return { result: base };
}

// ---------------------------------------------------------------------------
// job-not-reachable
// ---------------------------------------------------------------------------

function evaluateNotReachable(
  invariant: JobNotReachableInvariant,
  workflows: readonly AnalyzedWorkflow[],
): InvariantOutcome {
  const resolved = resolveJob(invariant.job, workflows);
  if ("error" in resolved) {
    return { referenceError: resolved.error };
  }
  const { workflow } = resolved;
  const jobId = invariant.job.id;

  const matching = workflow.exploration.evaluations.filter((e) =>
    matchesFilter(e, invariant),
  );

  const violation = matching.find((e) => e.jobs[jobId] === "run");
  const filterLabel = describeFilter(invariant);

  if (violation) {
    return {
      result: {
        id: invariant.id,
        ...(invariant.description !== undefined
          ? { description: invariant.description }
          : {}),
        verdict: "violated",
        message: `job "${jobId}" is reachable${filterLabel}`,
        workflow: workflow.file,
        jobId,
        scenario: violation.scenario,
        execution: violation.jobs,
      },
    };
  }

  const unknownScenario = matching.some((e) => e.jobs[jobId] === "unknown");
  if (unknownScenario) {
    return {
      result: unknownResult(invariant, workflow, jobId, [
        `job "${jobId}" is UNKNOWN in a relevant scenario${filterLabel}`,
      ]),
    };
  }

  // No matching scenario runs (or is unknown for) the job. This is sound as
  // NO VIOLATION unless an UNSUPPORTED TRIGGER could hide a matching event —
  // unrelated partiality (e.g. an unmodeled condition on another job) cannot
  // introduce a new triggering scenario, so it must not force UNKNOWN here.
  if (matching.length === 0) {
    const hiddenTrigger = workflow.exploration.limitations.some(
      (l) => !l.informational && l.kind === "unsupported-trigger",
    );
    if (hiddenTrigger) {
      return {
        result: unknownResult(invariant, workflow, jobId, [
          `an unsupported trigger may introduce a scenario matching this filter${filterLabel}`,
        ]),
      };
    }
  }

  return {
    result: {
      id: invariant.id,
      ...(invariant.description !== undefined
        ? { description: invariant.description }
        : {}),
      verdict: "not-violated",
      message: `no modeled scenario runs "${jobId}"${filterLabel}`,
      workflow: workflow.file,
      jobId,
    },
  };
}

// ---------------------------------------------------------------------------
// job-only-reachable
// ---------------------------------------------------------------------------

function evaluateOnlyReachable(
  invariant: JobOnlyReachableInvariant,
  workflows: readonly AnalyzedWorkflow[],
): InvariantOutcome {
  const resolved = resolveJob(invariant.job, workflows);
  if ("error" in resolved) {
    return { referenceError: resolved.error };
  }
  const { workflow } = resolved;
  const jobId = invariant.job.id;

  let violation: ScenarioOutcome | undefined;
  let sawUnknownDisallowed = false;

  for (const outcome of workflow.exploration.evaluations) {
    const allowed = contextAllowed(outcome.scenario, invariant);
    if (outcome.jobs[jobId] === "run" && !allowed) {
      violation ??= outcome;
    } else if (outcome.jobs[jobId] === "unknown" && !allowed) {
      sawUnknownDisallowed = true;
    }
  }

  const allowedLabel = describeAllowed(invariant);

  if (violation) {
    return {
      result: {
        id: invariant.id,
        ...(invariant.description !== undefined
          ? { description: invariant.description }
          : {}),
        verdict: "violated",
        message: `job "${jobId}" runs outside its allowed context (${allowedLabel})`,
        workflow: workflow.file,
        jobId,
        scenario: violation.scenario,
        execution: violation.jobs,
      },
    };
  }

  if (sawUnknownDisallowed) {
    return {
      result: unknownResult(invariant, workflow, jobId, [
        `job "${jobId}" is UNKNOWN in a scenario outside the allowed context (${allowedLabel})`,
      ]),
    };
  }

  return {
    result: {
      id: invariant.id,
      ...(invariant.description !== undefined
        ? { description: invariant.description }
        : {}),
      verdict: "not-violated",
      message: `every modeled run of "${jobId}" is within the allowed context (${allowedLabel})`,
      workflow: workflow.file,
      jobId,
    },
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function matchesFilter(
  outcome: ScenarioOutcome,
  invariant: JobNotReachableInvariant,
): boolean {
  if (
    invariant.event !== undefined &&
    outcome.scenario.event !== invariant.event
  ) {
    return false;
  }
  if (invariant.trust === "fork") {
    return (
      outcome.scenario.fork === true &&
      outcome.scenario.actorClass === "external"
    );
  }
  if (invariant.trust === "internal") {
    return outcome.scenario.fork === false;
  }
  return true;
}

function contextAllowed(
  scenario: Scenario,
  invariant: JobOnlyReachableInvariant,
): boolean {
  const eventAllowed =
    invariant.events.length === 0 || invariant.events.includes(scenario.event);
  const refAllowed =
    invariant.refs.length === 0 ||
    (scenario.event === "push" &&
      invariant.refs.includes(scenario.refKind ?? "branch"));
  return eventAllowed && refAllowed;
}

function describeFilter(invariant: JobNotReachableInvariant): string {
  const parts: string[] = [];
  if (invariant.trust !== undefined) {
    parts.push(`trust=${invariant.trust}`);
  }
  if (invariant.event !== undefined) {
    parts.push(`event=${invariant.event}`);
  }
  return parts.length > 0 ? ` under ${parts.join(", ")}` : "";
}

function describeAllowed(invariant: JobOnlyReachableInvariant): string {
  const parts: string[] = [];
  if (invariant.events.length > 0) {
    parts.push(`event: ${invariant.events.join(" | ")}`);
  }
  if (invariant.refs.length > 0) {
    parts.push(`ref: ${invariant.refs.join(" | ")}`);
  }
  return parts.length > 0 ? parts.join("; ") : "any";
}

function unknownResult(
  invariant: Invariant,
  workflow: AnalyzedWorkflow,
  jobId: string,
  reasons: string[],
): InvariantResult {
  return {
    id: invariant.id,
    ...(invariant.description !== undefined
      ? { description: invariant.description }
      : {}),
    verdict: "unknown",
    message: `cannot decide "${invariant.id}" soundly; a relevant scenario is UNKNOWN`,
    workflow: workflow.file,
    jobId,
    unknownReasons: unknownReasons(workflow, reasons),
  };
}

function unknownReasons(workflow: AnalyzedWorkflow, extra: string[]): string[] {
  const limitationMessages = workflow.exploration.limitations
    .filter((l) => !l.informational)
    .map((l) => l.message);
  return [...new Set([...extra, ...limitationMessages])].sort((a, b) =>
    a.localeCompare(b),
  );
}

function outcomeFor(
  workflow: AnalyzedWorkflow,
  scenario: Scenario,
): Record<string, JobExecution> | undefined {
  return workflow.exploration.evaluations.find((e) => e.scenario === scenario)
    ?.jobs;
}

type Resolution = { workflow: AnalyzedWorkflow } | { error: string };

/** Resolve a job reference to exactly one modeled workflow, or an error. */
function resolveJob(
  ref: JobRef,
  workflows: readonly AnalyzedWorkflow[],
): Resolution {
  let candidates = workflows.filter((w) => w.model.jobs.has(ref.id));
  if (ref.workflow !== undefined) {
    candidates = candidates.filter((w) =>
      matchesWorkflow(w.file, ref.workflow as string),
    );
  }

  if (candidates.length === 0) {
    const where =
      ref.workflow !== undefined ? ` in workflow "${ref.workflow}"` : "";
    return { error: `references unknown job "${ref.id}"${where}` };
  }
  if (candidates.length > 1) {
    const files = candidates
      .map((w) => w.file)
      .sort((a, b) => a.localeCompare(b))
      .join(", ");
    return {
      error: `job "${ref.id}" is ambiguous across workflows (${files}); qualify it with a workflow`,
    };
  }
  return { workflow: candidates[0]! };
}

/** Match a workflow file against a user-provided spec (path or basename). */
function matchesWorkflow(file: string, spec: string): boolean {
  if (file === spec) {
    return true;
  }
  if (posix.basename(file) === spec) {
    return true;
  }
  return file.endsWith(`/${spec}`);
}
