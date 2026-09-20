import { describe, expect, it } from "vitest";
import { checkUntrustedPrivilegedPath } from "../../src/invariants/index.js";
import { contextFor } from "./helpers.js";

describe("CP003 — untrusted privileged path", () => {
  it("B. external pull_request_target -> explicit contents:write -> violated", async () => {
    const context = await contextFor("security/prt-write.yml");
    const [finding] = checkUntrustedPrivilegedPath(context);
    expect(finding?.verdict).toBe("violated");
    expect(finding?.jobId).toBe("publish");
    expect(finding?.scenario?.event).toBe("pull_request_target");
    expect(finding?.scenario?.fork).toBe(true);
  });

  it("C. external pull_request_target -> write-all (workflow-level) -> violated", async () => {
    const context = await contextFor("security/workflow-write-all.yml");
    const [finding] = checkUntrustedPrivilegedPath(context);
    expect(finding?.verdict).toBe("violated");
    expect(finding?.jobId).toBe("publish");
  });

  it("D. external path to a read-only job -> no finding", async () => {
    const context = await contextFor("security/prt-readonly.yml");
    expect(checkUntrustedPrivilegedPath(context)).toEqual([]);
  });

  it("F. ordinary fork pull_request with explicit write -> unknown", async () => {
    const context = await contextFor("security/pr-fork-write.yml");
    const [finding] = checkUntrustedPrivilegedPath(context);
    expect(finding?.verdict).toBe("unknown");
  });

  it("E. unspecified permissions are not treated as write", async () => {
    // pull-request-target.yml's build job has no permissions; publish-preview
    // has explicit write. Only the explicit-write job is a candidate.
    const context = await contextFor("trust/pull-request-target.yml");
    const findings = checkUntrustedPrivilegedPath(context);
    expect(findings.every((f) => f.jobId !== "build")).toBe(true);
  });

  it("G. pull_request_target finding includes the policy limitation", async () => {
    const context = await contextFor("security/prt-write.yml");
    const [finding] = checkUntrustedPrivilegedPath(context);
    expect(
      finding?.limitations.some((l) => l.message.includes("policies")),
    ).toBe(true);
  });

  it("H. id-token: write is flagged and categorized as OIDC", async () => {
    const context = await contextFor("security/prt-idtoken.yml");
    const [finding] = checkUntrustedPrivilegedPath(context);
    expect(finding?.verdict).toBe("violated");
    expect(finding?.evidence.some((e) => e.message.includes("id-token"))).toBe(
      true,
    );
    expect(finding?.evidence.some((e) => e.message.includes("OIDC"))).toBe(
      true,
    );
  });

  it("I. counterexample selection is deterministic", async () => {
    const context = await contextFor("security/prt-write.yml");
    const a = checkUntrustedPrivilegedPath(context);
    const b = checkUntrustedPrivilegedPath(context);
    expect(JSON.stringify(a[0]?.scenario)).toBe(JSON.stringify(b[0]?.scenario));
  });
});
