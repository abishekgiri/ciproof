/**
 * Normalization: GitHub parser representation -> CIProof `WorkflowModel`.
 *
 * This is the ONLY place that unwraps GitHub's parsed document and converted
 * template. Everything it returns is a CIProof-owned model type; no parser
 * tokens or `@actions/*` types escape this module.
 *
 * Phase 1 scope: represent what the workflow declares. It does not evaluate
 * triggers, conditions, or reachability. It never executes workflow content.
 */

import {
  parseWorkflow,
  convertWorkflowTemplate,
  NoOperationTraceWriter,
  isMapping,
  isString,
  isBasicExpression,
} from "@actions/workflow-parser";
import type {
  WorkflowTemplate,
  WorkflowJob,
  InputConfig,
  BranchFilterConfig,
  PathFilterConfig,
} from "@actions/workflow-parser/model/workflow-template";
import type {
  TemplateToken,
  MappingToken,
} from "@actions/workflow-parser/templates/tokens/index";

import {
  ModelDiagnosticCode,
  UNSPECIFIED_PERMISSIONS,
  validateNeeds,
  type ConditionModel,
  type DispatchInputModel,
  type DispatchInputType,
  type JobModel,
  type ModelDiagnostic,
  type PermissionLevel,
  type PermissionModel,
  type TriggerModel,
  type UnsupportedConstruct,
  type WorkflowModel,
} from "../model/index.js";
import type { BranchPathFilters } from "../model/trigger.js";
import type { SourceLocation } from "../model/source.js";
import { describeError, validationErrorToDiagnostic } from "./diagnostics.js";
import { locationFromToken } from "./locations.js";
import { parseConditionExpression } from "./expressions.js";
import type { ParseDiagnostic, ParseWorkflowSourceInput } from "./types.js";

export interface WorkflowNormalizationResult {
  /** Present when a model could be built (valid parse; graph may still err). */
  model?: WorkflowModel;
  /** All diagnostics, parser and model, none swallowed. */
  diagnostics: ModelDiagnostic[];
}

/**
 * Parse and normalize a single workflow source into a CIProof `WorkflowModel`.
 *
 * - Parser failure (no document, or parser errors) -> no model + diagnostics.
 * - Valid workflow -> model (with any unsupported constructs marked).
 * - Converter/graph problems -> model plus diagnostics; never a crash.
 */
export async function normalizeWorkflow(
  input: ParseWorkflowSourceInput,
): Promise<WorkflowNormalizationResult> {
  const { filename } = input;
  const diagnostics: ModelDiagnostic[] = [];

  let parsed;
  try {
    parsed = parseWorkflow(
      { name: filename, content: input.content },
      new NoOperationTraceWriter(),
    );
  } catch (err) {
    diagnostics.push({
      code: ModelDiagnosticCode.NormalizeError,
      message: `internal parser error: ${describeError(err)}`,
      severity: "error",
    });
    return { diagnostics };
  }

  for (const error of parsed.context.errors.getErrors()) {
    diagnostics.push(
      parseDiagnosticToModel(filename, validationErrorToDiagnostic(error)),
    );
  }

  // A parse failure (missing document or any parser error) yields no model.
  if (parsed.value === undefined || parsed.context.errors.count > 0) {
    return { diagnostics };
  }

  let template: WorkflowTemplate;
  try {
    template = await convertWorkflowTemplate(parsed.context, parsed.value);
  } catch (err) {
    diagnostics.push({
      code: ModelDiagnosticCode.NormalizeError,
      message: `failed to convert workflow: ${describeError(err)}`,
      severity: "error",
    });
    return { diagnostics };
  }

  for (const convertError of template.errors ?? []) {
    diagnostics.push({
      code: ModelDiagnosticCode.ConvertError,
      message: convertError.Message,
      severity: "error",
    });
  }

  const root = isMapping(parsed.value) ? parsed.value : undefined;
  const model = buildModel(filename, template, root);

  diagnostics.push(...validateNeeds(model));

  return { model, diagnostics };
}

function buildModel(
  file: string,
  template: WorkflowTemplate,
  root: MappingToken | undefined,
): WorkflowModel {
  const unsupported: UnsupportedConstruct[] = [];
  const onToken = root ? findKey(root, "on") : undefined;

  const model: WorkflowModel = {
    file,
    triggers: buildTriggers(file, template, onToken, unsupported),
    permissions: buildPermissions(
      file,
      root ? findKey(root, "permissions") : undefined,
    ),
    jobs: buildJobs(file, template, root),
    unsupported,
  };

  const nameToken = root ? findKey(root, "name") : undefined;
  if (nameToken && isString(nameToken)) {
    model.name = nameToken.value;
  }

  const source = locationFromToken(file, root);
  if (source) {
    model.source = source;
  }

  if (root && findKey(root, "concurrency")) {
    unsupported.push({
      kind: "concurrency",
      message: "concurrency is not modeled by CIProof v0.1",
      ...withSource(locationFromToken(file, findKey(root, "concurrency"))),
    });
  }

  return model;
}

