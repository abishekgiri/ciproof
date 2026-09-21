/**
 * Public entry point for CIProof's machine-readable report layer.
 *
 * One structured finding model (`findings.ts`) feeds every format. Formatting
 * lives here; it never parses the human-readable output.
 */

export {
  findingsFromBuiltin,
  findingsFromInvariants,
  summarize,
  actionable,
  type ReportFinding,
  type ReportSummary,
  type ReportVerdict,
  type ReportLocation,
  type ReportCounterexample,
  type AnalyzedForReport,
} from "./findings.js";
export { renderJsonReport, JSON_REPORT_VERSION } from "./json.js";
export { renderSarif } from "./sarif.js";

/** Machine-readable output formats accepted by `--format`. */
export type OutputFormat = "text" | "json" | "sarif";
