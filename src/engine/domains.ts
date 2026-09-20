/**
 * Scenario domain derivation.
 *
 * From a WorkflowModel, derive finite representative domains for each dimension
 * Phase 2 supports (event, branch/base/head, fork/trust, changed files,
 * dispatch inputs). Witnesses for glob patterns are synthesized and verified
 * through the real matcher; anything that cannot be represented becomes an
 * AnalysisLimitation (never a fabricated value).
 */

import type {
  BranchPathFilters,
  DispatchInputModel,
  SupportedTriggerEvent,
  WorkflowModel,
  WorkflowRunTrigger,
} from "../model/index.js";
import { extractRefLiterals } from "../github/expressions.js";
import { isGlob, synthesizeNonMatch, synthesizeWitness } from "./witnesses.js";

export interface AnalysisLimitation {
  kind: string;
  message: string;
}

export interface ForkVariant {
  fork: boolean;
  actorClass: "internal" | "external";
}

export interface EventDomain {
  event: SupportedTriggerEvent;
  /** Branch candidates (push branch, or the dispatch ref branch). */
  branches: string[];
  /** Base-branch candidates (pull_request family). */
  bases: string[];
  /** Head-branch candidates (pull_request family). */
  heads: string[];
  forks: ForkVariant[];
  /** Changed-file candidate sets. */
  fileSets: string[][];
  /** Full assignments over supported dispatch inputs. */
  inputCombos: Record<string, boolean | string>[];
  /** Declared cron strings (schedule event). */
  schedules: string[];
  /** Upstream-run candidates (workflow_run event). */
  workflowRuns: WorkflowRunCandidate[];
}

export interface WorkflowRunCandidate {
  workflowName: string;
  activity: "requested" | "in_progress" | "completed";
  branch: string;
  conclusion?: string;
}

export interface DomainBuild {
  domains: EventDomain[];
  limitations: AnalysisLimitation[];
}

const HEAD_GENERIC = "ciproof-head";
const WORKFLOW_RUN_BRANCH = "ciproof-upstream";
const REPRESENTATIVE_CONCLUSIONS = ["success", "failure"];

/** Build the per-event scenario domains for a workflow. */
export function buildDomains(model: WorkflowModel): DomainBuild {
  const limitations: AnalysisLimitation[] = [];

  // Unsupported constructs are visible limitations (they make analysis partial).
  for (const item of model.unsupported) {
    limitations.push({ kind: "unsupported-construct", message: item.message });
  }
  const refLiterals = collectRefLiterals(model);
  for (const job of model.jobs.values()) {
    for (const item of job.unsupported) {
      limitations.push({
        kind: "unsupported-construct",
        message: item.message,
      });
    }
  }

  const domains: EventDomain[] = [];

  const referencesConclusion = [...model.jobs.values()].some((job) =>
    job.condition?.raw.includes("workflow_run.conclusion"),
  );

  for (const trigger of model.triggers) {
    const emptyExtras = { schedules: [], workflowRuns: [] };
    if (trigger.event === "workflow_dispatch") {
      domains.push({
        event: "workflow_dispatch",
        branches: branchCandidates(
          undefined,
          undefined,
          branchNamesFromRefs(refLiterals.ref),
          limitations,
        ),
        bases: [],
        heads: [],
        forks: [{ fork: false, actorClass: "internal" }],
        fileSets: [[]],
        inputCombos: inputCombos(trigger.inputs, limitations),
        ...emptyExtras,
      });
    } else if (trigger.event === "push") {
      domains.push({
        event: "push",
        branches: branchCandidates(
          trigger.filters.branches,
          trigger.filters.branchesIgnore,
          branchNamesFromRefs(refLiterals.ref),
          limitations,
        ),
        bases: [],
        heads: [],
        forks: [{ fork: false, actorClass: "internal" }],
        fileSets: fileCandidates(trigger.filters, limitations),
        inputCombos: [{}],
        ...emptyExtras,
      });
    } else if (
      trigger.event === "pull_request" ||
      trigger.event === "pull_request_target"
    ) {
      domains.push({
        event: trigger.event,
        branches: [],
        bases: branchCandidates(
          trigger.filters.branches,
          trigger.filters.branchesIgnore,
          refLiterals.baseRef,
          limitations,
        ),
        heads: headCandidates(refLiterals.headRef),
        forks: [
          { fork: false, actorClass: "internal" },
          { fork: true, actorClass: "external" },
        ],
        fileSets: fileCandidates(trigger.filters, limitations),
        inputCombos: [{}],
        ...emptyExtras,
      });
    } else if (trigger.event === "schedule") {
      domains.push({
        event: "schedule",
        branches: branchCandidates(
          undefined,
          undefined,
          branchNamesFromRefs(refLiterals.ref),
          limitations,
        ),
        bases: [],
        heads: [],
        forks: [{ fork: false, actorClass: "internal" }],
        fileSets: [[]],
        inputCombos: [{}],
        schedules: trigger.schedules.map((s) => s.cron),
        workflowRuns: [],
      });
    } else if (trigger.event === "workflow_run") {
      domains.push({
        event: "workflow_run",
        branches: [],
        bases: [],
        heads: [],
        forks: [{ fork: false, actorClass: "internal" }],
        fileSets: [[]],
        inputCombos: [{}],
        schedules: [],
        workflowRuns: workflowRunCandidates(trigger, referencesConclusion),
      });
    }
  }

  return { domains, limitations };
}

