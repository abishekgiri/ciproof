/**
 * CIProof command-line entry point.
 *
 * Phase 1 exposes exactly one product command, `inspect`, which prints the
 * normalized model of the workflows it discovers. No behavioral analysis
 * (check / paths / explain) exists yet — those arrive in later phases.
 */

import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { runInspect } from "./inspect.js";

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

  return program;
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
