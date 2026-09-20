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

## Phase 1 implementation status (parse / normalize vs. evaluate)

Phase 1 builds the normalized semantic model. It **represents** what a workflow
declares; it does **not** evaluate behavior. The distinction below is
deliberate, so no user mistakes representation for evaluation:

| Construct                                                             | Parse | Normalize                                             | Evaluate                                 |
| --------------------------------------------------------------------- | ----- | ----------------------------------------------------- | ---------------------------------------- |
| `push` / `pull_request` / `pull_request_target` / `workflow_dispatch` | yes   | yes                                                   | not yet                                  |
| `branches` / `branches-ignore` / `paths` / `paths-ignore`             | yes   | yes (patterns + order preserved)                      | not yet (no glob matching)               |
| `workflow_dispatch` `boolean` / `choice` inputs                       | yes   | yes                                                   | not yet                                  |
| `jobs.<id>.if`                                                        | yes   | yes (raw text + parse state + references)             | not yet                                  |
| `needs` (string or list)                                              | yes   | yes (order preserved)                                 | not yet (no state propagation)           |
| `needs` DAG structure                                                 | yes   | yes (+ unknown/self/cycle diagnostics)                | not yet                                  |
| `permissions`                                                         | yes   | yes (explicit vs. unspecified vs. read-all/write-all) | not yet (no effective-token computation) |

"Evaluate" — trigger matching, condition truth, reachability, scenario
generation — is Phase 2 and beyond. Everything in the "Not yet supported" table
below is neither normalized nor evaluated, and must surface as `UNKNOWN` when it
would affect a result.

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