function buildTriggers(
  file: string,
  template: WorkflowTemplate,
  onToken: TemplateToken | undefined,
  unsupported: UnsupportedConstruct[],
): TriggerModel[] {
  const triggers: TriggerModel[] = [];

  for (const event of Object.keys(template.events)) {
    const source = eventSource(file, onToken, event);

    if (event === "push") {
      triggers.push({
        event: "push",
        filters: filtersOf(template.events.push),
        ...withSource(source),
      });
    } else if (event === "pull_request") {
      triggers.push({
        event: "pull_request",
        filters: filtersOf(template.events.pull_request),
        ...withSource(source),
      });
    } else if (event === "pull_request_target") {
      triggers.push({
        event: "pull_request_target",
        filters: filtersOf(template.events.pull_request_target),
        ...withSource(source),
      });
    } else if (event === "workflow_dispatch") {
      triggers.push({
        event: "workflow_dispatch",
        inputs: buildInputs(template.events.workflow_dispatch),
        ...withSource(source),
      });
    } else {
      unsupported.push({
        kind: "unsupported-trigger",
        message: `${event} trigger is not modeled by CIProof v0.1`,
        ...withSource(source),
      });
    }
  }

  return triggers;
}

function filtersOf(
  config: (BranchFilterConfig & PathFilterConfig) | undefined,
): BranchPathFilters {
  const filters: BranchPathFilters = {};
  if (!config) {
    return filters;
  }
  if (config.branches) {
    filters.branches = [...config.branches];
  }
  if (config["branches-ignore"]) {
    filters.branchesIgnore = [...config["branches-ignore"]];
  }
  if (config.paths) {
    filters.paths = [...config.paths];
  }
  if (config["paths-ignore"]) {
    filters.pathsIgnore = [...config["paths-ignore"]];
  }
  return filters;
}

function buildInputs(
  config: WorkflowTemplate["events"]["workflow_dispatch"],
): DispatchInputModel[] {
  const inputs: DispatchInputModel[] = [];
  const declared = config?.inputs;
  if (!declared) {
    return inputs;
  }

  for (const [name, raw] of Object.entries(declared)) {
    inputs.push(buildInput(name, raw));
  }
  return inputs;
}

function buildInput(name: string, raw: InputConfig): DispatchInputModel {
  const rawType = String(raw.type);
  const type: DispatchInputType =
    rawType === "boolean" || rawType === "choice" ? rawType : "unsupported";

  const input: DispatchInputModel = { name, type, rawType };
  if (raw.required !== undefined) {
    input.required = raw.required;
  }
  if (raw.default !== undefined) {
    input.default = raw.default;
  }
  if (raw.options) {
    input.options = [...raw.options];
  }
  if (raw.description !== undefined) {
    input.description = raw.description;
  }
  return input;
}

function buildJobs(
  file: string,
  template: WorkflowTemplate,
  root: MappingToken | undefined,
): Map<string, JobModel> {
  const jobs = new Map<string, JobModel>();
  const rawJobs = rawJobMap(root);

  for (const job of template.jobs) {
    const id = job.id.value;
    const rawJob = rawJobs.get(id);
    jobs.set(id, buildJob(file, job, rawJob));
  }

  return jobs;
}

function buildJob(
  file: string,
  job: WorkflowJob,
  rawJob: MappingToken | undefined,
): JobModel {
  const unsupported: UnsupportedConstruct[] = [];
  const source =
    locationFromToken(file, rawJob) ?? locationFromToken(file, job.id);

  const model: JobModel = {
    id: job.id.value,
    kind: job.type === "reusableWorkflowJob" ? "reusableWorkflowJob" : "job",
    needs: (job.needs ?? []).map((need) => need.value),
    permissions: buildPermissions(
      file,
      rawJob ? findKey(rawJob, "permissions") : undefined,
    ),
    unsupported,
  };

  if (source) {
    model.source = source;
  }

  if (job.name) {
    model.name = job.name.toString();
  }

  // Read `if` from the raw job mapping so we capture the user's LITERAL
  // expression. The converter rewrites it (e.g. prepending `success() &&`),
  // which is semantically meaningful for later phases but is not what the
  // author declared.
  const condition = buildCondition(
    file,
    rawJob ? findKey(rawJob, "if") : undefined,
  );
  if (condition) {
    model.condition = condition;
  }

  if (job.type === "job") {
    const environment = simpleEnvironment(job.environment);
    if (environment !== undefined) {
      model.environment = environment;
    } else if (job.environment) {
      unsupported.push({
        kind: "complex-environment",
        message: `environment for job "${job.id.value}" is not a simple name`,
      });
    }

    if (job.strategy) {
      unsupported.push({
        kind: "matrix-strategy",
        message: `matrix strategy in job "${job.id.value}" is not modeled by CIProof v0.1`,
      });
    }
    if (job.outputs) {
      unsupported.push({
        kind: "dynamic-outputs",
        message: `dynamic outputs in job "${job.id.value}" are not modeled by CIProof v0.1`,
      });
    }
  } else {
    unsupported.push({
      kind: "reusable-workflow-job",
      message: `job "${job.id.value}" calls a reusable workflow, which is not modeled by CIProof v0.1`,
    });
  }

  return model;
}