function workflowRunCandidates(
  trigger: WorkflowRunTrigger,
  referencesConclusion: boolean,
): WorkflowRunCandidate[] {
  const names = trigger.workflows.length > 0 ? trigger.workflows : ["*"];
  const branch = trigger.branches?.[0] ?? WORKFLOW_RUN_BRANCH;
  const candidates: WorkflowRunCandidate[] = [];
  for (const workflowName of names) {
    for (const activity of trigger.types) {
      if (activity === "completed" && referencesConclusion) {
        for (const conclusion of REPRESENTATIVE_CONCLUSIONS) {
          candidates.push({ workflowName, activity, branch, conclusion });
        }
      } else if (activity === "completed") {
        candidates.push({
          workflowName,
          activity,
          branch,
          conclusion: "success",
        });
      } else {
        candidates.push({ workflowName, activity, branch });
      }
    }
  }
  return candidates;
}

function collectRefLiterals(model: WorkflowModel): {
  ref: string[];
  baseRef: string[];
  headRef: string[];
} {
  const ref = new Set<string>();
  const baseRef = new Set<string>();
  const headRef = new Set<string>();
  for (const job of model.jobs.values()) {
    if (!job.condition) {
      continue;
    }
    const literals = extractRefLiterals(job.condition.raw);
    literals.ref.forEach((l) => ref.add(l));
    literals.baseRef.forEach((l) => baseRef.add(l));
    literals.headRef.forEach((l) => headRef.add(l));
  }
  return { ref: [...ref], baseRef: [...baseRef], headRef: [...headRef] };
}

/** Map `refs/heads/<branch>` literals to branch names; skip non-branch refs. */
function branchNamesFromRefs(refs: string[]): string[] {
  const names: string[] = [];
  for (const ref of refs) {
    if (ref.startsWith("refs/heads/")) {
      names.push(ref.slice("refs/heads/".length));
    }
  }
  return names;
}

