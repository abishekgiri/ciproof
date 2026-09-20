import { describe, expect, it } from "vitest";
import { andTruth, notTruth, orTruth } from "../../src/model/index.js";

describe("three-valued logic", () => {
  it("NOT", () => {
    expect(notTruth("true")).toBe("false");
    expect(notTruth("false")).toBe("true");
    expect(notTruth("unknown")).toBe("unknown");
  });

  it("AND (conservative)", () => {
    expect(andTruth(["false", "unknown"])).toBe("false");
    expect(andTruth(["true", "unknown"])).toBe("unknown");
    expect(andTruth(["true", "true"])).toBe("true");
    expect(andTruth(["true", "false"])).toBe("false");
    expect(andTruth([])).toBe("true");
  });

  it("OR (conservative)", () => {
    expect(orTruth(["true", "unknown"])).toBe("true");
    expect(orTruth(["false", "unknown"])).toBe("unknown");
    expect(orTruth(["false", "false"])).toBe("false");
    expect(orTruth([])).toBe("false");
  });
});
