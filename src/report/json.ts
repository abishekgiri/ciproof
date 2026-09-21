/**
 * Deterministic JSON report for `ciproof check --format json`.
 *
 * The output is a stable, documented contract (see `JSON_REPORT_VERSION`):
 * additions may be made compatibly; a breaking change requires incrementing the
 * version. It is built from `ReportFinding`s, never from rendered text, contains
 * no ANSI, and is byte-stable for identical input.
 */

import { actionable, summarize, type ReportFinding } from "./findings.js";

/** Version of the JSON report contract. Bump only on a breaking change. */
export const JSON_REPORT_VERSION = 1;

export interface JsonReportOptions {
  /** Workflow files that could not be parsed/modeled (surfaced as notes). */
  parseFailures?: string[];
}

/** Render the machine-readable JSON report. */
export function renderJsonReport(
  findings: readonly ReportFinding[],
  options: JsonReportOptions = {},
): string {
  const summary = summarize(findings);
  const results = actionable(findings).map((f) => ({
    id: f.id,
    rule: f.rule,
    ruleId: f.ruleId,
    verdict: f.verdict,
    title: f.title,
    message: f.message,
    workflow: f.workflow ?? null,
    job: f.job ?? null,
    location: f.location ?? null,
    counterexample: f.counterexample ?? null,
    unknownReasons: f.unknownReasons ?? [],
    fingerprint: f.fingerprint,
  }));

  const notes = [...(options.parseFailures ?? [])]
    .sort((a, b) => a.localeCompare(b))
    .map((file) => `workflow could not be modeled: ${file}`);

  return (
    JSON.stringify(
      {
        version: JSON_REPORT_VERSION,
        summary,
        results,
        ...(notes.length > 0 ? { notes } : {}),
      },
      null,
      2,
    ) + "\n"
  );
}
