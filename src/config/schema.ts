/**
 * Schema and validation for `ciproof.yml`.
 *
 * Validates the user-facing YAML with zod (strict objects reject unknown keys,
 * so typos fail rather than being silently ignored), then lowers it into the
 * internal `Invariant` discriminated union. Produces structured issues with
 * dotted/bracketed paths so diagnostics can point at the offending field.
 *
 * This layer is pure: it takes an already-parsed plain object and returns either
 * a typed config or a list of issues. It never reads files or executes anything.
 */

import { z } from "zod";
import type { SupportedTriggerEvent } from "../model/index.js";
import {
  SUPPORTED_CONFIG_VERSION,
  type CiproofConfig,
  type Invariant,
  type JobRef,
  type RefKind,
  type TrustContext,
} from "./types.js";

export interface ConfigIssue {
  /** Dotted/bracketed path to the offending field, e.g. `invariants[2].id`. */
  path: string;
  message: string;
}

export type ConfigValidation =
  { ok: true; config: CiproofConfig } | { ok: false; issues: ConfigIssue[] };

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Events CIProof models, and therefore accepts in configuration. */
const EVENTS = [
  "push",
  "pull_request",
  "pull_request_target",
  "workflow_dispatch",
  "schedule",
  "workflow_run",
] as const satisfies readonly SupportedTriggerEvent[];

const eventEnum = z.enum(EVENTS);
const trustEnum = z.enum(["fork", "internal"]);
const refEnum = z.enum(["branch", "tag"]);

const jobRefSchema = z.union([
  z.string().min(1),
  z
    .object({
      workflow: z.string().min(1).optional(),
      id: z.string().min(1),
    })
    .strict(),
]);

/** A single value or a list of values, both accepted for allow-lists. */
function oneOrMany<T extends z.ZodTypeAny>(
  schema: T,
): z.ZodUnion<[T, z.ZodArray<T>]> {
  return z.union([schema, z.array(schema).min(1)]);
}

const requireSchema = z
  .object({
    "when-job-runs": jobRefSchema.optional(),
    "job-must-have-run": jobRefSchema.optional(),
    "job-not-reachable": z
      .object({
        job: jobRefSchema,
        trust: trustEnum.optional(),
        event: eventEnum.optional(),
      })
      .strict()
      .optional(),
    "job-only-reachable": z
      .object({
        job: jobRefSchema,
        event: oneOrMany(eventEnum).optional(),
        ref: oneOrMany(refEnum).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasRequiresParts =
      value["when-job-runs"] !== undefined ||
      value["job-must-have-run"] !== undefined;
    const forms = [
      hasRequiresParts,
      value["job-not-reachable"] !== undefined,
      value["job-only-reachable"] !== undefined,
    ].filter(Boolean).length;

    if (forms === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'unknown or missing invariant rule; expected one of "when-job-runs"+"job-must-have-run", "job-not-reachable", or "job-only-reachable"',
      });
      return;
    }
    if (forms > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "an invariant must declare exactly one rule",
      });
      return;
    }
    if (hasRequiresParts && value["when-job-runs"] === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["when-job-runs"],
        message: 'job-requires-job needs "when-job-runs"',
      });
    }
    if (hasRequiresParts && value["job-must-have-run"] === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["job-must-have-run"],
        message: 'job-requires-job needs "job-must-have-run"',
      });
    }
  });

const invariantSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(ID_PATTERN, "invariant id must match [a-zA-Z0-9][a-zA-Z0-9._-]*"),
    description: z.string().optional(),
    require: requireSchema,
  })
  .strict();

const configSchema = z
  .object({
    version: z
      .number({
        required_error: 'missing required "version"',
        invalid_type_error: '"version" must be a number',
      })
      .refine((v) => v === SUPPORTED_CONFIG_VERSION, {
        message: `unsupported config version; expected ${SUPPORTED_CONFIG_VERSION}`,
      }),
    invariants: z
      .array(invariantSchema)
      .min(1, "at least one invariant is required")
      .superRefine((invariants, ctx) => {
        const seen = new Map<string, number>();
        invariants.forEach((inv, index) => {
          const previous = seen.get(inv.id);
          if (previous !== undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, "id"],
              message: `duplicate invariant id "${inv.id}" (first defined at invariants[${previous}])`,
            });
          } else {
            seen.set(inv.id, index);
          }
        });
      }),
  })
  .strict();

type RawConfig = z.infer<typeof configSchema>;

/** Validate a parsed YAML object into a typed config, or return issues. */
export function validateConfig(parsed: unknown): ConfigValidation {
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, issues: toIssues(result.error) };
  }
  return { ok: true, config: lower(result.data) };
}

function lower(raw: RawConfig): CiproofConfig {
  return {
    version: raw.version,
    invariants: raw.invariants.map(lowerInvariant),
  };
}

function lowerInvariant(raw: RawConfig["invariants"][number]): Invariant {
  const base = {
    id: raw.id,
    ...(raw.description !== undefined ? { description: raw.description } : {}),
  };
  const require = raw.require;

  if (require["job-not-reachable"] !== undefined) {
    const rule = require["job-not-reachable"];
    return {
      kind: "job-not-reachable",
      ...base,
      job: lowerRef(rule.job),
      ...(rule.trust !== undefined
        ? { trust: rule.trust as TrustContext }
        : {}),
      ...(rule.event !== undefined
        ? { event: rule.event as SupportedTriggerEvent }
        : {}),
    };
  }
  if (require["job-only-reachable"] !== undefined) {
    const rule = require["job-only-reachable"];
    return {
      kind: "job-only-reachable",
      ...base,
      job: lowerRef(rule.job),
      events: toArray(rule.event) as SupportedTriggerEvent[],
      refs: toArray(rule.ref) as RefKind[],
    };
  }
  // job-requires-job (both parts validated present by the schema).
  return {
    kind: "job-requires-job",
    ...base,
    target: lowerRef(require["when-job-runs"]!),
    requires: lowerRef(require["job-must-have-run"]!),
  };
}

function lowerRef(
  ref: string | { workflow?: string | undefined; id: string },
): JobRef {
  if (typeof ref === "string") {
    return { id: ref };
  }
  return {
    ...(ref.workflow !== undefined ? { workflow: ref.workflow } : {}),
    id: ref.id,
  };
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function toIssues(error: z.ZodError): ConfigIssue[] {
  return error.issues
    .map((issue) => ({ path: formatPath(issue.path), message: issue.message }))
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) || a.message.localeCompare(b.message),
    );
}

function formatPath(path: (string | number)[]): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else {
      out += out.length === 0 ? segment : `.${segment}`;
    }
  }
  return out.length === 0 ? "(root)" : out;
}