/**
 * Build a condition model from a job's raw `if` token.
 *
 * The token is present only when the workflow explicitly declares `if:`. When
 * absent, GitHub applies an implicit `success()` default; CIProof records the
 * absence rather than inventing that default here.
 */
function buildCondition(
  file: string,
  ifToken: TemplateToken | undefined,
): ConditionModel | undefined {
  if (!ifToken) {
    return undefined;
  }

  const raw = isBasicExpression(ifToken)
    ? ifToken.expression
    : ifToken.toString();
  const parsed = parseConditionExpression(raw);

  const condition: ConditionModel = {
    raw,
    parseState: parsed.state,
    references: parsed.references,
  };

  const source = isBasicExpression(ifToken)
    ? (locationFromToken(file, { range: ifToken.expressionRange }) ??
      locationFromToken(file, ifToken))
    : locationFromToken(file, ifToken);
  if (source) {
    condition.source = source;
  }

  return condition;
}

function buildPermissions(
  file: string,
  token: TemplateToken | undefined,
): PermissionModel {
  if (!token) {
    return UNSPECIFIED_PERMISSIONS;
  }

  const source = locationFromToken(file, token);

  if (isMapping(token)) {
    const scopes: Record<string, PermissionLevel> = {};
    for (const pair of token) {
      const level = toPermissionLevel(pair.value.toString());
      if (level) {
        scopes[pair.key.toString()] = level;
      }
    }
    return { mode: "explicit", scopes, ...withSource(source) };
  }

  if (isString(token)) {
    const value = token.value.trim();
    if (value === "read-all") {
      return { mode: "read-all", ...withSource(source) };
    }
    if (value === "write-all") {
      return { mode: "write-all", ...withSource(source) };
    }
  }

  // Declared but in a shape CIProof does not recognize: record it as an empty
  // explicit block rather than pretending nothing was declared.
  return { mode: "explicit", scopes: {}, ...withSource(source) };
}

function toPermissionLevel(value: string): PermissionLevel | undefined {
  const trimmed = value.trim();
  if (trimmed === "read" || trimmed === "write" || trimmed === "none") {
    return trimmed;
  }
  return undefined;
}

function simpleEnvironment(
  token: TemplateToken | undefined,
): string | undefined {
  return token && isString(token) ? token.value : undefined;
}

/** Build a map of job id -> raw job mapping token, for permission extraction. */
function rawJobMap(root: MappingToken | undefined): Map<string, MappingToken> {
  const map = new Map<string, MappingToken>();
  if (!root) {
    return map;
  }
  const jobsToken = findKey(root, "jobs");
  if (!jobsToken || !isMapping(jobsToken)) {
    return map;
  }
  for (const pair of jobsToken) {
    if (isMapping(pair.value)) {
      map.set(pair.key.toString(), pair.value);
    }
  }
  return map;
}

/** Find a value token by key within a mapping, or undefined. */
function findKey(
  mapping: MappingToken,
  key: string,
): TemplateToken | undefined {
  return mapping.find(key);
}

/** Best-effort source of a specific event within the `on:` declaration. */
function eventSource(
  file: string,
  onToken: TemplateToken | undefined,
  event: string,
): SourceLocation | undefined {
  if (!onToken) {
    return undefined;
  }
  if (isMapping(onToken)) {
    const eventToken = findKey(onToken, event);
    return (
      locationFromToken(file, eventToken) ?? locationFromToken(file, onToken)
    );
  }
  return locationFromToken(file, onToken);
}

/** Spread helper honoring exactOptionalPropertyTypes for optional `source`. */
function withSource(
  source: SourceLocation | undefined,
): { source: SourceLocation } | Record<string, never> {
  return source ? { source } : {};
}

function parseDiagnosticToModel(
  file: string,
  diagnostic: ParseDiagnostic,
): ModelDiagnostic {
  const model: ModelDiagnostic = {
    code:
      diagnostic.code ??
      (diagnostic.origin === "adapter"
        ? "CIPROOF_PARSER_CRASH"
        : "CIPROOF_PARSE_ERROR"),
    message: diagnostic.message,
    severity: "error",
  };
  if (diagnostic.range) {
    model.source = {
      file,
      start: diagnostic.range.start,
      ...withEnd(diagnostic.range.end),
    };
  }
  return model;
}

function withEnd(
  end: { line: number; column: number } | undefined,
): { end: { line: number; column: number } } | Record<string, never> {
  return end ? { end } : {};
}
