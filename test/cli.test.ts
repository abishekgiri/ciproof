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

  it("registers inspect but no analysis commands yet", () => {
    // Phase 1 boundary: inspect exists; behavioral analysis does not.
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toContain("inspect");
    expect(names).not.toContain("check");
    expect(names).not.toContain("paths");
    expect(names).not.toContain("explain");
  });
});
