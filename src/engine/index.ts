/**
 * Public entry point for CIProof's concrete scenario evaluator (Phase 2).
 *
 * Depends only on the normalized model (`src/model`) and the expression adapter
 * (`src/github/expressions`); no `@actions/workflow-parser` types leak in.
 * Evaluates ONE explicit scenario — no enumeration, invariants, or
 * counterexamples.
 */

export { evaluateWorkflowScenario } from "./evaluate.js";
export { validateScenario, type Scenario } from "./scenario.js";
export {
  evaluateTrigger,
  matchesFilterPattern,
  type TriggerEvaluation,
} from "./trigger.js";
export {
  evaluateEffectiveCondition,
  type EffectiveCondition,
} from "./condition.js";
export {
  successOfNeeds,
  orderJobs,
  type JobOrdering,
  type SuccessComputation,
} from "./needs.js";
export { buildEventContext, type EventContext } from "./context.js";
export {
  exploreWorkflow,
  type ExplorationResult,
  type ExecutionPlan,
  type ScenarioOutcome,
  type Completeness,
} from "./explorer.js";
export {
  buildDomains,
  type EventDomain,
  type AnalysisLimitation,
} from "./domains.js";
export { generateScenarios, type ScenarioGeneration } from "./scenarios.js";
export { behaviorSignature } from "./signatures.js";
export {
  classifyJobReachability,
  describeUnknownReason,
  type Reachability,
  type UnknownReason,
  type ReachabilityClassification,
} from "./reachability.js";
export {
  DEFAULT_LIMITS,
  DEFAULT_MAX_SCENARIOS,
  type ExplorationLimits,
} from "./limits.js";
export { isGlob, synthesizeWitness, synthesizeNonMatch } from "./witnesses.js";
export {
  evidence,
  type Evidence,
  type JobExecution,
  type JobResult,
  type TriggerMatch,
  type WorkflowEvaluation,
  type EvaluationDiagnostic,
  type Truth,
} from "./evidence.js";
