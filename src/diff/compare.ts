/**
 * Semantic behavior comparator.
 *
 * Consumes two BehaviorSnapshots (`before`, `after`) and returns structured
 * semantic changes. It is a PURE function of the two snapshots — it never
 * touches git, the filesystem, or rendered strings — so it is fully testable
 * with in-memory snapshots.
 *
 * Correctness rules it must never break:
 *   unreachable != unknown
 *   absence of evidence != evidence of absence
 * A crossing of the modeled/unknown boundary is reported as an UNKNOWN change,
 * never as added/removed reachability.
 */

import type {
  BehaviorSnapshot,
  JobSnapshot,
  ScenarioDescriptor,
  WorkflowSnapshot,
} from "./snapshot.js";

export type ChangeCategory =
  | "added-workflow"
  | "removed-workflow"
  | "workflow-modelability-changed"
  | "added-job"
  | "removed-job"
  | "added-reachability"
  | "removed-reachability"
  | "changed-reachability"
  | "modeled-to-unknown"
  | "unknown-to-modeled"
  | "unknown-reason-changed"
  | "privilege-changed"
  | "trust-exposure-changed";

export interface SemanticChange {
  category: ChangeCategory;
  workflow: string;
  job?: string;
  /** Human-readable prior state. */
  before?: string;
  /** Human-readable new state. */
  after?: string;
  /** Reason string, e.g. why something became UNKNOWN. */
  reason?: string;
  /** Scenario labels gained (sorted). */
  addedScenarios?: string[];
  /** Scenario labels lost (sorted). */
  removedScenarios?: string[];
  /** Extra detail lines (e.g. per-job summary for an added/removed workflow). */
  details?: string[];
}

/** Deterministic ordering weight for change categories. */
const CATEGORY_ORDER: Record<ChangeCategory, number> = {
  "added-workflow": 0,
  "removed-workflow": 1,
  "workflow-modelability-changed": 2,
  "added-job": 3,
  "removed-job": 4,
  "added-reachability": 5,
  "removed-reachability": 6,
  "changed-reachability": 7,
  "modeled-to-unknown": 8,
  "unknown-to-modeled": 9,
  "unknown-reason-changed": 10,
  "privilege-changed": 11,
  "trust-exposure-changed": 12,
};

/** Compare two behavior snapshots and return sorted semantic changes. */
export function compareBehavior(
  before: BehaviorSnapshot,
  after: BehaviorSnapshot,
): SemanticChange[] {
  const changes: SemanticChange[] = [];

  const beforeByFile = new Map(before.workflows.map((w) => [w.file, w]));
  const afterByFile = new Map(after.workflows.map((w) => [w.file, w]));
  const files = [
    ...new Set([...beforeByFile.keys(), ...afterByFile.keys()]),
  ].sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const b = beforeByFile.get(file);
    const a = afterByFile.get(file);
    if (!b && a) {
      changes.push(addedWorkflowChange(a));
      continue;
    }
    if (b && !a) {
      changes.push(removedWorkflowChange(b));
      continue;
    }
    if (b && a) {
      changes.push(...compareWorkflow(b, a));
    }
  }

  return sortChanges(changes);
}

