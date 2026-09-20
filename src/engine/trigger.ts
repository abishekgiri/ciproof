/**
 * Trigger evaluation for one concrete scenario.
 *
 * Supports event matching plus `branches` / `branches-ignore` / `paths` /
 * `paths-ignore` using GitHub filter-pattern globbing. Branch filters match the
 * pushed branch (push) or the base branch (pull_request family);
 * workflow_dispatch is not subject to branch/path filters. Anything indeterminate
 * (e.g. a PR with no base branch supplied) yields `unknown`, never a guess.
 */

import type {
  BranchPathFilters,
  SourceLocation,
  TriggerModel,
  WorkflowModel,
  WorkflowRunTrigger,
} from "../model/index.js";
import { andTruth, type Truth } from "../model/truth.js";
import { evidence, type Evidence, type TriggerMatch } from "./evidence.js";
import type { Scenario } from "./scenario.js";

export interface TriggerEvaluation {
  match: TriggerMatch;
  evidence: Evidence[];
}

export function evaluateTrigger(
  model: WorkflowModel,
  scenario: Scenario,
): TriggerEvaluation {
  const trigger = model.triggers.find((t) => t.event === scenario.event);

  if (!trigger) {
    return {
      match: "not-matched",
      evidence: [
        evidence(
          "fail",
          `workflow does not declare the ${scenario.event} event`,
        ),
      ],
    };
  }

  if (trigger.event === "workflow_dispatch") {
    return {
      match: "matched",
      evidence: [
        evidence(
          "pass",
          "workflow_dispatch matches (branch/path filters do not apply)",
          trigger.source,
        ),
      ],
    };
  }

  if (trigger.event === "schedule") {
    // schedule is time-based and runs on the default branch; if declared, it
    // fires. CIProof does not model when.
    return {
      match: "matched",
      evidence: [
        evidence(
          "pass",
          "schedule matches (runs on the default branch; timing not modeled)",
          trigger.source,
        ),
      ],
    };
  }

  if (trigger.event === "workflow_run") {
    return evaluateWorkflowRun(trigger, scenario);
  }

  if (trigger.event === "push") {
    return evaluatePush(trigger.filters, scenario, trigger.source);
  }

  if (trigger.event === "workflow_call") {
    // Reusable workflows run only when called; no standalone scenario matches.
    return {
      match: "not-matched",
      evidence: [
        evidence(
          "info",
          "workflow_call runs only when invoked by another workflow",
          trigger.source,
        ),
      ],
    };
  }

  const ev: Evidence[] = [
    evidence("pass", `event ${scenario.event} matched`, trigger.source),
  ];

  const branch = filterBranch(scenario);
  const branchResult = matchBranchFilters(trigger.filters, branch, ev);
  const pathResult = matchPathFilters(
    trigger.filters,
    scenario.changedFiles,
    ev,
  );

  const combined = andTruth([branchResult, pathResult]);
  return { match: truthToMatch(combined), evidence: ev };
}

/**
 * Push trigger evaluation with branch/tag ref-kind rules:
 * - only tag filters -> branch pushes do not trigger (and vice versa);
 * - neither -> both branches and tags trigger;
 * - path filters are IGNORED for tag pushes (GitHub semantics).
 */
