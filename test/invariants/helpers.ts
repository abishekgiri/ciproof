import { normalizeWorkflow } from "../../src/github/normalize.js";
import {
  exploreWorkflow,
  type ExplorationLimits,
} from "../../src/engine/index.js";
import { readFixture } from "../helpers/fixtures.js";
import type { CheckContext } from "../../src/invariants/index.js";

/** Build a CheckContext (model + exploration) from a fixture. */
export async function contextFor(
  fixture: string,
  limits?: ExplorationLimits,
): Promise<CheckContext> {
  const { model } = await normalizeWorkflow(readFixture(fixture));
  if (!model) {
    throw new Error(`no model for ${fixture}`);
  }
  const exploration = exploreWorkflow(model, limits);
  return { model, exploration };
}
