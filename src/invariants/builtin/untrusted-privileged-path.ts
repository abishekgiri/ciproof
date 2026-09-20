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
    const job = model.jobs.get(jobId);

    // A local reusable-workflow call: trace the chain to the internal
    // privileged job rather than only flagging the caller job.
    if (job?.reusableCall?.resolved) {
      const chain = chainFinding(jobId, model, exploration);
      if (chain) {
        findings.push(chain);
      }
      continue;
    }

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

type WriteState =
  | { kind: "write-all" }
  | { kind: "scopes"; scopes: Set<string> }
  | { kind: "none" }
  | { kind: "unspecified" };

/** The caller job's granted write capability (upper bound for the called workflow). */
function callerWriteState(jobId: string, model: WorkflowModel): WriteState {
  const job = model.jobs.get(jobId);
  const perm =
    job && job.permissions.mode !== "unspecified"
      ? job.permissions
      : model.permissions;
  if (perm.mode === "unspecified") {
    return { kind: "unspecified" };
  }
  if (perm.mode === "write-all") {
    return { kind: "write-all" };
  }
  if (perm.mode === "read-all") {
    return { kind: "none" };
  }
  const scopes = new Set(
    Object.entries(perm.scopes ?? {})
      .filter(
        ([s, l]) =>
          (l as PermissionLevel) === "write" && WRITE_CAPABLE_SCOPES.has(s),
      )
      .map(([s]) => s),
  );
  return scopes.size > 0 ? { kind: "scopes", scopes } : { kind: "none" };
}

/**
 * CP003 through a resolved local reusable workflow. Permissions cannot be
 * elevated through the call, so the effective write is min(caller, called).
 * pull_request_target -> violated; ordinary fork pull_request or an
 * unspecified/unprovable caller grant -> unknown.
 */
function chainFinding(
  callJobId: string,
  model: WorkflowModel,
  exploration: CheckContext["exploration"],
): Finding | null {
  const callJob = model.jobs.get(callJobId);
  const called = callJob?.reusableCall?.resolved;
  if (!callJob || !called) {
    return null;
  }

  const external = exploration.evaluations.filter(
    (e) =>
      e.scenario.fork === true &&
      e.scenario.actorClass === "external" &&
      e.jobs[callJobId] === "run",
  );
  const target =
    external.find((e) => e.scenario.event === "pull_request_target") ??
    external.find((e) => e.scenario.event === "pull_request");
  if (!target) {
    return null;
  }

  const callerState = callerWriteState(callJobId, model);
  if (callerState.kind === "none") {
    return null; // caller grants no write; called cannot elevate
  }

  // Find a privileged, unconditionally-reachable job in the called workflow.
  for (const [calledJobId] of called.jobs) {
    if (!unconditionallyReachable(calledJobId, called)) {
      continue;
    }
    const calledPriv = privilegeOf(calledJobId, called);
    if (!calledPriv) {
      continue;
    }
    const effective = effectiveWrite(callerState, calledPriv);
    if (effective === "none") {
      continue;
    }

    const path = callJob.reusableCall?.target;
    const pathLabel = path?.kind === "local" ? path.path : "reusable workflow";
    const scopeLabel =
      effective === "write-all" ? "write-all" : [...effective].join(", ");
    const chainEvidence = [
      evidence(
        target.scenario.event === "pull_request_target" ? "pass" : "info",
        `external ${target.scenario.event} from a fork/external actor`,
      ),
      evidence("pass", `job "${callJobId}" runs and calls ${pathLabel}`),
      evidence("pass", `called job "${calledJobId}" runs`),
      evidence(
        "info",
        `effective write (min of caller and called): ${scopeLabel}`,
      ),
    ];

    if (
      callerState.kind === "unspecified" ||
      target.scenario.event !== "pull_request_target"
    ) {
      return {
        id: CP003_ID,
        title: "untrusted privileged path",
        severity: "error",
        verdict: "unknown",
        message: `a fork context can reach privileged job "${calledJobId}" via reusable workflow ${pathLabel}, but the effective privilege is not provable`,
        jobId: callJobId,
        scenario: target.scenario,
        evidence: chainEvidence,
        limitations: [
          {
            kind:
              callerState.kind === "unspecified"
                ? "permission-unknown"
                : "fork-token",
            message:
              callerState.kind === "unspecified"
                ? "caller permissions are unspecified; effective privilege depends on repository/org defaults CIProof does not model"
                : "GitHub downgrades write tokens for fork pull_request runs unless repository settings allow them",
          },
        ],
      };
    }

    return {
      id: CP003_ID,
      title: "untrusted privileged path",
      severity: "error",
      verdict: "violated",
      message: `external pull_request_target can reach privileged job "${calledJobId}" through reusable workflow ${pathLabel}`,
      jobId: callJobId,
      scenario: target.scenario,
      evidence: chainEvidence,
      limitations: [
        {
          kind: "policy",
          message:
            "repository/org Actions execution policies are not modeled; an external policy may block this event",
        },
      ],
    };
  }

  return null;
}

/** min(caller, called) write capability. */
function effectiveWrite(
  caller: WriteState,
  called: Privilege,
): "write-all" | Set<string> | "none" {
  if (caller.kind === "unspecified") {
    // Treated as potentially granting; verdict handled as UNKNOWN by caller.
    return called.writeAll ? "write-all" : new Set(called.writeScopes);
  }
  if (caller.kind === "none") {
    return "none";
  }
  if (caller.kind === "write-all") {
    return called.writeAll ? "write-all" : new Set(called.writeScopes);
  }
  // caller.kind === "scopes"
  if (called.writeAll) {
    return caller.scopes.size > 0 ? caller.scopes : "none";
  }
  const inter = new Set(called.writeScopes.filter((s) => caller.scopes.has(s)));
  return inter.size > 0 ? inter : "none";
}

/** A called job is unconditionally reachable if it and all its needs have no `if`. */
function unconditionallyReachable(
  jobId: string,
  model: WorkflowModel,
  seen: Set<string> = new Set(),
): boolean {
  if (seen.has(jobId)) {
    return true;
  }
  seen.add(jobId);
  const job = model.jobs.get(jobId);
  if (!job || job.condition) {
    return false;
  }
  return job.needs.every((need) => unconditionallyReachable(need, model, seen));
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
