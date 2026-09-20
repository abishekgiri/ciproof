/**
 * Convert GitHub token ranges into CIProof `SourceLocation`s.
 *
 * The raw range shape is described structurally here so this module does not
 * import GitHub parser types; any token's `.range` matches `RawRange`.
 */

import type { SourceLocation } from "../model/source.js";

interface RawPosition {
  line: number;
  column: number;
}

interface RawRange {
  start: RawPosition;
  end: RawPosition;
}

interface RangeBearing {
  range?: RawRange | undefined;
}

/** Build a `SourceLocation` from a raw token range, if present. */
export function locationFromRange(
  file: string,
  range: RawRange | undefined,
): SourceLocation | undefined {
  if (range === undefined) {
    return undefined;
  }
  return {
    file,
    start: { line: range.start.line, column: range.start.column },
    end: { line: range.end.line, column: range.end.column },
  };
}

/** Build a `SourceLocation` from any token that may carry a range. */
export function locationFromToken(
  file: string,
  token: RangeBearing | undefined,
): SourceLocation | undefined {
  return token ? locationFromRange(file, token.range) : undefined;
}
