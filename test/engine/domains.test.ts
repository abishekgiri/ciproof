import { describe, expect, it } from "vitest";
import {
  buildDomains,
  generateScenarios,
  validateScenario,
  DEFAULT_LIMITS,
  type AnalysisLimitation,
  type EventDomain,
} from "../../src/engine/index.js";
import { loadModel } from "../helpers/fixtures.js";

async function domainsFor(
  fixture: string,
): Promise<{ domains: EventDomain[]; limitations: AnalysisLimitation[] }> {
  return buildDomains(await loadModel(fixture));
}

function domain(
  domains: EventDomain[],
  event: EventDomain["event"],
): EventDomain {
  const found = domains.find((d) => d.event === event);
  if (!found) {
    throw new Error(`no domain for ${event}`);
  }
  return found;
}

describe("event domain", () => {
  it("A. generates domains for each declared supported event", async () => {
    const { domains } = await domainsFor("explore/canonical.yml");
    expect(domains.map((d) => d.event).sort()).toEqual([
      "pull_request",
      "workflow_dispatch",
    ]);
  });

  it("B. does not generate undeclared events", async () => {
    const { domains } = await domainsFor("triggers/push.yml");
    expect(domains.map((d) => d.event)).toEqual(["push"]);
  });
});

describe("branch domains", () => {
  it("C. includes exact branch filters", async () => {
    const { domains } = await domainsFor("filters/branches.yml");
    expect(domain(domains, "push").branches).toContain("main");
  });

  it("D. includes a verified wildcard witness", async () => {
    const { domains } = await domainsFor("filters/branches.yml");
    // release/** -> a synthesized branch under release/
    expect(
      domain(domains, "push").branches.some((b) => b.startsWith("release/")),
    ).toBe(true);
  });

  it("G. includes a non-matching branch class", async () => {
    const { domains } = await domainsFor("filters/branches.yml");
    const branches = domain(domains, "push").branches;
    expect(
      branches.some((b) => b.includes("unmatched") || b.includes("none")),
    ).toBe(true);
  });

  it("E. handles ordered negative branch patterns without crashing", async () => {
    const { domains } = await domainsFor("explore/ordered-branches.yml");
    expect(domain(domains, "push").branches.length).toBeGreaterThan(0);
  });
});

describe("workflow_dispatch input domains", () => {
  it("H. enumerates boolean inputs as false and true", async () => {
    const { domains } = await domainsFor("triggers/workflow-dispatch.yml");
    const combos = domain(domains, "workflow_dispatch").inputCombos;
    const values = combos.map((c) => c.skip_tests).sort();
    expect(values).toEqual([false, true]);
  });

  it("I. enumerates every declared choice option", async () => {
    const { domains } = await domainsFor("conditions/choice-input.yml");
    const combos = domain(domains, "workflow_dispatch").inputCombos;
    const envs = combos.map((c) => c.environment).sort();
    expect(envs).toEqual(["production", "staging"]);
  });

  it("J. records a limitation for an unsupported input type", async () => {
    const { limitations } = await domainsFor("conditions/choice-input.yml");
    expect(
      limitations.some(
        (l) => l.kind === "unsupported-input" && l.message.includes("note"),
      ),
    ).toBe(true);
  });
});

describe("fork / trust domains", () => {
  it("K. generates internal and fork variants for pull_request", async () => {
    const { domains } = await domainsFor("triggers/pull-request.yml");
    const forks = domain(domains, "pull_request").forks;
    expect(forks.map((f) => f.fork).sort()).toEqual([false, true]);
  });

  it("L. generates no fork variants for push", async () => {
    const { domains } = await domainsFor("triggers/push.yml");
    expect(domain(domains, "push").forks).toEqual([
      { fork: false, actorClass: "internal" },
    ]);
  });
});

describe("changed-file domains", () => {
  it("M/O. includes a matching and a non-matching file set for paths", async () => {
    const { domains } = await domainsFor("filters/paths.yml");
    const sets = domain(domains, "push").fileSets;
    expect(
      sets.some((s) =>
        s.some((f) => f.endsWith(".ts") || f.startsWith("src/")),
      ),
    ).toBe(true);
    expect(sets.some((s) => s.length === 0)).toBe(true); // empty class
  });

  it("N/P. includes ignored and mixed file sets for paths-ignore", async () => {
    const { domains } = await domainsFor("filters/paths-ignore.yml");
    const sets = domain(domains, "push").fileSets;
    expect(sets.some((s) => s.length === 1)).toBe(true); // single ignored
    expect(sets.some((s) => s.length >= 2)).toBe(true); // mixed ignored + surviving
  });
});

describe("scenario generation pruning", () => {
  it("Q. every generated scenario passes validation without errors", async () => {
    const { domains } = await domainsFor("explore/canonical.yml");
    const { scenarios } = generateScenarios(domains, DEFAULT_LIMITS);
    expect(scenarios.length).toBeGreaterThan(0);
    for (const scenario of scenarios) {
      expect(
        validateScenario(scenario).filter((d) => d.severity === "error"),
      ).toEqual([]);
    }
  });
});
