/**
 * Presentation minimization for counterexamples.
 *
 * Shows only the scenario fields relevant to a finding. This never mutates the
 * actual Scenario object — it is display trimming, not symbolic minimization.
 */

import type { Scenario } from "../engine/index.js";

export interface ScenarioHighlight {
  label: string;
  value: string;
}

/** Relevant fields for a CP002 (prerequisite) counterexample. */
export function highlightForPrerequisite(
  scenario: Scenario,
): ScenarioHighlight[] {
  const out: ScenarioHighlight[] = [{ label: "event", value: scenario.event }];
  if (scenario.branch) {
    out.push({ label: "branch", value: scenario.branch });
  }
  for (const [key, value] of Object.entries(scenario.inputs)) {
    out.push({ label: `input.${key}`, value: String(value) });
  }
  return out;
}

/** Relevant fields for a CP003 (untrusted privilege) counterexample. */
export function highlightForPrivilege(scenario: Scenario): ScenarioHighlight[] {
  const out: ScenarioHighlight[] = [
    { label: "event", value: scenario.event },
    { label: "fork", value: String(scenario.fork) },
  ];
  if (scenario.baseRef) {
    out.push({ label: "base", value: scenario.baseRef });
  }
  return out;
}

/**
 * Relevant fields for a reachability counterexample (user invariants). Shows the
 * trigger context that made the job reachable: event, ref/trust, and inputs.
 */
export function highlightForReachability(
  scenario: Scenario,
): ScenarioHighlight[] {
  const out: ScenarioHighlight[] = [{ label: "event", value: scenario.event }];
  if (scenario.ref) {
    out.push({ label: "ref", value: scenario.ref });
  }
  if (scenario.branch && !scenario.ref) {
    out.push({ label: "branch", value: scenario.branch });
  }
  if (scenario.baseRef) {
    out.push({ label: "base", value: scenario.baseRef });
  }
  if (
    scenario.event === "pull_request" ||
    scenario.event === "pull_request_target"
  ) {
    out.push({ label: "fork", value: String(scenario.fork) });
  }
  for (const [key, value] of Object.entries(scenario.inputs)) {
    out.push({ label: `input.${key}`, value: String(value) });
  }
  return out;
}
