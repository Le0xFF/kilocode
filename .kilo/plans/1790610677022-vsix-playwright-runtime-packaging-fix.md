# Fix VSIX activation crash: ship `dist/node_modules` (playwright runtime) in the offline VSIX

## Obiettivo (Objective)

Make the `kilo-code` 7.8.1 VSIX activate correctly on fully offline machines by guaranteeing that the extension's runtime-external module `playwright-core` (plus `chromium-bidi` and its nested deps) is always present inside the packaged VSIX at `dist/node_modules/`, and make the VSIX build a **deterministic, scripted, self-verifying, fully offline** process so this regression class cannot recur.

Observed failure (user's offline machine, VS Code 1.135, installed VSIX `kilocode.kilo-code-7.8.1`):

```
Error: Cannot find module 'playwright-core'
Require stack:
- ~/.vscode/extensions/kilocode.kilo-code-7.8.1/dist/extension.js
```

## Analisi (Analysis)

Evidence gathered from four scoped code investigations (current tree, branch `leocode`, HEAD `f1342aaa6a`):

1. **The bundle has exactly one runtime-external `require`**: `require("playwright-core")`, at the top level of `dist/extension.js`.
   - esbuild externalizes only `/^playwright-core(?:\/|$)/` via the plugin `packages/kilo-vscode/script/playwright-runtime.js:27` (wired at `esbuild.js:9,430`); `external: ["vscode"]` at `esbuild.js:428` (host-provided).
   - Origin: value import `import { chromium } from "playwright-core"` in `src/services/browser-automation/browser-broker.ts:6-13`, statically imported from `src/extension.ts:19` → `src/services/browser-automation/index.ts`. It executes at activation for **every** window (activationEvents `onStartupFinished`/`onUri`), even with the experimental flag off.
   - `ws` is bundled (not external); `chromium-bidi` never enters the bundle — it is loaded at runtime *by* the external `playwright-core` from `dist/node_modules`.
   - After every successful esbuild run, the plugin copies `playwright-core` + `chromium-bidi` (and recursively each package's `dependencies`: `mitt`, `urlpattern-polyfill`, `zod` nested under `chromium-bidi/node_modules`) into `dist/node_modules/` (`playwright-runtime.js:28-33`, gated on zero build errors). `esbuild.js:499-510` also copies license files to `dist/licenses/`.
2. **The mechanism works and previously worked**: the stale artifact `packages/kilo-vscode/dist/kilo-code-v7.7.5-offline.vsix` (302 MB, built 2026-09-19) contains `extension/dist/node_modules/{playwright-core,chromium-bidi(+nested)}` and activated fine. The v7.8.1 close-out VSIXes (`kilo-code-7.8.1-{linux,win32}.vsix`, 133.05/133.44 MB, 265/259 files) were produced by a **manual, never-scripted, never file-list-documented "dual-staging + local vsce 3.9.2" one-off recipe** (only prose: `packages/kilo-vscode/AGENTS.md:117`, `PRUNE-NOTES.md:168`); the recorded content checks (`bin/` contents, 37 tree-sitter entries, manifest version/engines) **never verified `dist/node_modules`** — so the linux artifact lost `playwright-core` and no check caught it. The artifacts are gone from disk (`dist-vsix/` empty, untracked); the installed copy on the offline machine is the surviving evidence.
3. **`.vscodeignore` is NOT the cause** and must not be "fixed" blindly: line 4 `node_modules/**` contains a slash → anchored at the package root → it does **not** exclude `dist/node_modules/**`. The installed `@vscode/vsce` 3.9.2 (devDep, `^3.7.1`) honors `!` negations (`out/package.js:1286-1304`), so `!dist/**` (`:23`) keeps all of `dist/` in. The AGENTS.md claim "vsce 3.9.2 strips the `!` negations" is factually wrong for the installed version (what is true: negations have unconditional precedence over *all* ignore patterns, so you cannot re-exclude individual files inside `!dist/**`/`!bin/**` — e.g. `dist/*.vsix`, `bin/.cli-version`).
4. **Real content gaps in the current `.vscodeignore`** (a plain vsce pack from the package root would ship junk; the 302 MB v7.7.5 artifact proves it: it contained `extension/tests/**`, `extension/storybook-static/**`, and a nested stale VSIX rescued by `!dist/**`): missing exclusions for `tests/**`, `test-results/**`, `storybook-static/**`, `docs/**`, `dist-vsix/**`, `vsc-extension-quickstart.md`.
5. **Offline runtime facts** (so no code change is needed for runtime): loading `playwright-core` at import time does no network/fs/executable work (registry dir is only *computed*; executable resolution and spawn happen only inside `chromium.launch()`). Browser missing → graceful localized `BrowserLaunchError` screens (`browser-broker.ts:120-136,739-750`), never an extension-host crash. Default browser source: system Chrome (`kilo-code.new.agentManager.browser.useSystemChrome` default `true` → `channel: "chrome"` scanned from OS locations); escape hatch: `PLAYWRIGHT_BROWSERS_PATH`. The separate "Web Tools" setting `kilo-code.new.browserAutomation.enabled` (`npx @playwright/mcp@latest`) is offline-incompatible by upstream design (needs npm registry) — off by default, document only.
6. **Packaging APIs available offline** (no new dependencies allowed — pinned offline fork):
   - `@vscode/vsce` 3.9.2 (installed devDep): `createVSIX({ cwd, packagePath, target, version, updatePackageJson: false, dependencies: false, skipLicense: true })` (cf. `script/dev-snapshot.ts:68-76`) — zero network/npm activity, honors `<cwd>/.vscodeignore` (`out/package.js:1275`); `listFiles({ cwd, packageManager: PackageManager.None })` computes exactly the VSIX file list (already used by `tests/unit/esbuild-dependencies.test.ts:7,85`).
   - `script/local-bin.ts --target <os>-arch`: stages the per-target CLI binary into `bin/` (prebuilt lookup `packages/opencode/dist/@kilocode/cli-<os>-x64/bin/kilo[.exe]`, platformTags `cli-linux-x64`/`cli-windows-x64`), copies tree-sitter/sandbox/bwrap resources, removes `bin/.cli-version` + `bin/.ffmpeg-target` markers (`local-bin.ts:377-379`); ready+fresh target ⇒ offline no-op (ffmpeg from `node_modules/.kilo-ffmpeg-target` marker, bwrap from `KILO_SKIP_BUNDLED_BWRAP=1`/staged copy); a *rebuild* may touch the network (bun artifact / `npm pack @ffmpeg-installer/*` / bubblewrap build) ⇒ the packager must never force rebuilds.
   - `script/build.ts` (upstream 8-target `vsce package` loop + `publish.ts`) is the upstream release path, **not** used by this fork (it needs all 8 CLI binaries); keep the files, do not use them.
7. **Guard landscape**: `test:unit` (`bun script/run-unit-tests.ts`) auto-discovers `tests/unit/**/*.test.{ts,tsx}` (no precompile needed; per-file timeout 300 s); `bun run knip` entries already cover `script/*.ts` and `tests/**`; root `bun run check:offline` = `script/check-offline-invariants.ts` with invariants I1–I10 as top-level `pass/fail` blocks (none packaging-related); docs currently label the VS Code 1.103 floor invariant "I11" (doc-level grep, not in the script) — the new script invariant takes id **I11**, and doc references to the floor are renumbered **I12**.

## Assunzioni (Assumptions)

- A1. The failing 7.8.1 VSIX lacked `dist/node_modules/` (the broken artifact is no longer on disk; inference is corroborated by: the v7.7.5 artifact which *did* ship it and worked, the absence of any content check for it at close-out, and the fact that the manual recipe's only documented checks were `bin/`/tree-sitter/manifest). The fix makes this class of loss impossible to ship, which covers both "staging dropped it" and "stale dist packed" causes.
- A2. **Decision (confirmed with user): ship the `playwright-core`/`chromium-bidi` libraries only — do NOT embed a Chromium browser binary in the VSIX.** On the offline machine the Integrated Browser (experimental, off by default) needs system Chrome or a pre-seeded `PLAYWRIGHT_BROWSERS_PATH`; missing-browser already degrades gracefully. This is documented, not coded around.
- A3. Version stays **7.8.1** — the fix is a re-pack, force-installed over the same version on the offline machine (`code --install-extension ... --force`). No version bump.
- A4. The build machine has warm caches from the close-out (per-target CLI binaries under `packages/opencode/dist/@kilocode/cli-{linux,windows}-x64/bin/` or fresh `node_modules/.kilo-cli-version-*` markers in `packages/kilo-vscode/`, plus `bin/ffmpeg*` + `.kilo-ffmpeg-target` markers, plus `bwrap` for the linux target). If a target's prebuilt is missing and no network is available, the packager fails loudly with instructions instead of attempting a network build.
- A5. No new npm dependencies may be introduced (locked offline fork; `bun install` offline).
- A6. The `Web Tools` MCP setting (`kilo-code.new.browserAutomation.enabled`) remains off-by-default and documented as offline-incompatible; no behavior change.

## Piano di implementazione (Implementation plan)

Sequenziale: ogni step è eseguito da un subagente diverso; lo step N+1 parte solo dopo approvazione (utente) dello step N. Ogni step termina con la codebase compilabile (`bun run typecheck` + `bun run lint` in `packages/kilo-vscode/`) e con i guard rilevanti verdi.

### Step 1 — Packaging baseline: purge stale artifacts and harden `.vscodeignore`

**Obiettivo**

Remove the stale 302 MB VSIX from the working tree and extend `.vscodeignore` so that *any* vsce pack from the package root (the packager, `launch.ts --mode vsix`, `dev-snapshot.ts`) no longer ships dev junk (`tests/`, `storybook-static/`, `test-results/`, `docs/`, `dist-vsix/`, quickstart file).

**Motivazione**

The old `dist/kilo-code-v7.7.5-offline.vsix` sits inside `dist/`, and `!dist/**`'s negation precedence rescues it from the default `**/*.vsix` ignore — any pack from the tree would embed a VSIX-in-VSIX. The missing junk exclusions explain the v7.7.5 artifact's 302 MB/`tests/**`/`storybook-static/**` bloat. Doing this before the packager (Step 2) keeps Step 2 focused on the packer itself.

**File da leggere**

- `packages/kilo-vscode/.vscodeignore` (33 lines, current content)
- `packages/kilo-vscode/package.json` (confirm there is **no** `files` field — vsce hard-errors if both `files` and `.vscodeignore` exist)
- `packages/kilo-vscode/AGENTS.md` §"CLI Binary" (context for what `bin/` must keep)

**File da modificare**

- `packages/kilo-vscode/.vscodeignore` — append (keep all existing lines untouched):
  ```
  tests/**
  test-results/**
  storybook-static/**
  docs/**
  dist-vsix/**
  vsc-extension-quickstart.md
  ```

**Attività**

1. Delete `packages/kilo-vscode/dist/kilo-code-v7.7.5-offline.vsix` (untracked build junk) and any other `packages/kilo-vscode/dist/*.vsix`.
2. Apply the `.vscodeignore` additions above.
3. Verify (from `packages/kilo-vscode/`, local vsce resolves from the installed devDep — no network): `bunx vsce ls --no-dependencies --skip-license` (or `node_modules/.bin/vsce ls --no-dependencies`) and check the printed file list:
   - **present**: `dist/node_modules/playwright-core/browsers.json`, `dist/node_modules/playwright-core/index.js`, `dist/node_modules/chromium-bidi/package.json`, `dist/node_modules/chromium-bidi/node_modules/zod/package.json`, `dist/extension.js`, `package.json`
   - **absent**: anything under `tests/`, `storybook-static/`, `test-results/`, top-level `node_modules/`, `*.vsix`
   - If `dist/node_modules` is absent from the list, stop and investigate (it must not happen per the anchoring analysis; do not "fix" it by editing ignore rules beyond the additions above).

**Dipendenze**

- Nessuna (primo step).

**Output atteso**

Tree with no stale VSIX, hardened `.vscodeignore`, and a verified vsce file list proving `dist/node_modules/**` is included and dev junk excluded.

**Verifiche**

- `vsce ls` output as specified in Attività 3.
- `bun test tests/unit/esbuild-dependencies.test.ts` from `packages/kilo-vscode/` (its staging copies the real `.vscodeignore` and asserts the playwright runtime survives `listFiles`) — still green.

**Compilazione**

- No TS changes. Run `bun run typecheck` and `bun run lint` from `packages/kilo-vscode/` as a no-op sanity gate; both must be green.

**Rischi**

- Over-excluding something vsce needs: mitigated by the `vsce ls` check listing `package.json`/`dist/extension.js`/`README.md` as still present.
- `docs/**` exclusion: `docs/` in the package dir is fork-local notes, never shipped; safe.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step; non anticipare gli step successivi (in particolare NON creare il packager).
- Non introdurre refactoring non richiesti, non toccare altri file, modifiche minime.
- Compila/typecheck al termine; risolvi qualsiasi errore introdotto.
- In caso di dubbi su semantica ignore/vsce, consulta il sorgente locale `node_modules/@vscode/vsce/out/package.js` invece di supporre.

---

### Step 2 — Deterministic offline VSIX packager (`script/pack-vsix.ts` + `package:vsix`)

**Obiettivo**

Add `packages/kilo-vscode/script/pack-vsix.ts` — the single, scripted, fully-offline VSIX production path for the fork — and npm script `"package:vsix"`. It produces `dist-vsix/kilo-code-<ver>-linux.vsix` and `dist-vsix/kilo-code-<ver>-win32.vsix` from a per-platform staging tree, and **hard-fails unless the required runtime files (including `dist/node_modules/playwright-core`/`chromium-bidi`) are in the VSIX file list**. This directly repairs the crash: the shipped VSIX will contain `dist/node_modules/`.

**Motivazione**

The regression happened because packaging was a manual, undocumented one-off with no content assertions for the runtime payload. A scripted packager with pre-pack `listFiles` assertions makes the loss of `dist/node_modules` a build failure, not a runtime crash. Reusing `local-bin.ts` + local `@vscode/vsce` `createVSIX` keeps the flow 100% offline (A5).

**File da leggere**

- `packages/kilo-vscode/script/dev-snapshot.ts` (the `createVSIX` call pattern to mirror, `:48-76`)
- `packages/kilo-vscode/script/local-bin.ts` (target handling `:38-88,231-262,376-433`; marker files; `removeDist()` hazard `:435-441`)
- `packages/kilo-vscode/script/build.ts` (what NOT to reuse: 8-target loop, wipes `bin/`/`dist/`/`out/`, `vsce package` CLI per target)
- `packages/kilo-vscode/script/playwright-runtime.js` (the `dist/node_modules` producer)
- `packages/kilo-vscode/esbuild.js` (`notices()` → `dist/licenses`, `wasm()`)
- `packages/kilo-vscode/package.json` (scripts map, `version`, `engines`)
- `@vscode/vsce` types: `node_modules/@vscode/vsce/dist/vsce.d.ts` (`IPackageOptions`, `listFiles`, `PackageManager`)

**File da modificare**

- `packages/kilo-vscode/script/pack-vsix.ts` (NEW, ~150-200 lines)
- `packages/kilo-vscode/package.json` — add to `scripts`: `"package:vsix": "bun script/pack-vsix.ts"` (keep existing scripts untouched)

**Attività**

1. `pack-vsix.ts` structure (imports: `bun`, node builtins, `@vscode/vsce` only — **no new deps**):
   - `const TARGETS = [{ key: "linux", vsceTarget: "linux-x64", localBinTarget: "linux-x64", binary: "kilo" }, { key: "win32", vsceTarget: "win32-x64", localBinTarget: "windows-x64", binary: "kilo.exe" }]` (note the `cli-` platformTag mapping used by `local-bin.ts`: `cli-linux-x64` / `cli-windows-x64`). CLI arg filter: `bun run package:vsix [linux|win32]` (default: both).
   - Exported constants (reused by the Step 3 test):
     - `REQUIRED_VSIX_FILES` (relative paths that MUST be in the vsce file list): `package.json`, `dist/extension.js`, `dist/webview.js`, `dist/agent-manager.js`, `dist/node_modules/playwright-core/index.js`, `dist/node_modules/playwright-core/browsers.json`, `dist/node_modules/playwright-core/lib/generated/utilityScriptSource.js`, `dist/node_modules/chromium-bidi/package.json`, `dist/node_modules/chromium-bidi/node_modules/zod/package.json`, `dist/node_modules/chromium-bidi/node_modules/mitt/package.json`, `dist/node_modules/chromium-bidi/node_modules/urlpattern-polyfill/package.json`, `dist/licenses/playwright-core/LICENSE`, `README.md`, plus per-target: `bin/kilo`|`bin/kilo.exe`, `bin/ffmpeg`|`bin/ffmpeg.exe`, `bin/tree-sitter/tree-sitter.wasm`.
     - `FORBIDDEN_VSIX_PATTERNS`: `node_modules/` (paths not under `dist/`), `tests/`, `test-results/`, `storybook-static/`, `*.vsix`, `bin/.cli-version`, `bin/.ffmpeg-target`.
   - Exported `stageVsix(target, root)`:
     1. Run `bun script/local-bin.ts --target <localBinTarget>` (spawn; inherit stdio; **no** `--force` — never trigger a rebuild). Non-zero exit ⇒ abort with the child's output.
     2. Prereq assertions (abort with actionable message if missing): `dist/extension.js`; `dist/node_modules/playwright-core/package.json` + `dist/node_modules/chromium-bidi/package.json`; `bin/<binary>`; `bin/ffmpeg(.exe)` (marker `node_modules/.kilo-ffmpeg-target` must equal the local-bin target). Message for missing `dist/node_modules`: "run `bun run build:check:production` (esbuild re-copies the playwright runtime)".
     3. `rm` any `dist/*.vsix` (defensive; the stale-VSIX hazard from Step 1).
     4. Build a staging dir under `os.tmpdir()` (`fs.cpSync`, `dereference: true`): copy `package.json`, `.vscodeignore`, `README.md`, `LICENSE`, `THIRD_PARTY_LICENSES`, `dist/` (whole tree), `audio-wav/` (whole tree), `bin/` (whole tree as staged by `local-bin.ts` — includes `tree-sitter/`, sandbox helpers, `bwrap` for linux). Nothing else. (Do **not** copy `node_modules/`, `tests/`, `webview-ui/`, `src/`, `script/`, `docs/`, `dist-vsix/`.)
   - Per target: `const files = await listFiles({ cwd: staging, packageManager: PackageManager.None })` → assert every `REQUIRED_VSIX_FILES` entry (target-adjusted) is in `files`; assert no `files` entry matches any `FORBIDDEN_VSIX_PATTERNS` rule; on failure print the missing/forbidden lists and exit 1 **before** packing.
   - Pack: `await createVSIX({ cwd: staging, packagePath: join(root, "dist-vsix", \`kilo-code-${version}-${key}.vsix\`), target: vsceTarget, version, updatePackageJson: false, dependencies: false, skipLicense: true })` with `version` read from `package.json` (must equal the manifest's — never rewrite it). Ensure `dist-vsix/` exists.
   - Post-pack sanity: artifact exists, size > 100 MB (a VSIX without the CLI binary or the dist tree is far smaller), log `path + size + file count (files.length)`. Remove staging.
   - All failures: `process.exit(1)` with a precise message; no `catch {}` anywhere.
2. Add the `package:vsix` script to `package.json`.
3. Run `bun run package:vsix` on this machine to produce **both** artifacts (this is the actual fix output; per A4 the close-out caches should make it a pure offline no-op for CLI staging). If a target's prebuilt CLI is absent: if this machine has network, let `local-bin.ts` perform the one-time cross-build and note it in the report; if not, abort with instructions — do not hand-stage binaries.

**Dipendenze**

- Step 1 completed and approved (`.vscodeignore` hardened, stale VSIX removed).

**Output atteso**

`packages/kilo-vscode/dist-vsix/kilo-code-7.8.1-linux.vsix` + `kilo-code-7.8.1-win32.vsix` produced by the new script, each verified (by the script's own pre-pack assertions) to contain the full `dist/` tree **including `dist/node_modules/{playwright-core,chromium-bidi(+nested)}`**, per-platform `bin/`, `audio-wav/`, and no dev junk.

**Verifiche**

- `bun run typecheck` + `bun run lint` green (new script typechecks; it is a knip entry via `script/*.ts`).
- `bun run knip` from `packages/kilo-vscode/` green (only declared deps imported).
- `bun run package:vsix` completes for both targets; log shows file counts and sizes (~133 MB-class each).
- Independent artifact inspection: `unzip -l <vsix>` must show `extension/dist/extension.js`, `extension/dist/node_modules/playwright-core/browsers.json`, `extension/dist/node_modules/chromium-bidi/package.json`, `extension/bin/kilo` (linux) / `kilo.exe` (win32), `extension/package.json`; must NOT show `extension/tests/`, `extension/storybook-static/`, any nested `*.vsix`, or `extension/bin/.cli-version`.
- `unzip -p <vsix> extension.vsixmanifest` shows `Version="7.8.1"` and `Engine`/`vscode ^1.103.0` floor preserved.

**Compilazione**

- `bun run typecheck` + `bun run lint` from `packages/kilo-vscode/` green at step end; resolve any error introduced by the new script before finishing.

**Rischi**

- `local-bin.ts` rebuild path wipes `packages/opencode/dist` (`removeDist`, `:435-441`) — mitigated by never passing `--force` and by prereq checks before staging; if markers are stale on this machine, the subagent must report it (and only then, with network available, allow the one-time cross-build).
- `createVSIX` may complain about repo fields (`repository` is present in `package.json:12-16`, so `allowMissingRepository` is not needed).
- Windows-target staging from Linux: `bin/kilo.exe` is a PE binary — copying it as a file is fine; do not try to execute it.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step; non anticipare gli step successivi (non scrivere test, non toccare guard/docs).
- Nessuna dipendenza npm nuova; nessuna modifica a `esbuild.js`, `playwright-runtime.js`, `.vscodeignore` (sempre che Step 1 non l'abbia già fatto).
- Segui lo stile del repo (naming a una parola dove chiaro, `const`, early return, nessun `try/catch` vuoto — logga con dettagli).
- Compila/typecheck al termine; risolvi ogni errore introdotto; se una verifica non può essere eseguita (es. target CLI assente senza rete), riportalo esplicitamente nel report invece di forzare.
- Se hai dubbi sull'API `createVSIX`, leggi `node_modules/@vscode/vsce/dist/vsce.d.ts` e `out/package.js` — non supporre.

---

### Step 3 — Regression guard: `tests/unit/vsix-packaging.test.ts`

**Obiettivo**

Add a unit-test guard so CI/dev runs fail if (a) `.vscodeignore` semantics ever exclude `dist/node_modules/**` again, (b) the packager's staging stops including the playwright runtime, or (c) the production bundle gains a bare `require` that is not resolvable from the shipped `dist/` tree (the exact regression class of this bug).

**Motivazione**

The close-out shipped a broken VSIX because no check looked inside the artifact. A cheap `listFiles`-based guard (same mechanism vsce uses, already proven by `tests/unit/esbuild-dependencies.test.ts:67-127`) catches the loss at build/test time, on any machine, with no network and no vsix unpacking.

**File da leggere**

- `packages/kilo-vscode/tests/unit/esbuild-dependencies.test.ts` (style, `listFiles` usage, tmpdir staging, timeout-as-third-arg pattern)
- `packages/kilo-vscode/script/pack-vsix.ts` (from Step 2 — reuse its exported `stageVsix`, `REQUIRED_VSIX_FILES`, `FORBIDDEN_VSIX_PATTERNS`)
- `packages/kilo-vscode/script/run-unit-tests.ts` (discovery `:173-177`, per-file timeout, budget behavior)

**File da modificare**

- `packages/kilo-vscode/tests/unit/vsix-packaging.test.ts` (NEW)

**Attività**

Three tests, no mocks, no new deps (imports: `bun:test`, node builtins, `@vscode/vsce` `{ listFiles, PackageManager }`, `../../script/pack-vsix`):

1. `".vscodeignore keeps the playwright runtime in and dev junk out of the VSIX file list"` (always runs, fast):
   - tmpdir staging: copy the repo's real `package.json` + `.vscodeignore`; create dummy files: `dist/extension.js` (1 B), `dist/node_modules/playwright-core/browsers.json` (1 B), `dist/node_modules/chromium-bidi/package.json` (1 B), `node_modules/fake-pkg/index.js` (1 B), `tests/unit/junk.test.ts` (1 B), `storybook-static/junk.js` (1 B), `dist/stale.vsix` (1 B).
   - `files = await listFiles({ cwd: staging, packageManager: PackageManager.None })` → expect to CONTAIN the two `dist/node_modules` dummies + `dist/extension.js`; expect to NOT contain any path under top-level `node_modules/`, `tests/`, `storybook-static/`, and not `dist/stale.vsix`.
2. `"packager staging includes the full playwright runtime"` (runs only if `dist/extension.js` AND `bin/kilo` exist in the repo — otherwise register nothing / skip with a log line, since CI checkouts may lack build artifacts):
   - `const { staging } = await stageVsix(<linux target object>, <package root>)` → `listFiles` → assert every `REQUIRED_VSIX_FILES` entry is present and no `FORBIDDEN_VSIX_PATTERNS` match; assert specifically `dist/node_modules/chromium-bidi/node_modules/zod/package.json` (nested-dep copy).
   - Declare a generous per-test timeout as the third `it` argument (e.g. `60_000`) — `stageVsix` may spawn `local-bin.ts`.
3. `"production extension bundle is self-sufficient for offline installs"` (runs only if `dist/extension.js` exists):
   - Scan `dist/extension.js` for bare specifiers with the same regex approach as `esbuild-dependencies.test.ts:28-41` (`require("...")` / `import "..."`).
   - For each specifier that is not relative, not a `node:` builtin (use `node:module` `builtinModules`), and not `vscode`: resolve it with `createRequire(path.join(root, "dist/extension.js")).resolve(spec)` wrapped so resolution failure ⇒ assertion failure with the specifier named. Expected universe today: exactly `playwright-core` (resolves via `dist/node_modules`).

Notes: the new file is auto-discovered by `test:unit`; keep total added runtime well under the 300 s per-file budget (test 1 is ms-fast; tests 2-3 are skipped in bare checkouts). If `test-unit-timings.json` scheduling complains, update via `bun run test:unit:timings --update-timings` (optional, last resort).

**Dipendenze**

- Step 2 completed (the test imports `pack-vsix.ts` exports).

**Output atteso**

Green new guard test file; suite total grows by the new tests (skips allowed only when build artifacts are absent).

**Verifiche**

- `bun test tests/unit/vsix-packaging.test.ts` from `packages/kilo-vscode/` — pass.
- Full `bun run test:unit` from `packages/kilo-vscode/` — all green (previously 462/462 at close-out; now 462+new).
- `bun run knip` green (test file is a knip entry; all imports declared).
- Sanity: temporarily break the guard's target (e.g. move `dist/node_modules` aside) and confirm test 2/3 fails, then restore. (Do this carefully, restore before finishing.)

**Compilazione**

- `bun run typecheck` + `bun run lint` green; resolve anything introduced.

**Rischi**

- Test 2 depends on `stageVsix` spawning `local-bin.ts`; on a machine with stale markers this could attempt a network build — the test must pass through `local-bin.ts`'s normal gating and, if it cannot complete offline, the test should fail with that error (acceptable: signals "prepare CLI binaries first"), not hang (keep the per-test timeout).
- Regex-based require scan (test 3) is heuristic by nature (same as the existing guard at `esbuild-dependencies.test.ts`); false positives are avoided by the same filtering rules that test already uses.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step; non modificare `pack-vsix.ts` salvo un fix genuinamente necessario alla riusabilità degli export (riportalo nel report).
- Nessuno mock: i test devono eseguire la logica reale (`listFiles`, staging, resolution).
- Compila/typecheck al termine; risolvi ogni errore introdotto.
- In caso di dubbio sulle API, leggi i file citati sopra — non supporre.

---

### Step 4 — Offline invariant I11 (check:offline) + documentation corrections

**Obiettivo**

Make the packaging self-sufficiency part of the fork's invariant suite and correct the stale documentation that caused (or at least failed to prevent) this regression.

**Motivazione**

`check:offline` (10/10) is the fork's standing offline gate but none of I1–I10 touches VSIX packaging — the exact gap through which the broken 7.8.1 VSIX shipped. The AGENTS.md packaging paragraph contains a factually wrong claim ("vsce 3.9.2 strips the `!` negations") and still points at the manual recipe.

**File da leggere**

- `script/check-offline-invariants.ts` (root; invariant block pattern `pass/fail`, docstring `:2,:5`, report section `:314-325`)
- `packages/kilo-vscode/AGENTS.md` (§"CLI Binary" packaging paragraph at `:117`, hard-requirement header line mentioning the floor invariant)
- `docs/upstream-sync.md` (packaging-gate paragraph, invariants matrix where the floor is labeled I11)
- `PRUNE-NOTES.md` `:166,:168` (wording "I1–I11", "10/10", the close-out VSIX bullet — the erratum itself is written in Step 5)
- Root `AGENTS.md` (mentions "invariants I1–I10" — update to I1–I11)

**File da modificare**

- `script/check-offline-invariants.ts`:
  - New block **I11** (VSIX packaging self-sufficiency) before the report section, matching the existing read-only style (no process spawning): assert `packages/kilo-vscode/script/pack-vsix.ts` exists AND its text contains the required-runtime markers `dist/node_modules/playwright-core` and `dist/node_modules/chromium-bidi` (i.e. the packager still asserts the playwright runtime) AND `packages/kilo-vscode/.vscodeignore` does not contain an un-anchored pattern that would exclude `dist/node_modules` (simple heuristic: no line equal to `node_modules/**` appearing *after* a `!dist/**` negation without the anchoring comment — keep it to: file exists + `!dist/**` line present + the two runtime strings in `pack-vsix.ts`). Update the docstring "I1–I10" → "I1–I11".
  - Renumber doc references to the VS Code 1.103 floor invariant from **I11 → I12** (floor stays doc/grep-level, implemented exactly as before).
- `packages/kilo-vscode/AGENTS.md` §"CLI Binary": replace the "vsce 3.9.2 strips the `!` negations … stage twice" sentence with the verified behavior: negations ARE honored by the installed vsce 3.9.2, but with unconditional precedence over all ignore patterns (so per-file exclusion inside `!dist/**`/`!bin/**` is impossible — that is why `bin/.cli-version`/`bin/.ffmpeg-target` are removed from the staged tree by `local-bin.ts`, not by `.vscodeignore`); declare **`bun run package:vsix`** as the single offline VSIX production path (per-platform staging, local `@vscode/vsce`, pre-pack content assertions incl. `dist/node_modules`); note `script/build.ts`/`publish.ts` remain the upstream multi-target/publish path, unused by this fork; add one line: the VSIX ships the `playwright-core`/`chromium-bidi` libraries but **no browser binary** — the Integrated Browser needs system Chrome (default) or `PLAYWRIGHT_BROWSERS_PATH`; the `Web Tools` MCP setting needs the npm registry and stays off in offline deployments.
- `docs/upstream-sync.md`: post-sync packaging gate = `bun run compile` (from `packages/kilo-vscode/`) **then** `bun run package:vsix` (self-verifies `dist/node_modules`); renumber floor invariant to I12 in the matrix.
- Root `AGENTS.md`: "I1–I10" → "I1–I11" where it refers to the `check:offline` suite.

**Dipendenze**

- Steps 1–3 completed (I11 asserts the existence of the Step-2 script).

**Output atteso**

`bun run check:offline` reports 11/11; docs are consistent with the scripted pipeline and the verified vsce behavior.

**Verifiche**

- `bun run check:offline` from repo root → 11/11 green.
- Root guards: `bun run script/check-workflows.ts`, `bun run script/check-md-table-padding.ts` (docs tables touched — keep tables compact, no padded cells), `bun run script/check-kilocode-duplication.ts`, `bun run script/check-kilo-generated-artifacts.ts`, `bun run script/check-forbidden-strings.ts`.
- `bun run knip` + `bun run typecheck` + `bun run lint` (root and `packages/kilo-vscode/`) green.

**Compilazione**

- TS touched only in `script/check-offline-invariants.ts`: root `bun run typecheck` green; resolve any error introduced.

**Rischi**

- Renumbering I11→I12 in docs may miss one reference — grep the whole repo for `I11` after the edit and fix stragglers (report them).
- I11 heuristic stays deliberately coarse (file/string presence): its job is to fail loudly if the packaging script or its runtime assertions are deleted in a future sync, not to re-implement the packer.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step; non toccare `pack-vsix.ts`, i test, o la packaging pipeline.
- Modifiche docs minime e mirate; nessuna riscrittura di sezioni non colpite; tabelle markdown compatti (senza padding).
- Esegui i guard elencati in Verifiche; risolvi gli errori introdotti.

---

### Step 5 — Final re-pack, artifact verification, close-out record, hand-off

**Obiettivo**

Produce the corrected 7.8.1 VSIXes through the new pipeline, verify their contents end-to-end (including the previously-missing `dist/node_modules` payload), record the erratum in `PRUNE-NOTES.md` + `CHANGELOG.md`, and hand off precise install/verification steps for the offline machine.

**Motivazione**

The user's offline machine still runs the broken `kilocode.kilo-code-7.8.1` VSIX; only a re-packed artifact fixes it. The close-out record must state what went wrong and why the new gate prevents recurrence.

**File da leggere**

- `PRUNE-NOTES.md` (the 2026-09-26 sync section, `:144-173`) and `packages/kilo-vscode/CHANGELOG.md` (7.8.1 offline-fork section)
- Artifacts from Step 2/4 runs: `packages/kilo-vscode/dist-vsix/kilo-code-7.8.1-{linux,win32}.vsix`

**File da modificare**

- `PRUNE-NOTES.md` — append a short erratum block to the 2026-09-26 sync section: root cause (close-out manual staging dropped `dist/node_modules/{playwright-core,chromium-bidi}`; no content check covered it; installed 7.8.1 VSIX crashed activation with `Cannot find module 'playwright-core'` on offline VS Code 1.135), fix (scripted `bun run package:vsix` with pre-pack content assertions + `tests/unit/vsix-packaging.test.ts` guard + check:offline I11), re-packed artifacts with sizes.
- `packages/kilo-vscode/CHANGELOG.md` — one line under the 7.8.1 offline-fork section: re-packed VSIXes now ship `dist/node_modules` (playwright runtime); install with `--force`.

**Attività**

1. `bun run package:vsix` from `packages/kilo-vscode/` → both artifacts (fresh, from the current tree after Steps 1–4).
2. Per-artifact verification (all must pass, else stop and fix in the packager, not by hand-editing zips):
   - `unzip -l` contains: `extension/dist/extension.js`, `extension/dist/webview.js`, `extension/dist/agent-manager.js`, `extension/dist/node_modules/playwright-core/index.js`, `extension/dist/node_modules/playwright-core/browsers.json`, `extension/dist/node_modules/chromium-bidi/package.json`, `extension/dist/node_modules/chromium-bidi/node_modules/zod/package.json`, `extension/dist/licenses/playwright-core/LICENSE`, `extension/package.json`, `extension/README.md`, `extension/audio-wav/…`; linux: `extension/bin/kilo`, `extension/bin/ffmpeg`, `extension/bin/bwrap`, `extension/bin/tree-sitter/tree-sitter.wasm`; win32: `extension/bin/kilo.exe`, `extension/bin/ffmpeg.exe`, `extension/bin/tree-sitter/tree-sitter.wasm` (37 tree-sitter entries each, as at close-out).
   - `unzip -l` does NOT contain: `extension/tests/`, `extension/storybook-static/`, `extension/dist/*.vsix`, `extension/bin/.cli-version`, `extension/bin/.ffmpeg-target`, top-level `node_modules/`.
   - `unzip -p <vsix> extension.vsixmanifest` → `Identity ... Version="7.8.1"`, `InstalledSize`/`Size` sane, engine `^1.103.0`.
   - Sizes in the 130–145 MB class (the previous broken artifacts were 133.05/133.44 MB *without* the payload; with `dist/node_modules` expect ~+20 MB — record actual values).
   - Optional (if a VS Code binary exists on this machine): install the linux VSIX into an isolated profile and confirm the extension activates without the playwright error; otherwise mark as user-side verification.
3. Write the PRUNE-NOTES erratum + CHANGELOG line with the recorded sizes.
4. Produce the hand-off note for the user (in the final report): on the offline machine run `code --install-extension <path>/kilo-code-7.8.1-linux.vsix --force`, reopen VS Code, confirm no `Cannot find module 'playwright-core'` in the log, and (as at close-out) check the spawned backend's `GET /provider` returns only the 6 local providers.

**Dipendenze**

- Steps 1–4 completed and approved.

**Output atteso**

Two verified VSIXes in `packages/kilo-vscode/dist-vsix/`, close-out documentation updated, hand-off instructions delivered.

**Verifiche**

- The full verification matrix of Attività 2, per artifact.
- `bun run test:unit` (final state, all green), `bun run check:offline` (11/11), root guards green.

**Compilazione**

- No new source changes expected; if the packager needs a fix, apply it, re-run `bun run typecheck`/`lint` in `packages/kilo-vscode/`, then re-pack. The tree must end green.

**Rischi**

- Size/manifest surprises (e.g. `updatePackageJson` semantics) → the packager already pins `updatePackageJson: false` + explicit `version`; if the manifest shows a different version, fix in `pack-vsix.ts` and re-pack.
- The offline machine may have an *older* extension folder from the broken install — `--force` replaces it; mention this in the hand-off.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step; se la verifica degli artifact fallisce, la correzione appartiene al packager (riapri Step 2 con un fix mirato e ri-reporta) — non modificare a mano il contenuto dei VSIX.
- Non bumpare la versione. Non committare nulla a meno che non sia esplicitamente richiesto.
- Il report finale deve contenere: dimensioni/SHA degli artifact, esito di ogni verifica della matrice, e i comandi esatti per l'installazione sulla macchina offline.

---

## Criteri di completamento (Completion criteria)

- Tutti gli step completati e approvati, in ordine.
- `bun run package:vsix` produce entrambi gli artifact con `dist/node_modules/{playwright-core,chromium-bidi(+nested)}` verificati pre-pack e nell'artifact finale.
- `tests/unit/vsix-packaging.test.ts` verde; suite `test:unit` completa verde; `bun run check:offline` 11/11; guard root (workflows, md-table-padding, duplication, generated-artifacts, forbidden-strings) e `knip` verdi.
- Documentazione corretta (recipe scriptizzata, semantica vsce verificata, floor invariant rinominata I12, nota offline sul browser provisioning).
- Nessun crash di activation atteso sulla macchina offline: l'artifact reinstallato con `--force` carica `playwright-core` da `dist/node_modules/` senza rete.
- Nessuna funzionalità extra introdotta; nessuna dipendenza npm nuova; versione e floor `^1.103.0` invariati.

## Open questions / scope notes

- Fuori scope (confermato): embed di un binario Chromium nel VSIX (decisione: solo librerie + docs); comportamento del setting "Web Tools" MCP (resta off, solo documentazione); bump di versione; supporto a piattaforme oltre linux-x64/win32-x64 (i target restano gli stessi del close-out).
- Se in futuro un sync upstream introduce un nuovo modulo external nel bundle, il test di self-sufficienza dello Step 3 fallirà: la risposta è estendere la lista di copy di `script/playwright-runtime.js` (o il meccanismo equivalente) + `REQUIRED_VSIX_FILES`, non impacchettare manualmente.