# CIProof — CLAUDE.md

> Behavioral verification for GitHub Actions.
> Write what your CI must guarantee. Get a concrete counterexample when it doesn't.

The project helps a developer answer questions like:

- Can production deploy without integration tests?
- Can a fork PR reach a write-enabled job?
- Can a manual input bypass a required prerequisite?
- Is a job impossible to reach?
- Did this PR introduce a new path to production?
- Did a workflow change remove a required security gate on one path?
- Can a required check disappear for a valid PR scenario?
- What exact event + ref + fork + input combination violates my CI rule?

The tool must work **without executing the workflow, without repository secrets, without a cloud account, and without an LLM.**

---

## 1. The product boundary

Never lose this distinction.

| Existing tool class | Main question |
|---|---|
| actionlint / validators | Is this workflow syntactically or structurally valid? |
| act | Can I execute this workflow locally? |
| zizmor / CodeQL / security scanners | Does this workflow match a known dangerous pattern? |
| job simulators | What happens for this specific event/context? |
| GitHub run logs | Why did this job behave this way after it ran? |
| graph/estate tools such as ravelact | How are workflows, actions, permissions, callers, and dependencies connected? |
| **CIProof** | **Is there any modeled execution context where CI behavior violates an invariant?** |

CIProof must not become another static pattern scanner or generic workflow visualizer.

Bad product framing:

> `pull_request_target` is dangerous

Good product framing:

> A fork pull request can reach `deploy-production` with `contents:write`.
>
> Counterexample:
> ```
> pull_request_target
>   -> build
>   -> publish-preview
>   -> deploy-production
> ```

The moat is:

- behavioral invariants,
- scenario/state exploration,
- reachability,
- concrete counterexamples,
- semantic behavior diff.

---

## 2. Core engineering principles

### 2.1 Deterministic core

Never use an LLM to decide:

- whether a workflow trigger matches,
- whether a condition evaluates true,
- whether a job is reachable,
- whether a prerequisite completed,
- whether an invariant was violated,
- whether a counterexample is valid.

An optional natural-language explanation layer can be added much later, but it must never be authoritative.

### 2.2 Trust over feature count

False counterexamples destroy the product.

Prefer `UNKNOWN` over guessing.

Prefer missing a finding over inventing a path that GitHub cannot actually produce.

### 2.3 Evidence, not fake confidence

Never output:

> 91% dangerous

Instead output evidence:

```
deploy-production RUNS because:
✓ workflow_dispatch matches
✓ branch=main satisfies job.if
✓ build completed
✓ integration-test was skipped
✓ deploy-production does not require integration-test
```

### 2.4 Honest result model

CIProof uses three top-level verdicts:

**REFUTED** — A realizable counterexample exists.

```
REFUTED

Counterexample:
event=workflow_dispatch
branch=main
skip_integration=true
```

**NO VIOLATION FOUND** — No violation exists in the set of scenarios CIProof successfully modeled. Never phrase this as universal safety unless the supported semantics genuinely justify it.

```
NO VIOLATION FOUND

Checked 128 modeled scenarios.
2 runtime-dependent expressions were UNKNOWN.
```

**UNKNOWN** — The result depends on semantics or runtime values CIProof cannot currently model.

```
UNKNOWN

deploy depends on:
needs.generate.outputs.should_deploy

This value is produced by runtime code.
```

---

## 3. Competitive positioning

Do not rebuild capabilities already well served elsewhere.

### Cede

Do not build a general security-pattern scanner for:

- unpinned actions,
- template injection,
- artifact poisoning,
- broad `GITHUB_TOKEN` permissions,
- generic dangerous-trigger warnings.

Tools such as zizmor and CodeQL already own that category.

Do not copy generic graph tooling. Tools such as ravelact already analyze GitHub Actions estates, build intermediate representations, trace trigger/caller relationships, inspect permissions and secrets, and visualize workflow structure.

CIProof can render graphs as an output surface, but **graph visualization is not the product.**

### Own

CIProof should own:

**A. Invariant verification**
```
Whenever deploy-production runs,
integration-tests must have completed.
```

**B. Counterexamples**
```
workflow_dispatch
branch=main
skip_integration=true

integration-tests SKIPPED
deploy-production RUN
```

**C. Semantic behavior diff**
```
This PR adds a new execution path:
workflow_dispatch -> deploy-production
```

**D. Reachability under multiple contexts** — not just one concrete event, but all meaningful modeled classes of: event, branch/ref, fork/trust, changed files, dispatch inputs, job dependencies.

