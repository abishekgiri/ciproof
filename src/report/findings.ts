/**
 * The canonical, externally-reportable finding model.
 *
 * One stable representation feeds every machine-readable format (JSON, SARIF).
 * These formats are built from this structured model — NEVER by parsing the
 * human-readable text output. Both analysis paths (built-in checks when there is
 * no config, and user-declared invariants when there is) lower into the same
 * `ReportFinding`, so the two produce identical output shapes.
 */

import { createHash } from "node:crypto";
import type { JobExecution } from "../engine/index.js";
import type { Finding } from "../invariants/index.js";
import {
  highlightForPrerequisite,
  highlightForPrivilege,
  highlightForReachability,
  type InvariantResult,
} from "../invariants/index.js";
import type { ExplorationResult } from "../engine/index.js";
import type { WorkflowModel } from "../model/index.js";

/** Externally-facing verdict (stable wire vocabulary). */
export type ReportVerdict = "refuted" | "unknown" | "no-violation";

export interface ReportLocation {
  file: string;
  line?: number;
  column?: number;
}

export interface ReportCounterexample {
  /** Minimized, human-safe scenario fields (label -> value). */
  scenario: Record<string, string>;
  /** Job states in the counterexample scenario. */
  execution?: Record<string, string>;
}

export interface ReportFinding {
  /** Instance id shown to users (invariant id, or a built-in check id). */
  id: string;
  /** Stable rule id for tooling, e.g. `ciproof/builtin/CP001`. */
  ruleId: string;
  /** Rule kind, e.g. `job-not-reachable` or `CP001`. */
  rule: string;
  verdict: ReportVerdict;
  title: string;
  message: string;
  workflow?: string;
  job?: string;
  location?: ReportLocation;
  counterexample?: ReportCounterexample;
  unknownReasons?: string[];
  /** Stable identity across runs (rule + location class). */
  fingerprint: string;
}

export interface ReportSummary {
  refuted: number;
  unknown: number;
  passed: number;
}

/** One analyzed workflow, used to resolve job source locations. */
export interface AnalyzedForReport {
  file: string;
  model?: WorkflowModel;
  exploration?: ExplorationResult;
  findings: Finding[];
}

const BUILTIN_TITLES: Record<string, string> = {
  CP001: "unreachable job",
  CP002: "prerequisite bypass",
  CP003: "untrusted privileged path",
};

/** Map an internal verdict to the external wire vocabulary. */
function toReportVerdict(
  verdict: "violated" | "not-violated" | "unknown",
): ReportVerdict {
  switch (verdict) {
    case "violated":
      return "refuted";
    case "not-violated":
      return "no-violation";
    case "unknown":
      return "unknown";
  }
}

/** Build report findings from the built-in checks (config-free mode). */
export function findingsFromBuiltin(
  analyzed: readonly AnalyzedForReport[],
): ReportFinding[] {
  const out: ReportFinding[] = [];
  for (const wf of analyzed) {
    for (const finding of wf.findings) {
      out.push(builtinToReport(wf, finding));
    }
  }
  return sortFindings(out);
}

