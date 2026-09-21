/**
 * Controlled semantic-compatibility cases with INDEPENDENT ground truth.
 *
 * Each case pairs a tiny workflow + one explicit scenario with the outcome
 * GitHub Actions actually produces, taken from documented GitHub semantics (the
 * `oracle` field cites the rule) — NOT from CIProof's own output. The
 * differential test compares CIProof's prediction against `expected` and fails
 * on any false RUN/SKIP/BLOCK.
 *
 * Expected outcomes use UNKNOWN where the behavior depends on semantics CIProof
 * deliberately does not model; there, UNKNOWN is the correct answer, not a miss.
 */

import type { Scenario } from "../../src/engine/index.js";

export type Expected = "RUN" | "SKIPPED" | "BLOCKED" | "UNKNOWN";

export interface CompatibilityCase {
  name: string;
  workflow: string;
  scenario: Scenario;
  expected: Record<string, Expected>;
  oracle: string;
}

function scenario(over: Partial<Scenario>): Scenario {
  return {
    event: "push",
    fork: false,
    actorClass: "internal",
    changedFiles: [],
    inputs: {},
    ...over,
  };
}

const job = (body: string): string =>
  `jobs:\n  j:\n${body}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`;

export const CASES: CompatibilityCase[] = [
  {
    name: "if-true",
    workflow: "on: push\n" + job("    if: ${{ true }}"),
    scenario: scenario({ ref: "refs/heads/main", branch: "main" }),
    expected: { j: "RUN" },
    oracle: "A literal-true job condition runs the job.",
  },
  {
    name: "if-false",
    workflow: "on: push\n" + job("    if: ${{ false }}"),
    scenario: scenario({ ref: "refs/heads/main", branch: "main" }),
    expected: { j: "SKIPPED" },
    oracle: "A literal-false job condition skips the job.",
  },
  {
    name: "if-event-name-match",
    workflow:
      "on: [push, pull_request]\n" +
      job("    if: ${{ github.event_name == 'push' }}"),
    scenario: scenario({ ref: "refs/heads/main", branch: "main" }),
    expected: { j: "RUN" },
    oracle: "github.event_name equals the triggering event; condition true.",
  },
  {
    name: "if-event-name-nomatch",
    workflow:
      "on: [push, pull_request]\n" +
      job("    if: ${{ github.event_name == 'push' }}"),
    scenario: scenario({
      event: "pull_request",
      baseRef: "main",
      headRef: "feature",
    }),
    expected: { j: "SKIPPED" },
    oracle: "On pull_request the condition is false, so the job is skipped.",
  },
  {
    name: "needs-success-runs",
    workflow:
      "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n  deploy:\n    needs: test\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
    scenario: scenario({ ref: "refs/heads/main", branch: "main" }),
    expected: { test: "RUN", deploy: "RUN" },
    oracle: "A dependent job runs when its needs succeed (implicit success()).",
  },
  {
    name: "needs-skipped-implicit-success",
    workflow:
      "on: push\njobs:\n  test:\n    if: ${{ false }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n  deploy:\n    needs: test\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
    scenario: scenario({ ref: "refs/heads/main", branch: "main" }),
    expected: { test: "SKIPPED", deploy: "SKIPPED" },
    oracle:
      "Default success() is not satisfied when a need is skipped, so the dependent is skipped.",
  },
  {
    name: "always-after-skipped-need",
    workflow:
      "on: push\njobs:\n  test:\n    if: ${{ false }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n  deploy:\n    needs: test\n    if: ${{ always() }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
    scenario: scenario({ ref: "refs/heads/main", branch: "main" }),
    expected: { test: "SKIPPED", deploy: "RUN" },
    oracle: "always() runs the job regardless of dependency results.",
  },
  {
    name: "success-fn-after-run",
    workflow:
      "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n  deploy:\n    needs: test\n    if: ${{ success() }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
    scenario: scenario({ ref: "refs/heads/main", branch: "main" }),
    expected: { test: "RUN", deploy: "RUN" },
    oracle: "success() is satisfied when all needs succeeded.",
  },
  {
    name: "failure-fn-unknown",
    workflow: "on: push\n" + job("    if: ${{ failure() }}"),
    scenario: scenario({ ref: "refs/heads/main", branch: "main" }),
    expected: { j: "UNKNOWN" },
    oracle:
      "failure() depends on runtime step outcomes CIProof does not model; UNKNOWN is correct.",
  },
  {
    name: "cancelled-fn-unknown",
    workflow: "on: push\n" + job("    if: ${{ cancelled() }}"),
    scenario: scenario({ ref: "refs/heads/main", branch: "main" }),
    expected: { j: "UNKNOWN" },
    oracle: "cancelled() depends on runtime cancellation; UNKNOWN is correct.",
  },
  {
    name: "dispatch-boolean-true-skips",
    workflow:
      "on:\n  workflow_dispatch:\n    inputs:\n      skip:\n        type: boolean\n" +
      job("    if: ${{ !inputs.skip }}"),
    scenario: scenario({
      event: "workflow_dispatch",
      ref: "refs/heads/main",
      branch: "main",
      inputs: { skip: true },
    }),
    expected: { j: "SKIPPED" },
    oracle:
      "A true boolean input makes !inputs.skip false; the job is skipped.",
  },
  {
    name: "dispatch-boolean-false-runs",
    workflow:
      "on:\n  workflow_dispatch:\n    inputs:\n      skip:\n        type: boolean\n" +
      job("    if: ${{ !inputs.skip }}"),
    scenario: scenario({
      event: "workflow_dispatch",
      ref: "refs/heads/main",
      branch: "main",
      inputs: { skip: false },
    }),
    expected: { j: "RUN" },
    oracle: "A false boolean input makes !inputs.skip true; the job runs.",
  },
  {
    name: "push-branch-filter-match",
    workflow:
      "on:\n  push:\n    branches: [main]\n" + job("    if: ${{ true }}"),
    scenario: scenario({ ref: "refs/heads/main", branch: "main" }),
    expected: { j: "RUN" },
    oracle: "A push to a matching branch triggers the workflow.",
  },
  {
    name: "push-branch-filter-nomatch",
    workflow:
      "on:\n  push:\n    branches: [main]\n" + job("    if: ${{ true }}"),
    scenario: scenario({ ref: "refs/heads/feature", branch: "feature" }),
    expected: { j: "SKIPPED" },
    oracle:
      "A push to a non-matching branch does not trigger the workflow, so no job runs.",
  },
  {
    name: "push-tag-filter-match",
    workflow: "on:\n  push:\n    tags: ['v*']\n" + job("    if: ${{ true }}"),
    scenario: scenario({ refKind: "tag", ref: "refs/tags/v1.2.3" }),
    expected: { j: "RUN" },
    oracle: "A tag push matching the tag filter triggers the workflow.",
  },
  {
    name: "pull-request-target-fork-reaches-job",
    workflow: "on: pull_request_target\n" + job("    if: ${{ true }}"),
    scenario: scenario({
      event: "pull_request_target",
      baseRef: "main",
      headRef: "feature",
      fork: true,
      actorClass: "external",
    }),
    expected: { j: "RUN" },
    oracle:
      "pull_request_target runs in the base repository context and reaches its jobs even from a fork PR.",
  },
  {
    name: "fork-guard-condition-unknown",
    workflow:
      "on: pull_request_target\n" +
      job("    if: ${{ github.event.pull_request.head.repo.fork == false }}"),
    scenario: scenario({
      event: "pull_request_target",
      baseRef: "main",
      headRef: "feature",
      fork: true,
      actorClass: "external",
    }),
    expected: { j: "UNKNOWN" },
    oracle:
      "The guard reads github.event.pull_request.* which CIProof does not model; UNKNOWN is correct (and prevents a false RUN).",
  },
  {
    name: "path-filter-match",
    workflow:
      "on:\n  push:\n    paths: ['src/**']\n" + job("    if: ${{ true }}"),
    scenario: scenario({
      ref: "refs/heads/main",
      branch: "main",
      changedFiles: ["src/index.ts"],
    }),
    expected: { j: "RUN" },
    oracle: "A changed file matching the path filter triggers the workflow.",
  },
  {
    name: "path-filter-nomatch",
    workflow:
      "on:\n  push:\n    paths: ['src/**']\n" + job("    if: ${{ true }}"),
    scenario: scenario({
      ref: "refs/heads/main",
      branch: "main",
      changedFiles: ["docs/readme.md"],
    }),
    expected: { j: "SKIPPED" },
    oracle:
      "No changed file matches the path filter, so the workflow does not run.",
  },
];
