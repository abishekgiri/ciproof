import { describe, expect, it } from "vitest";
import { expandMatrix } from "../../src/model/index.js";

describe("expandMatrix", () => {
  it("A. one dimension", () => {
    const combos = expandMatrix({ node: [18, 20, 22] }, [], []);
    expect(combos.map((c) => c.values.node)).toEqual([18, 20, 22]);
  });

  it("B/C. two dimensions in deterministic order (first key outermost)", () => {
    const combos = expandMatrix(
      { fruit: ["apple", "pear"], animal: ["cat", "dog"] },
      [],
      [],
    );
    expect(combos.map((c) => `${c.values.fruit}/${c.values.animal}`)).toEqual([
      "apple/cat",
      "apple/dog",
      "pear/cat",
      "pear/dog",
    ]);
  });

  it("G. exclude exact match removes a combination", () => {
    const combos = expandMatrix(
      { os: ["ubuntu", "windows"], node: [20, 22] },
      [],
      [{ os: "windows", node: 20 }],
    );
    expect(combos).toHaveLength(3);
    expect(
      combos.some((c) => c.values.os === "windows" && c.values.node === 20),
    ).toBe(false);
  });

  it("H. exclude partial match removes all matching combinations", () => {
    const combos = expandMatrix(
      { os: ["ubuntu", "windows"], node: [20, 22] },
      [],
      [{ os: "windows" }],
    );
    expect(combos.every((c) => c.values.os !== "windows")).toBe(true);
    expect(combos).toHaveLength(2);
  });

  it("D/E/F/I. include augments, overwrites added values, and appends (GitHub golden)", () => {
    const combos = expandMatrix(
      { fruit: ["apple", "pear"], animal: ["cat", "dog"] },
      [
        { color: "green" },
        { color: "pink", animal: "cat" },
        { fruit: "apple", shape: "circle" },
        { fruit: "banana" },
        { fruit: "banana", animal: "cat" },
      ],
      [],
    );
    const shapes = combos.map((c) => JSON.stringify(c.values));
    expect(shapes).toEqual([
      JSON.stringify({
        fruit: "apple",
        animal: "cat",
        color: "pink",
        shape: "circle",
      }),
      JSON.stringify({
        fruit: "apple",
        animal: "dog",
        color: "green",
        shape: "circle",
      }),
      JSON.stringify({ fruit: "pear", animal: "cat", color: "pink" }),
      JSON.stringify({ fruit: "pear", animal: "dog", color: "green" }),
      JSON.stringify({ fruit: "banana" }),
      JSON.stringify({ fruit: "banana", animal: "cat" }),
    ]);
  });

  it("include-only matrix (no dimensions) yields one combination per include", () => {
    const combos = expandMatrix({}, [{ a: 1 }, { a: 2 }], []);
    expect(combos.map((c) => c.values.a)).toEqual([1, 2]);
  });

  it("L. 256-job boundary is computable", () => {
    const combos = expandMatrix(
      {
        a: Array.from({ length: 16 }, (_, i) => i),
        b: Array.from({ length: 16 }, (_, i) => i),
      },
      [],
      [],
    );
    expect(combos).toHaveLength(256);
  });
});
