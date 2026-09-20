/**
 * CP003 — untrusted privileged path.
 *
 * Reports when an external/fork context can reach a job with EXPLICITLY modeled
 * write privilege. It is deliberately conservative:
 *  - only explicit `write` scopes / `write-all` count as privileged;
 *    `unspecified` permissions are never treated as privileged;
 *  - effective privilege = job-level permissions, else workflow-level
 *    (repository/org/enterprise defaults and fork token downgrades are NOT
 *    modeled);
 *  - `pull_request_target` external reach -> VIOLATED (with a policy limitation);
 *  - ordinary `pull_request` fork reach -> UNKNOWN (GitHub downgrades fork write
 *    tokens unless repo settings allow them, which CIProof does not know).
 *
 * It never claims fork code executes — only that an external context can reach a
 * privileged job under the modeled workflow definition.
 */

import { evidence } from "../../engine/index.js";
import type {
  PermissionLevel,
  PermissionModel,
  WorkflowModel,
} from "../../model/index.js";
import type { CheckContext, Finding } from "../types.js";

export const CP003_ID = "CP003";

/** Write-capable permission scopes GitHub recognizes. */
const WRITE_CAPABLE_SCOPES = new Set([
  "actions",
  "checks",
  "contents",
  "deployments",
  "discussions",
  "issues",
  "packages",
  "pages",
  "pull-requests",
  "security-events",
  "statuses",
  "id-token",
]);

interface Privilege {
  writeAll: boolean;
  writeScopes: string[];
  /** Where the effective permission came from. */
  source: "job" | "workflow";
}

export function checkUntrustedPrivilegedPath(context: CheckContext): Finding[] {
  const { model, exploration } = context;
  const findings: Finding[] = [];

  for (const [jobId] of model.jobs) {
    const privilege = privilegeOf(jobId, model);
    if (!privilege) {
      continue; // no explicitly modeled write privilege
    }

    const external = exploration.evaluations.filter(
      (e) =>
        e.scenario.fork === true &&
        e.scenario.actorClass === "external" &&
        e.jobs[jobId] === "run",
    );
    if (external.length === 0) {
      continue; // no external context reaches this privileged job
    }

    const target =
      external.find((e) => e.scenario.event === "pull_request_target") ??
      external.find((e) => e.scenario.event === "pull_request");
    if (!target) {
      continue;
    }

    const privilegeEvidence = privilege.writeAll
      ? [
          evidence(
            "info",
            `explicit privilege: write-all (${privilege.source}-level)`,
          ),
        ]
      : privilege.writeScopes.map((scope) =>
          evidence(
            "info",
            scope === "id-token"
              ? `explicit privilege: id-token: write (OIDC token request; ${privilege.source}-level)`
              : `explicit privilege: ${scope}: write (${privilege.source}-level)`,
          ),
        );

    if (target.scenario.event === "pull_request_target") {
      findings.push({
        id: CP003_ID,
        title: "untrusted privileged path",
        severity: "error",
        verdict: "violated",
        message: `external pull_request_target can reach privileged job "${jobId}"`,
        jobId,
        scenario: target.scenario,
        evidence: [
          evidence(
            "pass",
            "event pull_request_target from a fork/external actor",
          ),
          evidence("pass", `privileged job "${jobId}" runs`),
          ...privilegeEvidence,
        ],
        limitations: [
          {
            kind: "policy",
            message:
              "repository/org Actions execution policies are not modeled; an external policy may block this event",
          },
        ],
      });
    } else {
      // Ordinary fork pull_request: effective write privilege is unknowable
      // without repository settings, so this is UNKNOWN, not a violation.
      findings.push({
        id: CP003_ID,
        title: "untrusted privileged path",
        severity: "error",
        verdict: "unknown",
        message: `a fork pull_request can reach job "${jobId}", which declares write privilege; effective privilege depends on repository settings CIProof does not model`,
        jobId,
        scenario: target.scenario,
        evidence: [
          evidence("info", "event pull_request from a fork/external actor"),
          evidence("info", `job "${jobId}" runs and declares write privilege`),
          ...privilegeEvidence,
        ],
        limitations: [
          {
            kind: "fork-token",
            message:
              "GitHub downgrades write tokens for fork pull_request runs unless repository settings allow them; CIProof does not model that setting",
          },
        ],
      });
    }
  }

  return findings;
}

function privilegeOf(jobId: string, model: WorkflowModel): Privilege | null {
  const job = model.jobs.get(jobId);
  if (!job) {
    return null;
  }
  const jobPriv = privilegeFrom(job.permissions, "job");
  if (jobPriv) {
    return jobPriv;
  }
  // Job did not declare permissions: fall back to the workflow-level default.
  if (job.permissions.mode === "unspecified") {
    return privilegeFrom(model.permissions, "workflow");
  }
  return null;
}

function privilegeFrom(
  permissions: PermissionModel,
  source: "job" | "workflow",
): Privilege | null {
  if (permissions.mode === "write-all") {
    return { writeAll: true, writeScopes: [], source };
  }
  if (permissions.mode === "explicit" && permissions.scopes) {
    const writeScopes = Object.entries(permissions.scopes)
      .filter(
        ([scope, level]) =>
          (level as PermissionLevel) === "write" &&
          WRITE_CAPABLE_SCOPES.has(scope),
      )
      .map(([scope]) => scope)
      .sort((a, b) => a.localeCompare(b));
    if (writeScopes.length > 0) {
      return { writeAll: false, writeScopes, source };
    }
  }
  return null;
}
