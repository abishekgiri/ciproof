import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDiff } from "../../src/diff.js";
import {
  parseRevisionRange,
  isGitRepository,
  GitError,
} from "../../src/diff/git.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "ci",
      GIT_AUTHOR_EMAIL: "ci@example.com",
      GIT_COMMITTER_NAME: "ci",
      GIT_COMMITTER_EMAIL: "ci@example.com",
    },
  });
}

/** Create a temp git repo and commit each provided revision's workflow files. */
function makeRepo(revisions: Record<string, string>[]): string {
  const root = mkdtempSync(join(tmpdir(), "ciproof-diff-"));
  tempDirs.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  revisions.forEach((files, index) => {
    for (const [rel, content] of Object.entries(files)) {
      writeFileSync(join(root, rel), content);
    }
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", `rev ${index}`]);
  });
  return root;
}

const WF = ".github/workflows/ci.yml";

function pushMain(jobBody: string): string {
  return `on:\n  push:\n    branches: [main]\njobs:\n${jobBody}`;
}

const UNREACHABLE = pushMain(
  "  deploy:\n    if: ${{ false }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
);
const REACHABLE = pushMain(
  "  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
);

describe("parseRevisionRange", () => {
  it("splits three-dot and two-dot forms", () => {
    expect(parseRevisionRange("main...HEAD")).toEqual({
      base: "main",
      head: "HEAD",
    });
    expect(parseRevisionRange("HEAD~1..HEAD")).toEqual({
      base: "HEAD~1",
      head: "HEAD",
    });
  });

  it("rejects a range with no separator or a missing side", () => {
    expect(() => parseRevisionRange("HEAD")).toThrow(GitError);
    expect(() => parseRevisionRange("...HEAD")).toThrow(GitError);
    expect(() => parseRevisionRange("main...")).toThrow(GitError);
  });
});

describe("runDiff — end to end over real commits", () => {
  it("detects an added reachability across two commits", async () => {
    const root = makeRepo([{ [WF]: UNREACHABLE }, { [WF]: REACHABLE }]);
    const { output, exitCode } = await runDiff({
      root,
      revisions: "HEAD~1...HEAD",
    });
    expect(exitCode).toBe(0);
    expect(output).toContain("ADDED REACHABILITY");
    expect(output).toContain("deploy");
    expect(output).toContain("push → refs/heads/main");
  });

  it("reports no changes for a formatting-only commit", async () => {
    const reformatted = `# a comment\njobs:\n  deploy:\n    steps:\n      - run: echo\n    runs-on: "ubuntu-latest"\non:\n  push:\n    branches:\n      - main\n`;
    const root = makeRepo([{ [WF]: REACHABLE }, { [WF]: reformatted }]);
    const { output, exitCode } = await runDiff({
      root,
      revisions: "HEAD~1...HEAD",
    });
    expect(exitCode).toBe(0);
    expect(output).toContain("No modeled CI behavior changes.");
  });

  it("emits JSON when requested", async () => {
    const root = makeRepo([{ [WF]: UNREACHABLE }, { [WF]: REACHABLE }]);
    const { output, exitCode } = await runDiff({
      root,
      revisions: "HEAD~1...HEAD",
      json: true,
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output);
    expect(parsed.changeCount).toBe(1);
    expect(parsed.changes[0].category).toBe("added-reachability");
  });
});

describe("runDiff — invalid input (H)", () => {
  it("fails cleanly with a non-zero exit on an invalid revision", async () => {
    const root = makeRepo([{ [WF]: REACHABLE }, { [WF]: UNREACHABLE }]);
    const { output, exitCode } = await runDiff({
      root,
      revisions: "definitely-not-a-ref...HEAD",
    });
    expect(exitCode).toBe(2);
    expect(output).toContain("error:");
    expect(output).toContain("definitely-not-a-ref");
  });

  it("fails cleanly on a malformed range", async () => {
    const root = makeRepo([{ [WF]: REACHABLE }]);
    const { exitCode, output } = await runDiff({ root, revisions: "HEAD" });
    expect(exitCode).toBe(2);
    expect(output).toContain("error:");
  });

  it("fails cleanly when the directory is not a git repository", async () => {
    const root = mkdtempSync(join(tmpdir(), "ciproof-nogit-"));
    tempDirs.push(root);
    expect(isGitRepository(root)).toBe(false);
    const { exitCode, output } = await runDiff({
      root,
      revisions: "HEAD~1...HEAD",
    });
    expect(exitCode).toBe(2);
    expect(output).toContain("not a git repository");
  });
});

describe("runDiff — dirty worktree safety (I)", () => {
  it("does not modify the working tree or index, and reads committed content", async () => {
    const root = makeRepo([{ [WF]: UNREACHABLE }, { [WF]: REACHABLE }]);

    // Dirty the working tree: uncommitted edit + an untracked file.
    const dirtyContent = "# locally edited, uncommitted\n" + UNREACHABLE;
    writeFileSync(join(root, WF), dirtyContent);
    writeFileSync(join(root, "scratch.txt"), "untracked");

    const statusBefore = git(root, ["status", "--porcelain"]);
    const fileBefore = readFileSync(join(root, WF), "utf8");

    const { exitCode, output } = await runDiff({
      root,
      revisions: "HEAD~1...HEAD",
    });

    // The diff read committed content (added reachability), NOT the dirty file.
    expect(exitCode).toBe(0);
    expect(output).toContain("ADDED REACHABILITY");

    // The working tree and index are untouched.
    expect(git(root, ["status", "--porcelain"])).toBe(statusBefore);
    expect(readFileSync(join(root, WF), "utf8")).toBe(fileBefore);
    expect(readFileSync(join(root, WF), "utf8")).toBe(dirtyContent);
  });
});
