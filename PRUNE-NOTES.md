# PRUNE-NOTES — VS Code-only branch state

This branch (`leocode`) is a reduced copy of the Kilo Code monorepo containing **only** the VS Code extension (`packages/kilo-vscode/`) plus its transitive workspace dependencies and minimal tooling. Everything else was removed on purpose. Read this before building, testing, or syncing.

## What was removed and why

- **Products**: `kilo-jetbrains`, `kilo-docs`, `storybook`, `sdk-next`, `httpapi-codegen`, `client`, `session-ui`, `kilo-console`, `kilo-web-ui`. None are imported by the extension or the CLI; console/web-ui were consumed only by the CLI build, which now guards their absence (see below).
- **Fork-sync toolchain (permanently obsolete)**: `script/upstream/`, `.opencode-version`, `check-opencode-annotations` CI + script, mergiraf/rerere automation, `.kilo/command/review-upstream-merge.md`, `.kilo/agent/upstream-merge.md`, the `kilocode-merge-minimizer` skill. These existed to merge from upstream anomalyco/opencode; that upstream no longer exists for this branch.
- **Root scaffolding**: `nix/` + flake, `perf/`, `plans/`, `specs/`, `translations/`, `artifacts/`, `docs/`, `bin/` (kilodev launcher), `github/`, `.opencode/`, `.changeset/`, `CONTRIBUTING` extras, per-topic root docs (`RELEASING.md`, `TESTING.md`, `SECURITY.md`, `PRIVACY.md`, …), `logo.png`, IDE dirs (`.idea/`, `.zed/`), `install`, `.envrc`, `.dockerignore`, `kilocode-2.code-workspace`.
- **Scripts**: everything under `script/` except `setup-git.ts`, `generate.ts`, `beta.ts`, `check-md-table-padding.ts`, `check-forbidden-strings.ts`, `check-workflows.ts`, `check-kilo-generated-artifacts.ts`.
- **CI workflows**: kept `test.yml`, `test-vscode.yml`, `visual-regression.yml` (vscode job only, baselines moved in-repo), `typecheck.yml`, `beta.yml`, `check-md-table-padding.yml`, `check-forbidden-strings.yml`, `check-kilo-generated-artifacts.yml`, `codeql.yml`. All others (jetbrains, docs, nix, publish, smoke-test, containers, watch-opencode-releases, auto-close, disabled/) removed. The allowlist in `script/check-workflows.ts` matches exactly.
- **Visual regression baselines** moved from `packages/kilo-docs/public/img/screenshot-tests/kilo-vscode/` to `packages/kilo-vscode/test-fixtures/{visual-regression,permission-dock-dropdown}/` (LFS rules extended in `.gitattributes`). Old LFS snapshots remain on GitHub LFS as orphans.

## Surviving package set

The root `package.json` lists workspaces **explicitly** (no `packages/*` glob) so future merges from `main` cannot resurrect removed packages even if main re-adds them to a glob. The list is the transitive closure of `@kilocode/cli` (the spawned backend) plus direct bundle-time deps of the extension: `opencode`, `core`, `ui`, `plugin`, `kilo-indexing`, `kilo-memory`, `kilo-sandbox`, `kilo-i18n`, `kilo-ui`, `script`, `tui`, `server`, `codemode`, `schema`, `protocol`, `llm`, `effect-drizzle-sqlite`, `effect-sqlite-node`, `http-recorder`, `plugin-atomic-chat`, `sdk/js`, and `kilo-vscode` itself. `kilo-gateway` and `kilo-telemetry` were later fully removed from the workspace list (see "Online-services removal" below; their surviving references are commented-out stubs, not live imports). Batch-B follow-up (vendoring the CLI binary) could shrink this further.

## Sync flow (the ONLY sync path)

The only upstream is `origin/main` = https://github.com/Kilo-Org/kilocode/. There is no `upstream` remote and there never will be again. The fork-sync toolchain (including the `check-opencode-annotations` script) was removed with it, so the annotation check documented in `AGENTS.md` is stale and cannot be run from this checkout; `kilocode_change` markers are still honored by manual merge resolution.

