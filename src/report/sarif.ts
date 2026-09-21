/**
 * SARIF 2.1.0 report for `ciproof check --format sarif`.
 *
 * Compatible with GitHub code scanning. Built from `ReportFinding`s, never from
 * text. Deterministic: rules and results are sorted, and no timestamps are
 * emitted. Mapping:
 *
 *   REFUTED -> result, level "error"
 *   UNKNOWN -> result, level "note", clearly marked (never looks like a pass)
 *   NO VIOLATION FOUND -> no result
 *
 * UNKNOWN is included as a low-severity result (not hidden) with an explicit
 * message and a `verdict` property, so it can never be mistaken for a pass.
 */

import { actionable, type ReportFinding } from "./findings.js";

const SARIF_VERSION = "2.1.0";
const SARIF_SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json";
const INFORMATION_URI = "https://github.com/abishekgiri/ciproof";
const FINGERPRINT_KEY = "ciproofFingerprint/v1";

export interface SarifOptions {
  toolName?: string;
  toolVersion?: string;
  parseFailures?: string[];
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  defaultConfiguration: { level: string };
}

/** Render a SARIF 2.1.0 log for the given findings. */
export function renderSarif(
  findings: readonly ReportFinding[],
  options: SarifOptions = {},
): string {
  const reportable = actionable(findings);

  // Stable, deduped rule metadata, sorted by rule id.
  const ruleById = new Map<string, SarifRule>();
  for (const f of reportable) {
    if (!ruleById.has(f.ruleId)) {
      ruleById.set(f.ruleId, {
        id: f.ruleId,
        name: f.rule,
        shortDescription: { text: f.title },
        fullDescription: { text: describeRule(f) },
        defaultConfiguration: { level: levelFor(f) },
      });
    }
  }
  const rules = [...ruleById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const ruleIndex = new Map(rules.map((r, i) => [r.id, i]));

  const results = reportable.map((f) => ({
    ruleId: f.ruleId,
    ruleIndex: ruleIndex.get(f.ruleId) ?? 0,
    level: levelFor(f),
    message: { text: messageFor(f) },
    ...(f.location
      ? {
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.location.file },
                ...(f.location.line !== undefined
                  ? {
                      region: {
                        startLine: f.location.line,
                        ...(f.location.column !== undefined
                          ? { startColumn: f.location.column }
                          : {}),
                      },
                    }
                  : {}),
              },
            },
          ],
        }
      : {}),
    partialFingerprints: { [FINGERPRINT_KEY]: f.fingerprint },
    properties: { verdict: f.verdict },
  }));

  const notifications = [...(options.parseFailures ?? [])]
    .sort((a, b) => a.localeCompare(b))
    .map((file) => ({
      level: "warning",
      message: { text: `workflow could not be modeled: ${file}` },
    }));

  const log = {
    version: SARIF_VERSION,
    $schema: SARIF_SCHEMA,
    runs: [
      {
        tool: {
          driver: {
            name: options.toolName ?? "CIProof",
            informationUri: INFORMATION_URI,
            ...(options.toolVersion !== undefined
              ? { version: options.toolVersion }
              : {}),
            rules,
          },
        },
        results,
        ...(notifications.length > 0
          ? {
              invocations: [
                {
                  executionSuccessful: true,
                  toolExecutionNotifications: notifications,
                },
              ],
            }
          : {}),
      },
    ],
  };

  return JSON.stringify(log, null, 2) + "\n";
}

function levelFor(f: ReportFinding): string {
  return f.verdict === "refuted" ? "error" : "note";
}

function messageFor(f: ReportFinding): string {
  if (f.verdict === "unknown") {
    const reasons =
      f.unknownReasons && f.unknownReasons.length > 0
        ? ` Reasons: ${f.unknownReasons.join("; ")}.`
        : "";
    return `UNKNOWN (not a pass): ${f.message}.${reasons}`;
  }
  return f.message;
}

function describeRule(f: ReportFinding): string {
  return f.verdict === "unknown"
    ? `CIProof invariant "${f.id}" could not be decided within the supported model.`
    : `CIProof invariant "${f.id}" (${f.rule}).`;
}
