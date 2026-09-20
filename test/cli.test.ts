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

  it("registers inspect and explain, but no multi-scenario commands yet", () => {
    // Phase 2 boundary: inspect + explain exist; check / paths (scenario
    // exploration and invariants) do not.
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toContain("inspect");
    expect(names).toContain("explain");
    expect(names).not.toContain("check");
    expect(names).not.toContain("paths");
  });
});
