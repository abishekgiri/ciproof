/**
 * Deterministic, bounded scenario generation from derived domains.
 *
 * Generation is event-local (each event's Cartesian product uses only the
 * dimensions that apply to it), pruned through `validateScenario`, and capped by
 * `ExplorationLimits`. It never generates an impossible combination silently.
 */

import {
  validateScenario,
  type Scenario,
  type WorkflowRunContext,
} from "./scenario.js";
import type { EventDomain } from "./domains.js";
import type { ExplorationLimits } from "./limits.js";

export interface ScenarioGeneration {
  scenarios: Scenario[];
  generated: number;
  truncated: boolean;
}

/** Generate the bounded set of realizable scenarios for a workflow's domains. */
export function generateScenarios(
  domains: EventDomain[],
  limits: ExplorationLimits,
): ScenarioGeneration {
  const scenarios: Scenario[] = [];
  let generated = 0;
  let truncated = false;

  const push = (scenario: Scenario): boolean => {
    generated++;
    const problems = validateScenario(scenario);
    if (problems.some((p) => p.severity === "error")) {
      return true; // pruned, keep going
    }
    scenarios.push(scenario);
    if (scenarios.length >= limits.maxScenarios) {
      truncated = true;
      return false; // stop
    }
    return true;
  };

  outer: for (const domain of domains) {
    for (const scenario of scenariosForDomain(domain)) {
      if (!push(scenario)) {
        break outer;
      }
    }
  }

  return { scenarios, generated, truncated };
}

function* scenariosForDomain(domain: EventDomain): Generator<Scenario> {
  switch (domain.event) {
    case "push":
      for (const branch of domain.branches) {
        for (const changedFiles of domain.fileSets) {
          yield {
            event: "push",
            refKind: "branch",
            branch,
            ref: `refs/heads/${branch}`,
            fork: false,
            actorClass: "internal",
            changedFiles,
            inputs: {},
          };
        }
      }
      // Tag pushes: path filters do not apply, so no changed-file dimension.
      for (const tag of domain.tags) {
        yield {
          event: "push",
          refKind: "tag",
          ref: `refs/tags/${tag}`,
          fork: false,
          actorClass: "internal",
          changedFiles: [],
          inputs: {},
        };
      }
      return;
    case "workflow_dispatch":
      for (const branch of domain.branches) {
        for (const inputs of domain.inputCombos) {
          yield {
            event: "workflow_dispatch",
            branch,
            ref: `refs/heads/${branch}`,
            fork: false,
            actorClass: "internal",
            changedFiles: [],
            inputs,
          };
        }
      }
      return;
    case "pull_request":
    case "pull_request_target":
      for (const baseRef of domain.bases) {
        for (const headRef of domain.heads) {
          for (const fork of domain.forks) {
            for (const changedFiles of domain.fileSets) {
              yield {
                event: domain.event,
                baseRef,
                headRef,
                fork: fork.fork,
                actorClass: fork.actorClass,
                changedFiles,
                inputs: {},
              };
            }
          }
        }
      }
      return;
    case "schedule":
      for (const branch of domain.branches) {
        for (const cron of domain.schedules) {
          yield {
            event: "schedule",
            branch,
            ref: `refs/heads/${branch}`,
            fork: false,
            actorClass: "internal",
            changedFiles: [],
            inputs: {},
            schedule: cron,
          };
        }
      }
      return;
    case "workflow_run":
      for (const run of domain.workflowRuns) {
        yield {
          event: "workflow_run",
          branch: run.branch,
          ref: `refs/heads/${run.branch}`,
          fork: false,
          actorClass: "internal",
          changedFiles: [],
          inputs: {},
          workflowRun: {
            workflowName: run.workflowName,
            activity: run.activity,
            branch: run.branch,
            ...(run.conclusion !== undefined
              ? {
                  conclusion: run.conclusion as NonNullable<
                    WorkflowRunContext["conclusion"]
                  >,
                }
              : {}),
          },
        };
      }
      return;
  }
}
