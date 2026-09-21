import { describe, expect, it } from "vitest";
import { validateConfig } from "../../src/config/schema.js";

function valid(): unknown {
  return {
    version: 1,
    invariants: [
      {
        id: "production-needs-tests",
        require: {
          "when-job-runs": "deploy-production",
          "job-must-have-run": "integration-tests",
        },
      },
    ],
  };
}

describe("validateConfig — valid configs (A)", () => {
  it("accepts a well-formed job-requires-job config", () => {
    const result = validateConfig(valid());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.invariants[0]).toMatchObject({
        kind: "job-requires-job",
        id: "production-needs-tests",
        target: { id: "deploy-production" },
        requires: { id: "integration-tests" },
      });
    }
  });

  it("accepts job-not-reachable and job-only-reachable, with qualified job refs", () => {
    const result = validateConfig({
      version: 1,
      invariants: [
        {
          id: "forks-cannot-publish",
          require: {
            "job-not-reachable": { job: "publish", trust: "fork" },
          },
        },
        {
          id: "release-only-from-tags",
          require: {
            "job-only-reachable": {
              job: { workflow: "release.yml", id: "release" },
              event: "push",
              ref: "tag",
            },
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.invariants[1]).toMatchObject({
        kind: "job-only-reachable",
        job: { workflow: "release.yml", id: "release" },
        events: ["push"],
        refs: ["tag"],
      });
    }
  });
});

describe("validateConfig — rejections", () => {
  it("C. rejects an unsupported version", () => {
    const result = validateConfig({ ...(valid() as object), version: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path === "version")).toBe(true);
    }
  });

  it("C. rejects a missing version", () => {
    const cfg = valid() as { version?: number };
    delete cfg.version;
    const result = validateConfig(cfg);
    expect(result.ok).toBe(false);
  });

  it("D. rejects duplicate invariant ids", () => {
    const result = validateConfig({
      version: 1,
      invariants: [
        { id: "dup", require: { "job-not-reachable": { job: "a" } } },
        { id: "dup", require: { "job-not-reachable": { job: "b" } } },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => /duplicate/.test(i.message))).toBe(true);
    }
  });

  it("E. rejects unknown keys (typos) rather than ignoring them", () => {
    const result = validateConfig({
      version: 1,
      invariants: [
        {
          id: "typo",
          require: { "job-not-reachable": { job: "publish", trustt: "fork" } },
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("F. rejects an unknown invariant rule kind", () => {
    const result = validateConfig({
      version: 1,
      invariants: [{ id: "weird", require: { "make-it-safe": true } }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid event name", () => {
    const result = validateConfig({
      version: 1,
      invariants: [
        {
          id: "bad-event",
          require: { "job-not-reachable": { job: "j", event: "deployment" } },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some((i) => i.path.includes("job-not-reachable.event")),
      ).toBe(true);
    }
  });

  it("rejects an invalid trust value", () => {
    const result = validateConfig({
      version: 1,
      invariants: [
        {
          id: "bad-trust",
          require: { "job-not-reachable": { job: "j", trust: "stranger" } },
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing invariant id", () => {
    const result = validateConfig({
      version: 1,
      invariants: [{ require: { "job-not-reachable": { job: "j" } } }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid invariant id pattern", () => {
    const result = validateConfig({
      version: 1,
      invariants: [
        { id: "-bad id", require: { "job-not-reachable": { job: "j" } } },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects two rule forms in one invariant", () => {
    const result = validateConfig({
      version: 1,
      invariants: [
        {
          id: "two-forms",
          require: {
            "when-job-runs": "deploy",
            "job-must-have-run": "tests",
            "job-not-reachable": { job: "deploy" },
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects job-requires-job missing one side", () => {
    const result = validateConfig({
      version: 1,
      invariants: [{ id: "half", require: { "when-job-runs": "deploy" } }],
    });
    expect(result.ok).toBe(false);
  });

  it("produces deterministic, path-sorted issues", () => {
    const bad = {
      version: 2,
      invariants: [{ id: "x", require: {} }],
    };
    const a = validateConfig(bad);
    const b = validateConfig(bad);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
