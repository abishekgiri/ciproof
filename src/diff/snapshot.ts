/**
 * BehaviorSnapshot — a git-free, presentation-free capture of the CI behavior
 * CIProof can soundly establish for a set of workflows at one revision.
 *
 * A snapshot is the unit the semantic comparator diffs. It is built from the
 * SAME analyzer the rest of CIProof uses (normalize -> explore), so there is one
 * source of truth for behavior. It records only what CIProof establishes
 * soundly, and preserves the `unreachable != unknown` distinction explicitly.
 */

import {
  classifyJobReachability,
  describeUnknownReason,
  type ExplorationResult,
  type Scenario,
} from "../engine/index.js";
import type {
  JobModel,
  PermissionModel,
  WorkflowModel,
  PermissionLevel,
} from "../model/index.js";

/** Write-capable permission scopes GitHub recognizes (mirrors CP003's set). */
const WRITE_CAPABLE_SCOPES = new Set([
  "actions",
  "checks",
  "contents",
  "deployments",
  "discussions",
  "issues",
  "packages",
  "pages",
  "pull-requests",
  "security-events",
  "statuses",
  "id-token",
]);

/** A canonical, comparable description of one reachability-relevant context. */
export interface ScenarioDescriptor {
  /** Stable key for set comparison (never rendered). */
  key: string;
  /** Human-readable label for reporting. */
  label: string;
}

export type JobReachability = "reachable" | "unreachable" | "unknown";

export interface JobSnapshot {
  job: string;
  reachability: JobReachability;
  /** Contexts under which the job runs (deduped, sorted by key); empty unless reachable. */
  reachableScenarios: ScenarioDescriptor[];
  /** Present only when reachability is `unknown`. */
  unknownReason?: string;
  /**
   * Declared write privilege for the job: sorted explicit write scopes, or
   * `write-all`, or empty when unspecified/read-only. Mirrors CP003 conservatism
   * (only EXPLICIT write is counted; unspecified is never privileged).
   */
  writePrivilege: string[] | "write-all";
  /** Whether an external/fork context runs this job (modeled trust exposure). */
  externalReachable: boolean;
}

export interface WorkflowSnapshot {
  /** Workflow identity: the file path (e.g. `.github/workflows/ci.yml`). */
  file: string;
  name?: string;
  /** True when a model + exploration were produced. */
  present: boolean;
  /** True when the workflow could not be parsed/normalized at this revision. */
  modelError: boolean;
  completeness: ExplorationResult["completeness"] | "unmodeled";
  /** Non-informational limitation messages (deduped, sorted). */
  limitations: string[];
  /** Jobs sorted by id. */
  jobs: JobSnapshot[];
}

export interface BehaviorSnapshot {
  /** Resolved revision label (metadata; the comparator ignores it). */
  revision: string;
  /** Workflows sorted by file path. */
  workflows: WorkflowSnapshot[];
}

/** One analyzed workflow at a revision, as produced by normalize + explore. */
export interface AnalyzedWorkflow {
  file: string;
  model?: WorkflowModel;
  exploration?: ExplorationResult;
}

/** Build a full behavior snapshot for a revision from analyzed workflows. */
export function buildBehaviorSnapshot(
  revision: string,
  analyzed: readonly AnalyzedWorkflow[],
): BehaviorSnapshot {
  const workflows = analyzed
    .map((entry) =>
      buildWorkflowSnapshot(entry.file, entry.model, entry.exploration),
    )
    .sort((a, b) => a.file.localeCompare(b.file));
  return { revision, workflows };
}

/** Build a single workflow's snapshot. Missing model/exploration => model error. */
export function buildWorkflowSnapshot(
  file: string,
  model: WorkflowModel | undefined,
  exploration: ExplorationResult | undefined,
): WorkflowSnapshot {
  if (!model || !exploration) {
    return {
      file,
      present: false,
      modelError: true,
      completeness: "unmodeled",
      limitations: [],
      jobs: [],
    };
  }

  const jobs: JobSnapshot[] = [...model.jobs.entries()]
    .map(([jobId, job]) => buildJobSnapshot(jobId, job, model, exploration))
    .sort((a, b) => a.job.localeCompare(b.job));

  const limitations = [
    ...new Set(
      exploration.limitations
        .filter((l) => !l.informational)
        .map((l) => l.message),
    ),
  ].sort((a, b) => a.localeCompare(b));

  return {
    file,
    ...(model.name !== undefined ? { name: model.name } : {}),
    present: true,
    modelError: false,
    completeness: exploration.completeness,
    limitations,
    jobs,
  };
}

