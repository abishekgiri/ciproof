# GitHub Actions Semantics — Research Notes

Research notes for the semantics CIProof must model in later phases. **This is
not implementation.** Each entry records the feature, an official documentation
reference, the observed rule, the future CIProof requirement, and the fixture
that exercises it.

Guidance followed here:

- Prefer **official GitHub documentation**.
- Where behavior is not fully pinned down by docs, it is labeled
  **ASSUMPTION — requires empirical validation** and must be confirmed by a
  Layer B compatibility run (see `test/compatibility/README.md`) before CIProof
  relies on it.
- Where docs and observed behavior disagree, prefer measured behavior and record
  the discrepancy.

Primary sources (verified reachable, September 2026):

- Events that trigger workflows —
  <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>
- Expressions (incl. status-check functions) —
  <https://docs.github.com/en/actions/reference/workflows-and-actions/expressions>
- Using jobs in a workflow —
  <https://docs.github.com/actions/using-jobs/using-jobs-in-a-workflow>
- Using conditions to control job execution —
  <https://docs.github.com/actions/using-jobs/using-conditions-to-control-job-execution>
- Workflow syntax for GitHub Actions —
  <https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions>
- Contexts reference —
  <https://docs.github.com/en/actions/reference/workflows-and-actions/contexts>

---

## 1. `pull_request` — `github.ref` behavior

- **Docs:** Events that trigger workflows (`pull_request`); Contexts reference.
- **Observed rule:** For `pull_request`, `GITHUB_SHA` is the **last merge commit
  of the PR merge branch**, and `github.ref` is the PR merge ref
  (`refs/pull/<n>/merge`). To get the head commit, workflows must read
  `github.event.pull_request.head.sha`. The job runs against merge-ref content.
- **Future CIProof requirement:** The `pull_request` context builder must model
  `github.ref` as a PR merge ref, **distinct** from a `push` ref. Branch-class
  derivation for a `pull_request` should use the PR **base** branch for
  `branches` filters (see item 8), not `github.ref`.
- **Fixture:** `test/fixtures/triggers/pull-request.yml`,
  `test/fixtures/trust/pull-request.yml`.

## 2. `pull_request_target` — ref / trust behavior

- **Docs:** Events that trigger workflows (`pull_request_target`).
- **Observed rule:** Runs **in the context of the default branch of the base
  repository**, not the PR merge commit. Because it runs in the base context, it
  has access to secrets and a token that can write — which is why it "can label
  or comment on pull requests from forks," and why the docs warn that "running
  untrusted code on the `pull_request_target` trigger may lead to security
  vulnerabilities."
- **Future CIProof requirement:** The `pull_request_target` context builder must
  mark the run as **privileged even when the PR comes from a fork**. This is the
  trust asymmetry CP003 depends on: a fork actor + a privileged base-context run.
  CIProof must prove a concrete reachable path, not merely flag the trigger.
- **Fixture:** `test/fixtures/triggers/pull-request-target.yml`,
  `test/fixtures/trust/pull-request-target.yml`.

## 3. `workflow_dispatch` boolean inputs

- **Docs:** Events that trigger workflows (`workflow_dispatch`).
- **Observed rule (important nuance):** The `inputs` context **preserves Boolean
  values as Booleans**, whereas `github.event.inputs` **converts them to
  strings**. The `choice` type **resolves to a string** (one of the declared
  options). Quote: the two contexts are "identical except that the `inputs`
  context preserves Boolean values as Booleans instead of converting them to
  strings."
- **Future CIProof requirement:** When evaluating `if: ${{ inputs.x }}` for a
  `boolean` input, treat the value as a real boolean domain `{true, false}`.
  When the same value is read via `github.event.inputs.x`, treat it as the
  **string** `"true"`/`"false"`. Conflating these would produce false results.
  `choice` inputs enumerate their **declared options only** — never invent
  values outside the declared domain.
- **Fixture:** `test/fixtures/triggers/workflow-dispatch.yml`,
  `test/fixtures/conditions/boolean-input.yml`.

## 4. `jobs.<id>.needs`

- **Docs:** Using jobs in a workflow; Workflow syntax (`jobs.<job_id>.needs`).
- **Observed rule:** `needs` declares jobs that must complete before this job
  runs, forming a dependency DAG. Execution proceeds in dependency order.
- **Future CIProof requirement:** Build a `needs` DAG from the normalized model;
  evaluate jobs topologically. Detect cycles and missing `needs` targets (both
  are modeling errors CIProof should surface rather than silently ignore).
- **Fixture:** `test/fixtures/needs/simple-needs.yml`,
  `test/fixtures/needs/chain-needs.yml`.

## 5. Skipped / failed prerequisite propagation

- **Docs:** Using jobs in a workflow; Using conditions to control job execution.
- **Observed rule (cited):** "If a job fails or is skipped, all jobs that need it
  are skipped **unless the jobs use a conditional expression that causes the job
  to continue**." A failure or skip propagates down the dependency chain from the
  point of failure/skip onward.
