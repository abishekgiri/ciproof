# CIProof

**Write what your CI must guarantee. Get a concrete counterexample when it doesn't.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange.svg)](#status)
[![Made for GitHub Actions](https://img.shields.io/badge/GitHub-Actions-2088FF?logo=githubactions&logoColor=white)](https://docs.github.com/actions)

GitHub Actions workflows are programs — events, branches, permissions, conditions, dependencies, inputs, and trust boundaries. But we still review them like YAML.

CIProof explores the meaningful execution paths of your workflows and shows you the **exact scenario that breaks an invariant you care about** — such as "production can never deploy without integration tests" or "a fork PR can never reach a write-privileged job."

No workflow is executed. No secrets are required. No cloud account. No LLM.

```console
$ npx ciproof check

✗ production-needs-tests

Counterexample:
event=workflow_dispatch
branch=main
skip_integration=true

integration-tests     SKIPPED
deploy-production     RUN

No workflow was executed. No secrets were required.
```

> Find the CI paths you didn't know you had.

---

## Why CIProof

Most CI tooling answers a different question than "is my workflow actually safe under every scenario?"

| Tool class               | The question it answers                                                             |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `actionlint`, validators | Is this workflow syntactically valid?                                               |
| `act`                    | Can I execute this workflow locally?                                                |
| `zizmor`, CodeQL         | Does this workflow match a known dangerous pattern?                                 |
| Run logs                 | Why did this job behave this way _after_ it ran?                                    |
| Graph/estate tools       | How are workflows, actions, and permissions connected?                              |
| **CIProof**              | **Is there any modeled execution context where CI behavior violates an invariant?** |

CIProof is not another pattern scanner or workflow visualizer. It is a **bounded reachability engine** for GitHub Actions: it enumerates realizable execution scenarios (event × ref × fork/trust × changed files × inputs × job dependencies), evaluates what actually runs, and produces a **minimal, concrete counterexample** when an invariant can be violated.

The design bias, in strict priority order:

```
correctness > trust > counterexample quality > usefulness > performance > features > polish
```

A false counterexample is treated as a bug. When CIProof cannot model something soundly, it says `UNKNOWN` — never fake certainty.

---

## What it does

- **Reachability** — Which jobs can actually run, and under exactly which event/ref/fork/input combination?
- **Invariant verification** — Assert rules like "deploy requires tests" or "forks cannot deploy" and get them checked against every modeled scenario.
- **Concrete counterexamples** — Not "this looks risky," but the exact minimal scenario that violates your rule, with an execution trace and source evidence.
- **Semantic behavior diff** _(planned)_ — `ciproof diff origin/main...HEAD` tells you which execution paths a PR _gained or lost_ — e.g. "`workflow_dispatch` can now reach `deploy-production`."

### Example

Given this workflow:

```yaml
on:
  pull_request:
  workflow_dispatch:
    inputs:
      skip_tests:
        type: boolean

jobs:
  test:
    if: ${{ !inputs.skip_tests }}
  deploy:
    needs: test
    if: ${{ always() }}
```

with the invariant _"whenever `deploy` runs, `test` must have completed"_ — CIProof reports:

```
REFUTED

Counterexample:
event=workflow_dispatch
skip_tests=true

test      SKIPPED
deploy    RUN
```

Because `deploy` uses `if: always()`, it runs even when `test` is skipped. That path is easy to miss in review and impossible to see without exploring the input space.

---

## Verdicts

CIProof reports one of three honest verdicts, never a confidence percentage:

- **REFUTED** — a realizable counterexample exists (shown, minimized).
- **NO VIOLATION FOUND** — no violation in the set of scenarios CIProof successfully modeled (it tells you how many, and how many expressions were `UNKNOWN`).
- **UNKNOWN** — the result depends on semantics or runtime values CIProof cannot yet model (e.g. a job gated on `needs.build.outputs.*` produced by runtime code).

---

## Install

> Not yet published. CIProof is in early development — see [Status](#status).

Once released:

```bash
npx ciproof check
```

## CLI (planned surface)

```bash
ciproof check                        # verify invariants, report counterexamples
ciproof paths <workflow>             # enumerate meaningful execution scenarios
ciproof explain <job> --event ...    # explain why a job runs/skips in one context
ciproof inspect                      # show the normalized workflow model
ciproof diff origin/main...HEAD      # semantic behavior diff (planned)
```

Exit codes: `0` no violation · `1` violation found · `2` bad config · `3` parse/model error · `4` analysis incomplete.

---

## How it works

1. Parse workflows with GitHub's own [`@actions/workflow-parser`](https://github.com/actions/languageservices) and [`@actions/expressions`](https://github.com/actions/languageservices), behind an isolation adapter.
2. Normalize into CIProof's own intermediate representation (events, triggers, jobs, `needs` DAG, conditions — with source locations).
3. Derive a **finite set of equivalence classes** from the patterns the workflow actually references (branches, paths, inputs, trust).
4. Evaluate each realizable scenario in dependency order → `RUN` / `SKIPPED` / `BLOCKED` / `UNKNOWN`, with evidence.
5. Deduplicate behaviorally-identical scenarios, evaluate invariants, and **minimize** any counterexample.

CIProof **never executes** workflow shell steps, repository scripts, local actions, or containers. Workflow and repository content is treated as untrusted input.

---

## Status

Pre-alpha. The engine is being built spike-first: the first milestone is to accurately reproduce GitHub's real behavior on a semantic-compatibility fixture suite before any product polish. Supported semantics are deliberately narrow and grow only when validated against real GitHub Actions runs.

**v0.1 target scope:** events `push` / `pull_request` / `pull_request_target` / `workflow_dispatch`; `branches`/`paths` filters; `jobs.<id>.if`, `needs`, `permissions`; boolean & choice dispatch inputs; internal vs. fork trust. Everything outside this surfaces as `UNKNOWN`, never a guess.

---

## Contributing

CIProof's identity is **behavioral verification**, not shallow pattern rules. The most valuable contributions are:

- event-semantics and compatibility fixtures validated against real GitHub runs,
- new invariant types with counterexample support,
- output formats (JSON, SARIF, graph),
- real-world regression cases.

Every semantic feature must ship with a fixture, an expected output, and a test.

---

## License

[MIT](./LICENSE) © Abishek Giri