---

## 4. Technology choices

### Language

Use **TypeScript** for the core.

The main reason is fidelity to GitHub Actions semantics. Prefer GitHub's public language-services packages where practical:

- `@actions/workflow-parser`
- `@actions/expressions`

Do not recreate GitHub expression syntax manually.

### Dependency isolation

GitHub's parser/expression packages must sit behind our own adapter layer.

```
src/github/
├── parser.ts
├── expressions.ts
├── contexts.ts
└── types.ts
```

The rest of CIProof must depend on our normalized IR, not GitHub package internals. This matters because external parser APIs can change.

### Suggested tooling

- TypeScript
- Node.js >= 20
- Vitest
- ESLint
- Prettier
- Zod
- Commander or oclif
- chalk + cli-table3, or Ink

Do not add Z3 in v1. Do not add a database in v1. Do not build a web backend in v1.

---

## 5. Repository layout

Use a simple structure first:

```
ciproof/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts
│   │
│   ├── github/
│   │   ├── parser.ts
│   │   ├── expressions.ts
│   │   ├── contexts.ts
│   │   └── types.ts
│   │
│   ├── model/
│   │   ├── workflow.ts
│   │   ├── trigger.ts
│   │   ├── job.ts
│   │   ├── scenario.ts
│   │   ├── evidence.ts
│   │   └── truth.ts
│   │
│   ├── engine/
│   │   ├── trigger.ts
│   │   ├── condition.ts
│   │   ├── needs.ts
│   │   ├── reachability.ts
│   │   ├── scenarios.ts
│   │   ├── explorer.ts
│   │   └── counterexample.ts
│   │
│   ├── invariants/
│   │   ├── builtin/
│   │   │   ├── unreachable-job.ts
│   │   │   ├── prerequisite-bypass.ts
│   │   │   └── untrusted-privileged-path.ts
│   │   └── user-rules.ts
│   │
│   ├── diff/
│   │   └── behavior-diff.ts
│   │
│   └── report/
│       ├── terminal.ts
│       ├── json.ts
│       ├── sarif.ts
│       └── graph.ts
│
├── test/
│   ├── fixtures/
│   ├── compatibility/
│   └── corpus/
│
├── examples/
└── docs/
```

Do not over-engineer into a monorepo until there is a real need.

---

## 6. Normalized semantic model

Create CIProof's own IR.

```ts
export interface WorkflowModel {
  id: string;
  file: string;
  name?: string;
  triggers: TriggerModel[];
  jobs: Map<string, JobModel>;
}

export interface TriggerModel {
  event: EventType;
  branches?: PatternSet;
  branchesIgnore?: PatternSet;
  paths?: PatternSet;
  pathsIgnore?: PatternSet;
}

export interface JobModel {
  id: string;
  name?: string;
  needs: string[];
  condition?: ExpressionModel;
  permissions: PermissionSet;
  environment?: string;
}

export interface Scenario {
  event: EventType;
  branch: string;
  fork: boolean;
  actorClass: ActorClass;
  changedFiles: string[];
  inputs: Record<string, unknown>;
}

export type TruthValue = "true" | "false" | "unknown";

export type JobExecution = "run" | "skipped" | "blocked" | "unknown";

export interface Evidence {
  kind: string;
  message: string;
  source?: SourceLocation;
}

export interface JobResult {
  jobId: string;
  state: JobExecution;
  evidence: Evidence[];
}
```

Preserve source locations wherever possible. Every user-visible conclusion should have evidence.

---

## 7. Event-specific context modeling

Never model GitHub Actions with one fake universal context.

At minimum, create separate context builders for:

- `push`
- `pull_request`
- `pull_request_target`
- `workflow_dispatch`

Each event builder must define the event's valid: ref behavior, head/base relationship, fork/trust state, inputs, repository context, actor class, and available event payload fields.

Do not generate impossible scenarios. Example: a normal `pull_request` run does not have the same `github.ref` semantics as a `push` run.

Counterexample generation is only valuable if the counterexample can really happen.

---

## 8. V0.1 supported semantics

Support only:

**Events:** `push`, `pull_request`, `pull_request_target`, `workflow_dispatch`

**Workflow filters:** `branches`, `branches-ignore`, `paths`, `paths-ignore`

**Job semantics:** `jobs.<id>.if`, `needs`, `permissions`

**Dispatch inputs:** `boolean`, `choice`

**Trust:** internal PR, fork/external PR

