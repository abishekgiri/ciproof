/**
 * Runs the built-in checks against a workflow's exploration result.
 *
 * CP001 (unreachable) and CP003 (untrusted privileged path) need no user
 * intent and always run. CP002 (prerequisite bypass) requires explicit rules.
 */

import type { CheckContext, Finding, PrerequisiteRule } from "./types.js";
import { checkUnreachableJob } from "./builtin/unreachable-job.js";
import { checkPrerequisiteBypass } from "./builtin/prerequisite-bypass.js";
import { checkUntrustedPrivilegedPath } from "./builtin/untrusted-privileged-path.js";

export interface CheckOptions {
  prerequisiteRules?: PrerequisiteRule[];
}

/** Run all applicable built-in checks; returns findings in a stable order. */
export function runChecks(
  context: CheckContext,
  options: CheckOptions = {},
): Finding[] {
  const findings: Finding[] = [];
  findings.push(...checkUnreachableJob(context));
  if (options.prerequisiteRules && options.prerequisiteRules.length > 0) {
    findings.push(
      ...checkPrerequisiteBypass(context, options.prerequisiteRules),
    );
  }
  findings.push(...checkUntrustedPrivilegedPath(context));
  return findings;
}
