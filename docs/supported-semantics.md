# Supported semantics (v0.1)

CIProof models a **bounded** subset of GitHub Actions semantics. Anything outside
this surface is reported as `UNKNOWN`, never guessed. This document is the
single, specific statement of what v0.1 models; "supports GitHub Actions" is not
a claim CIProof makes.

## Events

| Event                 | Modeled                                    |
| --------------------- | ------------------------------------------ |
| `push`                | yes (branch and tag refs)                  |
| `pull_request`        | yes (fork/trust)                           |
| `pull_request_target` | yes (fork/trust)                           |
| `workflow_dispatch`   | yes (boolean & choice inputs)              |
| `schedule`            | yes (cron entries; default-branch context) |
| `workflow_run`        | yes (name/activity/branch/conclusion)      |
| other events          | UNKNOWN (`unsupported-trigger`)            |

## Filters

- **Branches:** `branches`, `branches-ignore` (glob witnesses + a non-match class).
- **Tags:** `tags`, `tags-ignore`; tag pushes correctly ignore path filters.
- **Paths:** `paths`, `paths-ignore` over explicit changed-file classes.

## Conditions (`jobs.<id>.if`)

Three-valued evaluation with implicit `success()`. `always()` and `success()` are
modeled from need states. `failure()` and `cancelled()` depend on runtime step
outcomes and are `UNKNOWN`. Conditions referencing unmodeled context (e.g.
`github.event.pull_request.*`) are `UNKNOWN` — which prevents false RUN claims.

## needs / dependencies

`needs` (string or list) with DAG validation; success/skipped propagation. A
dependent job with a skipped need and default `success()` is skipped; with
`always()` it runs.

## Inputs

`workflow_dispatch` `boolean` and `choice` inputs are enumerated. `string`,
`number`, and `environment` inputs are `UNKNOWN` when they affect a result
(`unsupported-input`).

## Trust / fork

Internal vs. external/fork actors are modeled per event. `pull_request_target`
runs in the base context and reaches its jobs even from a fork.

## Permissions

Explicit `permissions` (workflow- and job-level) are modeled; only explicit
`write`/`write-all` count as privileged (used by CP003). Repository/org/enterprise
default-permission settings and fork-token downgrades are **not** modeled.

## Matrices

Static matrices (literal values, `include`/`exclude`) are modeled; they do not
change job reachability. Dynamic matrices (`fromJSON`, needs-derived) are
`UNKNOWN` (`matrix-strategy`).

## Reusable workflows

Local, same-repository reusable workflows (`uses: ./.github/workflows/x.yml`) are
resolved and evaluated, including input/secret/permission flow and CP003 through
the call. External reusable workflows (`uses: owner/repo/...@ref`) are **not
fetched** and are `UNKNOWN` (`external-reusable-workflow`).

## concurrency

Modeled as **informational**: it affects run queueing/cancellation, not
structural reachability, so it never makes analysis partial. Runtime cancellation
is not modeled.

## Known UNKNOWN causes (from the validation corpus, ranked by impact)

`unsupported-trigger`, `dynamic-outputs` (`needs.*.outputs.*`),
`unsupported-input`, `external-reusable-workflow`, `matrix-strategy` (dynamic),
`complex-environment`, `reusable-workflow-job`, and witness-synthesis limits
(`branch-witness`, `path-witness`). See
[validation-study.md](validation-study.md) for counts.
