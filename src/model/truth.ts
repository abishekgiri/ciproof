/**
 * Three-valued truth, used wherever a result may be indeterminate because it
 * depends on semantics or runtime values CIProof does not model.
 *
 * `unknown` is a first-class value, never collapsed into `true` or `false`.
 * The combinators use conservative (Kleene) semantics.
 */
export type Truth = "true" | "false" | "unknown";

/** Logical NOT. `!unknown = unknown`. */
export function notTruth(value: Truth): Truth {
  if (value === "unknown") {
    return "unknown";
  }
  return value === "true" ? "false" : "true";
}

/**
 * Logical AND over any number of operands.
 * A single `false` forces `false` (even with unknowns present); otherwise any
 * `unknown` yields `unknown`; otherwise `true`.
 */
export function andTruth(values: Truth[]): Truth {
  let sawUnknown = false;
  for (const value of values) {
    if (value === "false") {
      return "false";
    }
    if (value === "unknown") {
      sawUnknown = true;
    }
  }
  return sawUnknown ? "unknown" : "true";
}

/**
 * Logical OR over any number of operands.
 * A single `true` forces `true`; otherwise any `unknown` yields `unknown`;
 * otherwise `false`.
 */
export function orTruth(values: Truth[]): Truth {
  let sawUnknown = false;
  for (const value of values) {
    if (value === "true") {
      return "true";
    }
    if (value === "unknown") {
      sawUnknown = true;
    }
  }
  return sawUnknown ? "unknown" : "false";
}
