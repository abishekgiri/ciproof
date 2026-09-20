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
  TriggerModel,
  WorkflowModel,
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
