import { describe, expect, it } from "vitest";
import {
  ModelDiagnosticCode,
  UNSPECIFIED_PERMISSIONS,
  getDependencies,
  getDependents,
  validateNeeds,
  type JobModel,
  type WorkflowModel,
} from "../../src/model/index.js";

function job(id: string, needs: string[] = []): JobModel {
  return {
    id,
    kind: "job",
    needs,
    permissions: UNSPECIFIED_PERMISSIONS,
    unsupported: [],
  };
}

function workflow(...jobs: JobModel[]): WorkflowModel {
  return {
    file: "test.yml",
    triggers: [],
    jobs: new Map(jobs.map((j) => [j.id, j])),
    unsupported: [],
  };
}

describe("needs utilities", () => {
  it("returns direct dependencies in declared order", () => {
    const model = workflow(job("build"), job("deploy", ["build"]));
    expect(getDependencies(model, "deploy")).toEqual(["build"]);
    expect(getDependencies(model, "build")).toEqual([]);
  });

  it("returns dependents", () => {
    const model = workflow(
      job("build"),
      job("test", ["build"]),
      job("deploy", ["build"]),
    );
    expect(getDependents(model, "build")).toEqual(["test", "deploy"]);
    expect(getDependents(model, "deploy")).toEqual([]);
  });
});

describe("validateNeeds", () => {
  it("accepts a valid DAG with no diagnostics", () => {
    const model = workflow(
      job("build"),
      job("test", ["build"]),
      job("deploy", ["test"]),
    );
    expect(validateNeeds(model)).toEqual([]);
  });

  it("Y. flags a nonexistent needs target", () => {
    const model = workflow(job("deploy", ["build"]));
    const diagnostics = validateNeeds(model);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe(ModelDiagnosticCode.UnknownNeed);
    expect(diagnostics[0]?.message).toContain("build");
  });

  it("flags a self-dependency", () => {
    const model = workflow(job("a", ["a"]));
    const diagnostics = validateNeeds(model);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe(ModelDiagnosticCode.SelfDependency);
  });

  it("Z. detects a dependency cycle", () => {
    const model = workflow(job("a", ["b"]), job("b", ["a"]));
    const diagnostics = validateNeeds(model);
    const cycle = diagnostics.find(
      (d) => d.code === ModelDiagnosticCode.NeedsCycle,
    );
    expect(cycle).toBeDefined();
    expect(cycle?.message).toContain("->");
  });

  it("reports a three-node cycle exactly once", () => {
    const model = workflow(job("a", ["c"]), job("b", ["a"]), job("c", ["b"]));
    const cycles = validateNeeds(model).filter(
      (d) => d.code === ModelDiagnosticCode.NeedsCycle,
    );
    expect(cycles).toHaveLength(1);
  });
});
