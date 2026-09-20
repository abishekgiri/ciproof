import { describe, expect, it } from "vitest";
import { normalizeWorkflow } from "../../src/github/normalize.js";
import { readFixture } from "../helpers/fixtures.js";
import type {
  WorkflowDispatchTrigger,
  WorkflowModel,
} from "../../src/model/index.js";

async function model(rel: string): Promise<WorkflowModel> {
  const result = await normalizeWorkflow(readFixture(rel));
  if (!result.model) {
    throw new Error(
      `expected a model for ${rel}; diagnostics: ${JSON.stringify(result.diagnostics)}`,
    );
  }
  return result.model;
}

describe("normalizeWorkflow", () => {
  it("A. captures the workflow name", async () => {
    expect((await model("triggers/push.yml")).name).toBe("push-basic");
  });

  it("B. normalizes a push trigger", async () => {
    const m = await model("triggers/push.yml");
    expect(m.triggers.map((t) => t.event)).toEqual(["push"]);
  });

  it("C. normalizes a pull_request trigger", async () => {
    const m = await model("triggers/pull-request.yml");
    expect(m.triggers.map((t) => t.event)).toEqual(["pull_request"]);
  });

  it("D. normalizes a pull_request_target trigger", async () => {
    const m = await model("triggers/pull-request-target.yml");
    expect(m.triggers.map((t) => t.event)).toEqual(["pull_request_target"]);
  });

  it("E. normalizes a workflow_dispatch trigger", async () => {
    const m = await model("triggers/workflow-dispatch.yml");
    expect(m.triggers.map((t) => t.event)).toContain("workflow_dispatch");
  });

  it("F. captures branch filters in order", async () => {
    const m = await model("filters/branches.yml");
    const trigger = m.triggers[0];
    expect(trigger?.event).toBe("push");
    if (trigger?.event === "push") {
      expect(trigger.filters.branches).toEqual(["main", "release/**"]);
    }
  });

  it("G. captures branches-ignore filters", async () => {
    const m = await model("filters/branches-ignore.yml");
    const trigger = m.triggers[0];
    if (trigger?.event === "push") {
      expect(trigger.filters.branchesIgnore).toEqual(["dependabot/**"]);
    }
  });

  it("H. captures path filters", async () => {
    const m = await model("filters/paths.yml");
    const trigger = m.triggers[0];
    if (trigger?.event === "push") {
      expect(trigger.filters.paths).toEqual(["src/**", "**.ts"]);
    }
  });

  it("I. captures paths-ignore filters", async () => {
    const m = await model("filters/paths-ignore.yml");
    const trigger = m.triggers[0];
    if (trigger?.event === "push") {
      expect(trigger.filters.pathsIgnore).toEqual(["docs/**", "**.md"]);
    }
  });

  it("J. normalizes a boolean dispatch input", async () => {
    const m = await model("triggers/workflow-dispatch.yml");
    const dispatch = m.triggers.find(
      (t): t is WorkflowDispatchTrigger => t.event === "workflow_dispatch",
    );
    const input = dispatch?.inputs.find((i) => i.name === "skip_tests");
    expect(input?.type).toBe("boolean");
    expect(input?.default).toBe(false);
  });

  it("K. normalizes a choice input and marks string as unsupported", async () => {
    const m = await model("conditions/choice-input.yml");
    const dispatch = m.triggers.find(
      (t): t is WorkflowDispatchTrigger => t.event === "workflow_dispatch",
    );
    const choice = dispatch?.inputs.find((i) => i.name === "environment");
    expect(choice?.type).toBe("choice");
    expect(choice?.options).toEqual(["staging", "production"]);
    const str = dispatch?.inputs.find((i) => i.name === "note");
    expect(str?.type).toBe("unsupported");
    expect(str?.rawType).toBe("string");
  });

  it("L. normalizes a single job", async () => {
    const m = await model("triggers/push.yml");
    expect([...m.jobs.keys()]).toEqual(["build"]);
  });

  it("M. normalizes multiple jobs preserving order", async () => {
    const m = await model("needs/simple-needs.yml");
    expect([...m.jobs.keys()]).toEqual(["build", "deploy"]);
  });

  it("N. normalizes needs declared as a string", async () => {
    const m = await model("needs/simple-needs.yml");
    expect(m.jobs.get("deploy")?.needs).toEqual(["build"]);
  });

  it("O. normalizes needs declared as a list, in order", async () => {
    const m = await model("needs/list-needs.yml");
    expect(m.jobs.get("deploy")?.needs).toEqual(["build", "test"]);
  });

  it("P. normalizes a chained needs graph", async () => {
    const m = await model("needs/chain-needs.yml");
    expect(m.jobs.get("test")?.needs).toEqual(["build"]);
    expect(m.jobs.get("deploy")?.needs).toEqual(["test"]);
  });

  it("Q. preserves the literal jobs.if expression", async () => {
    const m = await model("needs/always-needs.yml");
    expect(m.jobs.get("test")?.condition?.raw).toBe("!inputs.skip_tests");
    expect(m.jobs.get("deploy")?.condition?.raw).toBe("always()");
  });

  it("represents a valid condition as parseState valid with references", async () => {
    const m = await model("conditions/branch-ref.yml");
    const condition = m.jobs.get("release")?.condition;
    expect(condition?.parseState).toBe("valid");
    expect(condition?.references).toContain("github");
  });

  it("records no condition when if is not declared (implicit success())", async () => {
    const m = await model("triggers/push.yml");
    expect(m.jobs.get("build")?.condition).toBeUndefined();
  });

  it("T. captures explicit job permissions", async () => {
    const m = await model("trust/pull-request-target.yml");
    const perms = m.jobs.get("publish-preview")?.permissions;
    expect(perms?.mode).toBe("explicit");
    expect(perms?.scopes).toEqual({ contents: "write", packages: "write" });
  });

  it("U. distinguishes unspecified permissions", async () => {
    const m = await model("trust/pull-request-target.yml");
    expect(m.jobs.get("build")?.permissions.mode).toBe("unspecified");
  });

  it("V. keeps an unsupported schedule trigger visible", async () => {
    const m = await model("unsupported/schedule.yml");
    expect(m.triggers).toHaveLength(0);
    expect(m.unsupported.some((u) => u.kind === "unsupported-trigger")).toBe(
      true,
    );
  });

  it("W. marks a reusable-workflow job as unsupported", async () => {
    const m = await model("unsupported/reusable-workflow.yml");
    const job = m.jobs.get("call");
    expect(job?.kind).toBe("reusableWorkflowJob");
    expect(
      job?.unsupported.some((u) => u.kind === "reusable-workflow-job"),
    ).toBe(true);
  });

  it("marks matrix strategy and dynamic outputs as unsupported", async () => {
    const matrix = await model("unsupported/matrix-complex.yml");
    expect(
      matrix.jobs
        .get("build")
        ?.unsupported.some((u) => u.kind === "matrix-strategy"),
    ).toBe(true);

    const dynamic = await model("unsupported/dynamic-output.yml");
    expect(
      dynamic.jobs
        .get("decide")
        ?.unsupported.some((u) => u.kind === "dynamic-outputs"),
    ).toBe(true);
  });

  it("X. preserves source locations for workflow, trigger, job, and if", async () => {
    const m = await model("needs/always-needs.yml");
    expect(m.source?.start.line).toBeGreaterThan(0);
    expect(m.triggers[0]?.source?.start.line).toBeGreaterThan(0);
    expect(m.jobs.get("deploy")?.source?.start.line).toBeGreaterThan(0);
    expect(m.jobs.get("deploy")?.condition?.source?.start.line).toBeGreaterThan(
      0,
    );
  });

  it("returns no model for malformed YAML but surfaces diagnostics", async () => {
    const result = await normalizeWorkflow(
      readFixture("invalid/malformed-yaml.yml"),
    );
    expect(result.model).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("returns no model for structurally invalid workflows", async () => {
    const result = await normalizeWorkflow(
      readFixture("invalid/invalid-structure.yml"),
    );
    expect(result.model).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("never throws on non-workflow text", async () => {
    await expect(
      normalizeWorkflow({ filename: "junk.yml", content: ":::not yaml:::" }),
    ).resolves.toBeDefined();
  });
});
