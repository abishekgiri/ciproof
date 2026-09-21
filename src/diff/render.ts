/**
 * Rendering for the semantic behavior diff.
 *
 * Formatting lives ONLY here — the snapshot and comparator layers never produce
 * rendered strings. Output is deterministic (inputs are pre-sorted by the
 * comparator) and contains no ANSI escapes, so it is easy to review in a PR.
 */

import type { SemanticChange } from "./compare.js";

/** Human-readable section header for each change category. */
const CATEGORY_HEADER: Record<SemanticChange["category"], string> = {
  "added-workflow": "ADDED WORKFLOW",
  "removed-workflow": "REMOVED WORKFLOW",
  "workflow-modelability-changed": "MODELABILITY CHANGE",
  "added-job": "ADDED JOB",
  "removed-job": "REMOVED JOB",
  "added-reachability": "ADDED REACHABILITY",
  "removed-reachability": "REMOVED REACHABILITY",
  "changed-reachability": "CHANGED REACHABILITY",
  "modeled-to-unknown": "MODELED -> UNKNOWN",
  "unknown-to-modeled": "UNKNOWN -> MODELED",
  "unknown-reason-changed": "UNKNOWN CHANGE",
  "privilege-changed": "PRIVILEGE CHANGE",
  "trust-exposure-changed": "TRUST EXPOSURE CHANGE",
};

export interface RenderInput {
  base: string;
  head: string;
  changes: SemanticChange[];
}

/** Render the diff as deterministic, ANSI-free text. */
export function renderDiffText(input: RenderInput): string {
  const { base, head, changes } = input;
  const lines: string[] = [
    "CIProof semantic diff",
    `base:  ${base}`,
    `head:  ${head}`,
    "",
  ];

  if (changes.length === 0) {
    lines.push("No modeled CI behavior changes.");
    return lines.join("\n") + "\n";
  }

  lines.push(
    `${changes.length} behavior change${changes.length === 1 ? "" : "s"}`,
    "",
  );

  for (const change of changes) {
    lines.push(CATEGORY_HEADER[change.category]);
    lines.push(`  workflow: ${change.workflow}`);
    if (change.job !== undefined) {
      lines.push(`  job: ${change.job}`);
    }
    if (change.before !== undefined) {
      lines.push(`  before: ${change.before}`);
    }
    if (change.after !== undefined) {
      lines.push(`  after: ${change.after}`);
    }
    if (change.reason !== undefined) {
      lines.push(`  reason: ${change.reason}`);
    }
    for (const scenario of change.addedScenarios ?? []) {
      lines.push(`  + ${scenario}`);
    }
    for (const scenario of change.removedScenarios ?? []) {
      lines.push(`  - ${scenario}`);
    }
    for (const detail of change.details ?? []) {
      lines.push(`    ${detail}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

/** Render the diff as stable JSON. */
export function renderDiffJson(input: RenderInput): string {
  return (
    JSON.stringify(
      {
        base: input.base,
        head: input.head,
        changeCount: input.changes.length,
        changes: input.changes,
      },
      null,
      2,
    ) + "\n"
  );
}