function branchCandidates(
  positive: string[] | undefined,
  ignore: string[] | undefined,
  literals: string[],
  limitations: AnalysisLimitation[],
): string[] {
  const set = new Set<string>();

  for (const pattern of [...(positive ?? []), ...(ignore ?? [])]) {
    if (isGlob(pattern)) {
      const witness = synthesizeWitness(pattern);
      if (witness !== null) {
        set.add(witness);
      } else if (!pattern.startsWith("!")) {
        limitations.push({
          kind: "branch-witness",
          message: `cannot synthesize a branch witness for pattern "${pattern}"`,
        });
      }
    } else {
      set.add(pattern);
    }
  }

  for (const literal of literals) {
    set.add(literal);
  }

  const hasFilters =
    (positive?.length ?? 0) + (ignore?.length ?? 0) + literals.length > 0;
  if (hasFilters) {
    const nonMatch = synthesizeNonMatch([
      ...(positive ?? []),
      ...(ignore ?? []),
    ]);
    if (nonMatch !== null) {
      set.add(nonMatch);
    } else {
      limitations.push({
        kind: "branch-witness",
        message: "cannot synthesize a non-matching branch witness",
      });
    }
  }

  if (set.size === 0) {
    set.add("main");
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function headCandidates(literals: string[]): string[] {
  const set = new Set<string>(literals);
  if (literals.length > 0) {
    const nonMatch = synthesizeNonMatch(literals);
    if (nonMatch !== null) {
      set.add(nonMatch);
    }
  }
  if (set.size === 0) {
    set.add(HEAD_GENERIC);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function fileCandidates(
  filters: BranchPathFilters,
  limitations: AnalysisLimitation[],
): string[][] {
  if (!filters.paths && !filters.pathsIgnore) {
    return [[]];
  }

  const sets: string[][] = [];

  if (filters.paths) {
    for (const pattern of filters.paths) {
      const witness = isGlob(pattern) ? synthesizeWitness(pattern) : pattern;
      if (witness !== null) {
        sets.push([witness]);
      } else {
        limitations.push({
          kind: "path-witness",
          message: `cannot synthesize a path witness for pattern "${pattern}"`,
        });
      }
    }
    const nonMatch = synthesizeNonMatch(filters.paths);
    if (nonMatch !== null) {
      sets.push([nonMatch]);
    }
    sets.push([]);
  }

  if (filters.pathsIgnore) {
    const first = filters.pathsIgnore.find((p) => !p.startsWith("!"));
    const ignored =
      first === undefined
        ? null
        : isGlob(first)
          ? synthesizeWitness(first)
          : first;
    const surviving = synthesizeNonMatch(filters.pathsIgnore);
    if (ignored !== null) {
      sets.push([ignored]);
      if (surviving !== null) {
        sets.push([ignored, surviving]);
      }
    } else {
      limitations.push({
        kind: "path-witness",
        message: "cannot synthesize an ignored-path witness",
      });
    }
    if (surviving !== null) {
      sets.push([surviving]);
    }
    sets.push([]);
  }

  return dedupeSets(sets);
}

function dedupeSets(sets: string[][]): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const set of sets) {
    const key = JSON.stringify(set);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(set);
    }
  }
  return out;
}

function inputCombos(
  inputs: DispatchInputModel[],
  limitations: AnalysisLimitation[],
): Record<string, boolean | string>[] {
  const dimensions: { name: string; values: (boolean | string)[] }[] = [];

  for (const input of inputs) {
    if (input.type === "boolean") {
      dimensions.push({ name: input.name, values: [false, true] });
    } else if (input.type === "choice") {
      if (input.options && input.options.length > 0) {
        dimensions.push({ name: input.name, values: [...input.options] });
      } else {
        limitations.push({
          kind: "unsupported-input",
          message: `choice input "${input.name}" declares no options; left unset`,
        });
      }
    } else {
      limitations.push({
        kind: "unsupported-input",
        message: `input "${input.name}" has unsupported type ${input.rawType}; left unset (evaluates as unknown)`,
      });
    }
  }

  let combos: Record<string, boolean | string>[] = [{}];
  for (const dimension of dimensions) {
    const next: Record<string, boolean | string>[] = [];
    for (const combo of combos) {
      for (const value of dimension.values) {
        next.push({ ...combo, [dimension.name]: value });
      }
    }
    combos = next;
  }
  return combos;
}