function buildJobSnapshot(
  jobId: string,
  job: JobModel,
  model: WorkflowModel,
  exploration: ExplorationResult,
): JobSnapshot {
  const { reachability, reason } = classifyJobReachability(
    jobId,
    job,
    exploration,
  );

  const runScenarios = exploration.evaluations.filter(
    (e) => e.jobs[jobId] === "run",
  );
  const reachableScenarios =
    reachability === "reachable"
      ? dedupeDescriptors(runScenarios.map((e) => describeScenario(e.scenario)))
      : [];

  const externalReachable = runScenarios.some(
    (e) => e.scenario.fork === true && e.scenario.actorClass === "external",
  );

  return {
    job: jobId,
    reachability,
    reachableScenarios,
    ...(reason !== undefined
      ? { unknownReason: describeUnknownReason(reason) }
      : {}),
    writePrivilege: writePrivilegeOf(jobId, model),
    externalReachable,
  };
}

/** Canonical, deterministic description of a scenario's reachability context. */
export function describeScenario(scenario: Scenario): ScenarioDescriptor {
  switch (scenario.event) {
    case "push": {
      const ref = scenario.ref ?? "(unknown ref)";
      return { key: `push|${ref}`, label: `push → ${ref}` };
    }
    case "workflow_dispatch": {
      const inputs = formatInputs(scenario.inputs);
      return {
        key: `workflow_dispatch|${inputs}`,
        label:
          inputs.length > 0
            ? `workflow_dispatch [${inputs}]`
            : "workflow_dispatch",
      };
    }
    case "pull_request":
    case "pull_request_target": {
      const base = scenario.baseRef ?? "(any base)";
      const trust = scenario.fork ? " (fork)" : "";
      return {
        key: `${scenario.event}|base=${base}|fork=${scenario.fork}`,
        label: `${scenario.event} → base ${base}${trust}`,
      };
    }
    case "schedule": {
      const cron = scenario.schedule ?? "(cron)";
      return { key: `schedule|${cron}`, label: `schedule → ${cron}` };
    }
    case "workflow_run": {
      const run = scenario.workflowRun;
      const name = run?.workflowName ?? "*";
      const activity = run?.activity ?? "*";
      const conclusion = run?.conclusion ? `/${run.conclusion}` : "";
      return {
        key: `workflow_run|${name}|${activity}${conclusion}`,
        label: `workflow_run → ${name} ${activity}${conclusion}`,
      };
    }
    default: {
      const event: string = scenario.event;
      return { key: `event|${event}`, label: event };
    }
  }
}

function formatInputs(inputs: Record<string, boolean | string>): string {
  return Object.keys(inputs)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${String(inputs[key])}`)
    .join(", ");
}

function dedupeDescriptors(
  descriptors: ScenarioDescriptor[],
): ScenarioDescriptor[] {
  const byKey = new Map<string, ScenarioDescriptor>();
  for (const descriptor of descriptors) {
    if (!byKey.has(descriptor.key)) {
      byKey.set(descriptor.key, descriptor);
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The job's declared write privilege (job-level, else workflow-level), counting
 * only EXPLICIT write scopes — identical conservatism to CP003.
 */
function writePrivilegeOf(
  jobId: string,
  model: WorkflowModel,
): string[] | "write-all" {
  const job = model.jobs.get(jobId);
  const perm =
    job && job.permissions.mode !== "unspecified"
      ? job.permissions
      : model.permissions;
  return writeScopesOf(perm);
}

function writeScopesOf(perm: PermissionModel): string[] | "write-all" {
  if (perm.mode === "write-all") {
    return "write-all";
  }
  if (perm.mode !== "explicit" || !perm.scopes) {
    return [];
  }
  return Object.entries(perm.scopes)
    .filter(
      ([scope, level]) =>
        (level as PermissionLevel) === "write" &&
        WRITE_CAPABLE_SCOPES.has(scope),
    )
    .map(([scope]) => scope)
    .sort((a, b) => a.localeCompare(b));
}
