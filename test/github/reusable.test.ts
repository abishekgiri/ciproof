import { describe, expect, it } from "vitest";
import {
  normalizeWorkflow,
  type WorkflowFileProvider,
} from "../../src/github/normalize.js";
import { exploreWorkflow } from "../../src/engine/index.js";
import { checkUntrustedPrivilegedPath } from "../../src/invariants/index.js";
import type { WorkflowModel } from "../../src/model/index.js";

function provider(files: Record<string, string>): WorkflowFileProvider {
  return { read: (path) => files[path] };
}

async function normalize(
  caller: string,
  files: Record<string, string>,
): Promise<WorkflowModel> {
  const result = await normalizeWorkflow(
    { filename: ".github/workflows/caller.yml", content: caller },
    { fileProvider: provider(files) },
  );
  if (!result.model) {
    throw new Error(`no model: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.model;
}

const DEPLOY = `
name: deploy
on:
  workflow_call:
    inputs:
      environment:
        type: string
jobs:
  publish:
    permissions:
      contents: write
    runs-on: ubuntu-latest
    steps:
      - run: echo publish
`;

describe("workflow_call + local reusable workflows", () => {
  it("A/B. parses workflow_call and resolves a local call", async () => {
    const caller = `
name: caller
on: push
jobs:
  call:
    uses: ./.github/workflows/deploy.yml
    with:
      environment: production
`;
    const model = await normalize(caller, {
      ".github/workflows/deploy.yml": DEPLOY,
    });
    const job = model.jobs.get("call");
    expect(job?.kind).toBe("reusableWorkflowJob");
    expect(job?.reusableCall?.target).toEqual({
      kind: "local",
      path: ".github/workflows/deploy.yml",
    });
    expect(job?.reusableCall?.resolved?.jobs.has("publish")).toBe(true);
    // resolved local call is supported (no unsupported marker)
    expect(job?.unsupported).toEqual([]);
  });

  it("E/H/I. captures with-inputs and secrets structurally", async () => {
    const caller = `
name: caller
on: push
jobs:
  call:
    uses: ./.github/workflows/deploy.yml
    with:
      environment: production
    secrets: inherit
`;
    const call = (
      await normalize(caller, {
        ".github/workflows/deploy.yml": DEPLOY,
      })
    ).jobs.get("call")?.reusableCall;
    expect(call?.with).toEqual({ environment: "production" });
    expect(call?.secrets).toBe("inherit");
  });

  it("M. missing local target -> resolution error + limitation", async () => {
    const caller = `
name: caller
on: push
jobs:
  call:
    uses: ./.github/workflows/missing.yml
`;
    const job = (await normalize(caller, {})).jobs.get("call");
    expect(job?.reusableCall?.resolutionError).toBe("missing");
    expect(job?.unsupported.some((u) => u.kind === "reusable-missing")).toBe(
      true,
    );
  });

  it("L. cycle detection", async () => {
    const caller = `
name: caller
on: push
jobs:
  call:
    uses: ./.github/workflows/b.yml
`;
    const b = `
name: b
on:
  workflow_call:
jobs:
  call-back:
    uses: ./.github/workflows/caller.yml
`;
    const model = await normalize(caller, { ".github/workflows/b.yml": b });
    const bResolved = model.jobs.get("call")?.reusableCall?.resolved;
    const callBack = bResolved?.jobs.get("call-back");
    expect(callBack?.reusableCall?.resolutionError).toBe("cycle");
  });

  it("N. external reusable workflow remains partial", async () => {
    const caller = `
name: caller
on: push
jobs:
  call:
    uses: octo/repo/.github/workflows/deploy.yml@v1
`;
    const job = (await normalize(caller, {})).jobs.get("call");
    expect(job?.reusableCall?.target.kind).toBe("external");
    expect(
      job?.unsupported.some((u) => u.kind === "external-reusable-workflow"),
    ).toBe(true);
  });
});

describe("CP003 through local reusable workflows", () => {
  function caller(callerPerm: string): string {
    return `
name: caller
on: pull_request_target
jobs:
  call:
    permissions:
      ${callerPerm}
    uses: ./.github/workflows/deploy.yml
`;
  }

  it("R. external pull_request_target -> write via local reusable -> violated", async () => {
    const model = await normalize(caller("contents: write"), {
      ".github/workflows/deploy.yml": DEPLOY,
    });
    const findings = checkUntrustedPrivilegedPath({
      model,
      exploration: exploreWorkflow(model),
    });
    expect(findings[0]?.verdict).toBe("violated");
    expect(findings[0]?.message).toContain("publish");
    expect(findings[0]?.message).toContain("reusable");
  });

  it("O/P. caller read cannot elevate called write -> no violation", async () => {
    const model = await normalize(caller("contents: read"), {
      ".github/workflows/deploy.yml": DEPLOY,
    });
    const findings = checkUntrustedPrivilegedPath({
      model,
      exploration: exploreWorkflow(model),
    });
    expect(findings).toEqual([]);
  });

  it("Q/S. caller unspecified permission -> unknown, not violated", async () => {
    const bare = `
name: caller
on: pull_request_target
jobs:
  call:
    uses: ./.github/workflows/deploy.yml
`;
    const model = await normalize(bare, {
      ".github/workflows/deploy.yml": DEPLOY,
    });
    const findings = checkUntrustedPrivilegedPath({
      model,
      exploration: exploreWorkflow(model),
    });
    expect(findings[0]?.verdict).toBe("unknown");
  });
});
