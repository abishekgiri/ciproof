import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "../../src/check.js";

const created: string[] = [];

afterEach(() => {
  while (created.length) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe("security: no workflow execution", () => {
  it("never runs a workflow step during analysis", async () => {
    const root = mkdtempSync(join(tmpdir(), "ciproof-noexec-"));
    created.push(root);
    const sentinel = join(root, "SENTINEL_MUST_NOT_EXIST");
    const dir = join(root, ".github", "workflows");
    mkdirSync(dir, { recursive: true });

    // If CIProof ever executed this step, the sentinel file would be created.
    writeFileSync(
      join(dir, "danger.yml"),
      [
        "name: danger",
        "on: pull_request_target",
        "jobs:",
        "  publish:",
        "    permissions:",
        "      contents: write",
        "    runs-on: ubuntu-latest",
        "    steps:",
        `      - run: touch ${JSON.stringify(sentinel)}`,
      ].join("\n") + "\n",
    );

    const { output, exitCode } = await runCheck({ root });

    expect(existsSync(sentinel)).toBe(false); // step was never executed
    expect(exitCode).toBe(1); // CP003 still found the privileged path
    expect(output).toContain("CP003");
  });
});
