/**
 * Bounded-exploration limits. The state space (especially many
 * workflow_dispatch inputs) can explode, so exploration is always capped and
 * reports truncation loudly rather than silently stopping.
 */

export interface ExplorationLimits {
  /** Maximum number of scenarios evaluated before truncating. */
  maxScenarios: number;
}

export const DEFAULT_MAX_SCENARIOS = 10_000;

export const DEFAULT_LIMITS: ExplorationLimits = {
  maxScenarios: DEFAULT_MAX_SCENARIOS,
};
