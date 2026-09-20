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
