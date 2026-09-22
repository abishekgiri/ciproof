// Guards a release: the pushed tag must match package.json's version, e.g. tag
// "v0.1.1" requires "version": "0.1.1". Used by the publish workflow so a
// mismatched or accidental tag can never publish the wrong version. The version
// itself is never inferred or modified here — that happens before the tag exists.
//
// Usage: node scripts/check-release-version.mjs [<tag>]
//   Tag falls back to $GITHUB_REF_NAME when the argument is omitted.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const tag = (process.argv[2] ?? process.env.GITHUB_REF_NAME ?? "").trim();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
const expected = `v${version}`;

if (tag !== expected) {
  process.stderr.write(
    `release tag "${tag}" does not match package.json version ` +
      `(expected "${expected}")\n`,
  );
  process.exit(1);
}

process.stdout.write(`release tag ${tag} matches package.json ${version}\n`);
