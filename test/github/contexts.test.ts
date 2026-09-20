import { describe, expect, it } from "vitest";
import {
  SUPPORTED_EVENTS,
  isSupportedEvent,
} from "../../src/github/contexts.js";

describe("event boundary", () => {
  it("declares exactly the v0.1 supported events", () => {
    expect([...SUPPORTED_EVENTS]).toEqual([
      "push",
      "pull_request",
      "pull_request_target",
      "workflow_dispatch",
    ]);
  });

  it("recognizes supported events", () => {
    expect(isSupportedEvent("push")).toBe(true);
    expect(isSupportedEvent("pull_request_target")).toBe(true);
  });

  it("rejects out-of-scope events", () => {
    expect(isSupportedEvent("schedule")).toBe(false);
    expect(isSupportedEvent("workflow_run")).toBe(false);
    expect(isSupportedEvent("repository_dispatch")).toBe(false);
  });
});
