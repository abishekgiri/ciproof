/**
 * Event-specific context builders.
 *
 * Each supported event produces its own `github.*` values and `inputs`
 * resolution. GitHub's semantics differ by event — notably `github.ref`,
 * `base_ref`/`head_ref`, and where `inputs` exist — so there is no single
 * universal context.
 */

import type { WorkflowDispatchTrigger, WorkflowModel } from "../model/index.js";
import type { ExpressionGithubContext } from "../github/expressions.js";
import type { Scenario } from "./scenario.js";

export interface EventContext {
  github: ExpressionGithubContext;
  /** Resolved input values with a known value. */
  inputs: Record<string, boolean | string>;
  /** Declared inputs whose value is unknown in this scenario. */
  unknownInputs: string[];
}

/** Build the concrete context for a scenario, per event semantics. */
export function buildEventContext(
  model: WorkflowModel,
  scenario: Scenario,
): EventContext {
  const github = buildGithub(scenario);
  const { inputs, unknownInputs } = resolveInputs(model, scenario);
  return { github, inputs, unknownInputs };
}

function buildGithub(scenario: Scenario): ExpressionGithubContext {
  const branchRef = scenario.ref ?? refFromBranch(scenario.branch);

  switch (scenario.event) {
    case "push":
      // push: ref is the pushed branch; base/head refs are empty.
      return {
        event_name: "push",
        ref: branchRef ?? "",
        base_ref: "",
        head_ref: "",
      };
    case "workflow_dispatch":
      // workflow_dispatch: runs on a branch/tag; base/head refs are empty.
      return {
        event_name: "workflow_dispatch",
        ref: branchRef ?? "",
        base_ref: "",
        head_ref: "",
      };
    case "pull_request":
      // pull_request: ref is the merge ref; base/head name the PR branches.
      return {
        event_name: "pull_request",
        ref: scenario.ref ?? "refs/pull/0/merge",
        base_ref: scenario.baseRef ?? "",
        head_ref: scenario.headRef ?? "",
      };
    case "pull_request_target":
      // pull_request_target: runs in the base repo; ref is the base branch.
      return {
        event_name: "pull_request_target",
        ref: scenario.baseRef
          ? `refs/heads/${scenario.baseRef}`
          : (scenario.ref ?? ""),
        base_ref: scenario.baseRef ?? "",
        head_ref: scenario.headRef ?? "",
      };
  }
}

function resolveInputs(
  model: WorkflowModel,
  scenario: Scenario,
): { inputs: Record<string, boolean | string>; unknownInputs: string[] } {
  const inputs: Record<string, boolean | string> = {};
  const unknownInputs: string[] = [];

  if (scenario.event !== "workflow_dispatch") {
    // Inputs only exist for workflow_dispatch; supplied values are passed
    // through so an inconsistent scenario is still evaluable and diagnosable.
    return { inputs: { ...scenario.inputs }, unknownInputs };
  }

  const dispatch = model.triggers.find(
    (t): t is WorkflowDispatchTrigger => t.event === "workflow_dispatch",
  );

  for (const declared of dispatch?.inputs ?? []) {
    const supplied = scenario.inputs[declared.name];
    if (supplied !== undefined) {
      inputs[declared.name] = coerceInput(supplied, declared.type);
    } else if (declared.default !== undefined) {
      inputs[declared.name] = coerceInput(declared.default, declared.type);
    } else {
      unknownInputs.push(declared.name);
    }
  }

  // Any supplied input not declared is still made available (GitHub-lenient).
  for (const [name, value] of Object.entries(scenario.inputs)) {
    if (!(name in inputs) && !unknownInputs.includes(name)) {
      inputs[name] = value;
    }
  }

  return { inputs, unknownInputs };
}

function coerceInput(
  value: boolean | string | number,
  type: string,
): boolean | string {
  if (type === "boolean") {
    if (typeof value === "boolean") {
      return value;
    }
    return String(value) === "true";
  }
  return typeof value === "boolean" ? String(value) : String(value);
}

function refFromBranch(branch: string | undefined): string | undefined {
  return branch ? `refs/heads/${branch}` : undefined;
}
