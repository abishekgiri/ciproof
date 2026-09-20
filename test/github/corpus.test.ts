import { describe, expect, it } from "vitest";
import { parseWorkflowSource } from "../../src/github/parser.js";
import { listFixtures, readFixture } from "../helpers/fixtures.js";

/**
 * Corpus-level checks over the whole fixture set.
 *
 * These assert only load/diagnostic behavior, never CIProof semantics.
 */
describe("fixture corpus", () => {
  const wellFormed = [
    ...listFixtures("triggers"),
    ...listFixtures("needs"),
    ...listFixtures("conditions"),
    ...listFixtures("filters"),
    ...listFixtures("trust"),
  ];

  it.each(wellFormed)("well-formed fixture parses cleanly: %s", (rel) => {
    const result = parseWorkflowSource(readFixture(rel));
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  const unsupported = listFixtures("unsupported");

  it.each(unsupported)(
    "unsupported-but-valid fixture still parses: %s",
    (rel) => {
      // These use constructs outside v0.1 scope (schedule, workflow_run,
      // matrix, reusable, dynamic outputs). They are valid GitHub workflows,
      // so the PARSER accepts them. CIProof's later phases are responsible for
      // marking their unmodeled behavior as UNKNOWN — the parser does not.
      const result = parseWorkflowSource(readFixture(rel));
      expect(result.hasDocument).toBe(true);
    },
  );

  const invalid = listFixtures("invalid");

  it.each(invalid)("invalid fixture yields diagnostics: %s", (rel) => {
    const result = parseWorkflowSource(readFixture(rel));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