function evaluatePush(
  filters: BranchPathFilters,
  scenario: Scenario,
  source: SourceLocation | undefined,
): TriggerEvaluation {
  const ev: Evidence[] = [];
  const hasBranchFilters = !!(filters.branches || filters.branchesIgnore);
  const hasTagFilters = !!(filters.tags || filters.tagsIgnore);
  const refKind = scenario.refKind ?? "branch";

  if (refKind === "tag") {
    if (hasBranchFilters && !hasTagFilters) {
      ev.push(
        evidence("fail", "tag push does not trigger a branch-only push filter"),
      );
      return { match: "not-matched", evidence: ev };
    }
    ev.push(evidence("pass", "push (tag) matched", source));
    const tag = tagFromRef(scenario.ref);
    const tagResult = matchTagFilters(filters, tag, ev);
    // Path filters are not evaluated for tag pushes.
    return { match: truthToMatch(tagResult), evidence: ev };
  }

  // Branch push.
  if (hasTagFilters && !hasBranchFilters) {
    ev.push(
      evidence("fail", "branch push does not trigger a tag-only push filter"),
    );
    return { match: "not-matched", evidence: ev };
  }
  ev.push(evidence("pass", "push (branch) matched", source));
  const branch = scenario.branch ?? branchFromRef(scenario.ref);
  const branchResult = matchBranchFilters(filters, branch, ev);
  const pathResult = matchPathFilters(filters, scenario.changedFiles, ev);
  return {
    match: truthToMatch(andTruth([branchResult, pathResult])),
    evidence: ev,
  };
}

function matchTagFilters(
  filters: BranchPathFilters,
  tag: string | undefined,
  ev: Evidence[],
): Truth {
  if (!filters.tags && !filters.tagsIgnore) {
    return "true";
  }
  if (tag === undefined) {
    ev.push(evidence("unknown", "tag is unknown; tag filter unresolved"));
    return "unknown";
  }
  if (filters.tags) {
    const matched = matchesAny(tag, filters.tags);
    ev.push(
      evidence(
        matched ? "pass" : "fail",
        `tag "${tag}" ${matched ? "matches" : "does not match"} tags [${filters.tags.join(", ")}]`,
      ),
    );
    return matched ? "true" : "false";
  }
  const ignored = matchesAny(tag, filters.tagsIgnore ?? []);
  ev.push(
    evidence(
      ignored ? "fail" : "pass",
      `tag "${tag}" ${ignored ? "is excluded by" : "is not excluded by"} tags-ignore`,
    ),
  );
  return ignored ? "false" : "true";
}

function tagFromRef(ref: string | undefined): string | undefined {
  return ref?.startsWith("refs/tags/")
    ? ref.slice("refs/tags/".length)
    : undefined;
}

function evaluateWorkflowRun(
  trigger: WorkflowRunTrigger,
  scenario: Scenario,
): TriggerEvaluation {
  const run = scenario.workflowRun;
  if (!run) {
    return {
      match: "unknown",
      evidence: [
        evidence("unknown", "no upstream workflow_run context supplied"),
      ],
    };
  }
  const ev: Evidence[] = [];

  const nameMatches =
    trigger.workflows.length === 0 ||
    trigger.workflows.includes(run.workflowName);
  ev.push(
    evidence(
      nameMatches ? "pass" : "fail",
      `upstream workflow "${run.workflowName}" ${nameMatches ? "matches" : "does not match"} [${trigger.workflows.join(", ")}]`,
    ),
  );

  const activityMatches = trigger.types.includes(run.activity);
  ev.push(
    evidence(
      activityMatches ? "pass" : "fail",
      `activity "${run.activity}" ${activityMatches ? "is" : "is not"} in [${trigger.types.join(", ")}]`,
    ),
  );

  const branchTruth = matchBranchFilters(
    {
      ...(trigger.branches ? { branches: trigger.branches } : {}),
      ...(trigger.branchesIgnore
        ? { branchesIgnore: trigger.branchesIgnore }
        : {}),
    },
    run.branch,
    ev,
  );

  const combined = andTruth([
    nameMatches ? "true" : "false",
    activityMatches ? "true" : "false",
    branchTruth,
  ]);
  return { match: truthToMatch(combined), evidence: ev };
}

function filterBranch(scenario: Scenario): string | undefined {
  if (scenario.event === "push") {
    return scenario.branch ?? branchFromRef(scenario.ref);
  }
  // pull_request / pull_request_target: filters match the base branch.
  return scenario.baseRef;
}

