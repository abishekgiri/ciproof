/**
 * `ciproof explain <job>` — evaluate ONE concrete scenario and explain why a
 * job runs, skips, or is unknown. No reachability search; one scenario only.
 */

import { readFileSync } from "node:fs";
import {
  type SupportedTriggerEvent,
  type WorkflowModel,
} from "./model/index.js";
import {
  evaluateWorkflowScenario,
  type Evidence,
  type JobResult,
  type Scenario,
  type WorkflowEvaluation,
} from "./engine/index.js";
import { normalizeWorkflow } from "./github/normalize.js";
import { discoverWorkflowFiles } from "./discovery.js";

export interface ExplainOptions {
  root: string;
  job: string;
  event: SupportedTriggerEvent;
  ref?: string;
  branch?: string;
  baseRef?: string;
  headRef?: string;
  fork: boolean;
  changedFiles: string[];
  inputs: Record<string, boolean | string>;
  json?: boolean;
}

export interface ExplainResult {
  output: string;
  exitCode: number;
}

/** Evaluate the requested job in every workflow that declares it. */
export async function runExplain(
  options: ExplainOptions,
): Promise<ExplainResult> {
  const scenario = toScenario(options);
  const files = discoverWorkflowFiles(options.root);

  const matches: { model: WorkflowModel; evaluation: WorkflowEvaluation }[] =
    [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file.absolutePath, "utf8");
    } catch {
      continue;
    }
    const { model } = await normalizeWorkflow({ filename: file.path, content });
    if (model && model.jobs.has(options.job)) {
      matches.push({
        model,
        evaluation: evaluateWorkflowScenario(model, scenario),
      });
    }
  }

  if (matches.length === 0) {
    return {
      output: `CIProof\n\nNo workflow defines a job named "${options.job}".\n`,
      exitCode: 2,
    };
  }

  const output = options.json
    ? renderJson(options, matches)
    : renderText(options, scenario, matches);

  return { output, exitCode: 0 };
}

function toScenario(options: ExplainOptions): Scenario {
  const scenario: Scenario = {
    event: options.event,
    fork: options.fork,
    actorClass: options.fork ? "external" : "internal",
    changedFiles: options.changedFiles,
    inputs: options.inputs,
  };
  if (options.ref !== undefined) {
    scenario.ref = options.ref;
  }
  if (options.branch !== undefined) {
    scenario.branch = options.branch;
  }
  if (options.baseRef !== undefined) {
    scenario.baseRef = options.baseRef;
  }
  if (options.headRef !== undefined) {
    scenario.headRef = options.headRef;
  }
  return scenario;
}

function renderText(
  options: ExplainOptions,
  scenario: Scenario,
  matches: { model: WorkflowModel; evaluation: WorkflowEvaluation }[],
): string {
  const lines: string[] = ["CIProof", ""];

  for (const { model, evaluation } of matches) {
    lines.push(model.file, "");
    lines.push("Scenario:");
    lines.push(`  event: ${scenario.event}`);
    if (scenario.branch) {
      lines.push(`  branch: ${scenario.branch}`);
    }
    if (scenario.baseRef) {
      lines.push(`  base_ref: ${scenario.baseRef}`);
    }
    if (scenario.headRef) {
      lines.push(`  head_ref: ${scenario.headRef}`);
    }
    if (scenario.changedFiles.length > 0) {
      lines.push(`  changed_files: [${scenario.changedFiles.join(", ")}]`);
    }
    if (Object.keys(scenario.inputs).length > 0) {
      lines.push("  inputs:");
      for (const [key, value] of Object.entries(scenario.inputs)) {
        lines.push(`    ${key}: ${value}`);
      }
    }
    lines.push("");
    lines.push(`Trigger: ${evaluation.trigger}`);
    lines.push("");

    for (const id of chainFor(options.job, model)) {
      const result = evaluation.jobs.get(id);
      if (result) {
        renderJobResult(lines, result);
      }
    }
  }

  lines.push("One concrete scenario evaluated.");
  lines.push("No reachability search performed.");
  return lines.join("\n").trimEnd() + "\n";
}

function renderJobResult(lines: string[], result: JobResult): void {
  lines.push(result.jobId);
  lines.push(`  ${result.state.toUpperCase()}`);
  for (const item of result.evidence) {
    lines.push(`  ${symbol(item)} ${item.message}`);
  }
  lines.push("");
}

function symbol(item: Evidence): string {
  switch (item.outcome) {
    case "pass":
      return "✓"; // ✓
    case "fail":
      return "✗"; // ✗
    case "unknown":
      return "?";
    default:
      return "•"; // •
  }
}

/** The target job preceded by its transitive dependencies, in model order. */
function chainFor(job: string, model: WorkflowModel): string[] {
  const wanted = new Set<string>();
  const visit = (id: string): void => {
    if (wanted.has(id)) {
      return;
    }
    wanted.add(id);
    for (const need of model.jobs.get(id)?.needs ?? []) {
      if (model.jobs.has(need)) {
        visit(need);
      }
    }
  };
  visit(job);
  return [...model.jobs.keys()].filter((id) => wanted.has(id));
}

function renderJson(
  options: ExplainOptions,
  matches: { model: WorkflowModel; evaluation: WorkflowEvaluation }[],
): string {
  return JSON.stringify(
    {
      job: options.job,
      workflows: matches.map(({ model, evaluation }) => ({
        file: model.file,
        trigger: evaluation.trigger,
        jobs: Object.fromEntries(
          [...evaluation.jobs].map(([id, r]) => [
            id,
            { state: r.state, evidence: r.evidence },
          ]),
        ),
      })),
    },
    null,
    2,
  );
}
