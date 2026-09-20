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
  isNumber,
  isBoolean,
  isSequence,
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
  MAX_MATRIX_JOBS,
  expandMatrix,
  validateNeeds,
  type ConditionModel,
  type DispatchInputModel,
  type DispatchInputType,
  type JobModel,
  type MatrixModel,
  type MatrixValue,
  type ModelDiagnostic,
  type PermissionLevel,
  type PermissionModel,
  type ReusableWorkflowCall,
  type ReusableTarget,
  type ScheduleEntry,
  type TriggerModel,
  type UnsupportedConstruct,
  type WorkflowModel,
  type WorkflowRunActivity,
  type WorkflowCallInput,
  type WorkflowCallSecret,
  MAX_REUSABLE_DEPTH,
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

/** Reads a repo-relative workflow file's content (for local reusable calls). */
export interface WorkflowFileProvider {
  read(path: string): string | undefined;
}

export interface NormalizeOptions {
  /** Enables local reusable-workflow resolution when provided. */
  fileProvider?: WorkflowFileProvider;
}

interface ResolutionContext {
  provider: WorkflowFileProvider | undefined;
  depth: number;
  visiting: Set<string>;
  memo: Map<string, WorkflowModel | null>;
}

/**
 * Parse and normalize a single workflow source into a CIProof `WorkflowModel`.
 *
 * - Parser failure (no document, or parser errors) -> no model + diagnostics.
 * - Valid workflow -> model (with any unsupported constructs marked).
 * - Converter/graph problems -> model plus diagnostics; never a crash.
 *
 * When a `fileProvider` is supplied, local reusable-workflow calls
 * (`./.github/workflows/x.yml`) are resolved into nested models.
 */
export async function normalizeWorkflow(
  input: ParseWorkflowSourceInput,
  options: NormalizeOptions = {},
): Promise<WorkflowNormalizationResult> {
  return normalizeTree(input, {
    provider: options.fileProvider,
    depth: 0,
    visiting: new Set([input.filename]),
    memo: new Map(),
  });
}