function builtinToReport(
  wf: AnalyzedForReport,
  finding: Finding,
): ReportFinding {
  const ruleId = `ciproof/builtin/${finding.id}`;
  const location = jobLocation(wf.model, wf.file, finding.jobId);
  const counterexample = finding.scenario
    ? {
        scenario: toRecord(
          finding.id === "CP003"
            ? highlightForPrivilege(finding.scenario)
            : highlightForPrerequisite(finding.scenario),
        ),
        ...executionFor(wf.exploration, finding.scenario),
      }
    : undefined;

  return {
    id: finding.id,
    ruleId,
    rule: finding.id,
    verdict: toReportVerdict(finding.verdict),
    title: finding.title || BUILTIN_TITLES[finding.id] || finding.id,
    message: finding.message,
    ...(wf.file !== undefined ? { workflow: wf.file } : {}),
    ...(finding.jobId !== undefined ? { job: finding.jobId } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(counterexample !== undefined ? { counterexample } : {}),
    ...(finding.verdict === "unknown"
      ? {
          unknownReasons: dedupeSort(finding.limitations.map((l) => l.message)),
        }
      : {}),
    fingerprint: fingerprint(ruleId, wf.file, finding.jobId),
  };
}

/** Build report findings from user-declared invariants (config mode). */
export function findingsFromInvariants(
  results: readonly InvariantResult[],
  models: ReadonlyMap<string, WorkflowModel>,
): ReportFinding[] {
  const out: ReportFinding[] = [];
  for (const result of results) {
    const ruleId = `ciproof/user/${result.id}`;
    const model = result.workflow ? models.get(result.workflow) : undefined;
    const location = jobLocation(model, result.workflow, result.jobId);
    const counterexample = result.scenario
      ? {
          scenario: toRecord(highlightForReachability(result.scenario)),
          ...(result.execution !== undefined
            ? { execution: stringifyExecution(result.execution) }
            : {}),
        }
      : undefined;

    out.push({
      id: result.id,
      ruleId,
      rule: result.rule ?? "invariant",
      verdict: toReportVerdict(result.verdict),
      title: result.description ?? result.id,
      message: result.message,
      ...(result.workflow !== undefined ? { workflow: result.workflow } : {}),
      ...(result.jobId !== undefined ? { job: result.jobId } : {}),
      ...(location !== undefined ? { location } : {}),
      ...(counterexample !== undefined ? { counterexample } : {}),
      ...(result.unknownReasons !== undefined
        ? { unknownReasons: dedupeSort(result.unknownReasons) }
        : {}),
      fingerprint: fingerprint(ruleId, result.workflow, result.jobId),
    });
  }
  return sortFindings(out);
}

export function summarize(findings: readonly ReportFinding[]): ReportSummary {
  return {
    refuted: findings.filter((f) => f.verdict === "refuted").length,
    unknown: findings.filter((f) => f.verdict === "unknown").length,
    passed: findings.filter((f) => f.verdict === "no-violation").length,
  };
}

/** Findings worth reporting to tooling (refuted or unknown), sorted. */
export function actionable(
  findings: readonly ReportFinding[],
): ReportFinding[] {
  return findings.filter((f) => f.verdict !== "no-violation");
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function jobLocation(
  model: WorkflowModel | undefined,
  file: string | undefined,
  jobId: string | undefined,
): ReportLocation | undefined {
  if (file === undefined) {
    return undefined;
  }
  const source =
    (jobId !== undefined ? model?.jobs.get(jobId)?.source : undefined) ??
    model?.source;
  if (source) {
    return {
      file,
      line: source.start.line,
      column: source.start.column,
    };
  }
  return { file };
}

function executionFor(
  exploration: ExplorationResult | undefined,
  scenario: Finding["scenario"],
): { execution?: Record<string, string> } {
  if (!exploration || !scenario) {
    return {};
  }
  const outcome = exploration.evaluations.find((e) => e.scenario === scenario);
  if (!outcome) {
    return {};
  }
  return { execution: stringifyExecution(outcome.jobs) };
}

function stringifyExecution(
  jobs: Record<string, JobExecution>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(jobs).sort((a, b) => a.localeCompare(b))) {
    out[key] = String(jobs[key]);
  }
  return out;
}

function toRecord(
  pairs: { label: string; value: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { label, value } of pairs) {
    out[label] = value;
  }
  return out;
}

function dedupeSort(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

/**
 * Stable identity from the rule and its location class. Deliberately excludes
 * timestamps, commit SHAs, random ids, and absolute paths, so the same semantic
 * finding fingerprints identically across runs.
 */
function fingerprint(
  ruleId: string,
  workflow: string | undefined,
  job: string | undefined,
): string {
  const material = [ruleId, workflow ?? "", job ?? ""].join(" ");
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

function sortFindings(findings: ReportFinding[]): ReportFinding[] {
  return [...findings].sort(
    (a, b) =>
      a.ruleId.localeCompare(b.ruleId) ||
      (a.workflow ?? "").localeCompare(b.workflow ?? "") ||
      (a.job ?? "").localeCompare(b.job ?? "") ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
}
