/**
 * Bounded scenario explorer.
 *
 * Derives domains, generates realizable scenarios, evaluates each through the
 * authoritative Phase 2 evaluator, and collapses equal outcomes into distinct
 * execution plans. It discovers modeled behavior only — no invariants, no
 * counterexample search, no claims of safety.
 */

import type { WorkflowModel } from "../model/index.js";
import { evaluateWorkflowScenario } from "./evaluate.js";
import type { JobExecution, TriggerMatch } from "./evidence.js";
import type { Scenario } from "./scenario.js";
import { buildDomains, type AnalysisLimitation } from "./domains.js";
import { generateScenarios } from "./scenarios.js";
import { behaviorSignature } from "./signatures.js";
import { DEFAULT_LIMITS, type ExplorationLimits } from "./limits.js";

/** How many example scenarios to retain per plan (besides the count). */
const SAMPLE_CAP = 5;

export type Completeness = "complete-within-supported-model" | "partial";

export interface ExecutionPlan {
  signature: string;
  trigger: TriggerMatch;
  /** Job id -> execution state, keys sorted for stable output. */
  jobs: Record<string, JobExecution>;
  /** The canonical scenario for this plan (first generated). */
  representative: Scenario;
  /** A bounded sample of scenarios producing this plan. */
  scenarios: Scenario[];
  /** Total scenarios that produced this plan (may exceed the sample). */
  scenarioCount: number;
}

/**
 * The full outcome of one evaluated scenario. Unlike plans (which dedup by job
 * states only), evaluations retain every trust/event context, so
 * scenario-sensitive checks (e.g. CP003, which depends on fork/event) are never
 * blinded by deduplication.
 */
export interface ScenarioOutcome {
  scenario: Scenario;
  trigger: TriggerMatch;
  jobs: Record<string, JobExecution>;
}

export interface ExplorationResult {
  scenariosGenerated: number;
  scenariosEvaluated: number;
  plans: ExecutionPlan[];
  /** Every evaluated scenario with its outcome (authority for checks). */
  evaluations: ScenarioOutcome[];
  completeness: Completeness;
  limitations: AnalysisLimitation[];
  truncated: boolean;
}

/** Explore the modeled scenario space for one workflow. */
export function exploreWorkflow(
  model: WorkflowModel,
  limits: ExplorationLimits = DEFAULT_LIMITS,
): ExplorationResult {
  const { domains, limitations } = buildDomains(model);
  const { scenarios, generated, truncated } = generateScenarios(
    domains,
    limits,
  );

  const plansBySignature = new Map<string, ExecutionPlan>();
  const order: string[] = [];
  const evaluations: ScenarioOutcome[] = [];

  for (const scenario of scenarios) {
    const evaluation = evaluateWorkflowScenario(model, scenario);
    const signature = behaviorSignature(evaluation);

    const jobs: Record<string, JobExecution> = {};
    for (const id of [...evaluation.jobs.keys()].sort((a, b) =>
      a.localeCompare(b),
    )) {
      jobs[id] = evaluation.jobs.get(id)?.state ?? "unknown";
    }
    evaluations.push({ scenario, trigger: evaluation.trigger, jobs });

    const existing = plansBySignature.get(signature);
    if (existing) {
      existing.scenarioCount++;
      if (existing.scenarios.length < SAMPLE_CAP) {
        existing.scenarios.push(scenario);
      }
      continue;
    }

    plansBySignature.set(signature, {
      signature,
      trigger: evaluation.trigger,
      jobs,
      representative: scenario,
      scenarios: [scenario],
      scenarioCount: 1,
    });
    order.push(signature);
  }

  const plans = order.map((signature) => {
    const plan = plansBySignature.get(signature);
    if (!plan) {
      throw new Error(`missing plan for signature ${signature}`);
    }
    return plan;
  });

  const completeness = computeCompleteness(truncated, limitations, plans);

  return {
    scenariosGenerated: generated,
    scenariosEvaluated: scenarios.length,
    plans,
    evaluations,
    completeness,
    limitations,
    truncated,
  };
}

function computeCompleteness(
  truncated: boolean,
  limitations: AnalysisLimitation[],
  plans: ExecutionPlan[],
): Completeness {
  if (truncated || limitations.some((l) => !l.informational)) {
    return "partial";
  }
  const hasUnknown = plans.some(
    (plan) =>
      plan.trigger === "unknown" ||
      Object.values(plan.jobs).some((state) => state === "unknown"),
  );
  return hasUnknown ? "partial" : "complete-within-supported-model";
}
