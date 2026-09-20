import { describe, expect, it } from "vitest";
import { parseWorkflowSource } from "../../src/github/parser.js";
import { readFixture } from "../helpers/fixtures.js";

/**
 * Phase 0 parser-adapter tests.
 *
 * The question under test is NOT "are CIProof semantics correct?" (that comes
 * later). It is: "can CIProof reliably load GitHub workflow files and expose
 * parser diagnostics without crashing?"
 */
describe("parseWorkflowSource", () => {
  it("A. parses a simple push workflow with no diagnostics", () => {
    const result = parseWorkflowSource(readFixture("triggers/push.yml"));
    expect(result.ok).toBe(true);
    expect(result.hasDocument).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.document).toBeDefined();
  });

  it("B. parses a simple pull_request workflow", () => {
    const result = parseWorkflowSource(
      readFixture("triggers/pull-request.yml"),
    );
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("C. parses workflow_dispatch with a boolean input", () => {
    const result = parseWorkflowSource(
      readFixture("triggers/workflow-dispatch.yml"),
    );
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("D. parses a workflow with jobs and needs", () => {
    const result = parseWorkflowSource(readFixture("needs/simple-needs.yml"));
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("E. parses a workflow using jobs.<id>.if", () => {
    const result = parseWorkflowSource(
      readFixture("conditions/event-name.yml"),
    );
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("F. parses a workflow using pull_request_target", () => {
    const result = parseWorkflowSource(
      readFixture("triggers/pull-request-target.yml"),
    );
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("G. reports a diagnostic for malformed YAML and does not crash", () => {
    const result = parseWorkflowSource(
      readFixture("invalid/malformed-yaml.yml"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    const [first] = result.diagnostics;
    expect(first?.origin).toBe("parser");
    // Malformed YAML carries a source range.
    expect(first?.range).toBeDefined();
    expect(first?.range?.start.line).toBeGreaterThan(0);
  });

  it("H. reports diagnostics for valid YAML with invalid workflow structure", () => {
    const result = parseWorkflowSource(
      readFixture("invalid/invalid-structure.yml"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.every((d) => d.origin === "parser")).toBe(true);
  });

  it("I. handles an empty workflow without crashing", () => {
    const result = parseWorkflowSource(readFixture("invalid/empty.yml"));
    expect(result.ok).toBe(false);
    expect(result.hasDocument).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("J. parses a workflow with multiple jobs", () => {
    const result = parseWorkflowSource(readFixture("needs/chain-needs.yml"));
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("preserves the filename in the result", () => {
    const result = parseWorkflowSource(readFixture("triggers/push.yml"));
    expect(result.filename).toBe("triggers/push.yml");
  });

  it("never throws on arbitrary non-workflow text", () => {
    expect(() =>
      parseWorkflowSource({ filename: "junk.yml", content: ":::not yaml:::" }),
    ).not.toThrow();
  });
});
