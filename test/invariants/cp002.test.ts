import { describe, expect, it } from "vitest";
import {
  checkPrerequisiteBypass,
  type PrerequisiteRule,
} from "../../src/invariants/index.js";
import { contextFor } from "./helpers.js";

function rule(target: string, required: string[]): PrerequisiteRule {
  return {
    name: `${target}-needs`,
    targetJob: target,
    requiredCompletedJobs: required,
  };
}

describe("CP002 — prerequisite bypass", () => {
  it("E. canonical skip_tests + always() -> violated with counterexample", async () => {
    const context = await contextFor("explore/canonical.yml");
    const [finding] = checkPrerequisiteBypass(context, [
      rule("deploy", ["test"]),
    ]);
    expect(finding?.verdict).toBe("violated");
    expect(finding?.scenario?.event).toBe("workflow_dispatch");
    expect(finding?.scenario?.inputs.skip_tests).toBe(true);
  });

  it("A. target run + prerequisite run -> not violated", async () => {
    const context = await contextFor("needs/chain-needs.yml");
    const [finding] = checkPrerequisiteBypass(context, [
      rule("deploy", ["test"]),
    ]);
    expect(finding?.verdict).toBe("not-violated");
  });

  it("C. target that never runs -> not violated", async () => {
    const context = await contextFor("invariants/unreachable.yml");
    const [finding] = checkPrerequisiteBypass(context, [
      rule("never", ["build"]),
    ]);
    expect(finding?.verdict).toBe("not-violated");
  });

  it("D. prerequisite UNKNOWN -> unknown", async () => {
    // notify (needs build, if !cancelled()) is UNKNOWN; make it the target's
    // prerequisite so completion cannot be determined.
    const context = await contextFor("conditions/not-cancelled.yml");
    const [finding] = checkPrerequisiteBypass(context, [
      rule("build", ["notify"]),
    ]);
    expect(finding?.verdict).toBe("unknown");
  });

  it("G. rule referencing a missing job -> configuration diagnostic", async () => {
    const context = await contextFor("needs/chain-needs.yml");
    const [finding] = checkPrerequisiteBypass(context, [
      rule("deploy", ["does-not-exist"]),
    ]);
    expect(finding?.verdict).toBe("unknown");
    expect(finding?.message).toContain("undefined job");
  });

  it("is deterministic in counterexample selection", async () => {
    const context = await contextFor("explore/canonical.yml");
    const a = checkPrerequisiteBypass(context, [rule("deploy", ["test"])]);
    const b = checkPrerequisiteBypass(context, [rule("deploy", ["test"])]);
    expect(JSON.stringify(a[0]?.scenario)).toBe(JSON.stringify(b[0]?.scenario));
  });
});
