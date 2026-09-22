# Trusted Publishing (npm via GitHub Actions OIDC)

From v0.1.1 onward, CIProof is published to npm through GitHub Actions using
**npm Trusted Publishing** (OIDC) — there is **no long-lived npm token** in the
repository or CI. The publish workflow exchanges a short-lived GitHub OIDC token
for npm credentials at publish time, and npm attaches **provenance**
automatically for the public package.

```
git tag vX.Y.Z  ─▶  .github/workflows/publish.yml  ─▶  OIDC  ─▶  npm publish (+provenance)
```

## Release flow

1. Bump `version` in `package.json` on `main` and merge it.
2. Create an annotated tag matching that version and push it:
   ```bash
   git tag -a vX.Y.Z -m "CIProof vX.Y.Z"
   git push origin vX.Y.Z
   ```
3. The tag push triggers [`publish.yml`](../.github/workflows/publish.yml), which:
   - verifies the tag matches `package.json` (`scripts/check-release-version.mjs`),
   - runs the full gate (`typecheck`, `lint`, `format:check`, `test`, `build`,
     `release:check`),
   - refuses to republish an existing version,
   - publishes with `npm publish` using OIDC (token-free).
4. Create the GitHub Release from `docs/releases/vX.Y.Z.md`.
5. Optionally run the **Public package smoke** workflow (manual) to verify the
   published version from the registry across Ubuntu/macOS/Windows.

## One-time npm-side configuration (account settings — cannot be done in code)

The trusted-publisher relationship is configured on npmjs.com, not in the repo.
On the `ciproof` package settings, add a trusted publisher:

| Field             | Value                                                       |
| ----------------- | ----------------------------------------------------------- |
| Provider          | GitHub Actions                                              |
| Organization/user | `abishekgiri`                                               |
| Repository        | `ciproof`                                                   |
| Workflow filename | `publish.yml`                                               |
| Environment       | (leave blank unless the workflow uses a GitHub Environment) |

The package must already exist for this configuration to be available — which it
does, since v0.1.0 was published first with an authenticated (OTP) publish.

## Why not a token

- No secret to leak or rotate; nothing to store in GitHub secrets.
- npm receives short-lived, workflow-scoped OIDC credentials.
- Provenance ties the published artifact to the exact repository, commit, and
  workflow. Do not add `--provenance` manually or set `NPM_TOKEN` /
  `NODE_AUTH_TOKEN` for publishing — trusted publishing handles it.

## Verifying provenance after a trusted-publishing release

```bash
npm view ciproof@X.Y.Z          # check the version is live
# in a fresh project after installing:
npm audit signatures            # should report a verified provenance attestation
```

v0.1.0 was published manually before trusted publishing existed, so it has **no
provenance**; that is expected and only applies to that first release.
