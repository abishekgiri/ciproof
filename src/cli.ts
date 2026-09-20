/**
 * CIProof command-line entry point.
 *
 * Commands: `inspect` (normalized model), `explain` (evaluate one concrete
 * scenario), and `paths` (explore the modeled scenario space into distinct
 * execution plans). Invariant checking / counterexamples are a later phase.
 */

import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { runInspect } from "./inspect.js";
import { runExplain } from "./explain.js";
import { runPaths } from "./paths.js";
import type { SupportedTriggerEvent } from "./model/index.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("ciproof")
    .description(
      "Behavioral verification for GitHub Actions. Write what your CI must " +
        "guarantee, get a concrete counterexample when it doesn't.",
    )
    .version(pkg.version, "-v, --version", "print the CIProof version");

  program
    .command("inspect")
    .description(
      "show the normalized model of discovered workflows (no analysis)",
    )
    .option("-C, --dir <path>", "repository root to inspect", process.cwd())
    .option("--json", "emit the normalized model as JSON", false)
    .action(async (options: { dir: string; json: boolean }) => {
      const { output, exitCode } = await runInspect({
        root: options.dir,
        json: options.json,
      });
      process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
      process.exitCode = exitCode;
    });

  program
    .command("paths")
    .description(
      "explore the modeled scenario space and list distinct execution plans",
    )
    .option("-C, --dir <path>", "repository root to inspect", process.cwd())
    .option(
      "--workflow <file>",
      "restrict to workflows whose path contains this",
    )
    .option(
      "--max-scenarios <n>",
      "maximum scenarios to evaluate before truncating",
      (value) => Number.parseInt(value, 10),
    )
    .option("--json", "emit the exploration as JSON", false)
    .action(
      async (options: {
        dir: string;
        workflow?: string;
        maxScenarios?: number;
        json: boolean;
      }) => {
        const { output, exitCode } = await runPaths({
          root: options.dir,
          ...(options.workflow !== undefined
            ? { workflow: options.workflow }
            : {}),
          ...(options.maxScenarios !== undefined &&
          !Number.isNaN(options.maxScenarios)
            ? { maxScenarios: options.maxScenarios }
            : {}),
          json: options.json,
        });
        process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
        process.exitCode = exitCode;
      },
    );

  const supportedEvents: SupportedTriggerEvent[] = [
    "push",
    "pull_request",
    "pull_request_target",
    "workflow_dispatch",
  ];

  program
    .command("explain")
    .description("evaluate one concrete scenario and explain a job's outcome")
    .argument("<job>", "the job id to explain")
    .requiredOption(
      "--event <event>",
      `triggering event (${supportedEvents.join(" | ")})`,
    )
    .option("-C, --dir <path>", "repository root to inspect", process.cwd())
    .option("--ref <ref>", "git ref for the run (e.g. refs/heads/main)")
    .option("--branch <name>", "branch name (push)")
    .option("--base-ref <name>", "base branch (pull_request family)")
    .option("--head-ref <name>", "head branch (pull_request family)")
    .option("--fork", "the pull request comes from a fork", false)
    .option(
      "--changed-file <path>",
      "a changed file (repeatable)",
      collect,
      [] as string[],
    )
    .option(
      "--input <key=value>",
      "a workflow_dispatch input (repeatable)",
      collectInput,
      {} as Record<string, boolean | string>,
    )
    .option("--json", "emit the evaluation as JSON", false)
    .action(async (job: string, options: ExplainCliOptions) => {
      if (!supportedEvents.includes(options.event)) {
        process.stderr.write(
          `Unsupported event "${options.event}". Supported: ${supportedEvents.join(", ")}\n`,
        );
        process.exitCode = 2;
        return;
      }
      const { output, exitCode } = await runExplain({
        root: options.dir,
        job,
        event: options.event,
        ...(options.ref !== undefined ? { ref: options.ref } : {}),
        ...(options.branch !== undefined ? { branch: options.branch } : {}),
        ...(options.baseRef !== undefined ? { baseRef: options.baseRef } : {}),
        ...(options.headRef !== undefined ? { headRef: options.headRef } : {}),
        fork: options.fork,
        changedFiles: options.changedFile,
        inputs: options.input,
        json: options.json,
      });
      process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
      process.exitCode = exitCode;
    });

  return program;
}

interface ExplainCliOptions {
  event: SupportedTriggerEvent;
  dir: string;
  ref?: string;
  branch?: string;
  baseRef?: string;
  headRef?: string;
  fork: boolean;
  changedFile: string[];
  input: Record<string, boolean | string>;
  json: boolean;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function collectInput(
  value: string,
  previous: Record<string, boolean | string>,
): Record<string, boolean | string> {
  const eq = value.indexOf("=");
  const key = eq === -1 ? value : value.slice(0, eq);
  const raw = eq === -1 ? "true" : value.slice(eq + 1);
  const parsed: boolean | string =
    raw === "true" ? true : raw === "false" ? false : raw;
  return { ...previous, [key]: parsed };
}

export async function run(argv: readonly string[]): Promise<void> {
  await buildProgram().parseAsync(argv as string[]);
}

// Only auto-run when invoked as a script, not when imported by tests.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  await run(process.argv);
}
