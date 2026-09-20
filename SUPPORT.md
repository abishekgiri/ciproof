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

## Implementation status (parse / normalize / evaluate-one / explore-many)

Four distinct levels, so no user mistakes one for another. **Evaluate-one** is a
single explicit scenario (`ciproof explain`). **Explore-many** derives a finite
set of scenarios, evaluates each, and collapses them into distinct execution
plans (`ciproof paths`). Neither checks invariants or searches for
counterexamples — that is Phase 4+.

| Construct                                                             | Parse | Normalize                    | Evaluate-one                             | Explore-many                                  |
| --------------------------------------------------------------------- | ----- | ---------------------------- | ---------------------------------------- | --------------------------------------------- |
| `push` / `pull_request` / `pull_request_target` / `workflow_dispatch` | yes   | yes                          | yes (event-specific context)             | yes (only declared events generated)          |
| `branches` / `branches-ignore`                                        | yes   | yes (patterns + order)       | yes (filter-pattern globbing)            | yes (verified witnesses + a non-match class)  |
| `paths` / `paths-ignore`                                              | yes   | yes (patterns + order)       | yes over explicit changed files          | yes (matching / non-matching / mixed / empty) |
| `workflow_dispatch` `boolean`                                         | yes   | yes                          | yes (booleans stay booleans)             | yes (enumerates `false`, `true`)              |
| `workflow_dispatch` `choice`                                          | yes   | yes                          | yes                                      | yes (enumerates declared options)             |
| `workflow_dispatch` `string` / `number` / `environment`               | yes   | represented (unsupported)    | UNKNOWN when it affects a result         | partial (left unset; limitation recorded)     |
| `jobs.<id>.if`                                                        | yes   | yes                          | yes (three-valued; implicit `success()`) | yes                                           |
| `success()` / `always()`                                              | yes   | n/a                          | yes (from modeled needs state)           | yes                                           |
| `failure()` / `cancelled()`                                           | yes   | n/a                          | UNKNOWN (runtime state not modeled)      | UNKNOWN plan preserved; partial               |
| `needs` (string or list) + DAG                                        | yes   | yes (diagnostics)            | yes (success/skipped abstraction)        | yes                                           |
| `permissions`                                                         | yes   | yes (explicit / unspecified) | not yet (no effective-token computation) | not yet                                       |
| `schedule` / `workflow_run` / matrix / reusable / dynamic outputs     | yes   | unsupported marker           | UNKNOWN when relevant                    | not generated; limitation → partial           |

### Phase 3 exploration assumptions

- **Equivalence classes, not enumeration.** Branch/path domains are finite
  representatives derived from the patterns the workflow references (plus a
  non-matching class), each synthesized witness verified through the real
  matcher. Ordered positive/negative patterns are preserved (last-match-wins).
- **Bounded.** Exploration caps at `--max-scenarios` (default 10,000). Hitting
  the cap sets `truncated` and prints a loud "Results are partial." message —
  never "all paths checked."
- **Completeness.** `complete-within-supported-model` requires no truncation, no
  limitations, and no UNKNOWN plans; otherwise `partial`. It never claims
  mathematical completeness beyond the supported abstraction.
- **UNKNOWN plans are kept**, not discarded — a distinct plan whose outcome
  depends on unmodeled semantics is legitimate and reported.
- **No invariants, no counterexamples, no safety claims.** `ciproof paths`
  discovers execution plans only.

### Phase 2 evaluation assumptions (unchanged)

- **No execution.** A `run` result means "GitHub would schedule this job", not
  "the job succeeded"; step-level failures and cancellation are not modeled.
- **Conservative UNKNOWN.** Any unmodeled context field, unknown input, or
  unmodeled function makes the affected result `unknown`, never a guess.

### Invariant checks (`ciproof check`)

Checks run over exploration results and report `violated` / `not-violated` /
`unknown`. `not-violated` means "no violation found within the modeled
scenarios" — never "safe" or "proven". Counterexamples are always concrete,
already-explored scenarios (never fabricated).

| Check                               | What it reports                                                             | Conservatism                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CP001** unreachable job           | A job no explored scenario runs.                                            | Strong (`violated`) only when exploration is complete-within-supported-model and the job has no UNKNOWN state / unsupported construct; otherwise `unknown`.                                                                                                                                                                        |
| **CP002** prerequisite bypass       | A target job runs while an explicitly-required job did not complete.        | Requires explicit rules (`--require target:job,...`); never guesses from names. RUN is the only "completed" state; a required UNKNOWN yields `unknown`.                                                                                                                                                                            |
| **CP003** untrusted privileged path | An external/fork context reaches a job with explicit `write` / `write-all`. | Only explicit modeled privilege counts (`unspecified` never does); effective = job-level then workflow-level. `pull_request_target` → `violated` (with a policy limitation); ordinary fork `pull_request` → `unknown` (fork-token downgrade depends on repo settings). Repository/org/enterprise Actions policies are not modeled. |

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
