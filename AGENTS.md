# AGENTS.md

This repo has been pruned to contain only the Kilo VS Code extension (`packages/kilo-vscode/`) plus its transitive workspace dependencies and minimal tooling. The CLI runtime in `packages/opencode/` is still present as a dependency, but the JetBrains plugin, docs site, storybook, console/web UIs, and other packages were removed.

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `main`; local development happens on `leocode`.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.
- You may be running in a git worktree. All changes must be made in your current working directory — never modify files in the main repo checkout.

## Build and Dev

- **Extension**: `bun run extension` (build + launch VS Code with the extension in dev mode). Pass `--no-build` to skip the build. When asked to run an isolated VS Code/Kilo environment, use the CLI scripts instead of interactive launch configs: `bun run extension:isolated` reuses `.kilo-dev/`, and `bun run extension:isolated:clean` clears `.kilo-dev/` first. Pass an optional workspace path after `--`, for example `bun run extension:isolated -- ../sample-project`.
- **Typecheck**: `bun turbo typecheck` (uses `tsgo`, not `tsc`) from the repo root.
- **Test**: `bun test` from `packages/kilo-vscode/` (NOT from root -- root blocks tests)
- **Single test**: `bun test ./test/path/to/file.test.ts` from `packages/kilo-vscode/`
- **SDK regen**: After changing server endpoints in `packages/opencode/src/server/`, run `bun run script/generate.ts` from root to regenerate `packages/sdk/js/`
- **Knip** (unused exports): `bun run knip` from `packages/kilo-vscode/`. CI runs this — all exported types/functions must be imported somewhere. Remove or unexport unused exports before pushing.
- **kilocode_change check**: `bun run check-kilocode-change` from `packages/kilo-vscode/`. CI runs this — `kilocode_change` is a marker for merge conflicts in shared files and must not appear in `packages/kilo-vscode/` or `packages/kilo-ui/` (these are entirely Kilo Code additions). Remove the markers before pushing.
- **kilocode_change check**: `bun run check-kilocode-change` from `packages/kilo-vscode/`. CI runs this — `kilocode_change` is a marker for merge conflicts in shared files and must not appear in `packages/kilo-vscode/` or `packages/kilo-ui/` (these are entirely Kilo Code additions). Remove the markers before pushing.
- **opencode annotation check**: `bun run script/check-opencode-annotations.ts --worktree` from repo root when verifying local agent changes. Every Kilo-specific change in shared opencode files must be annotated with `kilocode_change` markers. Exempt paths (no markers needed): `packages/opencode/src/kilocode/`, `packages/opencode/test/kilocode/`, and any path containing `kilocode` in the name.
- **Effect facade ratchet**: Do not add runtime-backed Promise facades to shared `packages/opencode/src` Effect services; use service dependencies, `AppRuntime`, or Kilo-owned boundaries. Run `bun run script/check-opencode-promise-facades.ts` when touching service adapters.
- **workflow allowlist**: `bun run script/check-workflows.ts` from repo root. Any `.yml` / `.yaml` file added to or removed from `.github/workflows/` must be reflected in the hardcoded list in `script/check-workflows.ts`.
- **Backend/SDK programmatic testing**: spawn the local backend with `bun dev serve` from `packages/opencode/` and drive it via `curl`; use this instead of `kilo serve` (prod binary) when testing backend fixes.

## Quality Checks

Before saying an implementation is ready, run the smallest relevant checks that can catch lint, typecheck, and test failures for the touched package. Do not rely on manual extension launch to discover build problems. Fix failures you introduce before the final response, or state exactly which check is still failing or could not be run.

| Area | Checks |
|---|---|
| Root / cross-package | `bun run lint`, `bun run typecheck` |
| CLI | From `packages/opencode/`: `bun run typecheck`, `bun test` or targeted `bun test ./path/to/file.test.ts` |
| VS Code extension | From `packages/kilo-vscode/`: `bun run typecheck`, `bun run lint`, `bun run test:unit` or `bun run test` |
| Extension build/package | From `packages/kilo-vscode/`: `bun run compile` or `bun run package` when touching build, packaging, SDK, or webview integration paths |
| CI/local guards | Run affected guards documented above, such as `bun run knip`, `bun run check-kilocode-change`, `bun run script/check-opencode-annotations.ts --worktree`, or source link extraction |

Never run root `bun test`; the root script prints `do not run tests from root` and exits with code 1. Use package-level tests instead.

## Products

The VS Code extension is a client of the **CLI** (`packages/opencode/`), which contains the AI agent runtime, HTTP server, and session management. The extension spawns or connects to a `kilo serve` process and communicates via HTTP + SSE using `@kilocode/sdk`.

