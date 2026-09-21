/**
 * `ciproof check` — verify invariants and report findings with concrete,
 * already-explored counterexamples. Evaluates user-declared invariants from
 * `ciproof.yml` when present, otherwise the built-in checks (CP001/CP002/CP003).
 *
 * Output is available as human text, JSON (`--format json`), or SARIF 2.1.0
 * (`--format sarif`), all built from the same structured findings — never by
 * parsing the text output. The exit code depends only on the analysis, not the
 * format. Never prints "safe".
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { WorkflowModel } from "./model/index.js";
import {
  exploreWorkflow,
  type ExplorationResult,
  type Evidence,
  type JobExecution,
} from "./engine/index.js";
import {
  runChecks,
  highlightForPrerequisite,
  highlightForPrivilege,
  highlightForReachability,
  evaluateUserInvariants,
  type Finding,
  type PrerequisiteRule,
  type AnalyzedWorkflow,
  type InvariantResult,
} from "./invariants/index.js";
import { normalizeWorkflow } from "./github/normalize.js";
import { discoverWorkflowFiles, createFileProvider } from "./discovery.js";
import {
  loadConfig,
  type ConfigLoad,
  type ConfigIssue,
} from "./config/index.js";
import type { ReferenceError } from "./invariants/index.js";
import {
  findingsFromBuiltin,
  findingsFromInvariants,
  renderJsonReport,
  renderSarif,
  type OutputFormat,
} from "./report/index.js";
import pkg from "../package.json" with { type: "json" };

export interface CheckCliOptions {
  root: string;
  workflow?: string;
  maxScenarios?: number;
  prerequisiteRules?: PrerequisiteRule[];
  /** Explicit config path (`--config`); overrides discovery. */
  configPath?: string;
  /** Machine-readable format for the report (text | json | sarif). */
  format?: OutputFormat;
  /** Write the report to this file instead of stdout. */
  output?: string;
  /** Legacy detailed per-workflow JSON (superseded by `format: "json"`). */
  json?: boolean;
}

export interface CheckResult {
  output: string;
  exitCode: number;
  /** Which stream the output belongs on (default stdout). */
  stream?: "stdout" | "stderr";
}

interface CheckedWorkflow {
  file: string;
  model?: WorkflowModel;
  exploration?: ExplorationResult;
  findings: Finding[];
}

export async function runCheck(options: CheckCliOptions): Promise<CheckResult> {
  const format: OutputFormat = options.format ?? "text";

  // Load configuration first: a bad config is a usage error (exit 2) regardless
  // of the workflows. Config errors are human diagnostics -> stderr, never mixed
  // into a machine-readable stdout report.
  const config = loadConfig({
    root: options.root,
    ...(options.configPath !== undefined
      ? { configPath: options.configPath }
      : {}),
  });
  if (config.status === "error") {
    return {
      output: renderConfigErrors(config),
      exitCode: 2,
      stream: "stderr",
    };
  }

  let files = discoverWorkflowFiles(options.root);
  if (options.workflow) {
    files = files.filter((f) => f.path.includes(options.workflow as string));
  }

  const checked: CheckedWorkflow[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file.absolutePath, "utf8");
    } catch {
      checked.push({ file: file.path, findings: [] });
      continue;
    }
    const { model } = await normalizeWorkflow(
      { filename: file.path, content },
      { fileProvider: createFileProvider(options.root) },
    );
    if (!model) {
      checked.push({ file: file.path, findings: [] });
      continue;
    }
    const exploration = exploreWorkflow(
      model,
      options.maxScenarios !== undefined
        ? { maxScenarios: options.maxScenarios }
        : undefined,
    );
    const findings = runChecks(
      { model, exploration },
      options.prerequisiteRules
        ? { prerequisiteRules: options.prerequisiteRules }
        : {},
    );
    checked.push({ file: file.path, model, exploration, findings });
  }

  const rendered =
    config.status === "ok"
      ? renderConfigMode(config, checked, format, options.json ?? false)
      : renderBuiltinMode(checked, files.length, format, options.json ?? false);

  return applyOutput(rendered, options.output);
}

