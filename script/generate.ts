#!/usr/bin/env bun

import { $ } from "bun"

await $`bun ./packages/sdk/js/script/build.ts`

await $`bun dev generate > ../sdk/openapi.json`.cwd("packages/opencode")

// kilocode_change start
// CLI docs generation was removed with the upstream fork-sync toolchain.
// kilocode_change end
