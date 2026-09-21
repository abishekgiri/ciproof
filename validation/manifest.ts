/**
 * Validation for the corpus manifest, the counterexample audit, and cache paths.
 *
 * Pure functions over already-parsed data, so the test suite can exercise them
 * with no network. The manifest pins every repository to an immutable full
 * commit SHA; the audit records manual verdicts on concrete counterexamples.
 */

import { isAbsolute, normalize } from "node:path";

export interface ManifestEntry {
  repo: string;
  commit: string;
  category?: string;
}

export interface Manifest {
  version: number;
  repositories: ManifestEntry[];
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

export const VALID_AUDIT_VERDICTS = [
  "TRUE_POSITIVE",
  "FALSE_POSITIVE",
  "UNVERIFIED",
] as const;
export type AuditVerdict = (typeof VALID_AUDIT_VERDICTS)[number];

export interface AuditFinding {
  repo: string;
  commit: string;
  workflow: string;
  job?: string;
  rule: string;
  verdict: AuditVerdict;
  evidence: string[];
}

export interface Audit {
  version: number;
  method: string;
  findings: AuditFinding[];
}

/** Validate a corpus manifest: version, entry shape, pinned SHAs, no duplicates. */
export function validateManifest(value: unknown): string[] {
  const issues: string[] = [];
  if (typeof value !== "object" || value === null) {
    return ["manifest is not an object"];
  }
  const m = value as Partial<Manifest>;
  if (m.version !== 1) {
    issues.push(`unsupported manifest version: ${String(m.version)}`);
  }
  if (!Array.isArray(m.repositories)) {
    issues.push("repositories must be an array");
    return issues;
  }
  const seenRepos = new Set<string>();
  m.repositories.forEach((entry, index) => {
    const where = `repositories[${index}]`;
    if (typeof entry?.repo !== "string" || !REPO_PATTERN.test(entry.repo)) {
      issues.push(`${where}.repo is not a valid "owner/name"`);
    } else if (seenRepos.has(entry.repo)) {
      issues.push(`${where}.repo is a duplicate: ${entry.repo}`);
    } else {
      seenRepos.add(entry.repo);
    }
    if (typeof entry?.commit !== "string" || !FULL_SHA_PATTERN.test(entry.commit)) {
      issues.push(`${where}.commit must be a full 40-char commit SHA`);
    }
  });
  return issues;
}

/** Validate a counterexample audit: shape and allowed verdict values only. */
export function validateAudit(value: unknown): string[] {
  const issues: string[] = [];
  if (typeof value !== "object" || value === null) {
    return ["audit is not an object"];
  }
  const a = value as Partial<Audit>;
  if (a.version !== 1) {
    issues.push(`unsupported audit version: ${String(a.version)}`);
  }
  if (typeof a.method !== "string" || a.method.length === 0) {
    issues.push("audit.method must be a non-empty string");
  }
  if (!Array.isArray(a.findings)) {
    issues.push("audit.findings must be an array");
    return issues;
  }
  a.findings.forEach((finding, index) => {
    const where = `findings[${index}]`;
    if (typeof finding?.repo !== "string" || !REPO_PATTERN.test(finding.repo)) {
      issues.push(`${where}.repo is not a valid "owner/name"`);
    }
    if (
      typeof finding?.commit !== "string" ||
      !FULL_SHA_PATTERN.test(finding.commit)
    ) {
      issues.push(`${where}.commit must be a full 40-char commit SHA`);
    }
    if (typeof finding?.workflow !== "string" || finding.workflow.length === 0) {
      issues.push(`${where}.workflow must be a non-empty string`);
    }
    if (
      typeof finding?.verdict !== "string" ||
      !(VALID_AUDIT_VERDICTS as readonly string[]).includes(finding.verdict)
    ) {
      issues.push(
        `${where}.verdict must be one of ${VALID_AUDIT_VERDICTS.join(", ")}`,
      );
    }
    if (!Array.isArray(finding?.evidence)) {
      issues.push(`${where}.evidence must be an array`);
    }
  });
  return issues;
}

/**
 * A cache entry path is safe only if, once normalized, it stays within the cache
 * root and is not absolute. Prevents a manifest from escaping the cache dir.
 */
export function isSafeCacheEntry(entry: string): boolean {
  if (entry.length === 0 || isAbsolute(entry)) {
    return false;
  }
  const normalized = normalize(entry);
  return !normalized.startsWith("..") && !normalized.includes(`..`);
}
