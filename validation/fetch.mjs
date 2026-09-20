// Fetches workflow files for a pinned corpus of public repositories.
// Uses `gh api` for metadata (auth, rate limits) and records exact commit SHAs.
// Never executes any downloaded content — files are written to a local cache.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, "cache");
const MAX_WORKFLOWS_PER_REPO = 8;

const REPOS = [
  // JavaScript / TypeScript
  ["sindresorhus/got", "library"],
  ["expressjs/express", "library"],
  ["chalk/chalk", "library"],
  ["axios/axios", "library"],
  ["lodash/lodash", "library"],
  ["prettier/prettier", "cli"],
  ["eslint/eslint", "cli"],
  ["vitejs/vite", "web"],
  ["date-fns/date-fns", "library"],
  ["colinhacks/zod", "library"],
  // Python
  ["psf/requests", "library"],
  ["pallets/flask", "web"],
  ["pytest-dev/pytest", "cli"],
  ["tiangolo/fastapi", "web"],
  ["psf/black", "cli"],
  ["encode/httpx", "library"],
  ["python-poetry/poetry", "cli"],
  ["pydantic/pydantic", "library"],
  // Go
  ["gin-gonic/gin", "web"],
  ["spf13/cobra", "library"],
  ["junegunn/fzf", "cli"],
  ["cli/cli", "cli"],
  ["sigstore/cosign", "security"],
  // Rust
  ["BurntSushi/ripgrep", "cli"],
  ["sharkdp/bat", "cli"],
  ["sharkdp/fd", "cli"],
  ["clap-rs/clap", "library"],
  ["serde-rs/serde", "library"],
  ["tokio-rs/tokio", "library"],
  // Java / JVM
  ["google/gson", "library"],
  ["square/okhttp", "library"],
  ["junit-team/junit5", "library"],
  // Infra / devops
  ["helm/helm", "devops"],
  ["argoproj/argo-cd", "devops"],
  ["kubernetes-sigs/kustomize", "devops"],
  ["fluxcd/flux2", "devops"],
  // Security tooling
  ["aquasecurity/trivy", "security"],
  ["gitleaks/gitleaks", "security"],
  ["trufflesecurity/trufflehog", "security"],
  // CLI / tools
  ["jqlang/jq", "cli"],
  ["stedolan/jq", "cli"],
  ["muesli/duf", "cli"],
  // Actions ecosystem (fork-PR heavy, explicit permissions)
  ["actions/checkout", "actions"],
  ["actions/setup-node", "actions"],
  ["actions/upload-artifact", "actions"],
  ["step-security/harden-runner", "security"],
  // Web apps / frameworks
  ["gatsbyjs/gatsby", "web"],
  ["strapi/strapi", "web"],
  ["nestjs/nest", "web"],
  ["withastro/astro", "web"],
];

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function resolveSha(repo) {
  const out = gh(["api", `repos/${repo}`, "--jq", ".default_branch"]).trim();
  const branch = out || "main";
  const sha = gh([
    "api",
    `repos/${repo}/commits/${branch}`,
    "--jq",
    ".sha",
  ]).trim();
  return { branch, sha };
}

function listWorkflows(repo, sha) {
  try {
    const json = gh([
      "api",
      `repos/${repo}/contents/.github/workflows?ref=${sha}`,
    ]);
    const entries = JSON.parse(json);
    return entries
      .filter(
        (e) =>
          e.type === "file" &&
          (e.name.endsWith(".yml") || e.name.endsWith(".yaml")),
      )
      .map((e) => e.path)
      .sort()
      .slice(0, MAX_WORKFLOWS_PER_REPO);
  } catch {
    return [];
  }
}

function fetchFile(repo, path, sha) {
  const b64 = gh([
    "api",
    `repos/${repo}/contents/${path}?ref=${sha}`,
    "--jq",
    ".content",
  ]);
  return Buffer.from(b64.replace(/\n/g, ""), "base64").toString("utf8");
}

const manifest = [];
for (const [repo, category] of REPOS) {
  try {
    const { branch, sha } = resolveSha(repo);
    const workflows = listWorkflows(repo, sha);
    if (workflows.length === 0) {
      manifest.push({ repo, commit: sha, branch, category, workflowFiles: [], notes: "no workflows found" });
      process.stderr.write(`- ${repo}: no workflows\n`);
      continue;
    }
    const localDir = join(CACHE, repo.replace("/", "__"));
    mkdirSync(localDir, { recursive: true });
    const files = [];
    for (const path of workflows) {
      const content = fetchFile(repo, path, sha);
      const local = join(localDir, path.replace(/\//g, "__"));
      writeFileSync(local, content);
      files.push({ path, local });
    }
    manifest.push({ repo, commit: sha, branch, category, workflowFiles: files, notes: "" });
    process.stderr.write(`+ ${repo}@${sha.slice(0, 8)} (${files.length} workflows)\n`);
  } catch (err) {
    manifest.push({ repo, commit: null, category, workflowFiles: [], notes: `fetch error: ${String(err.message ?? err).slice(0, 120)}` });
    process.stderr.write(`! ${repo}: ${String(err.message ?? err).slice(0, 80)}\n`);
  }
}

writeFileSync(
  join(HERE, "corpus.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      repoCount: manifest.length,
      repos: manifest,
    },
    null,
    2,
  ),
);
process.stderr.write(`\nWrote corpus.json with ${manifest.length} repos\n`);
