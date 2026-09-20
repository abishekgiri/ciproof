/**
 * `ciproof inspect` — the only product-facing Phase 1 command.
 *
 * Discovers workflows, normalizes each into a `WorkflowModel`, and prints what
 * the workflow DECLARES. It performs no reachability analysis, evaluates no
 * conditions, and executes nothing.
 */

import { readFileSync } from "node:fs";
import {
  getDependents,
  type JobModel,
  type ModelDiagnostic,
  type PermissionModel,
  type TriggerModel,
  type WorkflowModel,
} from "./model/index.js";
import {
  normalizeWorkflow,
  type WorkflowNormalizationResult,
} from "./github/normalize.js";
import { discoverWorkflowFiles } from "./discovery.js";
import { describeError } from "./github/diagnostics.js";

export interface InspectOptions {
  root: string;
  json?: boolean;
}

export interface InspectResult {
  output: string;
  exitCode: number;
}

interface InspectedWorkflow {
  file: string;
  result: WorkflowNormalizationResult;
}

/** Run inspection over all discovered workflows under `options.root`. */
export async function runInspect(
  options: InspectOptions,
): Promise<InspectResult> {
  const files = discoverWorkflowFiles(options.root);
  const inspected: InspectedWorkflow[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file.absolutePath, "utf8");
    } catch (err) {
      inspected.push({
        file: file.path,
        result: {
          diagnostics: [
            {
              code: "CIPROOF_READ_ERROR",
              message: `could not read file: ${describeError(err)}`,
              severity: "error",
            },
          ],
        },
      });
      continue;
    }
    const result = await normalizeWorkflow({ filename: file.path, content });
    inspected.push({ file: file.path, result });
  }

  // Exit 3 (parse/model error) if any discovered workflow yielded no model.
  const exitCode = inspected.some((w) => w.result.model === undefined) ? 3 : 0;

  const output = options.json
    ? renderJson(inspected)
    : renderText(inspected, files.length);

  return { output, exitCode };
}

