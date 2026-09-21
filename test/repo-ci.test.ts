import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeWorkflow } from "../src/github/normalize.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("CIProof's own CI workflow (S)", () => {
  it("parses and normalizes without errors", async () => {
    const file = ".github/workflows/ci.yml";
    const content = readFileSync(join(repoRoot, file), "utf8");
    const { model, diagnostics } = await normalizeWorkflow({
      filename: file,
      content,
    });
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(model).toBeDefined();
    expect(model?.jobs.has("verify")).toBe(true);
  });
});
