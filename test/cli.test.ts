import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";

describe("cli scaffold", () => {
  it("names the program ciproof", () => {
    expect(buildProgram().name()).toBe("ciproof");
  });

  it("has a description", () => {
    expect(buildProgram().description().length).toBeGreaterThan(0);
  });

  it("exposes a version", () => {
    // commander stores the configured version string.
    expect(buildProgram().version()).toBeDefined();
  });

  it("registers inspect, explain, and paths, but no invariant command yet", () => {
    // Phase 3 boundary: inspect + explain + paths exist; check (invariants /
    // counterexamples) does not.
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toContain("inspect");
    expect(names).toContain("explain");
    expect(names).toContain("paths");
    expect(names).not.toContain("check");
  });
});