**Explicitly unsupported in v0.1:** `workflow_run`, `schedule`, `repository_dispatch`, `merge_group`, full reusable workflows, dynamic job outputs, complex matrices, `concurrency`, full environment protection, organization Actions policies, enterprise Actions policies, shell-step semantics, container execution.

Unsupported semantics must produce `UNKNOWN` when relevant, never fake certainty.

---

## 9. Scenario abstraction

We cannot enumerate infinite strings. Generate finite equivalence classes from the workflow itself.

**Events:** only events actually declared or referenced.

**Branch/ref classes:** derive representatives from `branches`, `branches-ignore`, explicit refs in conditions, known default branch where available. Examples: `main`, one matching `feature/*`, one matching `release/*`, one branch matching no pattern.

**Changed-file classes:** derive representatives from `paths`, `paths-ignore`. Examples: `src/example.ts`, `docs/example.md`, one path matching neither, empty change class where semantically meaningful. Do not model every file path.

**Actor/fork classes:** at minimum internal collaborator, external/fork contributor.

**workflow_dispatch inputs:** use declared domains — `boolean` -> `true | false`; `choice` -> every declared choice. Do not invent values outside declared domains.

**needs results:** do not enumerate these freely. Compute them from execution propagation.

---

## 10. Reachability algorithm

For each workflow:

1. Parse YAML with GitHub parser.
2. Normalize into `WorkflowModel`.
3. Derive the finite scenario domain.
4. Generate realizable scenario candidates.
5. For each scenario:
   - determine whether workflow trigger matches,
   - evaluate jobs in dependency order,
   - evaluate `job.if`,
   - propagate `needs`/skips,
   - compute permissions/trust metadata,
   - produce `JobResult[]` plus evidence.
6. Deduplicate scenarios that have identical observable behavior.
7. Evaluate invariants.
8. Minimize any violating counterexample.
9. Report.

The engine must preserve GitHub's evaluation ordering where relevant. Do not treat workflow YAML as generic unordered configuration.

---

## 11. V0.1 checks

Start with exactly three.

**CP001 — Unreachable job.** A job never reaches RUN in any supported realizable scenario.

```
CP001: release-preview is unreachable.

Required simultaneously:
event = pull_request
github.ref = refs/heads/main

No supported pull_request scenario satisfies both.
```

**CP002 — Prerequisite bypass.** A protected/deployment/release job is reachable while a declared prerequisite has not completed. User intent must be explicit where possible.

```yaml
rules:
  - name: production-needs-tests
    whenever:
      job: deploy-production
    require:
      completed:
        - integration-tests
```

Counterexample:
```
integration-tests     SKIPPED
deploy-production     RUN
```

**CP003 — Untrusted privileged path.** An external/fork context can reach a job that has relevant elevated permissions or a user-declared privileged role.

```
fork pull request
      ↓
pull_request_target
      ↓
publish-preview
      ↓
deploy-production

deploy-production:
contents: write
packages: write
```

Do not merely flag `pull_request_target`. Prove the reachable path.

---

## 12. Invariant DSL

After the core engine is trustworthy, add `.ciproof.yml`.

```yaml
version: 1

rules:
  - name: production-needs-tests
    whenever:
      job: deploy-production
    require:
      completed:
        - unit-tests
        - integration-tests

  - name: forks-cannot-deploy
    never:
      job: deploy-production
      when:
        fork: true

  - name: release-needs-security
    whenever:
      job: release
    require:
      completed:
        - security-scan
```

Keep the DSL small. Do not build a general-purpose logic language in v1.

---

## 13. Counterexample minimization

A counterexample should be as small as possible. If a violation only requires `event=workflow_dispatch`, `branch=main`, `skip_tests=true`, do not show irrelevant values.

```
✗ production-needs-tests

REFUTED

Minimal counterexample:

event: workflow_dispatch
branch: main
inputs:
  skip_tests: true

Execution:
build                 RUN
integration-tests     SKIPPED
deploy-production     RUN

Why deploy ran:
✓ trigger matched workflow_dispatch
✓ branch main matched
✓ deploy.if evaluated true
✓ deploy does not require integration-tests
```

Counterexample quality is a core product feature.

---

## 14. Semantic diff

Implement only after single-revision reachability is correct.

```
ciproof diff origin/main...HEAD
```

Algorithm:

1. Analyze base revision.
2. Analyze head revision.
3. Normalize comparable jobs/workflows.
4. Compare reachable scenario classes.
5. Report: paths gained, paths lost, prerequisites gained/lost, permissions increased/decreased.