- **Future CIProof requirement:** Three-valued propagation. If a needed job is
  `skipped` (or would not `run`), a dependent job is `skipped` **by default**,
  and only overridden by a job `if` that evaluates true regardless of ancestor
  state (see item 6). This propagation is the core of CP002 (prerequisite
  bypass).
- **Fixture:** `test/fixtures/needs/skipped-needs.yml`,
  `test/fixtures/needs/always-needs.yml`.

## 6. `always()` (and status-check functions)

- **Docs:** Expressions — status check functions.
- **Observed rule (cited):** `always()` "causes the step to always execute, and
  returns `true`, even when canceled." `success()` is true when all previous
  steps/ancestor jobs succeeded; `failure()` is true when any fails;
  `cancelled()` is true on cancellation. Docs warn against `always()` for
  critical tasks and suggest `if: ${{ !cancelled() }}` as a safer alternative.
- **Future CIProof requirement:** A job with `if: always()` **runs even when its
  `needs` were skipped or failed** — the canonical prerequisite-bypass shape. The
  condition evaluator must special-case the status-check functions: they depend
  on ancestor execution state, not on ordinary context values. Absent an explicit
  status-check function, GitHub inserts an implicit `success()` gate on the job's
  `if` with respect to `needs`.
  **ASSUMPTION — requires empirical validation:** the exact interaction between a
  custom `if` (that omits any status function) and skipped `needs` must be
  confirmed on real GitHub for each shape before CIProof reports it as certain.
- **Fixture:** `test/fixtures/needs/always-needs.yml`.

## 7. `jobs.<id>.if` evaluation

- **Docs:** Using conditions to control job execution; Workflow syntax
  (`jobs.<job_id>.if`); Expressions.
- **Observed rule:** A job runs only when its `if` evaluates to true. The `${{ }}`
  wrapper is optional for `if`. Conditions may reference contexts (`github`,
  `inputs`, `needs`, …) and functions.
- **Future CIProof requirement:** Evaluate `if` in the current scenario's
  context via the `@actions/expressions` adapter, producing `true` / `false` /
  `unknown`. Runtime-dependent references (e.g. `needs.x.outputs.*`) must yield
  `unknown`, never a guess. Preserve source locations for evidence.
- **Fixture:** `test/fixtures/conditions/event-name.yml`,
  `test/fixtures/conditions/branch-ref.yml`,
  `test/fixtures/conditions/compound-condition.yml`.

## 8. Branch filtering (`branches` / `branches-ignore`)

- **Docs:** Workflow syntax
  (`on.<push|pull_request>.<branches|branches-ignore>`).
- **Observed rule:** `branches`/`branches-ignore` accept glob patterns
  (`*`, `**`, `+`, `?`, `!`, ranges). `branches` and `branches-ignore` cannot be
  used together for the same event. For `pull_request`, the filter matches the
  **base** branch of the PR.
- **Future CIProof requirement:** Implement GitHub glob matching precisely
  (distinct from shell/`.gitignore` globs). Derive branch **equivalence classes**
  from the referenced patterns only. For `pull_request`, apply the filter to the
  PR base branch, not `github.ref`.
- **Fixture:** `test/fixtures/filters/branches.yml`,
  `test/fixtures/filters/branches-ignore.yml`.

## 9. Path filtering (`paths` / `paths-ignore`)

- **Docs:** Workflow syntax (`on.<push|pull_request>.<paths|paths-ignore>`).
- **Observed rule:** `paths`/`paths-ignore` accept glob patterns matched against
  the set of changed files in the event. `paths` and `paths-ignore` cannot be
  combined for the same event. A push whose changed files all match
  `paths-ignore` does not trigger the workflow.
- **Future CIProof requirement:** Derive changed-file **equivalence classes**
  from the referenced patterns (a matching file, a non-matching file, the empty
  change set where meaningful). Do not enumerate arbitrary file paths.
- **Fixture:** `test/fixtures/filters/paths.yml`,
  `test/fixtures/filters/paths-ignore.yml`.

## 10. `permissions`

- **Docs:** Workflow syntax (`permissions`); Contexts reference; Automatic token
  authentication.
- **Observed rule:** `permissions` can be set at workflow level and per job; a
  job-level block overrides the workflow level. Setting any permission key
  changes unspecified scopes to `none` (job level) relative to defaults. Scopes
  take `read` / `write` / `none`. The effective permissions bound the
  `GITHUB_TOKEN` for that job.
- **Future CIProof requirement:** Compute an **effective permission set** per job
  (workflow default → workflow-level → job-level override). CP003 uses this to
  decide whether a reachable job is "privileged" (e.g. `contents: write`).
  **ASSUMPTION — requires empirical validation:** the precise default permission
  baseline depends on repository/org settings, which CIProof does not read in
  v0.1; document the assumed baseline and confirm before asserting privilege.
- **Fixture:** `test/fixtures/trust/pull-request-target.yml`.

---

## Discrepancy log

_None recorded yet._ When GitHub documentation and observed (Layer B) behavior
disagree, record the feature, both behaviors, the chosen behavior (measured), and
the regression fixture that locks it in.
