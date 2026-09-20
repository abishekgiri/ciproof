/**
 * `ciproof check` — run the built-in invariant checks (CP001/CP002/CP003) over
 * each workflow's exploration result and report findings with concrete,
 * already-explored counterexamples. Never prints "safe".
 */

import { readFileSync } from "node:fs";
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
  type Finding,
  type PrerequisiteRule,
} from "./invariants/index.js";
import { normalizeWorkflow } from "./github/normalize.js";
import { discoverWorkflowFiles } from "./discovery.js";

export interface CheckCliOptions {
  root: string;
  workflow?: string;
  maxScenarios?: number;
  prerequisiteRules?: PrerequisiteRule[];
  json?: boolean;
}

export interface CheckResult {
  output: string;
  exitCode: number;
}

interface CheckedWorkflow {
  file: string;
  model?: WorkflowModel;
  exploration?: ExplorationResult;
  findings: Finding[];
}

export async function runCheck(options: CheckCliOptions): Promise<CheckResult> {
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
    const { model } = await normalizeWorkflow({ filename: file.path, content });
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

  const anyViolation = checked.some((w) =>
    w.findings.some((f) => f.verdict === "violated"),
  );
  const anyParseFailure = checked.some((w) => w.exploration === undefined);
  const exitCode = anyParseFailure ? 3 : anyViolation ? 1 : 0;

  const output = options.json
    ? renderJson(checked)
    : renderText(checked, files.length);
  return { output, exitCode };
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