function matchBranchFilters(
  filters: BranchPathFilters,
  branch: string | undefined,
  ev: Evidence[],
): Truth {
  if (!filters.branches && !filters.branchesIgnore) {
    return "true";
  }
  if (branch === undefined) {
    ev.push(evidence("unknown", "branch is unknown; branch filter unresolved"));
    return "unknown";
  }
  if (filters.branches) {
    const matched = matchesAny(branch, filters.branches);
    ev.push(
      evidence(
        matched ? "pass" : "fail",
        `branch "${branch}" ${matched ? "matches" : "does not match"} branches [${filters.branches.join(", ")}]`,
      ),
    );
    return matched ? "true" : "false";
  }
  const ignored = matchesAny(branch, filters.branchesIgnore ?? []);
  ev.push(
    evidence(
      ignored ? "fail" : "pass",
      `branch "${branch}" ${ignored ? "is excluded by" : "is not excluded by"} branches-ignore [${(filters.branchesIgnore ?? []).join(", ")}]`,
    ),
  );
  return ignored ? "false" : "true";
}

function matchPathFilters(
  filters: BranchPathFilters,
  changedFiles: string[],
  ev: Evidence[],
): Truth {
  if (!filters.paths && !filters.pathsIgnore) {
    return "true";
  }
  if (changedFiles.length === 0) {
    ev.push(
      evidence("unknown", "no changed files supplied; path filter unresolved"),
    );
    return "unknown";
  }
  if (filters.paths) {
    const matched = changedFiles.some((file) =>
      matchesAny(file, filters.paths ?? []),
    );
    ev.push(
      evidence(
        matched ? "pass" : "fail",
        `${matched ? "a" : "no"} changed file matches paths [${filters.paths.join(", ")}]`,
      ),
    );
    return matched ? "true" : "false";
  }
  const ignore = filters.pathsIgnore ?? [];
  const allIgnored = changedFiles.every((file) => matchesAny(file, ignore));
  ev.push(
    evidence(
      allIgnored ? "fail" : "pass",
      `${allIgnored ? "all" : "not all"} changed files are excluded by paths-ignore [${ignore.join(", ")}]`,
    ),
  );
  return allIgnored ? "false" : "true";
}

function truthToMatch(truth: Truth): TriggerMatch {
  if (truth === "true") {
    return "matched";
  }
  return truth === "false" ? "not-matched" : "unknown";
}

function branchFromRef(ref: string | undefined): string | undefined {
  if (ref?.startsWith("refs/heads/")) {
    return ref.slice("refs/heads/".length);
  }
  return undefined;
}

/**
 * Match a value against a GitHub filter-pattern list. Positive patterns add
 * matches; a leading `!` removes them, with later patterns overriding earlier
 * ones (GitHub's last-match-wins ordering).
 */
function matchesAny(value: string, patterns: string[]): boolean {
  let matched = false;
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      if (filterRegExp(pattern.slice(1)).test(value)) {
        matched = false;
      }
    } else if (filterRegExp(pattern).test(value)) {
      matched = true;
    }
  }
  return matched;
}

/**
 * Convert a GitHub filter pattern to a RegExp.
 * `*` matches within a path segment; `**` matches across `/`; `?` and `+` are
 * quantifiers on the preceding element; `[...]` are character classes.
 */
function filterRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i] as string;
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (char === "?" || char === "+") {
      out += char;
    } else if (char === "[") {
      let cls = "[";
      let j = i + 1;
      if (pattern[j] === "!") {
        cls += "^";
        j++;
      }
      while (j < pattern.length && pattern[j] !== "]") {
        cls += pattern[j];
        j++;
      }
      cls += "]";
      out += cls;
      i = j;
    } else {
      out += char.replace(/[.\\^$(){}|]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

/** Re-export for tests that exercise pattern matching directly. */
export { matchesAny as matchesFilterPattern };
export type { TriggerModel };