```
git switch main      # 1. go to main
git pull             # 2. update main from origin
git switch leocode   # 3. back to the pruned branch
git merge main       # 4. merge main into leocode
```

Post-merge procedure:

1. `bun install` (regenerates `bun.lock` against the explicit workspace list).
2. Resolve conflicts guided by `kilocode_change` markers: marked portions are **ours and win**; unmarked hunks integrate both sides. `merge.conflictStyle=zdiff3` (set by postinstall → `script/setup-git.ts`) makes the base section visible for manual resolution.
3. If the merge changed the server API, run `bun run script/generate.ts` (regenerates the OpenAPI spec from `packages/opencode` sources and rebuilds `packages/sdk/js`).
4. Extension suite: `cd packages/kilo-vscode && bun run test:unit && bun run compile`.
5. Human review.

Expected outcomes per case:

| Case | Result | Why |
|---|---|---|
| main advanced only inside pruned packages (jetbrains, docs, …) | clean | those paths don't exist here, git records our deletions, no overlap |
| main advanced shared surviving files (`packages/opencode/**`, root `package.json`, `turbo.json`, `bun.lock`, `patches/`, `script/`) | CONFLICTS expected | resolve one by one via markers; zdiff3 keeps blocks readable |

A controlled drill with synthetic changes on `turbo.json`, root `package.json`, and a marker region in `packages/opencode/src/config/config.ts` was executed and discarded: git auto-resolved non-overlapping edits (our rewritten versions won), post-merge `bun install` + `bun typecheck` + extension bundle stayed green. Real content conflicts in heavily rewritten files (e.g. root `package.json`) require manual marker-based resolution — budget time for that on each real sync.

## Constraints to know

- `packages/opencode` is **required**: the extension's `prepare:cli-binary` builds/spawns the CLI binary from it, and `prepare:sdk` regenerates the SDK from it. It stays until a future vendoring step provides a prebuilt binary via `CLI_DIST_DIR`.
- The CLI build tolerates missing `packages/kilo-console` / `packages/kilo-web-ui`: `packages/opencode/script/build.ts` skips console build + asset copy when those directories are absent (guarded block, `kilocode_change` markers). At runtime the CLI serves 404 JSON for `/console/*` and everything else works.
- `zdiff3` conflict style comes from postinstall (`script/setup-git.ts`); do not remove it.
- Root `workspaces.packages` must stay an **explicit list**. Do not convert it back to a glob.
- `patchedDependencies` entries must keep matching files in `patches/`; bun fails install otherwise.

## Execution rules (bun + disk isolation)

- Use the **system bun** (`~/.bun/bin/bun`). If `command -v bun` finds nothing, `source ~/.bashrc` in the same shell first. Never run repo tooling through podman/containers.
- Tooling writes stay inside the repo (gitignored: `node_modules/`, `dist/`, `out/`, `bin/`, `storybook-static/`, `.husky/_/`) plus standard bun user caches in HOME. The only lateral write is `merge.conflictStyle` in `.git/config` via postinstall (intended).
- Integration tests MUST use the system VSCodium/Codium binary (`/usr/bin/codium` here), forced with `VSCODE_EXEC_PATH=/usr/bin/codium`. `@vscode/test-cli` is bypassed on purpose: it always downloads an instance into `~/.vscode-test`. The runner (`packages/kilo-vscode/script/vscode-test-runner.ts`) drives `@vscode/test-electron` directly, pins all XDG homes under `<repo>/.kilo-dev/vscode-test/`, strips `ELECTRON_*`/`VSCODE_*` env vars, and writes hardening settings (telemetry off, no auto-update, trust disabled). Verified: zero writes to the real Codium profile dirs during a run.
- `extension:isolated` / `extension` remain local dev flows (same isolation recipe via `script/launch.ts`); they are not part of automated verification.

## Valid commands after the prune

