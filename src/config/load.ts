/**
 * Configuration discovery and loading for `ciproof.yml`.
 *
 * Discovery is deterministic: the canonical filename is `ciproof.yml`, with
 * `ciproof.yaml` accepted as an alias. If BOTH exist, that is a configuration
 * error (never a silent choice). The file is treated as untrusted declarative
 * data: it is parsed as plain YAML and validated — never evaluated or executed.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { validateConfig, type ConfigIssue } from "./schema.js";
import type { CiproofConfig } from "./types.js";

export const CONFIG_FILENAMES = ["ciproof.yml", "ciproof.yaml"] as const;

export type ConfigLoad =
  | { status: "none" }
  | { status: "ok"; path: string; config: CiproofConfig }
  | { status: "error"; path?: string; issues: ConfigIssue[] };

export interface LoadConfigOptions {
  root: string;
  /** Explicit config path (from `--config`); overrides discovery. */
  configPath?: string;
}

/** Discover, read, parse, and validate the project configuration. */
export function loadConfig(options: LoadConfigOptions): ConfigLoad {
  const path = resolvePath(options);
  if (path.status === "none") {
    return { status: "none" };
  }
  if (path.status === "error") {
    return { status: "error", issues: path.issues };
  }

  let content: string;
  try {
    content = readFileSync(path.path, "utf8");
  } catch {
    return {
      status: "error",
      path: path.path,
      issues: [{ path: "(file)", message: `cannot read ${path.path}` }],
    };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (err) {
    const message =
      err instanceof YAMLParseError ? err.message : "invalid YAML";
    return {
      status: "error",
      path: path.path,
      issues: [{ path: "(yaml)", message }],
    };
  }

  if (parsed === null || parsed === undefined) {
    return {
      status: "error",
      path: path.path,
      issues: [{ path: "(root)", message: "configuration file is empty" }],
    };
  }

  const validated = validateConfig(parsed);
  if (!validated.ok) {
    return { status: "error", path: path.path, issues: validated.issues };
  }
  return { status: "ok", path: path.path, config: validated.config };
}

type PathResolution =
  | { status: "none" }
  | { status: "found"; path: string }
  | { status: "error"; issues: ConfigIssue[] };

function resolvePath(options: LoadConfigOptions): PathResolution {
  if (options.configPath !== undefined) {
    const explicit = isAbsolute(options.configPath)
      ? options.configPath
      : join(options.root, options.configPath);
    if (!existsSync(explicit)) {
      return {
        status: "error",
        issues: [
          { path: "(file)", message: `config file not found: ${explicit}` },
        ],
      };
    }
    return { status: "found", path: explicit };
  }

  const present = CONFIG_FILENAMES.map((name) =>
    join(options.root, name),
  ).filter((candidate) => existsSync(candidate));
  if (present.length === 0) {
    return { status: "none" };
  }
  if (present.length > 1) {
    return {
      status: "error",
      issues: [
        {
          path: "(discovery)",
          message: `multiple config files found (${CONFIG_FILENAMES.join(", ")}); keep only one`,
        },
      ],
    };
  }
  return { status: "found", path: present[0]! };
}