/** Config-driven mode: evaluate user-declared invariants. */
function renderConfigMode(
  config: Extract<ConfigLoad, { status: "ok" }>,
  checked: CheckedWorkflow[],
  format: OutputFormat,
  legacyJson: boolean,
): CheckResult {
  const analyzed: AnalyzedWorkflow[] = checked
    .filter(
      (
        c,
      ): c is CheckedWorkflow &
        Required<Pick<CheckedWorkflow, "model" | "exploration">> =>
        c.model !== undefined && c.exploration !== undefined,
    )
    .map((c) => ({ file: c.file, model: c.model, exploration: c.exploration }));

  const evaluation = evaluateUserInvariants(config.config, analyzed);
  if (!evaluation.ok) {
    return {
      output: renderReferenceErrors(evaluation.referenceErrors),
      exitCode: 2,
      stream: "stderr",
    };
  }

  const results = evaluation.results;
  const anyRefuted = results.some((r) => r.verdict === "violated");
  const anyUnknown = results.some((r) => r.verdict === "unknown");
  const exitCode = anyRefuted ? 1 : anyUnknown ? 4 : 0;

  if (format === "json" || format === "sarif") {
    const models = new Map(analyzed.map((a) => [a.file, a.model]));
    const findings = findingsFromInvariants(results, models);
    const output =
      format === "json"
        ? renderJsonReport(findings)
        : renderSarif(findings, { toolVersion: pkg.version });
    return { output, exitCode };
  }

  // Legacy `--json` keeps the Phase 9 detailed shape; default is text.
  const output = legacyJson
    ? renderInvariantJson(config.path, results)
    : renderInvariantText(results);
  return { output, exitCode };
}

/** Config-free mode: the built-in checks (CP001/CP002/CP003). */
function renderBuiltinMode(
  checked: CheckedWorkflow[],
  discovered: number,
  format: OutputFormat,
  legacyJson: boolean,
): CheckResult {
  const anyViolation = checked.some((w) =>
    w.findings.some((f) => f.verdict === "violated"),
  );
  const parseFailures = checked
    .filter((w) => w.exploration === undefined)
    .map((w) => w.file);
  const exitCode = parseFailures.length > 0 ? 3 : anyViolation ? 1 : 0;

  if (format === "json" || format === "sarif") {
    const findings = findingsFromBuiltin(checked);
    const output =
      format === "json"
        ? renderJsonReport(findings, { parseFailures })
        : renderSarif(findings, { toolVersion: pkg.version, parseFailures });
    return { output, exitCode };
  }

  const output = legacyJson
    ? renderJson(checked)
    : renderText(checked, discovered);
  return { output, exitCode };
}

/** Write to a file when `--output` is set; otherwise return for stdout. */
function applyOutput(result: CheckResult, output?: string): CheckResult {
  if (output === undefined || result.stream === "stderr") {
    return result;
  }
  try {
    writeFileSync(output, result.output);
    return { output: "", exitCode: result.exitCode };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      output: `error: cannot write report to ${output}: ${message}\n`,
      exitCode: 2,
      stream: "stderr",
    };
  }
}

function reportable(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.verdict !== "not-violated");
}

