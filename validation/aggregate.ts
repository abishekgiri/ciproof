/**
 * Pure aggregation for the real-world validation study.
 *
 * These functions take already-analyzed per-workflow records (never files or the
 * network) and produce deterministic study metrics. Keeping them pure makes the
 * study reproducible and lets the test suite exercise the maths on a tiny
 * synthetic corpus with no network access.
 *
 * This module is developer/research infrastructure; it is not part of the
 * shipped `ciproof` CLI.
 */

/** How a workflow was ultimately handled. Parse/normalize failures are kept
 * distinct from semantic incompleteness (a partial-but-modeled analysis). */
export type WorkflowStatus =
  | "complete"
  | "partial"
  | "parse-failure"
  | "normalize-failure"
  | "analysis-error";

export interface JobCounts {
  total: number;
  /** Jobs that RUN in at least one modeled scenario. */
  runCapable: number;
  /** Jobs that never run and are soundly unreachable (complete analysis). */
  alwaysSkipped: number;
  /** Jobs whose reachability depends on unmodeled state. */
  unknownCapable: number;
}

export interface WorkflowRecord {
  repo: string;
  workflow: string;
  status: WorkflowStatus;
  jobs: JobCounts;
  scenarios: number;
  timeMs: number;
  /** Non-informational limitation kinds for this workflow (deduped). */
  limitationKinds: string[];
  findings: { id: string; verdict: string }[];
}

export interface UnknownReasonRow {
  kind: string;
  /** Distinct workflows in which the kind appeared. */
  workflows: number;
  /** Total occurrences across the corpus. */
  occurrences: number;
}

export interface StudyReport {
  version: number;
  corpus: { repositories: number; workflows: number; jobs: number };
  modeling: {
    complete: number;
    partial: number;
    parseFailure: number;
    normalizeFailure: number;
    analysisError: number;
    completePct: number;
    partialPct: number;
  };
  jobs: JobCounts;
  scenarios: { total: number; medianPerWorkflow: number; p95PerWorkflow: number; max: number };
  unknownReasons: UnknownReasonRow[];
  performance: { medianMs: number; p95Ms: number; maxMs: number; totalMs: number };
  findings: Record<string, { violated: number; unknown: number; notViolated: number }>;
}

export const STUDY_VERSION = 1;

/** Round to one decimal place (deterministic percentages). */
function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
}

/** Nearest-rank percentile (deterministic; p in [0,1]). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index]!;
}

/** Rank UNKNOWN/partial causes by workflows affected, then occurrences, then name. */
export function rankUnknownReasons(
  records: readonly WorkflowRecord[],
): UnknownReasonRow[] {
  const workflows = new Map<string, number>();
  const occurrences = new Map<string, number>();
  for (const record of records) {
    const seen = new Set<string>();
    for (const kind of record.limitationKinds) {
      occurrences.set(kind, (occurrences.get(kind) ?? 0) + 1);
      if (!seen.has(kind)) {
        seen.add(kind);
        workflows.set(kind, (workflows.get(kind) ?? 0) + 1);
      }
    }
  }
  return [...occurrences.keys()]
    .map((kind) => ({
      kind,
      workflows: workflows.get(kind) ?? 0,
      occurrences: occurrences.get(kind) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.workflows - a.workflows ||
        b.occurrences - a.occurrences ||
        a.kind.localeCompare(b.kind),
    );
}

/** Aggregate per-workflow records into the deterministic study report. */
export function aggregate(
  repositories: number,
  records: readonly WorkflowRecord[],
): StudyReport {
  const byStatus = (s: WorkflowStatus): number =>
    records.filter((r) => r.status === s).length;

  const complete = byStatus("complete");
  const partial = byStatus("partial");
  const parseFailure = byStatus("parse-failure");
  const normalizeFailure = byStatus("normalize-failure");
  const analysisError = byStatus("analysis-error");
  const analyzed = complete + partial;

  const jobs: JobCounts = records.reduce(
    (acc, r) => ({
      total: acc.total + r.jobs.total,
      runCapable: acc.runCapable + r.jobs.runCapable,
      alwaysSkipped: acc.alwaysSkipped + r.jobs.alwaysSkipped,
      unknownCapable: acc.unknownCapable + r.jobs.unknownCapable,
    }),
    { total: 0, runCapable: 0, alwaysSkipped: 0, unknownCapable: 0 },
  );

  const scenarioCounts = records.map((r) => r.scenarios);
  const times = records.map((r) => r.timeMs);

  const findings: StudyReport["findings"] = {};
  for (const record of records) {
    for (const f of record.findings) {
      const row = (findings[f.id] ??= {
        violated: 0,
        unknown: 0,
        notViolated: 0,
      });
      if (f.verdict === "violated") row.violated++;
      else if (f.verdict === "unknown") row.unknown++;
      else if (f.verdict === "not-violated") row.notViolated++;
    }
  }

  return {
    version: STUDY_VERSION,
    corpus: {
      repositories,
      workflows: records.length,
      jobs: jobs.total,
    },
    modeling: {
      complete,
      partial,
      parseFailure,
      normalizeFailure,
      analysisError,
      completePct: pct(complete, analyzed),
      partialPct: pct(partial, analyzed),
    },
    jobs,
    scenarios: {
      total: scenarioCounts.reduce((a, b) => a + b, 0),
      medianPerWorkflow: percentile(scenarioCounts, 0.5),
      p95PerWorkflow: percentile(scenarioCounts, 0.95),
      max: scenarioCounts.length > 0 ? Math.max(...scenarioCounts) : 0,
    },
    unknownReasons: rankUnknownReasons(records),
    performance: {
      medianMs: round2(percentile(times, 0.5)),
      p95Ms: round2(percentile(times, 0.95)),
      maxMs: round2(times.length > 0 ? Math.max(...times) : 0),
      totalMs: round2(times.reduce((a, b) => a + b, 0)),
    },
    findings: sortRecord(findings),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(record).sort((a, b) => a.localeCompare(b))) {
    out[key] = record[key]!;
  }
  return out;
}
