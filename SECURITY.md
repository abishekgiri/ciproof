# Security Policy

## Supported versions

CIProof is pre-1.0. Security fixes are made against the latest released `0.x`
version. Please upgrade to the latest release before reporting.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Reporting a vulnerability

Please report suspected vulnerabilities privately using GitHub's
["Report a vulnerability"](https://github.com/abishekgiri/ciproof/security/advisories/new)
security-advisory flow. Do not open a public issue for a security-sensitive
report. We will acknowledge the report and work on a fix; no response-time SLA is
promised for this pre-1.0 project.

## Threat model

CIProof analyzes workflow and repository content that may be **attacker
controlled**. It treats all such content as untrusted data:

- CIProof **parses YAML and analyzes it statically**. It does **not** execute
  workflow `run:` steps, repository scripts, local actions, Dockerfiles, or
  package scripts from analyzed repositories.
- Running `ciproof check`, `paths`, `explain`, or `inspect` needs **no secrets or
  tokens**, and no network access.
- `ciproof diff` reads git objects read-only; it never modifies the working tree
  or index.
- The validation corpus tooling (`validation/`) fetches pinned public workflow
  files into a local cache and likewise never executes them.

Security-sensitive issues include (non-exhaustively): a code path that could
execute analyzed repository content, a way to make CIProof read or exfiltrate
files outside the analyzed repository, or output that leaks local filesystem
paths, tokens, or environment values.
