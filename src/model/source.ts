/**
 * CIProof-owned source locations.
 *
 * These mirror the position information the GitHub parser exposes on tokens,
 * but are a CIProof type so the model never depends on parser internals.
 * Positions are one-based (line and column), matching GitHub's token ranges.
 */

export interface SourcePosition {
  /** One-based line number. */
  line: number;
  /** One-based column number. */
  column: number;
}

export interface SourceLocation {
  /** The workflow file the location refers to. */
  file: string;
  /** Start position. */
  start: SourcePosition;
  /** End position, when the parser provides one. */
  end?: SourcePosition;
}
