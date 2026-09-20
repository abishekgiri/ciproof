/**
 * Representation of a `jobs.<id>.if` condition.
 *
 * Phase 1 REPRESENTS conditions; it does not evaluate them. `parseState`
 * records whether CIProof's expression parser could parse the raw expression —
 * it is NOT a judgement about whether the condition is true or false in any
 * context. Evaluation against event/scenario contexts is Phase 2.
 */

import type { SourceLocation } from "./source.js";

export type ConditionParseState = "valid" | "invalid";

export interface ConditionModel {
  /**
   * The raw expression text, without the surrounding `${{ }}` markers.
   * Example: `github.event_name == 'push'`, `always()`, `!inputs.skip_tests`.
   */
  raw: string;
  /** Whether CIProof's expression parser accepted `raw`. */
  parseState: ConditionParseState;
  /**
   * Best-effort, lexical list of root identifiers referenced (context names and
   * function names), e.g. `["github"]` or `["inputs"]` or `["always"]`. This is
   * a representation aid, not an authoritative reference analysis.
   */
  references: string[];
  /** Location of the condition expression, when available. */
  source?: SourceLocation;
}