function renderText(checked: CheckedWorkflow[], discovered: number): string {
  const lines: string[] = ["CIProof", ""];
  if (discovered === 0) {
    lines.push("No workflows found under .github/workflows.");
    return lines.join("\n") + "\n";
  }

  let errors = 0;
  let warnings = 0;
  let unknowns = 0;

  for (const { file, exploration, findings } of checked) {
    lines.push(file, "");
    if (!exploration) {
      lines.push("  No model (parse/validation errors).", "");
      continue;
    }

    lines.push("Analysis:");
    lines.push(`  ${exploration.scenariosEvaluated} scenarios`);
    lines.push(`  ${exploration.plans.length} execution plans`);
    lines.push(
      exploration.completeness === "complete-within-supported-model"
        ? "  complete within supported model"
        : "  partial",
    );
    lines.push("");

    const shown = reportable(findings);
    for (const finding of shown) {
      if (finding.verdict === "unknown") {
        unknowns++;
      } else if (finding.severity === "error") {
        errors++;
      } else if (finding.severity === "warning") {
        warnings++;
      }
    }

    if (shown.length === 0) {
      if (exploration.completeness === "complete-within-supported-model") {
        lines.push(
          `No violations found across ${exploration.scenariosEvaluated} modeled scenarios.`,
        );
      } else {
        lines.push("No violations found in explored scenarios.");
        lines.push("Analysis is PARTIAL.");
        renderLimitationList(lines, exploration);
      }
      lines.push("");
      continue;
    }

    lines.push("Findings:", "");
    for (const finding of shown) {
      renderFinding(lines, finding, exploration);
    }
  }

  lines.push("Summary:");
  lines.push(`  ${errors} error${errors === 1 ? "" : "s"}`);
  lines.push(`  ${warnings} warning${warnings === 1 ? "" : "s"}`);
  lines.push(`  ${unknowns} unknown finding${unknowns === 1 ? "" : "s"}`);
  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

function renderFinding(
  lines: string[],
  finding: Finding,
  exploration: ExplorationResult,
): void {
  lines.push(`${finding.id}  ${verdictLabel(finding)}`);
  lines.push(finding.message);
  lines.push("");

  if (finding.scenario) {
    const highlights =
      finding.id === "CP003"
        ? highlightForPrivilege(finding.scenario)
        : highlightForPrerequisite(finding.scenario);
    lines.push("Counterexample:");
    for (const h of highlights) {
      lines.push(`  ${h.label}: ${h.value}`);
    }
    lines.push("");

    const outcome = exploration.evaluations.find(
      (e) => e.scenario === finding.scenario,
    );
    if (outcome) {
      lines.push("Execution:");
      const width = Object.keys(outcome.jobs).reduce(
        (m, id) => Math.max(m, id.length),
        0,
      );
      for (const [id, state] of Object.entries(outcome.jobs)) {
        lines.push(
          `  ${id.padEnd(width)}  ${(state as JobExecution).toUpperCase()}`,
        );
      }
      lines.push("");
    }
  }

  for (const item of finding.evidence) {
    lines.push(`  ${symbol(item)} ${item.message}`);
  }
  for (const limitation of finding.limitations) {
    lines.push(`  Limitation: ${limitation.message}`);
  }
  lines.push("");
}

function renderLimitationList(
  lines: string[],
  exploration: ExplorationResult,
): void {
  const messages = [...new Set(exploration.limitations.map((l) => l.message))];
  if (messages.length > 0) {
    lines.push("Limitations:");
    for (const message of messages) {
      lines.push(`  - ${message}`);
    }
  }
}

function verdictLabel(finding: Finding): string {
  if (finding.verdict === "unknown") {
    return "UNKNOWN";
  }
  return finding.severity.toUpperCase();
}

function symbol(item: Evidence): string {
  switch (item.outcome) {
    case "pass":
      return "✓";
    case "fail":
      return "✗";
    case "unknown":
      return "?";
    default:
      return "•";
  }
}

function renderJson(checked: CheckedWorkflow[]): string {
  return JSON.stringify(
    {
      workflows: checked.map(({ file, exploration, findings }) => ({
        file,
        analysis: exploration
          ? {
              scenariosEvaluated: exploration.scenariosEvaluated,
              plans: exploration.plans.length,
              completeness: exploration.completeness,
              limitations: exploration.limitations,
            }
          : null,
        findings: reportable(findings).map((f) => ({
          id: f.id,
          title: f.title,
          verdict: f.verdict,
          severity: f.severity,
          message: f.message,
          jobId: f.jobId ?? null,
          scenario: f.scenario ?? null,
          evidence: f.evidence,
          limitations: f.limitations,
        })),
      })),
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Config-driven invariant rendering
// ---------------------------------------------------------------------------

/** Verdict symbol: refuted ✗, passed ✓, unknown ?. */
function invariantSymbol(verdict: InvariantResult["verdict"]): string {
  switch (verdict) {
    case "violated":
      return "✗";
    case "not-violated":
      return "✓";
    case "unknown":
      return "?";
  }
}

function renderInvariantText(results: InvariantResult[]): string {
  const lines: string[] = ["CIProof", ""];

  if (results.length === 0) {
    lines.push("No invariants declared.");
    return lines.join("\n") + "\n";
  }

  for (const result of results) {
    lines.push(`${invariantSymbol(result.verdict)} ${result.id}`);
  }
  lines.push("");

  const refuted = results.filter((r) => r.verdict === "violated").length;
  const passed = results.filter((r) => r.verdict === "not-violated").length;
  const unknown = results.filter((r) => r.verdict === "unknown").length;
  lines.push(`${refuted} refuted`);
  lines.push(`${passed} passed within modeled scenarios`);
  lines.push(`${unknown} unknown`);
  lines.push("");

  for (const result of results) {
    if (result.verdict === "not-violated") {
      continue;
    }
    lines.push(
      `${invariantSymbol(result.verdict)} ${result.id}  ${result.verdict === "violated" ? "REFUTED" : "UNKNOWN"}`,
    );
    if (result.description) {
      lines.push(`  ${result.description}`);
    }
    lines.push(`  ${result.message}`);
    if (result.workflow) {
      lines.push(`  workflow: ${result.workflow}`);
    }
    if (result.scenario) {
      lines.push("");
      lines.push("  Counterexample:");
      for (const h of highlightForReachability(result.scenario)) {
        lines.push(`    ${h.label}: ${h.value}`);
      }
      if (result.execution) {
        lines.push("  Execution:");
        const width = Object.keys(result.execution).reduce(
          (m, id) => Math.max(m, id.length),
          0,
        );
        for (const [id, state] of Object.entries(result.execution)) {
          lines.push(`    ${id.padEnd(width)}  ${state.toUpperCase()}`);
        }
      }
    }
    for (const reason of result.unknownReasons ?? []) {
      lines.push(`  reason: ${reason}`);
    }
    lines.push("");
  }

  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

function renderInvariantJson(
  configPath: string,
  results: InvariantResult[],
): string {
  return (
    JSON.stringify(
      {
        config: configPath,
        summary: {
          refuted: results.filter((r) => r.verdict === "violated").length,
          passed: results.filter((r) => r.verdict === "not-violated").length,
          unknown: results.filter((r) => r.verdict === "unknown").length,
        },
        invariants: results.map((r) => ({
          id: r.id,
          verdict: r.verdict,
          message: r.message,
          workflow: r.workflow ?? null,
          jobId: r.jobId ?? null,
          counterexample: r.scenario
            ? { scenario: r.scenario, execution: r.execution ?? null }
            : null,
          unknownReasons: r.unknownReasons ?? [],
        })),
      },
      null,
      2,
    ) + "\n"
  );
}

function renderConfigErrors(
  config: Extract<ConfigLoad, { status: "error" }>,
): string {
  const label = config.path ?? "ciproof.yml";
  const lines = ["CIProof", "", "Configuration error:"];
  for (const issue of config.issues as ConfigIssue[]) {
    lines.push(`  ${label}: ${issue.path}: ${issue.message}`);
  }
  return lines.join("\n") + "\n";
}

function renderReferenceErrors(errors: ReferenceError[]): string {
  const lines = ["CIProof", "", "Configuration error:"];
  for (const err of errors) {
    lines.push(`  invariant "${err.invariantId}": ${err.message}`);
  }
  return lines.join("\n") + "\n";
}