| Command | Where | What it does |
|---|---|---|
| `bun install --frozen-lockfile` | root | clean install, lock must match |
| `bun typecheck` | root | turbo typecheck over all surviving packages |
| `bun run lint` | root | oxlint over the tree |
| `bun run test:unit` | `packages/kilo-vscode` | hermetic unit suite via RAM-aware runner (`script/run-unit-tests.ts`); auto-caps concurrency to ~2 GB/worker from `/proc/meminfo`; tune with `KILO_TEST_CONCURRENCY`, `KILO_TEST_FILE_TIMEOUT`, `KILO_TEST_SHARD=i/n`, `KILO_TEST_MEM_AVAILABLE_MB` |
| `VSCODE_EXEC_PATH=/usr/bin/codium bun run test:integration` | `packages/kilo-vscode` | isolated integration run on system Codium (state in `.kilo-dev/vscode-test/`) |
| `bun run compile` | `packages/kilo-vscode` | prepare:cli-binary + prepare:sdk + check-types + lint + bundle |
| `bun run package` | `packages/kilo-vscode` | produce the VSIX |
| `bun run knip` | `packages/kilo-vscode` | unused-export/file guard |
| `bun run script/check-{workflows,md-table-padding,forbidden-strings,kilo-generated-artifacts}.ts` | root | CI guards |
| `bun run script/generate.ts` | root | regenerate OpenAPI + SDK (after server API changes in a sync) |

Not runnable from root: `bun test` (deliberately exits 1), old root scripts (`dev*`, `sso`, `random`, …) are gone.

## Residui volutamente online (gated) — matrice finale

Chiusura dell'audit offline (step 12): i percorsi di rete che restano volontariamente disponibili sono tutti gated da scelta utente, azione esplicita, o caché fredda. Nessuno è attivabile automaticamente dal processo.

Rimangono online (gated):

