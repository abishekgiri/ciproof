# CIProof Support Matrix (v0.1 target)

This document defines the **semantic boundary** CIProof intends to model in
v0.1. It is the contract for what "supported" means. Two rules govern everything
below:

1. **Unsupported behavior must eventually produce `UNKNOWN`** wherever it is
   relevant to a result.
2. **Unsupported constructs must never be silently treated as safe.** Missing a
   finding is acceptable; inventing false certainty is not.

This matrix describes the target the later phases build toward, and it is the
reference the compatibility suite checks against.

---

## Implementation status (parse / normalize / evaluate)

Three distinct levels, so no user mistakes one for another. **Evaluate** means
CIProof can compute a construct's effect for **one explicit scenario**
(`ciproof explain`). It does **not** yet mean multi-scenario exploration,
invariants, or counterexamples — those are Phase 3+.

| Construct                                                             | Parse | Normalize                                           | Evaluate (one scenario)                                       |
| --------------------------------------------------------------------- | ----- | --------------------------------------------------- | ------------------------------------------------------------- |
| `push` / `pull_request` / `pull_request_target` / `workflow_dispatch` | yes   | yes                                                 | yes (event-specific context; distinct `github.ref`/base/head) |
| `branches` / `branches-ignore`                                        | yes   | yes (patterns + order)                              | yes (GitHub filter-pattern globbing)                          |
| `paths` / `paths-ignore`                                              | yes   | yes (patterns + order)                              | yes over explicit changed files; UNKNOWN if none supplied     |
| `workflow_dispatch` `boolean` / `choice` inputs                       | yes   | yes                                                 | yes (booleans stay booleans; unsupplied+no-default = UNKNOWN) |
| `jobs.<id>.if`                                                        | yes   | yes (raw text + parse state + references)           | yes (three-valued; implicit `success()` modeled)              |
| `success()` / `always()`                                              | yes   | n/a                                                 | yes (from modeled needs state)                                |
| `failure()` / `cancelled()`                                           | yes   | n/a                                                 | UNKNOWN (runtime state not modeled)                           |
| `needs` (string or list) + DAG                                        | yes   | yes (order; unknown/self/cycle diagnostics)         | yes (success/skipped propagation abstraction)                 |
| `permissions`                                                         | yes   | yes (explicit / unspecified / read-all / write-all) | not yet (no effective-token computation)                      |
| `schedule` / `workflow_run` / matrix / reusable / dynamic outputs     | yes   | unsupported marker                                  | UNKNOWN when relevant                                         |

### Phase 2 evaluation assumptions

- **No execution.** A `run` result means "GitHub would schedule this job", not
  "the job succeeded". For dependency flow, a scheduled job is treated as
  succeeded; step-level failures and cancellation are not modeled — hence
  `failure()`/`cancelled()`/`!cancelled()` evaluate to `unknown`.
- **One scenario only.** No scenario generation, deduplication, invariants, or
  counterexamples.
- **Conservative UNKNOWN.** Any unmodeled context field, unknown input, or
  unmodeled function makes the affected result `unknown`, never a guess.

---

## Supported targets (v0.1)

### Events

| Event                 | Status  | Fixture                                          |
| --------------------- | ------- | ------------------------------------------------ |
| `push`                | planned | `test/fixtures/triggers/push.yml`                |
| `pull_request`        | planned | `test/fixtures/triggers/pull-request.yml`        |
| `pull_request_target` | planned | `test/fixtures/triggers/pull-request-target.yml` |
| `workflow_dispatch`   | planned | `test/fixtures/triggers/workflow-dispatch.yml`   |

### Workflow filters

| Filter            | Status  | Fixture                                     |
| ----------------- | ------- | ------------------------------------------- |
| `branches`        | planned | `test/fixtures/filters/branches.yml`        |
| `branches-ignore` | planned | `test/fixtures/filters/branches-ignore.yml` |
| `paths`           | planned | `test/fixtures/filters/paths.yml`           |
| `paths-ignore`    | planned | `test/fixtures/filters/paths-ignore.yml`    |

### Job semantics

| Feature        | Status  | Fixture                                       |
| -------------- | ------- | --------------------------------------------- |
| `jobs.<id>.if` | planned | `test/fixtures/conditions/event-name.yml`     |
| `needs`        | planned | `test/fixtures/needs/simple-needs.yml`        |
| `permissions`  | planned | `test/fixtures/trust/pull-request-target.yml` |

### `workflow_dispatch` inputs

| Input type | Status  | Notes                                             |
| ---------- | ------- | ------------------------------------------------- |
| `boolean`  | planned | Domain `{true, false}`; real boolean in `inputs`. |
| `choice`   | planned | Domain = declared options only (strings).         |

### Trust classes

| Class              | Status  | Fixture                                       |
| ------------------ | ------- | --------------------------------------------- |
| Internal PR        | planned | `test/fixtures/trust/pull-request.yml`        |
| External / fork PR | planned | `test/fixtures/trust/pull-request-target.yml` |

---

## Not yet supported

These constructs are **out of v0.1 scope**. When they are relevant to a result,
CIProof must return `UNKNOWN` (or otherwise refuse to assert certainty), never a
confident "safe".

| Construct                     | Reason deferred                          | Fixture                                           |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------- |
| `workflow_run`                | Cross-workflow triggering not modeled    | `test/fixtures/unsupported/workflow-run.yml`      |
| `schedule`                    | Time-based triggering not modeled        | `test/fixtures/unsupported/schedule.yml`          |
| `repository_dispatch`         | External API triggering not modeled      | —                                                 |
| `merge_group`                 | Merge-queue semantics not modeled        | —                                                 |
| Reusable workflow semantics   | Input/secret/permission flow not modeled | `test/fixtures/unsupported/reusable-workflow.yml` |
| Dynamic job outputs           | Runtime-produced values are unknowable   | `test/fixtures/unsupported/dynamic-output.yml`    |
| Complex matrix semantics      | Job multiplicity not modeled             | `test/fixtures/unsupported/matrix-complex.yml`    |
| `concurrency`                 | Cancellation/queueing not modeled        | —                                                 |
| Full environment protection   | Reviewers/wait timers not modeled        | —                                                 |
| Organization Actions policies | Not read in v0.1 (see Phase 9)           | —                                                 |
| Enterprise Actions policies   | Not read in v0.1 (see Phase 9)           | —                                                 |
| Shell-step semantics          | CIProof never executes shell             | —                                                 |
| Container execution           | CIProof never executes containers        | —                                                 |

---

## The `UNKNOWN` contract

`UNKNOWN` is a first-class result, not an error. It means: _the outcome depends
on semantics or runtime values CIProof cannot currently model_. Examples that
must yield `UNKNOWN` rather than a guess:

- a job gated on `needs.<job>.outputs.<name>` produced by a run step,
- a condition referencing a context value CIProof does not model,
- any construct in the "Not yet supported" table when it affects the result.

A result set should report how many scenarios were modeled and how many
expressions were `UNKNOWN`, so a "NO VIOLATION FOUND" verdict is never mistaken
for universal safety.