function compareWorkflow(
  before: WorkflowSnapshot,
  after: WorkflowSnapshot,
): SemanticChange[] {
  const changes: SemanticChange[] = [];

  // Modelability of the whole workflow (parse/normalize succeeded or not).
  if (before.present && after.modelError) {
    return [
      {
        category: "workflow-modelability-changed",
        workflow: after.file,
        before: "modeled",
        after: "unmodeled",
        reason: "workflow no longer parses/normalizes at this revision",
      },
    ];
  }
  if (before.modelError && after.present) {
    return [
      {
        category: "workflow-modelability-changed",
        workflow: after.file,
        before: "unmodeled",
        after: "modeled",
        reason: "workflow now parses/normalizes",
      },
    ];
  }
  if (before.modelError && after.modelError) {
    return [];
  }

  const beforeJobs = new Map(before.jobs.map((j) => [j.job, j]));
  const afterJobs = new Map(after.jobs.map((j) => [j.job, j]));
  const jobIds = [...new Set([...beforeJobs.keys(), ...afterJobs.keys()])].sort(
    (x, y) => x.localeCompare(y),
  );

  for (const jobId of jobIds) {
    const bj = beforeJobs.get(jobId);
    const aj = afterJobs.get(jobId);
    if (!bj && aj) {
      changes.push(addedJobChange(after.file, aj));
      continue;
    }
    if (bj && !aj) {
      changes.push(removedJobChange(before.file, bj));
      continue;
    }
    if (bj && aj) {
      changes.push(...compareJob(after.file, bj, aj));
    }
  }

  return changes;
}

function compareJob(
  workflow: string,
  before: JobSnapshot,
  after: JobSnapshot,
): SemanticChange[] {
  const changes: SemanticChange[] = [];
  const b = before.reachability;
  const a = after.reachability;

  if (b === a) {
    if (a === "reachable") {
      const scenarioChange = scenarioDiff(workflow, before, after);
      if (scenarioChange) {
        changes.push(scenarioChange);
      }
    } else if (a === "unknown") {
      if (before.unknownReason !== after.unknownReason) {
        changes.push({
          category: "unknown-reason-changed",
          workflow,
          job: after.job,
          before: before.unknownReason ?? "unknown",
          after: after.unknownReason ?? "unknown",
        });
      }
    }
    // unreachable -> unreachable: no change.
  } else if (b !== "unknown" && a !== "unknown") {
    // modeled <-> modeled: a genuine reachability change.
    if (a === "reachable") {
      changes.push({
        category: "added-reachability",
        workflow,
        job: after.job,
        before: "unreachable",
        after: "reachable",
        addedScenarios: labels(after.reachableScenarios),
      });
    } else {
      changes.push({
        category: "removed-reachability",
        workflow,
        job: after.job,
        before: "reachable",
        after: "unreachable",
        removedScenarios: labels(before.reachableScenarios),
      });
    }
  } else if (b !== "unknown" && a === "unknown") {
    // Crossing into UNKNOWN — never reported as "removed reachability".
    changes.push({
      category: "modeled-to-unknown",
      workflow,
      job: after.job,
      before: b,
      after: "unknown",
      ...(after.unknownReason !== undefined
        ? { reason: after.unknownReason }
        : {}),
    });
  } else if (b === "unknown" && a !== "unknown") {
    changes.push({
      category: "unknown-to-modeled",
      workflow,
      job: after.job,
      before: "unknown",
      after: a,
      ...(before.unknownReason !== undefined
        ? { reason: before.unknownReason }
        : {}),
      ...(a === "reachable"
        ? { addedScenarios: labels(after.reachableScenarios) }
        : {}),
    });
  }

  // Modeled security dimensions (only meaningful when both sides are modeled).
  changes.push(...securityChanges(workflow, before, after));

  return changes;
}

function scenarioDiff(
  workflow: string,
  before: JobSnapshot,
  after: JobSnapshot,
): SemanticChange | null {
  const beforeKeys = new Map(before.reachableScenarios.map((s) => [s.key, s]));
  const afterKeys = new Map(after.reachableScenarios.map((s) => [s.key, s]));
  const added = after.reachableScenarios.filter((s) => !beforeKeys.has(s.key));
  const removed = before.reachableScenarios.filter(
    (s) => !afterKeys.has(s.key),
  );
  if (added.length === 0 && removed.length === 0) {
    return null;
  }
  return {
    category: "changed-reachability",
    workflow,
    job: after.job,
    ...(added.length > 0 ? { addedScenarios: labels(added) } : {}),
    ...(removed.length > 0 ? { removedScenarios: labels(removed) } : {}),
  };
}

