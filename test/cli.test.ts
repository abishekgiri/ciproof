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

  it("registers inspect, explain, paths, check, and diff", () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toContain("inspect");
    expect(names).toContain("explain");
    expect(names).toContain("paths");
    expect(names).toContain("check");
    expect(names).toContain("diff");
  });
});