```
deploy-production

BEFORE:
push -> main

AFTER:
push -> main
workflow_dispatch -> main     NEW

Behavior change:
+ deploy-production became reachable from workflow_dispatch

Privilege:
contents: write
```

Do not call textual YAML changes "semantic" unless they actually changed modeled behavior.

---

## 15. Required-check deadlock detector

Valuable, but post-core, not the first detector.

Important distinction:

- an entire workflow skipped by path/branch filtering can lead to required-check problems,
- an individual job skipped via `if:` has different GitHub status behavior.

Do not collapse those two cases. Add this only after we have a reliable way to know which checks are required.

Initial version can accept explicit required checks:

```
ciproof check --required "CI / test"
```

Later `ciproof check --repo owner/repo` can fetch relevant repository rules and branch protection.

---

## 16. GitHub Actions policies

GitHub supports Actions policies at repository, organization, and enterprise levels. Do not model policy APIs in v0.1.

Plan for a later read-only mode: `ciproof check --repo owner/repo`, where applicable policies become constraints on scenario realizability. Policy constraints must reduce false counterexamples. Do not report an execution path as realizable when an enforced GitHub policy makes it impossible.

---

## 17. Testing strategy

Correctness is the project. Use three independent test layers.

**Layer A — Unit tests.** Test branch glob matching, path matching, condition evaluation, needs propagation, three-valued truth, counterexample minimization.

**Layer B — Semantic compatibility fixtures.** Create tiny repositories/workflows designed to test GitHub semantics: `pull-request-ref`, `pull-request-target-ref`, `needs-skipped`, `needs-always`, `if-before-matrix`, `workflow-path-filter`, `job-if-skip`, `dispatch-boolean`, `fork-context`, `permissions-default`. Run these fixtures on real GitHub Actions. Compare actual outcomes with CIProof predictions. CIProof must not claim broad support until the compatibility suite agrees with GitHub.

**Layer C — Real-world corpus.** Collect workflows from real public repositories. Purpose: does CIProof find useful issues? (Not: is CIProof semantically correct?) Correctness and usefulness are separate measurements.

---

## 18. Validation gate before deep build

Do not spend eight weeks blindly. The first project milestone is a technical spike.

**Spike target:** implement enough to support `push`, `pull_request`, `workflow_dispatch`, `branches`, `paths`, `jobs.if`, `needs`.

```
ciproof paths <workflow>
```

Example input:

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

Expected conceptual output:

```
SCENARIO 1
pull_request
test    RUN
deploy  RUN

SCENARIO 2
workflow_dispatch
skip_tests=false
test    RUN
deploy  RUN

SCENARIO 3
workflow_dispatch
skip_tests=true
test    SKIPPED
deploy  RUN
```

Then check:

```
Invariant:
Whenever deploy runs, test must have completed.

Result:
REFUTED

Counterexample:
workflow_dispatch
skip_tests=true
```

If this engine cannot accurately match GitHub behavior, stop and fix semantics before continuing.

---

## 19. Development phases

**Phase 0 — Research and fixture setup (2–3 days).** Initialize TypeScript repo, license, Vitest, lint/format, GitHub parser adapter, 15–30 semantic fixture workflows, support matrix document. No website. No branding beyond project name. Acceptance: fixtures load, parser adapter has tests, unsupported constructs are visible.

**Phase 1 — Semantic model (~1 week).** Workflow discovery, parser adapter, normalized trigger model, job model, needs DAG, condition representation, source locations. Command: `ciproof inspect`. Acceptance: 30 fixtures normalize correctly; dependency graphs match expected structure.

**Phase 2 — Concrete scenario evaluator (~1 week).** Event contexts, branch/path filters, dispatch inputs, `job.if`, needs propagation, RUN/SKIP/BLOCKED/UNKNOWN, evidence traces. Command: `ciproof explain deploy --event workflow_dispatch --branch main`. Acceptance: CIProof outcomes match the semantic compatibility fixture runs.

**Phase 3 — Scenario explorer (~1 week).** Equivalence classes, bounded Cartesian exploration, pruning, behavior deduplication, state/time limits. Command: `ciproof paths`. Acceptance: normal workflows finish quickly; duplicate execution plans collapse; unmodeled semantics surface as UNKNOWN.

