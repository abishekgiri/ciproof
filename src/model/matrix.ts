/**
 * Job matrix strategy model.
 *
 * CIProof models STATIC matrices (all values are declared literals). A static
 * matrix does not change job-level reachability — GitHub evaluates
 * `jobs.<id>.if` before matrix expansion, and CIProof's checks operate at job
 * level — so combinations are computed for representation and tests but are NOT
 * expanded into separate scenarios (see `docs`/SUPPORT.md).
 *
 * Dynamic matrices (values from `fromJSON`, `needs` outputs, etc.) are not
 * modeled and remain UNKNOWN/partial.
 */

export type MatrixValue = string | number | boolean;

export interface MatrixCombination {
  values: Record<string, MatrixValue>;
}

export interface StaticMatrixModel {
  kind: "static";
  /** Declared dimensions, in declared order. */
  dimensions: Record<string, MatrixValue[]>;
  /** `exclude` entries (partial matches remove base combinations). */
  exclude: Record<string, MatrixValue>[];
  /** `include` entries (augment / overwrite / append per GitHub semantics). */
  include: Record<string, MatrixValue>[];
  /** Fully-resolved combinations after exclude/include. */
  combinations: MatrixCombination[];
}

export interface DynamicMatrixModel {
  kind: "dynamic";
  /** Why the matrix could not be resolved statically. */
  reason: string;
}

export type MatrixModel = StaticMatrixModel | DynamicMatrixModel;

/** GitHub's hard limit on matrix jobs per workflow run. */
export const MAX_MATRIX_JOBS = 256;