| Product | Package | Description |
|---|---|---|
| Kilo CLI | `packages/opencode/` | Core engine. TUI, `kilo run`, `kilo serve`. Kept as a dependency of the extension. |
| Kilo VS Code Extension | `packages/kilo-vscode/` | VS Code extension. Bundles the CLI binary, spawns `kilo serve` as a child process. Includes the **Agent Manager** — a multi-session orchestration panel with git worktree isolation. |

**Agent Manager** refers to a feature inside `packages/kilo-vscode/` (extension code in `src/agent-manager/`, webview in `webview-ui/agent-manager/`). It is not a standalone product. See the extension's `AGENTS.md` for details.

In each VS Code extension host, one `KiloConnectionService` is created for the sidebar, every Kilo editor tab, and Agent Manager; it lazily starts and reuses one current `kilo serve` backend at a time. Agent Manager worktree sessions pass a directory context to this shared backend rather than starting one per worktree. State captured by the active service layer, such as Snapshot `trackState`, is shared across those requests; only directory-keyed `InstanceState` data is isolated.

Extension-specific settings should live in the Kilo extension settings, not default VS Code settings, unless they are intentionally VS Code-wide. Experimental flags should follow existing flag patterns, not VS Code settings; they usually belong in the Kilo Experimental settings section.

## Monorepo Structure

Turborepo + Bun workspaces. The packages you'll work with most:

| Package | Name | Purpose |
|---|---|---|
| `packages/opencode/` | `@kilocode/cli` | Core CLI -- agents, tools, sessions, server, TUI. Kept as the extension's runtime dependency. |
| `packages/sdk/js/` | `@kilocode/sdk` | Auto-generated TypeScript SDK (client for the server API). Do not edit `src/gen/` by hand. |
| `packages/kilo-vscode/` | `kilo-code` | VS Code extension with sidebar chat + Agent Manager. See its own `AGENTS.md` for details. |
| `packages/kilo-gateway/` | `@kilocode/kilo-gateway` | Kilo auth, provider routing, API integration |
| `packages/kilo-telemetry/` | `@kilocode/kilo-telemetry` | PostHog analytics + OpenTelemetry |
| `packages/kilo-i18n/` | `@kilocode/kilo-i18n` | Internationalization / translations |
| `packages/kilo-ui/` | `@kilocode/kilo-ui` | SolidJS component library shared by the extension webview |
| `packages/util/` | `@opencode-ai/util` | Shared utilities (error, path, retry, slug, etc.) |
| `packages/plugin/` | `@kilocode/plugin` | Plugin/tool interface definitions |

Pruned (removed) products, no longer present in this repo: `kilo-jetbrains`, `kilo-docs`, storybook, `sdk-next`, `httpapi-codegen`, `client`, `session-ui`, `kilo-console`, `kilo-web-ui`, plus top-level `perf/`, `plans/`, `specs/`, `translations/`, `artifacts/`, `docs/`, `bin/`, `github/`, `.opencode/`, and nix/flake config.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `vscode`, `cli`, `sdk`, `ui`, `i18n`, `gateway`, or `telemetry`.

