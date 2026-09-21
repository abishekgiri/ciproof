import { describe, expect, it } from "vitest";
import {
  aggregate,
  percentile,
  rankUnknownReasons,
  type WorkflowRecord,
} from "../../validation/aggregate.js";

function record(over: Partial<WorkflowRecord>): WorkflowRecord {
  return {
    repo: "owner/repo",
    workflow: ".github/workflows/ci.yml",
    status: "complete",
    jobs: { total: 1, runCapable: 1, alwaysSkipped: 0, unknownCapable: 0 },
    scenarios: 4,
    timeMs: 1,
    limitationKinds: [],
    findings: [],
    ...over,
  };
}

// A tiny synthetic corpus — no network, fixed timings, deterministic.
const SYNTHETIC: WorkflowRecord[] = [
  record({
    workflow: "a.yml",
    status: "complete",
    jobs: { total: 2, runCapable: 2, alwaysSkipped: 0, unknownCapable: 0 },
    scenarios: 4,
    timeMs: 2,
    findings: [{ id: "CP003", verdict: "violated" }],
  }),
  record({
    workflow: "b.yml",
    status: "partial",
    jobs: { total: 3, runCapable: 1, alwaysSkipped: 0, unknownCapable: 2 },
    scenarios: 10,
    timeMs: 8,
    limitationKinds: ["dynamic-outputs", "unsupported-trigger"],
    findings: [{ id: "CP001", verdict: "unknown" }],
  }),
  record({
    workflow: "c.yml",
    status: "partial",
    jobs: { total: 1, runCapable: 0, alwaysSkipped: 0, unknownCapable: 1 },
    scenarios: 6,
    timeMs: 4,
    limitationKinds: ["dynamic-outputs"],
  }),
  record({
    workflow: "d.yml",
    status: "parse-failure",
    jobs: { total: 0, runCapable: 0, alwaysSkipped: 0, unknownCapable: 0 },
    scenarios: 0,
    timeMs: 1,
  }),
];

describe("percentile", () => {
  it("E. computes nearest-rank percentiles deterministically", () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(v, 0.5)).toBe(5);
    expect(percentile(v, 0.95)).toBe(10);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("rankUnknownReasons", () => {
  it("D. counts distinct workflows and total occurrences, ranked", () => {
    const ranked = rankUnknownReasons(SYNTHETIC);
    expect(ranked[0]).toEqual({
      kind: "dynamic-outputs",
      workflows: 2,
      occurrences: 2,
    });
    expect(ranked).toContainEqual({
      kind: "unsupported-trigger",
      workflows: 1,
      occurrences: 1,
    });
  });
});

describe("aggregate", () => {
  it("F. separates parse failures from partial (semantic) modeling", () => {
    const report = aggregate(2, SYNTHETIC);
    expect(report.modeling.complete).toBe(1);
    expect(report.modeling.partial).toBe(2);
    expect(report.modeling.parseFailure).toBe(1);
    expect(report.modeling.normalizeFailure).toBe(0);
  });

  it("E. computes percentages over analyzed (complete + partial) workflows", () => {
    const report = aggregate(2, SYNTHETIC);
    // analyzed = 3 (1 complete + 2 partial); parse failure excluded from denominator.
    expect(report.modeling.completePct).toBe(33.3);
    expect(report.modeling.partialPct).toBe(66.7);
  });

  it("aggregates jobs, scenarios, and findings", () => {
    const report = aggregate(2, SYNTHETIC);
    expect(report.corpus).toEqual({ repositories: 2, workflows: 4, jobs: 6 });
    expect(report.jobs).toEqual({
      total: 6,
      runCapable: 3,
      alwaysSkipped: 0,
      unknownCapable: 3,
    });
    expect(report.scenarios.total).toBe(20);
    expect(report.findings.CP003).toEqual({
      violated: 1,
      unknown: 0,
      notViolated: 0,
    });
  });

  it("C. is byte-identical for identical input (stable aggregation)", () => {
    const a = JSON.stringify(aggregate(2, SYNTHETIC));
    const b = JSON.stringify(aggregate(2, SYNTHETIC));
    expect(a).toBe(b);
  });

  it("J. runs on an empty synthetic corpus without throwing", () => {
    const report = aggregate(0, []);
    expect(report.corpus.workflows).toBe(0);
    expect(report.modeling.completePct).toBe(0);
    expect(report.scenarios.max).toBe(0);
  });
});