**Phase 4 — First three checks (~1 week).** CP001 unreachable job, CP002 prerequisite bypass, CP003 untrusted privileged path. Add minimal counterexample generation. Command: `ciproof check`. Acceptance: every finding contains exact workflow/job, counterexample, execution trace, source evidence, and no fake confidence score.

**Phase 5 — Real-world validation.** Run against a meaningful corpus. For every finding: manually verify, classify true/false/unknown, record unsupported semantics, add regressions. Go/no-go: proceed only if CIProof finds useful, defensible behavior that existing syntax/security tools do not explain as clearly.

**Phase 6 — Invariant DSL.** Add `.ciproof.yml`. Keep rule syntax deliberately small. Acceptance: user can express "deploy requires tests", "forks cannot deploy", "release requires security-scan" and receive minimal counterexamples.

**Phase 7 — Semantic diff.** Implement `ciproof diff origin/main...HEAD`. This becomes the headline feature. Acceptance: on workflow changes, CIProof accurately reports paths gained/lost.

**Phase 8 — GitHub Action.** Only after local CLI is trusted. Outputs: terminal, JSON, SARIF, PR comment.

```
CIProof

This PR changes CI behavior:

+ workflow_dispatch can now reach deploy-production
- integration-tests are no longer guaranteed before deploy

Counterexample available.
```

**Phase 9 — Policies and required checks.** Add optional authenticated GitHub API integration for required checks, rulesets, Actions policies. This should constrain realizability. Do not make GitHub API access mandatory for normal local analysis.

**Phase 10 — Advanced formal backend.** Only if state explosion becomes a demonstrated problem. Possible future backend: Z3 / SMT. Translate supported expressions to constraints such as `exists scenario: deploy_reachable = true AND integration_tests_completed = false`. SAT -> concrete counterexample. UNSAT -> property holds within the explicitly supported symbolic model. Do not add SMT for marketing value.

---

## 20. CLI design

Initial commands:

```
ciproof check
ciproof paths
ciproof explain <job>
ciproof inspect
```

Later:

```
ciproof diff origin/main...HEAD
ciproof graph
ciproof check --format json
ciproof check --format sarif
ciproof check --repo owner/repo
```

Suggested exit codes:

```
0  no violated invariants
1  violation found
2  invalid CIProof configuration
3  workflow parse/model error
4  analysis incomplete / unsupported semantics
```

Do not silently return success when analysis is materially incomplete.

---

## 21. Output philosophy

Terminal output should be concise and evidence-heavy.

```
✗ CP002 production-needs-tests

workflow_dispatch
branch=main
skip_tests=true

test      SKIPPED
deploy    RUN
```

Machine output must include stable IDs and structured evidence. Later formats: JSON, SARIF, Mermaid/SVG. Graph output is supportive, not the main product.

---

## 22. Performance constraints

The state space can explode. From the beginning:

- derive classes only from referenced patterns,
- deduplicate equivalent contexts,
- prune impossible combinations early,
- topologically evaluate jobs,
- memoize condition results where safe,
- enforce state and time limits,
- report partial analysis honestly.

Do not brute-force arbitrary strings.

---

## 23. Security constraints

CIProof analyzes repositories that may be untrusted. Never execute:

- workflow shell commands,
- repository scripts,
- local actions,
- arbitrary JS from the repo,
- Docker containers.

Parsing must not imply execution. Treat workflow/repository content as hostile input. Do not automatically upload repository contents anywhere.

---

## 24. Privacy and offline behavior

Default behavior: offline, local, read-only, no telemetry, no account. Authenticated GitHub API features must be explicit. Do not send workflow contents to external services.

---

## 25. What NOT to build initially

Do not build: a cloud dashboard, account/login, an LLM chatbot, workflow auto-fixing, generic security scanning, CI cost analysis, a workflow editor, GitLab CI, Jenkins, CircleCI, Azure Pipelines, container execution, shell analysis, organization-wide dashboards, Z3 before it is needed, a fancy web graph before the CLI works.

The magic is:

```
npx ciproof check
```

and a concrete bad path appears.

---

## 26. Launch criteria

Do not launch based only on synthetic examples. Before public launch:

- ✓ semantic compatibility suite exists
- ✓ real GitHub runs validate supported behavior
- ✓ at least 100 public workflows parse
- ✓ every unsupported construct is explicit
- ✓ false counterexamples are rare and treated as bugs
- ✓ real-world corpus contains defensible findings
- ✓ `ciproof check` is useful locally
- ✓ `ciproof diff` works on real workflow PRs
- ✓ README demo is based on a reproducible example

