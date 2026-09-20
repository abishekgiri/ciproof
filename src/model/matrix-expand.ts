/**
 * Compute matrix combinations following GitHub's documented semantics:
 * base Cartesian product (declared key order, first key outermost) -> apply
 * `exclude` (partial match) -> apply `include` (merge into ORIGINAL base
 * combinations where original keys match, else append a new combination;
 * include-added values may be overwritten by later includes, original values
 * never are).
 */

import type { MatrixCombination, MatrixValue } from "./matrix.js";

export function expandMatrix(
  dimensions: Record<string, MatrixValue[]>,
  include: Record<string, MatrixValue>[],
  exclude: Record<string, MatrixValue>[],
): MatrixCombination[] {
  const originalKeys = Object.keys(dimensions);

  // Base product in declared key order (first key outermost).
  let base: Record<string, MatrixValue>[] = originalKeys.length > 0 ? [{}] : [];
  for (const key of originalKeys) {
    const next: Record<string, MatrixValue>[] = [];
    for (const combo of base) {
      for (const value of dimensions[key] ?? []) {
        next.push({ ...combo, [key]: value });
      }
    }
    base = next;
  }

  // Exclude: remove base combinations that partially match an exclude entry.
  base = base.filter((combo) => !exclude.some((ex) => partialMatch(combo, ex)));

  const result: Record<string, MatrixValue>[] = base.map((c) => ({ ...c }));
  const baseCount = result.length;

  for (const inc of include) {
    let merged = false;
    for (let i = 0; i < baseCount; i++) {
      const combo = result[i] as Record<string, MatrixValue>;
      // An include merges into an original base combination only when it does
      // not overwrite any original matrix value.
      const canMerge = originalKeys
        .filter((k) => k in inc)
        .every((k) => combo[k] === inc[k]);
      if (canMerge) {
        for (const [k, v] of Object.entries(inc)) {
          combo[k] = v;
        }
        merged = true;
      }
    }
    if (!merged) {
      result.push({ ...inc });
    }
  }

  return result.map((values) => ({ values }));
}

function partialMatch(
  combo: Record<string, MatrixValue>,
  filter: Record<string, MatrixValue>,
): boolean {
  return Object.entries(filter).every(([k, v]) => combo[k] === v);
}