Examples: `fix(vscode): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

- Keep things in one function unless composable or reusable
- Avoid unnecessary destructuring. Instead of `const { a, b } = obj`, use `obj.a` and `obj.b` to preserve context
- Avoid possibly out-of-bounds array access. Instead of `array[index] ?? {}`, use `array.at(index) ?? {}`. Instead of `array[array.length - 1]`, use `array.at(-1)`
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer `Promise.withResolvers<T>()` for deferreds when runtime/types support it; allow callback/event executors, not async executors or redundant Promise wrapping.

### Avoid let statements

Prefer `const`. Replace `let` + if/else assignment with a ternary or an IIFE. Reassignment is the only legitimate reason to reach for `let`.

### Naming Enforcement (Read This)

THIS RULE IS MANDATORY FOR AGENT WRITTEN CODE.

- Use single word names by default for new locals, params, and helper functions.
- Multi-word names are allowed only when a single word would be unclear or ambiguous.
- Do not introduce new camelCase compounds when a short single-word alternative is clear.
- Before finishing edits, review touched lines and shorten newly introduced identifiers where possible.
- Good short names to prefer: `pid`, `cfg`, `err`, `opts`, `dir`, `root`, `child`, `state`, `timeout`.
- Examples to avoid unless truly required: `inputPID`, `existingClient`, `connectTimeout`, `workerPath`.

### Avoid else statements

Prefer early returns (or an IIFE) over `else`. After an `if` that returns/throws, the `else` is redundant.

### No empty catch blocks

Never leave a `catch` block empty. An empty `catch` silently swallows errors and hides bugs. If you're tempted to write one, ask yourself:

1. Is the `try`/`catch` even needed? (prefer removing it)
2. Should the error be handled explicitly? (recover, retry, rethrow)
3. At minimum, log it via `log.error("...", { err })` so failures are visible — never `catch {}` or `catch (e) {}` with no body.

### Prefer single word naming

Default to a single-word name for variables, parameters, and helper functions. Reach for a multi-word name only when a single word would be genuinely ambiguous in context — not just because the longer name "reads nicer". The rule is about meaning, not character count: don't introduce camelCase compounds like `inputPID`, `existingClient`, `connectTimeout`, or `workerPath` when `pid`, `client`, `timeout`, or `path` is already clear from the surrounding code. See the "Naming Enforcement" section above for the preferred vocabulary.

## Testing

You MUST avoid using `mocks` as much as possible.
Tests MUST test actual implementation, do not duplicate logic into a test.

Run tests at the package level (e.g. `bun test` from `packages/kilo-vscode/`); never from the repo root.

## Markdown Tables

Do not pad markdown table cells for column alignment. Use the compact form with single-space-padded content cells and a minimal separator row:

```
| Command | What it runs |
|---|---|
| `kilo serve` | The prod CLI on `$PATH`. |
```

Do **not** right-pad cells to line up columns:

```
| Command                       | What it runs             |
| ----------------------------- | ------------------------ |
| `kilo serve`                  | The prod CLI on `$PATH`. |
```

Padding makes every content change rewrite the entire table, which blows up diffs on untouched rows. Markdown files are excluded from prettier (see `.prettierignore`) so running the formatter won't re-pad them, and `script/check-md-table-padding.ts` enforces the rule in CI. Run `bun run script/check-md-table-padding.ts --fix` to auto-rewrite padded tables.

## Commit Conventions

[Conventional Commits](https://www.conventionalcommits.org/) with scopes matching packages: `vscode`, `cli`, `agent-manager`, `sdk`, `ui`, `i18n`, `gateway`, `telemetry`. Omit scope when spanning multiple packages.

## Release Notes

The changeset toolchain (`.changeset/`) was removed. Release notes for the extension are maintained manually in `packages/kilo-vscode/CHANGELOG.md` — append an entry there for user-facing changes.

## Pull Requests

PR descriptions should explain **what** changed, **why** the change is needed, and the intent or constraints a reviewer cannot infer from the diff alone. Keep simple PRs brief, but give non-trivial changes enough context to stand on their own. Skip file-by-file inventories, test result summaries, and anything obvious from the code itself.

## GitHub Issues

When creating or managing GitHub issues for the VS Code extension via `gh`, load `.kilo/skills/gh-issues/SKILL.md`. It covers templates, project boards, title conventions, and the `gh auth refresh -s project` recovery path.

## Sync Flow

The only upstream is `origin/main` (https://github.com/Kilo-Org/kilocode/). There are no more merges from anomalyco/opencode: `packages/opencode/` is inherited fork code that now only moves via `main`. The old fork-sync toolchain (`script/upstream/`, `.opencode-version`, mergiraf automation, rerere training, the `upstream` remote) was permanently removed as obsolete.

Sync procedure:

1. `git switch main && git pull && git switch leocode && git merge main`
2. `bun install` (postinstall sets `merge.conflictStyle=zdiff3` repo-locally via `script/setup-git.ts`, so conflicts include the common ancestor between `|||||||` and `=======` and stay readable)
3. Resolve conflicts manually, guided by `kilocode_change` markers — marked portions are our version and win.
4. `bun run script/generate.ts` if the server API changed.
5. Run the extension test suite.
6. Human review.

If you've overridden `merge.conflictStyle` in your user config, the repo-local setting takes precedence — don't override it back.

### Kilocode Change Markers

When editing shared files inherited from the fork, mark Kilo-specific lines with `kilocode_change` comments so future sync conflicts can be resolved mechanically. The basic forms are:

- Single line: `const value = 42 // kilocode_change`
- Multi-line block: wrap with `// kilocode_change start` / `// kilocode_change end`
- New file in a shared path: `// kilocode_change - new file` at the top
- JSX/TSX: use `{/* kilocode_change */}` (and `{/* kilocode_change start */}` / `end`)

Markers are NOT needed in paths that contain `kilocode` in the name (e.g. `packages/opencode/src/kilocode/`, `packages/opencode/test/kilocode/`) or in entirely-Kilo packages like `packages/kilo-vscode/` — these will not conflict with upstream.

For decision rules on when to keep changes inline vs. extract Kilo logic, marker placement guidance, and verification commands, load `.kilo/skills/kilocode-merge-minimizer/SKILL.md`.