---

## 27. Launch message

Primary README:

```
# CIProof

Write what your CI must guarantee.
Get a counterexample when it doesn't.

GitHub Actions are programs:
events, branches, permissions, conditions,
dependencies, inputs, and trust boundaries.

But we still review them like YAML.

CIProof explores meaningful workflow execution paths
and shows the concrete scenario that breaks your invariant.

$ npx ciproof check

✗ production-needs-tests

Counterexample:
workflow_dispatch
branch=main
skip_integration=true

integration-tests     SKIPPED
deploy-production     RUN

No workflow was executed.
No secrets were required.
```

Secondary line: *Find the CI paths you didn't know you had.*

---

## 28. The 10-second demo

The launch GIF should show:

1. Open `.github/workflows/deploy.yml`
2. Change one harmless-looking condition
3. Run `npx ciproof diff origin/main...HEAD`
4. Output:
   ```
   NEW PRIVILEGED PATH

   workflow_dispatch
        ↓
      build
        ↓
   deploy-production

   integration-tests are no longer guaranteed.
   ```
5. Show the minimal counterexample.

No narration required.

---

## 29. Open-source strategy

Make extension points explicit only after the core stabilizes. Good community contribution areas: event semantics fixtures, compatibility tests, output formats, new invariant types, policy adapters, real-world regression cases.

Do not encourage contributors to add dozens of shallow security pattern rules. CIProof's identity is behavioral verification.

---

## 30. Research direction

Long term, CIProof can become bounded model checking for CI/CD configuration. Potential research topics: sound equivalence-class abstraction for CI event state spaces, behavioral verification of CI/CD policies, minimal counterexample generation, semantic diffing of configuration programs, trust-boundary reachability, SMT-backed verification of GitHub Actions, composition of workflow semantics with repository/org/enterprise execution policies.

This research direction is legitimate only if the implementation and evaluation are rigorous. Do not add academic language to marketing before the engine earns it.

---

## 31. Coding rules

For every implementation task:

1. Understand actual GitHub semantics first.
2. Add or update a fixture.
3. Write the failing test.
4. Implement the smallest semantic change.
5. Verify UNKNOWN behavior for unsupported cases.
6. Run full tests.
7. Do not widen scope opportunistically.

Avoid clever abstractions until two real call sites require them. Prefer small explicit types and pure functions in the semantic engine. No hidden network calls. No workflow execution. No implicit LLM usage.

---

## 32. Correctness rules

Every semantic feature must have:

1. documentation reference or observed GitHub behavior,
2. compatibility fixture,
3. expected output,
4. unit/integration test.

When GitHub docs and observed behavior disagree: record the discrepancy, prefer measured behavior for compatibility, document the assumption, add a regression fixture.

---

## 33. Commit / PR artifact rules

Do not mention coding-assistant usage in: commit messages, PR titles, PR bodies, branch names, code comments, tests, documentation, changelogs, issue comments, release notes.

Write normal engineering artifacts describing the code and behavior only.

Do not commit this `CLAUDE.md` file unless explicitly requested.

---

## 34. Immediate next task

Do not start with semantic diff, graphs, SARIF, or GitHub API integration.

The next task is the **semantic spike**:

```
workflow -> finite contexts -> job reachability -> invariant -> counterexample
```

Implement, in order:

1. TypeScript project skeleton.
2. GitHub workflow-parser adapter.
3. Normalized `WorkflowModel`.
4. Event contexts for `pull_request` and `workflow_dispatch`.
5. needs DAG.
6. basic `jobs.<id>.if` evaluation.
7. boolean dispatch inputs.
8. `ciproof paths`.
9. one invariant: "deploy requires test".
10. minimal counterexample rendering.
11. compatibility fixtures on real GitHub.

Only after this passes do we proceed to broader events and detectors.

---

## 35. Definition of success for the spike

Given:

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

CIProof must correctly enumerate meaningful execution behavior and discover:

```
REFUTED

Counterexample:
event=workflow_dispatch
skip_tests=true

test      SKIPPED
deploy    RUN
```

for the invariant: *Whenever deploy runs, test must have completed.*

If CIProof cannot reproduce GitHub's actual behavior on this and the compatibility fixtures, do not proceed to product polish. Fix semantics first.

---

## 36. Decision rule

Always optimize in this order:

```
correctness > trust > counterexample quality > usefulness > performance > features > visual polish
```

CIProof wins only if developers trust its counterexamples.