function securityChanges(
  workflow: string,
  before: JobSnapshot,
  after: JobSnapshot,
): SemanticChange[] {
  const changes: SemanticChange[] = [];

  const beforePriv = privilegeLabel(before.writePrivilege);
  const afterPriv = privilegeLabel(after.writePrivilege);
  if (beforePriv !== afterPriv) {
    changes.push({
      category: "privilege-changed",
      workflow,
      job: after.job,
      before: beforePriv,
      after: afterPriv,
    });
  }

  // Trust exposure is derived from observed run scenarios, so it is only a sound
  // signal when BOTH sides are modeled. When a job is UNKNOWN, "not reachable by
  // a fork" cannot be claimed — that transition is already reported as an UNKNOWN
  // change, and asserting a trust change here would over-claim.
  const bothModeled =
    before.reachability !== "unknown" && after.reachability !== "unknown";
  if (bothModeled && before.externalReachable !== after.externalReachable) {
    changes.push({
      category: "trust-exposure-changed",
      workflow,
      job: after.job,
      before: before.externalReachable
        ? "reachable by external/fork context"
        : "not reachable by external/fork context",
      after: after.externalReachable
        ? "reachable by external/fork context"
        : "not reachable by external/fork context",
    });
  }

  return changes;
}

function addedWorkflowChange(after: WorkflowSnapshot): SemanticChange {
  return {
    category: "added-workflow",
    workflow: after.file,
    after: after.modelError ? "added (unmodeled)" : "added",
    details: workflowJobSummary(after),
  };
}

function removedWorkflowChange(before: WorkflowSnapshot): SemanticChange {
  return {
    category: "removed-workflow",
    workflow: before.file,
    before: before.modelError ? "removed (was unmodeled)" : "removed",
    details: workflowJobSummary(before),
  };
}

function addedJobChange(workflow: string, job: JobSnapshot): SemanticChange {
  return {
    category: "added-job",
    workflow,
    job: job.job,
    after: reachabilityLabel(job),
    ...(job.reachability === "reachable"
      ? { addedScenarios: labels(job.reachableScenarios) }
      : {}),
    ...(job.reachability === "unknown" && job.unknownReason !== undefined
      ? { reason: job.unknownReason }
      : {}),
  };
}

function removedJobChange(workflow: string, job: JobSnapshot): SemanticChange {
  return {
    category: "removed-job",
    workflow,
    job: job.job,
    before: reachabilityLabel(job),
    ...(job.reachability === "reachable"
      ? { removedScenarios: labels(job.reachableScenarios) }
      : {}),
  };
}

function workflowJobSummary(workflow: WorkflowSnapshot): string[] {
  if (workflow.modelError) {
    return ["workflow could not be modeled at this revision"];
  }
  return workflow.jobs.map((job) => {
    const scenarios =
      job.reachability === "reachable"
        ? `: ${labels(job.reachableScenarios).join("; ")}`
        : "";
    return `${job.job}: ${reachabilityLabel(job)}${scenarios}`;
  });
}

function reachabilityLabel(job: JobSnapshot): string {
  if (job.reachability === "unknown") {
    return `unknown (${job.unknownReason ?? "unknown"})`;
  }
  return job.reachability;
}

function privilegeLabel(privilege: string[] | "write-all"): string {
  if (privilege === "write-all") {
    return "write-all";
  }
  return privilege.length > 0 ? privilege.join(", ") : "none";
}

function labels(scenarios: ScenarioDescriptor[]): string[] {
  return scenarios.map((s) => s.label).sort((a, b) => a.localeCompare(b));
}

function sortChanges(changes: SemanticChange[]): SemanticChange[] {
  return [...changes].sort((a, b) => {
    if (a.workflow !== b.workflow) {
      return a.workflow.localeCompare(b.workflow);
    }
    const jobA = a.job ?? "";
    const jobB = b.job ?? "";
    if (jobA !== jobB) {
      return jobA.localeCompare(jobB);
    }
    if (a.category !== b.category) {
      return CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    }
    return 0;
  });
}
