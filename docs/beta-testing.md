# Try CIProof on your repository (~10 minutes)

CIProof v0.1.0 is a bounded, deterministic behavioral verifier for GitHub
Actions. It never executes your workflows and needs no secrets. This guide walks
through evaluating it on a real repository and reporting what you find.

## 1. Run the built-in checks

From the root of a repository that has `.github/workflows/`:

```bash
npx ciproof@0.1.0 check
```

CIProof reports one of three verdicts per finding:

- **REFUTED** (`✗`) — a concrete counterexample exists; it is printed (event, ref,
  inputs, and the job states that make it happen).
- **NO VIOLATION FOUND** (`✓`) — no violation across the modeled scenarios. This is
  **not** a universal proof of safety.
- **UNKNOWN** (`?`) — CIProof cannot decide this soundly within its modeled
  semantics. **UNKNOWN is not a pass** — it is an honest "cannot determine".

## 2. Explore the modeled scenarios

```bash
npx ciproof@0.1.0 paths
```

This lists the distinct execution plans CIProof derived — a good way to see how it
understands your workflows and where it reports UNKNOWN.

## 3. Add an invariant (optional)

Create `ciproof.yml` at the repo root:

```yaml
version: 1
invariants:
  - id: deploy-needs-tests
    require:
      when-job-runs: deploy
      job-must-have-run: tests
```

Then re-run:

```bash
npx ciproof@0.1.0 check
```

If a modeled scenario runs `deploy` while `tests` was skipped, CIProof prints the
concrete counterexample. (See a runnable example in [`examples/basic/`](../examples/basic/).)

## 4. See how a change affects behavior (optional)

```bash
npx ciproof@0.1.0 diff origin/main...HEAD
```

Reports how modeled CI behavior changed between two git revisions — reachability
gained/lost, scenario changes, and MODELED/UNKNOWN transitions. Requires `git`.

## What to report back

Feedback is voluntary and flows through GitHub issues — CIProof collects **no
telemetry** and makes no network calls. Please report:

- **false counterexamples** — a REFUTED result that cannot actually happen on
  GitHub (a correctness bug; use the _False counterexample_ issue form),
- **unexpected UNKNOWN** — where you expected a decision (the _Unexpected UNKNOWN_
  form; this helps prioritize future semantics),
- **false RUN / SKIP / BLOCK** predictions,
- **install issues**, **confusing output**, or **missing GitHub Actions semantics**.

**Remove any secrets before sharing workflow or config content.**

## Where CIProof is bounded

CIProof models a subset of GitHub Actions; everything else is UNKNOWN. See
[supported-semantics.md](supported-semantics.md) for the exact surface and
[validation-study.md](validation-study.md) for real-world accuracy evidence on the
pinned corpus.
