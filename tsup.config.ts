import { defineConfig } from "tsup";

// CIProof ships as a CLI. The GitHub language-services packages
// (@actions/workflow-parser, @actions/expressions) import JSON schema files
// without runtime import attributes, which native Node ESM rejects. Bundling
// with esbuild inlines those imports, so the built CLI runs under plain `node`.
export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  // Inline the GitHub packages so their bare JSON imports are resolved at build time.
  noExternal: [/^@actions\//],
  banner: {
    // Shebang, plus a `require` shim: bundling CommonJS transitive deps (e.g.
    // `yaml`) into ESM turns their internal `require(...)` into a runtime error
    // unless a real `require` exists. `createRequire` provides one.
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __ciproofCreateRequire } from "node:module";',
      "const require = __ciproofCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
