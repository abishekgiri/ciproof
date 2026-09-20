import { describe, expect, it } from "vitest";
import { validateScenario, type Scenario } from "../../src/engine/index.js";

function scenario(over: Partial<Scenario>): Scenario {
  return {
    event: "push",
    fork: false,
    actorClass: "internal",
    changedFiles: [],
    inputs: {},
    ...over,
  };
}

describe("validateScenario", () => {
  it("accepts a consistent push scenario", () => {
    expect(
      validateScenario(scenario({ event: "push", branch: "main" })),
    ).toEqual([]);
  });

  it("flags inputs supplied for a non-dispatch event", () => {
    const diagnostics = validateScenario(
      scenario({ event: "push", inputs: { x: true } }),
    );
    expect(diagnostics.some((d) => d.message.includes("inputs"))).toBe(true);
  });

  it("flags fork/base/head on a push scenario", () => {
    const diagnostics = validateScenario(
      scenario({ event: "push", fork: true, baseRef: "main" }),
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("warns when a pull_request scenario has no base branch", () => {
    const diagnostics = validateScenario(scenario({ event: "pull_request" }));
    expect(diagnostics.some((d) => d.message.includes("baseRef"))).toBe(true);
  });
});
