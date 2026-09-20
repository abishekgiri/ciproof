/**
 * Witness synthesis for branch and path filter patterns.
 *
 * A witness is a concrete branch name or file path synthesized to exercise a
 * pattern. Every synthesized witness is verified through the SAME matcher the
 * evaluator uses (`matchesFilterPattern`); if it cannot be verified, the caller
 * records a limitation rather than fabricating one.
 */

import { matchesFilterPattern } from "./trigger.js";

const TOKEN = "ciproof";

/** True if a pattern contains any glob/negation metacharacter. */
export function isGlob(pattern: string): boolean {
  return /[*?+[\]!]/.test(pattern);
}

/**
 * Synthesize a witness that matches `pattern`, or null if the synthesized
 * candidate cannot be verified against the real matcher.
 */
export function synthesizeWitness(pattern: string): string | null {
  if (pattern.startsWith("!")) {
    // A purely negative pattern has no positive witness.
    return null;
  }
  const candidate = synthesize(pattern);
  return matchesFilterPattern(candidate, [pattern]) ? candidate : null;
}

/**
 * Find a value that matches NONE of `patterns`, trying a few fixed candidates.
 * Returns null if every candidate happens to match (caller records a limitation).
 */
export function synthesizeNonMatch(patterns: string[]): string | null {
  const candidates = [
    `${TOKEN}-unmatched`,
    `zzz-${TOKEN}-none`,
    `${TOKEN}/none/deep/path.none`,
    `${TOKEN}-unmatched.dat`,
  ];
  const positives = patterns.filter((p) => !p.startsWith("!"));
  for (const candidate of candidates) {
    if (!matchesFilterPattern(candidate, positives)) {
      return candidate;
    }
  }
  return null;
}

function synthesize(pattern: string): string {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i] as string;
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        out += TOKEN;
        i++;
      } else {
        out += TOKEN;
      }
    } else if (char === "?" || char === "+") {
      // `?`/`+` are quantifiers on the preceding element, already emitted.
      continue;
    } else if (char === "[") {
      let j = i + 1;
      if (pattern[j] === "!") {
        j++;
      }
      out += pattern[j] ?? "a"; // a representative class member
      while (j < pattern.length && pattern[j] !== "]") {
        j++;
      }
      i = j;
    } else {
      out += char;
    }
  }
  return out;
}
