import { describe, expect, it } from "vitest";
import {
  evaluateExpression,
  type ExpressionContext,
} from "../../src/github/expressions.js";

const base: ExpressionContext = {
  github: {
    event_name: "workflow_dispatch",
    ref: "refs/heads/main",
    base_ref: "",
    head_ref: "",
  },
  inputs: { skip_tests: true },
  unknownInputs: [],
  successValue: "true",
};

function truth(expr: string, over: Partial<ExpressionContext> = {}): string {
  return evaluateExpression(expr, { ...base, ...over }).truth;
}

describe("evaluateExpression (three-valued)", () => {
  it("evaluates modeled context and inputs faithfully", () => {
    expect(truth("!inputs.skip_tests")).toBe("false");
    expect(truth("inputs.skip_tests == false")).toBe("false");
    expect(truth("github.ref == 'refs/heads/main'")).toBe("true");
    expect(truth("github.event_name == 'push'")).toBe("false");
  });

  it("models always() and success()", () => {
    expect(truth("always()")).toBe("true");
    expect(truth("success()", { successValue: "false" })).toBe("false");
    expect(truth("success()", { successValue: "true" })).toBe("true");
  });

  it("returns unknown for unmodeled functions and contexts", () => {
    expect(truth("!cancelled()")).toBe("unknown");
    expect(truth("failure()")).toBe("unknown");
    expect(truth("github.actor == 'octocat'")).toBe("unknown");
  });

  it("returns unknown for an input with no known value", () => {
    expect(
      truth("inputs.skip_tests", { inputs: {}, unknownInputs: ["skip_tests"] }),
    ).toBe("unknown");
  });

  it("short-circuits three-valued composition", () => {
    expect(truth("false && failure()")).toBe("false");
    expect(truth("true || failure()")).toBe("true");
    expect(truth("true && failure()")).toBe("unknown");
  });

  it("applies GitHub string-truthiness (non-empty string is true)", () => {
    expect(truth("'false'")).toBe("true");
    expect(truth("''")).toBe("false");
  });

  it("returns unknown for an unparseable expression", () => {
    expect(truth("github.ref ==")).toBe("unknown");
  });
});
