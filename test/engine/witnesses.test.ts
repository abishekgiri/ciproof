import { describe, expect, it } from "vitest";
import {
  isGlob,
  synthesizeWitness,
  synthesizeNonMatch,
  matchesFilterPattern,
} from "../../src/engine/index.js";

describe("witness synthesis", () => {
  it("classifies glob vs literal patterns", () => {
    expect(isGlob("main")).toBe(false);
    expect(isGlob("release/**")).toBe(true);
    expect(isGlob("feature/*")).toBe(true);
    expect(isGlob("!releases/**-alpha")).toBe(true);
  });

  it("synthesizes witnesses that the real matcher accepts", () => {
    for (const pattern of ["release/**", "feature/*", "src/**", "**.ts"]) {
      const witness = synthesizeWitness(pattern);
      expect(witness, pattern).not.toBeNull();
      expect(matchesFilterPattern(witness as string, [pattern])).toBe(true);
    }
  });

  it("returns null for a purely negative pattern", () => {
    expect(synthesizeWitness("!releases/**-alpha")).toBeNull();
  });

  it("finds a value matching none of the patterns", () => {
    const value = synthesizeNonMatch(["main", "release/**"]);
    expect(value).not.toBeNull();
    expect(matchesFilterPattern(value as string, ["main", "release/**"])).toBe(
      false,
    );
  });
});

describe("ordered pattern matching (last-match-wins)", () => {
  const patterns = [
    "releases/**",
    "!releases/**-alpha",
    "releases/special-alpha",
  ];

  it("F. include -> exclude -> include ordering is honored", () => {
    expect(matchesFilterPattern("releases/1.0", patterns)).toBe(true); // included
    expect(matchesFilterPattern("releases/1.0-alpha", patterns)).toBe(false); // excluded
    expect(matchesFilterPattern("releases/special-alpha", patterns)).toBe(true); // re-included
  });
});
