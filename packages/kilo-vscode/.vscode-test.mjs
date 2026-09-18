// DEPRECATED: the local integration-test flow now uses `script/vscode-test-runner.ts`
// (see `bun run test:integration`). This @vscode/test-cli config is retained only for
// compatibility; it downloads an instance and is no longer used by `bun run test`.
import { defineConfig } from "@vscode/test-cli"

export default defineConfig({
  files: "out/test/**/*.test.js",
})
