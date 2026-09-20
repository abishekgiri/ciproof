/**
 * `ciproof paths` — explore the modeled scenario space of each workflow and
 * report the distinct execution plans. No invariants, no counterexamples.
 */

import { readFileSync } from "node:fs";
import type { WorkflowModel } from "./model/index.js";
import {
  exploreWorkflow,
  DEFAULT_MAX_SCENARIOS,
  type ExecutionPlan,
  type ExplorationResult,
  type Scenario,
} from "./engine/index.js";
import { normalizeWorkflow } from "./github/normalize.js";
import { discoverWorkflowFiles, createFileProvider } from "./discovery.js";

export interface PathsOptions {
  root: string;
  /** Optional substring to select a single workflow file. */
  workflow?: string;
  maxScenarios?: number;
  json?: boolean;
}

export interface PathsResult {
  output: string;
  exitCode: number;
}

interface ExploredWorkflow {
  file: string;
  model?: WorkflowModel;
  result?: ExplorationResult;
}

export async function runPaths(options: PathsOptions): Promise<PathsResult> {
  const maxScenarios = options.maxScenarios ?? DEFAULT_MAX_SCENARIOS;
  let files = discoverWorkflowFiles(options.root);
  if (options.workflow) {
    files = files.filter((f) => f.path.includes(options.workflow as string));
  }

  const explored: ExploredWorkflow[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file.absolutePath, "utf8");
    } catch {
      explored.push({ file: file.path });
      continue;
    }
    const { model } = await normalizeWorkflow(
      { filename: file.path, content },
      { fileProvider: createFileProvider(options.root) },
    );
    if (!model) {
      explored.push({ file: file.path });
      continue;
    }
    explored.push({
      file: file.path,
      model,
      result: exploreWorkflow(model, { maxScenarios }),
    });
  }

  const exitCode = explored.some((w) => w.result === undefined) ? 3 : 0;
  const output = options.json
    ? renderJson(explored)
    : renderText(explored, files.length, maxScenarios);
  return { output, exitCode };
}

function renderText(
  explored: ExploredWorkflow[],
  discovered: number,
  maxScenarios: number,
): string {
  const lines: string[] = ["CIProof", ""];

  if (discovered === 0) {
    lines.push("No workflows found under .github/workflows.");
    return lines.join("\n") + "\n";
  }

  for (const { file, model, result } of explored) {
    lines.push(file, "");
    if (!result) {
      lines.push("  No model (parse/validation errors).", "");
      continue;
    }
    const jobOrder = model ? [...model.jobs.keys()] : [];

    lines.push("Modeled scenario space:");
    lines.push(`  generated: ${result.scenariosGenerated}`);
    lines.push(`  evaluated: ${result.scenariosEvaluated}`);
    lines.push(`  distinct plans: ${result.plans.length}`);
    lines.push("");

    lines.push("Analysis:");
    if (result.completeness === "complete-within-supported-model") {
      lines.push("  complete within supported model");
    } else {
      lines.push("  partial");
      for (const reason of uniqueLimitations(result)) {
        lines.push(`    - ${reason}`);
      }
    }
    if (result.truncated) {
      lines.push(
        `  Analysis truncated after ${maxScenarios} scenarios. Results are partial.`,
      );
    }
    const notes = [
      ...new Set(
        result.limitations.filter((l) => l.informational).map((l) => l.message),
      ),
    ];
    if (notes.length > 0) {
      lines.push("  Notes (do not affect reachability):");
      for (const note of notes) {
        lines.push(`    - ${note}`);
      }
    }
    lines.push("");

    result.plans.forEach((plan, index) => {
      renderPlan(lines, plan, index + 1, jobOrder);
    });
  }

  lines.push("No invariants checked.");
  lines.push("No counterexamples searched.");
  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

function renderPlan(
  lines: string[],
  plan: ExecutionPlan,
  index: number,
  jobOrder: string[],
): void {
  lines.push(`PLAN ${index}`, "");
  lines.push("Representative:");
  renderScenario(lines, plan.representative);
  lines.push("");

  if (plan.trigger === "matched") {
    lines.push("Jobs:");
    const ids = jobOrder.filter((id) => id in plan.jobs);
    if (ids.length === 0) {
      lines.push("  (no jobs)");
    }
    const width = ids.reduce((max, id) => Math.max(max, id.length), 0);
    for (const id of ids) {
      lines.push(`  ${id.padEnd(width)}  ${plan.jobs[id]?.toUpperCase()}`);
    }
  } else {
    lines.push(
      `Trigger:  ${plan.trigger === "unknown" ? "UNKNOWN" : "NOT MATCHED"}`,
    );
  }
  lines.push("");
  lines.push(`Equivalent scenarios:  ${plan.scenarioCount}`);
  lines.push("");
}

function renderScenario(lines: string[], scenario: Scenario): void {
  lines.push(`  event: ${scenario.event}`);
  if (scenario.branch) {
    lines.push(`  branch: ${scenario.branch}`);
  }
  if (scenario.baseRef) {
    lines.push(`  base: ${scenario.baseRef}`);
  }
  if (scenario.headRef) {
    lines.push(`  head: ${scenario.headRef}`);
  }
  if (
    scenario.event === "pull_request" ||
    scenario.event === "pull_request_target"
  ) {
    lines.push(`  fork: ${scenario.fork}`);
  }
  for (const [key, value] of Object.entries(scenario.inputs)) {
    lines.push(`  input.${key}: ${value}`);
  }
  if (scenario.changedFiles.length > 0) {
    lines.push("  changedFiles:");
    for (const file of scenario.changedFiles) {
      lines.push(`    - ${file}`);
    }
  }
}

function uniqueLimitations(result: ExplorationResult): string[] {
  const messages = result.limitations
    .filter((l) => !l.informational)
    .map((l) => l.message);
  const hasUnknownPlan = result.plans.some(
    (plan) =>
      plan.trigger === "unknown" ||
      Object.values(plan.jobs).some((s) => s === "unknown"),
  );
  if (hasUnknownPlan) {
    messages.push(
      "some plans depend on values CIProof does not model (UNKNOWN)",
    );
  }
  return [...new Set(messages)];
}

function renderJson(explored: ExploredWorkflow[]): string {
  return JSON.stringify(
    {
      workflows: explored.map(({ file, result }) => ({
        file,
        analysis: result
          ? {
              scenariosGenerated: result.scenariosGenerated,
              scenariosEvaluated: result.scenariosEvaluated,
              truncated: result.truncated,
              completeness: result.completeness,
              limitations: result.limitations,
              plans: result.plans.map((plan) => ({
                signature: plan.signature,
                trigger: plan.trigger,
                jobs: plan.jobs,
                scenarioCount: plan.scenarioCount,
                representative: plan.representative,
              })),
            }
          : null,
      })),
    },
    null,
    2,
  );
}
