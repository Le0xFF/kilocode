# Contributing to Kilo

See [the Documentation for details on contributing](https://kilo.ai/docs/contributing).

## TL;DR

There are lots of ways to contribute to the project:

- **Code Contributions:** Implement new features or fix bugs
- **Documentation:** Improve existing docs or create new guides
- **Bug Reports:** Report issues you encounter
- **Feature Requests:** Suggest new features or improvements
- **Community Support:** Help other users in the community

The Kilo Community is [on Discord](https://kilo.ai/discord).

## Prerequisites

- **Bun 1.3.14+** — required for all packages.

## Developing

- Install dependencies from the repo root:

  ```bash
  bun install
  ```

- Run the local CLI with `bun dev serve` from `packages/opencode/`. For the VS Code extension, use `bun run extension` from the repo root (see [Developing the VS Code Extension](#developing-the-vs-code-extension) below).

## Common Checks

From the repo root:

```bash
bun install
bun run lint
bun run typecheck
```

`bun run typecheck` wraps `bun turbo typecheck`. Use `bun turbo typecheck --force` if you need to bypass the Turbo cache.

Do **not** run `bun test` from the repo root. The root test script intentionally exits with failure so tests run from the package that owns them.

### CLI checks

From `packages/opencode/`:

```bash
bun run typecheck
bun test
bun test ./path/to/file.test.ts
```

For backend/API validation, spawn the local backend with `bun dev serve` from `packages/opencode/` and drive it via `curl`. After changing server endpoints in `packages/opencode/src/server/`, run `bun run script/generate.ts` from the repo root to regenerate `packages/sdk/js/`.

### VS Code extension checks

From `packages/kilo-vscode/`:

```bash
bun run typecheck
bun run lint
bun run test:unit
bun run test
bun run compile
bun run package
```

VSIX packaging is done via `bun run --cwd packages/kilo-vscode package`.

### Guardrails

- User-facing changes need an entry in `packages/kilo-vscode/CHANGELOG.md` (imperative mood, user-perspective entries).
- After changing server endpoints, regenerate the SDK with `bun run script/generate.ts`.
- When editing shared `packages/opencode/` files, keep Kilo changes small and mark Kilo-only edits with `// kilocode_change` for a single line or `// kilocode_change start` / `// kilocode_change end` for a block. Do not add these markers inside `kilocode`-named paths. See AGENTS.md for the full sync flow.

### Developing the VS Code Extension

Build and launch the extension in an isolated VS Code instance:

```bash
bun run extension                  # Build + launch in dev mode
bun run extension:isolated         # Build + launch with persistent isolated IDE + Kilo state
bun run extension:isolated:clean   # Clear isolated state, then build + launch
```

This auto-detects VS Code on macOS, Linux, and Windows. Override with `--app-path PATH` or `VSCODE_EXEC_PATH`. Use `--insiders` to prefer Insiders, pass a directory argument to open a specific folder, or use `--workspace PATH` for the same behavior.

The isolated modes are for testing the extension without touching your primary VS Code profile or real Kilo config. `extension:isolated` reuses `.kilo-dev/` on each run, so installed extensions, VS Code settings, Kilo auth, sessions, config, state, and cache persist across launches. `extension:isolated:clean` deletes `.kilo-dev/` before launching, which simulates a fresh install while still keeping all state inside this repo checkout.

```bash
bun run extension:isolated -- ../sample-project
bun run extension:isolated:clean -- ../sample-project
```

### Building a "local" binary

To compile a standalone executable:

```bash
./packages/opencode/script/build.ts --single
```

Then run it with:

```bash
./packages/opencode/dist/@kilocode/cli-<platform>/bin/kilo
```

Replace `<platform>` with your platform (e.g., `darwin-arm64`, `linux-x64`).

### Understanding bun dev vs kilo

During development, `bun dev serve` from `packages/opencode/` is the local equivalent of the built `kilo` command. Both run the same CLI interface:

```bash
# Development (from packages/opencode/)
bun dev serve            # Start headless API server

# Production
kilo serve               # Start headless API server
```

### Testing with a local backend

To point the CLI at a local backend (e.g., a locally running Kilo API server on port 3000), set the `KILO_API_URL` environment variable:

```bash
cd packages/opencode && KILO_API_URL=http://localhost:3000 bun dev serve
```

This redirects all gateway traffic (auth, model listing, provider routing, profile, etc.) to your local server. The default is `https://api.kilo.ai`.

There are also optional overrides for other services:

| Variable | Default | Purpose |
|---|---|---|
| `KILO_API_URL` | `https://api.kilo.ai` | Kilo API (gateway, auth, models, profile) |
| `KILO_SESSION_INGEST_URL` | `https://ingest.kilosessions.ai` | Session export / cloud sync |

> **VS Code:** The repo includes a "VSCode - Run Extension (Local Backend)" launch config in `.vscode/launch.json` that sets `KILO_API_URL=http://localhost:3000` automatically.

## Issue Template Requirements

If you open an issue through the GitHub web UI, GitHub will guide you through the correct template automatically.

If you open an issue through `gh issue create`, the API, or another tool that bypasses the web UI, include the equivalent required fields yourself so the issue still matches the template. Issues that skip required fields may be auto-closed by the compliance bot.

Current required fields by issue type:

- **Bug report:** include a `Description`. When you can, also add Plugins, Kilo version, Steps to reproduce, Screenshot and/or share link, Operating System, and Terminal so the report matches the full bug template.
- **Feature request:** use a title prefixed with `[FEATURE]:`, complete the required checkbox confirming you have searched for duplicates, and fill in `Describe the enhancement you want to request`.
- **Question:** include the `Question` field.

## Pull Request Expectations

Contributor guidance exists to protect maintainer review time and keep reviews focused on work that is ready to evaluate.

- **UI Changes:** Include screenshots or videos (before/after).
- **Logic Changes:** Explain how you verified it works.

### Contribution Ownership and AI Assistance

AI and coding agents are allowed, but contributors own the work they submit. Before requesting review, make sure you personally understand the change, have tested it appropriately, can explain the diff, and understand how it interacts with the affected packages and the rest of the repo.

If you use an agent, start it from the repo root so the root `AGENTS.md` is available. When your change touches a package with its own guidance, read and follow that package's `AGENTS.md` or contributor docs too.

Maintainers may close PRs that appear to be submitted without credible contributor ownership or understanding, including AI-assisted work that the contributor cannot explain or has not meaningfully reviewed.

### Tracker Use and Automation

Do not submit batches of agent-generated, untested, or weakly reviewed PRs.

Prioritize high-impact or high-priority issues first instead of opening many speculative fixes. If a contributor opens a large batch of low-value or duplicative PRs, maintainers may close the batch and ask the contributor to choose one PR to reopen, focus, and bring up to the documented review bar before submitting more.

For issues, do not mass-create tickets through automation or agents. Search existing issues first, open issues only when you have enough context for someone to act, and prioritize the most important reports instead of filing every possible finding. Maintainers may close duplicate, low-signal, automated, or weakly reviewed issues without action.

Repeated disregard of this contribution guide, or high-volume automated or agent-generated tracker spam across issues or PRs, may result in maintainers blocking the responsible account.

### Bug Bounties

Kilo has bug bounties. To be eligible, make sure your GitHub account is connected in your Kilo account.

### Testing Evidence

Every PR marked ready for review must include testing evidence. A bare `Not tested` or `N/A` answer is not sufficient.

Choose checks that match the files touched. Include command results and manual/local verification; for visual CLI or extension changes, include screenshots or videos. Docs-only, config-only, and similar changes still need concrete evidence, such as a relevant command check or preview.

If you cannot complete a relevant command, include all of the following in the PR:

- The command you attempted or would normally run
- The blocker or failure that prevented completion
- The substitute verification you performed instead

Agent limitations, local resource constraints, OOM constraints, or an agent prompt that says to skip tests do not waive this requirement. Draft PRs may be incomplete until they are marked ready for review. Maintainers may still defer or close review at their discretion.

Our issue-first policy asks contributors to reference an existing issue when opening a PR. This helps reviewers understand the problem statement, discussion, and intended scope before reviewing the code change.

A review-ready PR description should explain:

- What problem is being solved
- Why the change is needed
- Important implementation choices or tradeoffs reviewers cannot infer from the diff
- How the change was tested or verified

Keep the description focused on context reviewers cannot infer from the diff. Skip file-by-file summaries, placeholders, and other filler.

For visual UI changes, include screenshots or video showing the relevant before/after or resulting state.

Maintainers may close or decline review of PRs presented as review-ready at their discretion when they lack:

- Linked issue context
- A clear what/why explanation
- Credible testing evidence
- Credible contributor ownership of AI-assisted work
- Relevant UI proof for visual UI changes

When a PR is close to this bar, addresses important work, or would benefit from further shaping, maintainers may ask for specific fixes instead of closing or declining review. Contributors may reopen or resubmit once the PR meets the documented bar.

## PR Titles

Use conventional commit style PR titles such as:

- `feat: add MCP settings tab`
- `fix: correct Windows path handling`
- `docs: clarify issue template requirements`
- `chore: bump TypeScript to 5.8`
- `refactor: extract diff renderer into a hook`
- `test: cover ServerManager orphan cleanup`

## Issue and PR Lifecycle

To keep our backlog manageable, we automatically close inactive issues and PRs after a period of inactivity. This isn't a judgment on quality — older items tend to lose context over time and we'd rather start fresh if they're still relevant. Feel free to reopen or create a new issue/PR if you're still working on something!

Maintainers may also close issues or PRs that disregard the contribution guide, bypass required context, or lack credible contributor ownership of AI-assisted work.

## Style Preferences

- **Functions:** Keep logic within a single function unless breaking it out adds clear reuse.
- **Destructuring:** Avoid unnecessary destructuring.
- **Control flow:** Avoid `else` statements; prefer early returns.
- **Types:** Avoid `any`.
- **Variables:** Prefer `const`.
- **Naming:** Concise single-word identifiers when descriptive.
- **Runtime APIs:** Use Bun helpers (e.g., `Bun.file()`).