async function normalizeTree(
  input: ParseWorkflowSourceInput,
  ctx: ResolutionContext,
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

  await resolveReusableCalls(model, ctx);

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
    } else if (event === "schedule") {
      triggers.push({
        event: "schedule",
        schedules: buildSchedules(template.events.schedule),
        ...withSource(source),
      });
    } else if (event === "workflow_run") {
      triggers.push({
        event: "workflow_run",
        ...buildWorkflowRun(template.events.workflow_run),
        ...withSource(source),
      });
    } else if (event === "workflow_call") {
      triggers.push({
        event: "workflow_call",
        ...buildWorkflowCall(template.events.workflow_call),
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
  const tagConfig = config as { tags?: string[]; "tags-ignore"?: string[] };
  if (tagConfig.tags) {
    filters.tags = [...tagConfig.tags];
  }
  if (tagConfig["tags-ignore"]) {
    filters.tagsIgnore = [...tagConfig["tags-ignore"]];
  }
  if (config.paths) {
    filters.paths = [...config.paths];
  }
  if (config["paths-ignore"]) {
    filters.pathsIgnore = [...config["paths-ignore"]];
  }
  return filters;
}

const WORKFLOW_RUN_ACTIVITIES = [
  "requested",
  "in_progress",
  "completed",
] as const;

function buildSchedules(
  config: WorkflowTemplate["events"]["schedule"],
): ScheduleEntry[] {
  const schedules: ScheduleEntry[] = [];
  for (const entry of config ?? []) {
    const schedule: ScheduleEntry = { cron: entry.cron };
    if (entry.timezone !== undefined) {
      schedule.timezone = entry.timezone;
    }
    schedules.push(schedule);
  }
  return schedules;
}

function buildWorkflowRun(config: WorkflowTemplate["events"]["workflow_run"]): {
  workflows: string[];
  types: WorkflowRunActivity[];
  branches?: string[];
  branchesIgnore?: string[];
} {
  const declaredTypes = (config?.types ?? []).filter(
    (t): t is WorkflowRunActivity =>
      (WORKFLOW_RUN_ACTIVITIES as readonly string[]).includes(t),
  );
  const result: {
    workflows: string[];
    types: WorkflowRunActivity[];
    branches?: string[];
    branchesIgnore?: string[];
  } = {
    workflows: [...(config?.workflows ?? [])],
    // When `types` is omitted, GitHub applies all documented activity types.
    types:
      declaredTypes.length > 0 ? declaredTypes : [...WORKFLOW_RUN_ACTIVITIES],
  };
  if (config?.branches) {
    result.branches = [...config.branches];
  }
  if (config?.["branches-ignore"]) {
    result.branchesIgnore = [...config["branches-ignore"]];
  }
  return result;
}

function buildWorkflowCall(
  config: WorkflowTemplate["events"]["workflow_call"],
): { inputs: WorkflowCallInput[]; secrets: WorkflowCallSecret[] } {
  const inputs: WorkflowCallInput[] = [];
  for (const [name, raw] of Object.entries(config?.inputs ?? {})) {
    const rawType = String(raw.type);
    const type: WorkflowCallInput["type"] =
      rawType === "boolean" || rawType === "number" ? rawType : "string";
    const input: WorkflowCallInput = { name, type };
    if (raw.required !== undefined) {
      input.required = raw.required;
    }
    if (raw.default !== undefined && typeof raw.default !== "object") {
      input.default = raw.default;
    }
    if (raw.description !== undefined) {
      input.description = raw.description;
    }
    inputs.push(input);
  }
  const secrets: WorkflowCallSecret[] = [];
  for (const [name, raw] of Object.entries(config?.secrets ?? {})) {
    const secret: WorkflowCallSecret = { name };
    if (raw?.required !== undefined) {
      secret.required = raw.required;
    }
    if (raw?.description !== undefined) {
      secret.description = raw.description;
    }
    secrets.push(secret);
  }
  return { inputs, secrets };
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

    if (rawJob) {
      const matrix = buildMatrix(rawJob);
      if (matrix) {
        model.matrix = matrix;
        if (matrix.kind === "dynamic") {
          unsupported.push({
            kind: "matrix-strategy",
            message: `dynamic matrix in job "${job.id.value}" is not modeled by CIProof v0.1`,
          });
        } else if (matrix.combinations.length > MAX_MATRIX_JOBS) {
          unsupported.push({
            kind: "matrix-size",
            message: `matrix in job "${job.id.value}" exceeds GitHub's ${MAX_MATRIX_JOBS}-job limit`,
          });
        }
      }
    }
    if (job.outputs) {
      unsupported.push({
        kind: "dynamic-outputs",
        message: `dynamic outputs in job "${job.id.value}" are not modeled by CIProof v0.1`,
      });
    }
  } else {
    const call = rawJob ? buildReusableCall(rawJob) : undefined;
    if (call) {
      model.reusableCall = call;
      if (call.target.kind === "external") {
        unsupported.push({
          kind: "external-reusable-workflow",
          message: `job "${job.id.value}" calls an external reusable workflow (${call.target.raw}), which is not modeled by CIProof v0.1`,
        });
      }
      // Local calls are resolved (and any limitation added) in a later pass.
    } else {
      unsupported.push({
        kind: "reusable-workflow-job",
        message: `job "${job.id.value}" calls a reusable workflow that could not be parsed`,
      });
    }
  }

  return model;
}

/**
 * Resolve local reusable-workflow calls into nested models (async pass, run
 * after the synchronous model build). External/missing/cyclic/too-deep targets
 * record a limitation; successful local resolution adds none (now supported).
 */
async function resolveReusableCalls(
  model: WorkflowModel,
  ctx: ResolutionContext,
): Promise<void> {
  for (const job of model.jobs.values()) {
    const call = job.reusableCall;
    if (!call || call.target.kind !== "local") {
      continue;
    }
    const path = call.target.path;

    if (!isSafeLocalPath(path)) {
      call.resolutionError = "invalid-path";
      job.unsupported.push({
        kind: "reusable-workflow-job",
        message: `reusable target "${path}" is outside .github/workflows`,
      });
      continue;
    }
    if (!ctx.provider) {
      job.unsupported.push({
        kind: "reusable-workflow-job",
        message: `local reusable workflow "${path}" not resolved (no file provider)`,
      });
      continue;
    }
    if (ctx.visiting.has(path)) {
      call.resolutionError = "cycle";
      job.unsupported.push({
        kind: "reusable-cycle",
        message: `reusable-workflow cycle detected at "${path}"`,
      });
      continue;
    }
    if (ctx.depth + 1 > MAX_REUSABLE_DEPTH) {
      call.resolutionError = "depth";
      job.unsupported.push({
        kind: "reusable-depth",
        message: `reusable-workflow nesting exceeds ${MAX_REUSABLE_DEPTH}`,
      });
      continue;
    }

    if (ctx.memo.has(path)) {
      const cached = ctx.memo.get(path);
      if (cached) {
        call.resolved = cached;
      } else {
        call.resolutionError = "unresolved";
        job.unsupported.push({
          kind: "reusable-missing",
          message: `local reusable workflow "${path}" could not be resolved`,
        });
      }
      continue;
    }

    const content = ctx.provider.read(path);
    if (content === undefined) {
      ctx.memo.set(path, null);
      call.resolutionError = "missing";
      job.unsupported.push({
        kind: "reusable-missing",
        message: `local reusable workflow "${path}" was not found`,
      });
      continue;
    }

    const result = await normalizeTree(
      { filename: path, content },
      {
        provider: ctx.provider,
        depth: ctx.depth + 1,
        visiting: new Set([...ctx.visiting, path]),
        memo: ctx.memo,
      },
    );
    if (result.model) {
      ctx.memo.set(path, result.model);
      call.resolved = result.model; // resolved local call is supported
    } else {
      ctx.memo.set(path, null);
      call.resolutionError = "parse";
      job.unsupported.push({
        kind: "reusable-workflow-job",
        message: `local reusable workflow "${path}" could not be parsed`,
      });
    }
  }
}

/** A local reusable target must stay within `.github/workflows` (no traversal). */
function isSafeLocalPath(path: string): boolean {
  return (
    path.startsWith(".github/workflows/") &&
    !path.includes("..") &&
    (path.endsWith(".yml") || path.endsWith(".yaml"))
  );
}

/** Parse a reusable-workflow call from the raw job mapping (`uses`/`with`/`secrets`). */
function buildReusableCall(
  rawJob: MappingToken,
): ReusableWorkflowCall | undefined {
  const usesToken = findKey(rawJob, "uses");
  if (!usesToken || !isString(usesToken)) {
    return undefined;
  }
  const uses = usesToken.value;
  const target: ReusableTarget = uses.startsWith("./")
    ? { kind: "local", path: uses.slice(2) }
    : { kind: "external", raw: uses };

  const withValues: Record<string, string | number | boolean> = {};
  const unresolvedInputs: string[] = [];
  const withToken = findKey(rawJob, "with");
  if (withToken && isMapping(withToken)) {
    for (const pair of withToken) {
      const name = pair.key.toString();
      const literal = readScalar(pair.value);
      if (literal === null) {
        unresolvedInputs.push(name);
      } else {
        withValues[name] = literal;
      }
    }
  }

  let secrets: ReusableWorkflowCall["secrets"] = { names: [] };
  const secretsToken = findKey(rawJob, "secrets");
  if (secretsToken) {
    if (isString(secretsToken) && secretsToken.value === "inherit") {
      secrets = "inherit";
    } else if (isMapping(secretsToken)) {
      const names: string[] = [];
      for (const pair of secretsToken) {
        names.push(pair.key.toString());
      }
      secrets = { names };
    }
  }

  return { target, with: withValues, unresolvedInputs, secrets };
}

/**
 * Parse a job's `strategy.matrix` into a MatrixModel. Static matrices (all
 * literal values) are fully modeled; anything expression-driven (`fromJSON`,
 * `needs` outputs, …) is marked dynamic and stays unsupported.
 */
function buildMatrix(rawJob: MappingToken): MatrixModel | undefined {
  const strategy = findKey(rawJob, "strategy");
  if (!strategy || !isMapping(strategy)) {
    return undefined;
  }
  const matrixToken = findKey(strategy, "matrix");
  if (!matrixToken) {
    return undefined; // strategy without a matrix (e.g. only fail-fast)
  }
  if (isBasicExpression(matrixToken) || !isMapping(matrixToken)) {
    return { kind: "dynamic", reason: "matrix is an expression" };
  }

  const dimensions: Record<string, MatrixValue[]> = {};
  const include: Record<string, MatrixValue>[] = [];
  const exclude: Record<string, MatrixValue>[] = [];

  for (const pair of matrixToken) {
    const key = pair.key.toString();
    if (key === "include" || key === "exclude") {
      const entries = readMatrixEntries(pair.value);
      if (entries === null) {
        return { kind: "dynamic", reason: `${key} contains an expression` };
      }
      (key === "include" ? include : exclude).push(...entries);
    } else {
      const values = readMatrixValues(pair.value);
      if (values === null) {
        return {
          kind: "dynamic",
          reason: `dimension "${key}" contains an expression`,
        };
      }
      dimensions[key] = values;
    }
  }

  return {
    kind: "static",
    dimensions,
    include,
    exclude,
    combinations: expandMatrix(dimensions, include, exclude),
  };
}

/** Read a matrix dimension's literal values, or null if not all literal. */
function readMatrixValues(token: TemplateToken): MatrixValue[] | null {
  if (!isSequence(token)) {
    return null;
  }
  const values: MatrixValue[] = [];
  for (const element of token) {
    const literal = readScalar(element);
    if (literal === null) {
      return null; // object-valued or expression element -> not static
    }
    values.push(literal);
  }
  return values;
}

/** Read include/exclude entries (list of literal objects), or null if dynamic. */
function readMatrixEntries(
  token: TemplateToken,
): Record<string, MatrixValue>[] | null {
  if (!isSequence(token)) {
    return null;
  }
  const entries: Record<string, MatrixValue>[] = [];
  for (const element of token) {
    if (!isMapping(element)) {
      return null;
    }
    const entry: Record<string, MatrixValue> = {};
    for (const pair of element) {
      const literal = readScalar(pair.value);
      if (literal === null) {
        return null;
      }
      entry[pair.key.toString()] = literal;
    }
    entries.push(entry);
  }
  return entries;
}

/** Read a literal scalar (string/number/boolean), or null otherwise. */
function readScalar(token: TemplateToken): MatrixValue | null {
  if (isString(token)) {
    return token.value;
  }
  if (isNumber(token)) {
    return token.value;
  }
  if (isBoolean(token)) {
    return token.value;
  }
  return null;
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
