import { describe, expect, it } from "vitest";
import {
  parseConditionExpression,
  probeExpressionsRuntime,
} from "../../src/github/expressions.js";

describe("expressions adapter", () => {
  it("confirms @actions/expressions is installed and usable", () => {
    // Phase 0 only verifies the dependency is wired; no evaluation semantics.
    expect(probeExpressionsRuntime()).toBe(true);
  });
});

describe("parseConditionExpression", () => {
  it("R. parses valid expressions across supported shapes", () => {
    for (const raw of [
      "github.event_name == 'push'",
      "github.ref == 'refs/heads/main'",
      "inputs.skip_tests",
      "!inputs.skip_tests",
      "always()",
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
    ]) {
      expect(parseConditionExpression(raw).state, raw).toBe("valid");
    }
  });

  it("S. reports invalid syntax with an error message", () => {
    const trailing = parseConditionExpression("github.ref ==");
    expect(trailing.state).toBe("invalid");
    expect(trailing.error).toBeTruthy();

    expect(parseConditionExpression("&& foo").state).toBe("invalid");
  });

  it("extracts root identifiers (not property accessors)", () => {
    const result = parseConditionExpression("github.event_name == 'push'");
    expect(result.references).toEqual(["github"]);
  });

  it("includes function names among references", () => {
    expect(parseConditionExpression("always()").references).toContain("always");
  });
});
