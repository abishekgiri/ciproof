import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ParseWorkflowSourceInput } from "../../src/github/types.js";
import { normalizeWorkflow } from "../../src/github/normalize.js";
import type { WorkflowModel } from "../../src/model/index.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the fixture corpus root. */
export const FIXTURES_DIR = join(here, "..", "fixtures");

/** Read one fixture (path relative to the fixtures root) as parser input. */
export function readFixture(relativePath: string): ParseWorkflowSourceInput {
  const absolute = join(FIXTURES_DIR, relativePath);
  return { filename: relativePath, content: readFileSync(absolute, "utf8") };
}

/** Normalize a fixture into a WorkflowModel, throwing if none is produced. */
export async function loadModel(relativePath: string): Promise<WorkflowModel> {
  const result = await normalizeWorkflow(readFixture(relativePath));
  if (!result.model) {
    throw new Error(
      `expected a model for ${relativePath}; diagnostics: ${JSON.stringify(result.diagnostics)}`,
    );
  }
  return result.model;
}

/** List `*.yml` fixtures inside a category directory, relative to the root. */
export function listFixtures(category: string): string[] {
  const dir = join(FIXTURES_DIR, category);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yml"))
    .sort()
    .map((name) => `${category}/${name}`);
}