- `webfetch` tool: GET arbitrari verso URL dichiarati dall'agente, permission-gated (`webfetch`). Capacità intrinseca dell'agente, non un servizio Kilo.
- `skills.urls` config: pull di `index.json` dagli URL dichiarati dall'utente.
- MCP remote/OAuth: server con URL dichiarati dall'utente; il flow OAuth apre il browser di sistema.
- Browser automation (`npx @playwright/mcp@latest`): npm registry solo al primo uso con caché fredda; feature off di default.
- Embedders hosted per l'indexing: selezionabili solo se l'utente li configura esplicitamente; la UI limita le opzioni a ollama/openai-compatible.
- Import PR da GitHub (Agent Manager): `gh` / `git fetch` su azione utente esplicita.
- Download on-demand di binary/plugin: ripgrep dai GitHub releases se assente a sistema; `Npm.add` per plugin/dynamic-provider-SDK/@lancedb al primo uso con caché fredda.
- Comando manuale `kilo upgrade`: npm registry/brew/choco/scoop su azione esplicita (l'auto-update è stato rimosso).
- Link `openExternal` nella webview (kilo.ai/docs, github, reddit): aprono il browser di sistema, non socket del processo.
- `WellKnown` auth type + `KILO_AUTH_CONTENT`: wellknown fetch (`<url>/.well-known/opencode`) per `kilo login <url>` e remote config; host dichiarato dall'utente.

Assenti per costruzione:

- models.dev fetch: disabilitato da flag (`KILO_DISABLE_MODELS_FETCH`) + committed snapshot `models-dev.local.json`.
- LSP: feature rimossa interamente (binari language-server, download, toggle, permission row).
- Session sharing: feature rimossa (`opncd.ai`/console più referenziati; dati storici compatibili).
- Auto-update: rimosso (nessuna route `/global/upgrade`, nessun check automatico; resta il comando manuale).
- Network probe: lista di host esterni azzerata in `session/network.ts` — con la lista vuota non parte alcuna richiesta verso l'esterno e gli errori di connessione del provider degradano al normale retry (nessun park permanente su stato offline). Il meccanismo network-wait resta come meccanismo per chi reintroducesse host di probe: UI nella TUI (`Connection lost — retrying automatically`) e auto-drain/rifiuto nell'estensione.
- Telemetria OTel: env del child `kilo serve` sanificata allo spawn (tutte le `OTEL_*`, le proxy var non gestite da VS Code, e le API-key dei provider online ereditati — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `TOGETHER_API_KEY`, `PERPLEXITY_API_KEY`, `CLOUDFLARE_API_KEY`, `COHERE_API_KEY`, `DEEPSEEK_API_KEY`, `ZAI_API_KEY`, `HUGGINGFACE_API_KEY`, `MINIMAX_API_KEY`, `GITHUB_TOKEN`, `COPILOT_GITHUB_DEVICE_ID`, prefissi `AWS_`/`VERTEX_` — sono tolte; chi usa quelle chiavi con un provider BYOK le dichiara in `config.provider.<id>.env`).
- ChatGPT OAuth: i metodi `chatgpt-browser`/`chatgpt-headless` del plugin `openai` si registrano solo quando il provider non dichiara una `baseURL` custom; con un endpoint openai-compatible locale nessun flow verso `auth.openai.com` è raggiungibile. Le chiavi i18n `settings.providers.action.signInChatGPT` e `error.providerAuth.chatgpt.*` sono state rimosse dalle 21 locale.

## Cosmetici accettati (chiusura step 8)

Residui di superficie online accettati, tutti inert o gated da azione esplicita; tenuti in repo per coerenza con upstream:

| Residuo | Dove | Perché resta |
|---|---|---|
| `openExternal` link nella webview | FeedbackDialog, CustomProviderDialog, AboutKiloCodeTab, ProviderConnectDialog, useSlashCommand | aprono il browser di sistema, mai un socket del processo |
| MCP `client_uri` | `packages/opencode/src/mcp/oauth-provider.ts` (`https://kilo.ai`) | stringa dichiarativa nel metadata OAuth, nessun fetch al runtime |
| URL di installazione | Npm/Brew/Choco/Scoop/Release in `packages/opencode/src/kilocode/installation/index.ts` | usati solo dal comando manuale `kilo upgrade` su azione esplicita |
| `$schema` theme JSON | tema TUI | puntatore editor per l'autocomplete, non fetch |
| Doc links in prompt/help text | `kilo.ai/docs`, github, reddit nei testi CLI/TUI | copy per l'utente, aperto col browser di sistema |

## Future work (out of scope here)

- **Vendoring/offline**: replace `packages/opencode` with a prebuilt CLI binary (`CLI_DIST_DIR`), then drop batch-B packages (`tui`, `server`, `llm`, `schema`, `protocol`, `codemode`, `script`, `effect-*`, `http-recorder`) and the `prepare:cli-binary`/`prepare:sdk` steps. Separate effort.

Done in this branch (no longer future work):

- Full offline operation of the extension (no network at install/build/runtime) is complete. Closed across four commits: `1673a9fbf1` (remove online Kilo services for a fully offline extension), `cfacab50d3` (hard-cut out-of-surface providers from GET /provider to eliminate Kilo Gateway from the model picker), `969f948140` (close remaining online residuals for a fully offline extension), and `5d613a008b` (close out the offline surface — remove LSP, sharing, auto-update and probe residuals). The residual-online matrix above lists only user-gated paths; nothing is auto-enabled by the process.

## Online-services removal (this branch, step 13)

The online Kilo surface has been stripped from both the extension and the CLI so the product runs fully offline against user-configured local OpenAI-compatible providers (llama.cpp, vLLM, Ollama). Removed: Kilo Gateway auth/profile/balance, marketplace, KiloClaw, cloud sessions, remote notifications, PostHog telemetry, gateway autocomplete (FIM / next-edit), the `kilo` provider, `/kilo/*` + `/telemetry/*` HTTP groups, KiloSessions ingest/share/presence/export, and the `generate-image` / `websearch-kilo-exa` tools. Speech-to-text and image generation now target local endpoints via the regenerated `client.mediaLocal.*` SDK routes.

Dead code that remains in the workspace (kept, not deleted):

- `packages/kilo-gateway/` — removed from disk and from the workspace list; its former exports (`PROMPTS`, `AI_SDK_PROVIDERS`) were re-hosted into `packages/core/src/v1/config/constants.ts` (see "Online-services removal" below). Only commented-out references remain.
- `packages/kilo-telemetry/` — removed from disk and from the workspace list; no package declares it as a dependency anymore.
- Orphaned i18n keys for removed UI (`profile.*`, `deviceAuth.*`, `session.cloud.*`, `notifications.action.*`, etc.) were deleted across all 21 locales in the offline dead-code closure (step 4); the protection list in `tests/unit/i18n-unused-keys.test.ts` was updated accordingly.
- The generated SDK client exposes an empty legacy `kilo` namespace getter (`client.kilo`) so pre-regen call sites keep typechecking; the underlying routes are gone.

- `kilo providers login`: la priority map e le hint non più presentano il gateway `kilo` come "recommended"; solo provider locali/custom compaiono nel picker.
- Dipendenze orfane rimosse: `@openauthjs/openauth` (CLI), `aws4fetch`/`@smithy/eventstream-codec`/`@smithy/util-utf8` (llm), e il type-only import `@openrouter/ai-sdk-provider` da `provider-options.ts` (sostituito da un tipo strutturale inline).

Dead code deleted in the offline-surface finalization (step A5):

- `packages/opencode/src/kilocode/event-service/client.ts` + its test — `EventServiceClient` (WS ticket flow + ping interval) served only the removed gateway event service; grep proved zero importers outside the module's own test. Also removed the `event-service/` dirs and the `test-durations.json` entry.
- `trackStep` no-op in `kilocode/session/processor.ts` + its call site in `src/session/processor.ts`. This cascaded into removing the now-unread review-telemetry pipeline: `Input.telemetry` / `ctx.telemetry`, the suggest-tagging block, the telemetry extraction in `src/session/prompt.ts` and `markReviewTelemetry` in `prompt.ts`/`tool/task.ts`, and two vestigial tests in `test/session/prompt.test.ts` that only asserted `expect(true).toBe(true)`.
- Vestigial share plumbing in `cli/cmd/github.handler.ts`: `shareBaseUrl`, `shareId` (always undefined after session-sharing removal), `normalizeShare()`/`const share`, both `hasShared` comment-scan blocks, and the footer's `[kilo session]` link. The `footer({ image: true })` call sites were left untouched since the `image` option was already inert for the same reason.
- Two integration tests in `test/session/prompt.test.ts` that exercised only the removed telemetry plumbing.

Kept with reason:

- `kilocode/session/processor.ts` `ReviewTelemetry` type + `reviewTelemetry`/`extractSuggestionReviewTelemetry` helpers — still consumed by `src/session/processor.ts` (Input type, suggest tagging) and `src/session/prompt.ts` (extraction at turn start); not dead.
- `control-plane/dev/debug-workspace-plugin.ts` — dev-only adapter for the local workspace-sync simulation flow documented in `control-plane/dev/README.md` and referenced by `script/run-workspace-server`; it polls loopback `127.0.0.1`, not an online host.
- `kilocode/indexing.ts` `trackTelemetry` no-op + the `"telemetry"` variant of `indexing-worker-protocol.ts` — the worker still emits indexing telemetry events from `CodeIndexManager.onTelemetry` (kilo-indexing package) over the protocol to the client hook; removing the variant would cascade into the engine package. The no-op just drops them.

Removed dependencies: `openai` and `js-tiktoken` (extension); `@kilocode/kilo-telemetry` (CLI, done earlier) and the extension's `@kilocode/kilo-gateway` (done in step 11). The offline dead-code closure additionally pruned 7 orphaned extension dependencies and re-activated knip to watch `dependencies`. `@anthropic-ai/sdk` stays (type-only, used by legacy-migration per A9).