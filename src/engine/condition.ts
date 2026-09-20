/**
 * Effective job-condition evaluation.
 *
 * Phase 1 discovered that GitHub adds an implicit `success()` gate: a job with
 * no `if` runs on `success()`, and an ordinary `if` becomes
 * `success() && (<declared>)`. When the declared `if` itself uses a status
 * function (`always()`, `success()`, `failure()`, `cancelled()`), GitHub does
 * NOT add the implicit `success()` — the declared expression stands alone.
 *
 * `ConditionModel.raw` is never modified; the effective semantics are computed
 * here at evaluation time.
 */

import type { JobModel } from "../model/index.js";
import { andTruth, type Truth } from "../model/truth.js";
import {
  evaluateExpression,
  type ExpressionContext,
} from "../github/expressions.js";
import type { EventContext } from "./context.js";
import { evidence, type Evidence } from "./evidence.js";

const STATUS_FUNCTIONS = new Set(["success", "always", "failure", "cancelled"]);

export interface EffectiveCondition {
  effective: Truth;
  evidence: Evidence[];
}

/**
 * Compute a job's effective condition truth for one scenario, given the value
 * of `success()` derived from its dependencies.
 */
export function evaluateEffectiveCondition(
  job: JobModel,
  context: EventContext,
  successValue: Truth,
): EffectiveCondition {
  const exprContext: ExpressionContext = {
    github: context.github,
    inputs: context.inputs,
    unknownInputs: context.unknownInputs,
    successValue,
  };

  if (!job.condition) {
    return {
      effective: successValue,
      evidence: [
        evidence(
          truthOutcome(successValue),
          `no explicit if; effective condition is success() -> ${successValue}`,
        ),
      ],
    };
  }

  const declared = evaluateExpression(job.condition.raw, exprContext);
  const usesStatusFunction = job.condition.references.some((ref) =>
    STATUS_FUNCTIONS.has(ref.toLowerCase()),
  );

  const ev: Evidence[] = [
    evidence(
      truthOutcome(declared.truth),
      `if: ${job.condition.raw} -> ${declared.truth}`,
      job.condition.source,
    ),
  ];

  if (usesStatusFunction) {
    // Declared condition uses a status function: no implicit success() gate.
    return { effective: declared.truth, evidence: ev };
  }

  ev.unshift(
    evidence(
      truthOutcome(successValue),
      `implicit success() -> ${successValue}`,
    ),
  );
  return {
    effective: andTruth([successValue, declared.truth]),
    evidence: ev,
  };
}

function truthOutcome(truth: Truth): Evidence["outcome"] {
  if (truth === "true") {
    return "pass";
  }
  return truth === "false" ? "fail" : "unknown";
}