function renderText(
  inspected: InspectedWorkflow[],
  discovered: number,
): string {
  const lines: string[] = ["CIProof", ""];

  if (discovered === 0) {
    lines.push("No workflows found under .github/workflows.");
    return lines.join("\n");
  }

  for (const { file, result } of inspected) {
    lines.push(file, "");
    if (result.model) {
      renderModel(lines, result.model);
    } else {
      lines.push("  No model (parse/validation errors).");
    }
    renderDiagnostics(lines, result.diagnostics);
    lines.push("", "No reachability analysis performed.", "");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function renderModel(lines: string[], model: WorkflowModel): void {
  lines.push(`Workflow: ${model.name ?? "(unnamed)"}`, "");

  lines.push("Triggers:");
  if (model.triggers.length === 0) {
    lines.push("  (none supported)");
  }
  for (const trigger of model.triggers) {
    renderTrigger(lines, trigger);
  }
  lines.push("");

  lines.push("Jobs:");
  if (model.jobs.size === 0) {
    lines.push("  (none)");
  }
  for (const job of model.jobs.values()) {
    renderJob(lines, job);
  }
  lines.push("");

  lines.push("Dependency graph:");
  const edges = dependencyEdges(model);
  if (edges.length === 0) {
    lines.push("  (no dependencies)");
  } else {
    for (const edge of edges) {
      lines.push(`  ${edge}`);
    }
  }
  lines.push("");

  lines.push("Unsupported by CIProof v0.1:");
  const unsupported = collectUnsupported(model);
  if (unsupported.length === 0) {
    lines.push("  none");
  } else {
    for (const item of unsupported) {
      lines.push(`  ${item}`);
    }
  }
}

function renderTrigger(lines: string[], trigger: TriggerModel): void {
  lines.push(`  ${trigger.event}`);
  if (trigger.event === "workflow_dispatch") {
    if (trigger.inputs.length > 0) {
      lines.push("    inputs:");
      for (const input of trigger.inputs) {
        const suffix = input.type === "unsupported" ? " (unsupported)" : "";
        const options =
          input.type === "choice" && input.options
            ? ` [${input.options.join(", ")}]`
            : "";
        lines.push(`      ${input.name}: ${input.rawType}${suffix}${options}`);
      }
    }
    return;
  }
  if (trigger.event === "schedule") {
    for (const entry of trigger.schedules) {
      lines.push(`    cron: ${entry.cron}`);
    }
    return;
  }
  if (trigger.event === "workflow_run") {
    lines.push(`    workflows: [${trigger.workflows.join(", ")}]`);
    lines.push(`    types: [${trigger.types.join(", ")}]`);
    if (trigger.branches) {
      lines.push(`    branches: [${trigger.branches.join(", ")}]`);
    }
    if (trigger.branchesIgnore) {
      lines.push(`    branches-ignore: [${trigger.branchesIgnore.join(", ")}]`);
    }
    return;
  }
  const { filters } = trigger;
  if (filters.branches) {
    lines.push(`    branches: [${filters.branches.join(", ")}]`);
  }
  if (filters.branchesIgnore) {
    lines.push(`    branches-ignore: [${filters.branchesIgnore.join(", ")}]`);
  }
  if (filters.paths) {
    lines.push(`    paths: [${filters.paths.join(", ")}]`);
  }
  if (filters.pathsIgnore) {
    lines.push(`    paths-ignore: [${filters.pathsIgnore.join(", ")}]`);
  }
}

function renderJob(lines: string[], job: JobModel): void {
  const kind = job.kind === "reusableWorkflowJob" ? " (reusable workflow)" : "";
  lines.push(`  ${job.id}${kind}`);
  lines.push(`    needs: [${job.needs.join(", ")}]`);

  if (job.condition) {
    const unparsed =
      job.condition.parseState === "invalid" ? " (unparseable)" : "";
    lines.push(`    if: ${job.condition.raw}${unparsed}`);
  } else {
    lines.push("    if: (default: success())");
  }

  renderPermissions(lines, job.permissions);
}

function renderPermissions(
  lines: string[],
  permissions: PermissionModel,
): void {
  if (permissions.mode === "explicit") {
    const scopes = permissions.scopes ?? {};
    const keys = Object.keys(scopes);
    if (keys.length === 0) {
      lines.push("    permissions: {} (all none)");
      return;
    }
    lines.push("    permissions:");
    for (const scope of keys) {
      lines.push(`      ${scope}: ${scopes[scope]}`);
    }
    return;
  }
  lines.push(`    permissions: ${permissions.mode}`);
}

function renderDiagnostics(
  lines: string[],
  diagnostics: ModelDiagnostic[],
): void {
  if (diagnostics.length === 0) {
    return;
  }
  lines.push("", "Diagnostics:");
  for (const diagnostic of diagnostics) {
    const at = diagnostic.source
      ? ` (line ${diagnostic.source.start.line})`
      : "";
    lines.push(`  [${diagnostic.code}] ${diagnostic.message}${at}`);
  }
}

function dependencyEdges(model: WorkflowModel): string[] {
  const edges: string[] = [];
  for (const [id] of model.jobs) {
    for (const dependent of getDependents(model, id)) {
      edges.push(`${id} -> ${dependent}`);
    }
  }
  return edges;
}

function collectUnsupported(model: WorkflowModel): string[] {
  const items = model.unsupported.map((u) => u.message);
  for (const job of model.jobs.values()) {
    for (const u of job.unsupported) {
      items.push(u.message);
    }
  }
  return items;
}

function renderJson(inspected: InspectedWorkflow[]): string {
  const workflows = inspected.map(({ file, result }) => ({
    file,
    model: result.model ? modelToJson(result.model) : null,
    diagnostics: result.diagnostics,
  }));
  return JSON.stringify({ workflows }, null, 2);
}

function modelToJson(model: WorkflowModel): unknown {
  return {
    file: model.file,
    name: model.name ?? null,
    triggers: model.triggers,
    jobs: Object.fromEntries(model.jobs),
    unsupported: model.unsupported,
    source: model.source ?? null,
  };
}
