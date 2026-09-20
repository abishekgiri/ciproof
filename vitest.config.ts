import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The GitHub language-services packages import JSON schema files without
    // native ESM import attributes, which Node's loader rejects. Pre-bundling
    // them with esbuild (which inlines JSON) makes the parser usable in tests.
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ["@actions/workflow-parser", "@actions/expressions"],
        },
      },
    },
  },
});
