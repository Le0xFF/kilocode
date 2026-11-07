# Proxy credentials for the spawned `kilo serve` backend (S2, in-memory push, scheme-extensible)

## Obiettivo (Goal)

When VS Code's `http.proxy` points at an authenticated corporate proxy, the Kilo VS Code extension provides per-proxy **Basic** credentials to the `kilo serve` child **without ever placing them in any process environment variable**:

- Credentials travel extension → child over the existing authenticated loopback API (new Kilo-owned route, protected by the `KILO_SERVER_PASSWORD` basic auth the extension already enforces on every spawn).
- The CLI holds them **in process memory only** and applies them per-request via Bun `fetch`'s per-request `proxy` option. No `process.env` mutation, ever.
- UX: Command Palette commands **and** a "Network" tab in the webview settings panel (between "Language" and "About Kilo Code"). A **"Remember credentials (store in OS keychain)" checkbox defaults to OFF** — only when checked are credentials written to `context.secrets`; otherwise they are session-only and vanish on window reload.
- Stored/session credentials are viewable as **host + username only, never the password**.
- A 407 provider response gets an actionable hint.

**Standalone / upstream-PR requirement**: the whole feature must be extractable as a clean pull request to the original owner (Kilo-Org/kilocode = `origin`):
- All new code lives in Kilo-owned paths (`packages/opencode/src/kilocode/`, `packages/kilo-vscode/`), plus the regenerated `packages/sdk/js` and `en` i18n strings.
- **Zero new dependencies** (no `package.json` changes anywhere) — this is also why libcurl is NOT introduced in v1 (see Analysis).
- At most **one shared-file touch**: the bootstrap import line at the CLI entry (marked `kilocode_change` in this fork; a plain line in the upstream PR).
- Commits scoped per package (`feat(cli): …`, `feat(vscode): …`, `chore(sdk): regenerate types`) so a PR branch cut from `origin/main` + cherry-picks reproduces the feature.
- The feature is a no-op when no credentials are configured → safe to merge upstream for all users.

**Extensibility requirement**: the CLI implementation is built on a scheme/transport seam so future proxy auth methods — **Digest, NTLM, Kerberos/Negotiate** — are additive backend files, not re-architecture. v1 implements `basic` only.

**Verified facts the design rests on** (do not re-research):

1. `packages/kilo-vscode/src/services/cli-backend/server-manager.ts:376-447` (`buildProxyEnv`) already translates VS Code `http.proxy`/`http.noProxy`/`http.proxySupport` into the 8 standard proxy env vars for the child (invariant I14: never stripped). The plain proxy *URL* reaches the child; only credentials are missing.
2. CLI = Bun 1.4.4; all provider traffic goes through native `fetch` (directly, or via Effect `FetchHttpClient` / AI SDK `getOriginalFetch = () => globalThis.fetch`). Bun `fetch` supports a per-request `proxy` init option with `user:pass@` embedded (**Basic only**); `NO_PROXY` is documented to apply to an explicit `proxy` value; env-based resolution is re-read per request. **Bun has no plan for other schemes** — the only attempt (oven-sh/bun PR #36203, Windows SSPI Negotiate/NTLM) was closed unmerged in Sep 2026.
3. VS Code stores its own proxy credentials in the Electron main process only (OS-keychain-encrypted, unreachable by extensions/children; no public API). Reuse impossible → Kilo keeps its own store. Upstream `main` never had this feature; nothing lost in `leocode`.
4. Why NOT env injection: a credential in the child's initial env is visible via `/proc/<pid>/environ` (same user) and inherited by every subprocess the CLI spawns (the bash tool runs arbitrary commands). In-memory + per-request `proxy` option is the only design that keeps credentials out of all environments.
5. `packages/opencode/src/util/proxy-env.ts` (`getProxyForUrl`/`shouldProxy`) is dead shared code implementing the env-based proxy precedence needed by the fetch wrapper — reuse by import (no edit → no markers).
6. Extension: no `SecretStorage` usage today (first use); `KiloConnectionService.connect()` (`connection-service.ts:179`) is the public (re)connect trigger and re-runs on lazy respawn after exit; `ServerManager`'s constructor already receives the `ExtensionContext` (`server-manager.ts:97-101`). CLI Kilo route groups live in `packages/opencode/src/kilocode/server/httpapi/groups/`; the server auth middleware protects all paths when a password is configured (the extension always sets `KILO_SERVER_PASSWORD`). SDK client regenerates from server endpoints via root `./script/generate.ts` (auto-generated `packages/sdk/js` — never hand-edited; the regenerated output belongs in the upstream PR).
7. libcurl research (2026-11, curl.se docs + npm registry): libcurl covers Digest and Negotiate/Kerberos (GSSAPI/SSPI build) and CONNECT tunneling, but **removes NTLM in 8.24.0** (opt-in since 8.20.0; NTLM_WB removed in 8.8.0). npm binding landscape: `node-curl` dead (2014, non-N-API), `curl-ffi` gone from npm, only `node-libcurl` actively maintained (N-API, per-target prebuilds incl. Heimdal/Kerberos). Bun `--compile` embeds N-API addons (bun.com/docs/compiler/executables) but requires per-target prebuilds for all 6 targets. → **libcurl is a plausible future *Kerberos-only* backend, not the v1 baseline, and not an NTLM baseline.**
8. Per-scheme future feasibility: **Digest** = pure JS (MD5 challenge/response over a raw CONNECT socket). **NTLMv2** = pure JS feasible (HMAC-MD5 + small pure-JS MD4 for the NTOWF hash — [MS-NLMP] §2.2.2.5; the npm `ntlm` package is dead precisely because MD4/DES-ECB vanished from modern `crypto`). **Kerberos/Negotiate** = NOT pure-JS-realistic; needs OS SSPI (Windows) / GSSAPI (macOS/Linux) via a native binding (`node-libcurl` prebuilds or the `kerberos` npm package) — same reason the JS ecosystem's `proxy-agent-negotiate` takes `kerberos` as a native peer dep.

## Analisi (Analysis)

- **Data flow (steady state, v1 = basic)**:
  1. Child starts with plain proxy URL env (unchanged `buildProxyEnv`); in-memory credential state empty → all traffic native env-proxied, anonymous → 407 until credentials arrive.
  2. Extension (on successful connect, on Set/Clear, on secret change, on backend respawn) calls the new endpoint with `{ mechanism: "basic", user, password }` or `{ clear: true }` over `http://127.0.0.1:<port>` with the existing `Basic kilo:<password>` header.
  3. CLI stores credentials in the `proxy-auth` state module (no env writes); its installed `fetch` wrapper, on every request, resolves the proxy from env (via `proxy-env.ts`), and — when a **supported** backend is active and the target is not loopback/`NO_PROXY` — asks the active `ProxyAuthBackend` how to route the request. The v1 `basic` backend returns a `proxy` init value with URL-embedded credentials (WHATWG encoding); the wrapper passes it to the real `fetch`. Env proxy value already embedding credentials (S1 path) → pass-through untouched.
  4. On Clear: state empties → native env behavior restored.
- **Scheme seam (extensibility core)**: `packages/opencode/src/kilocode/proxy-auth/` directory:
  - `types.ts` — `ProxyAuthMechanism = "basic" | "digest" | "ntlm" | "kerberos"`; `ProxyCredentials { mechanism; user?: string; password?: string; domain?: string }` (v1 populates `mechanism: "basic"`, `user`, `password`; extra fields reserved for ntlm `domain`, future schemes); `ProxyAuthBackend { readonly mechanism; route(requestUrl, proxyUrl, creds): { proxy?: string } | CustomTransportAction }` — v1 backends only need the `{ proxy }` form; future backends may return a custom transport action (raw-socket CONNECT handshake for digest/ntlm; native handle for kerberos) which the fetch wrapper dispatches to a `ProxyTransport` executor. The seam is an interface + registry, deliberately minimal in v1 (no dead custom-transport plumbing beyond the type).
  - `state.ts` — in-memory singleton: `set(creds)`, `clear()`, `peek()`; validates `mechanism` against registered backends (`set` of an unregistered mechanism → API returns 501 "mechanism not supported" — forward-compatible contract).
  - `resolve.ts` — pure `resolveProxyForUrl(targetUrl, creds)` (env precedence via `proxy-env.ts`, no_proxy, defensive loopback bypass, embedded-creds pass-through).
  - `backends/basic.ts` — v1 backend (Bun `proxy` option).
  - `fetch-wrapper.ts` + `bootstrap.ts` — install the global fetch wrapper once at CLI startup (before any module captures a `fetch` binding); no-credentials → pure pass-through (feature is inert unless used).
  - Endpoints on the chosen Kilo group: `proxyAuth.set` / `proxyAuth.clear`; responses echo `{ active: boolean; host: string; mechanism: string }` — never credentials.
- **Residual-exposure audit** (all other paths verified clean): (a) `kilo serve` process memory — unavoidable; the heap-snapshot endpoint is refused while credentials are active; (b) loopback transit over the pre-existing `KILO_SERVER_PASSWORD`-authenticated channel — no new trust surface; (c) the S1 inline-credentials-in-`http.proxy` path — user-chosen, documented as such; (d) OS-level crash/heap dumps — documented enterprise caveat; (e) TUI mode without a server password: a local process can inject via the endpoint but cannot read anyone's credentials (responses echo only `active`/`host`/`mechanism`); (f) extension host memory holds session-only credentials by design, cleared on window reload; no command dumps the extension host heap.

## Assunzioni (Assumptions)

1. **v1 = Basic only** (username optional/anonymous, password required). Digest/NTLM/Kerberos are out of scope now; the seam + docs prepare them (Digest/NTLM: pure-JS backends; Kerberos: native GSSAPI/SSPI backend — libcurl/`node-libcurl` or `kerberos` package as candidate, chosen later with its prebuild pipeline).
2. Credentials persist only in `kilo serve` process memory (plus OS keychain when the user checks "remember"). Residual = the child's own memory; nothing in any environment, nothing on disk outside the keychain.
3. Per-proxy keying: `kilo.proxyAuth.<scheme>://<lowercase-host>:<resolved-port>`; user-embedded credentials in `http.proxy` always take precedence over pushed credentials; `http.proxySupport: "off"` disables proxying entirely (native behavior).
4. **Default is session-only** (checkbox off): pushed credentials live until window reload / backend restart. When "remember" is checked they go to `SecretStorage` (JSON `{ mechanism, user, password }` — shape already extensible) and are re-pushed on every backend (re)start.
5. Startup race (first provider call before the push lands) → 407, covered by the Step 5 hint; the extension pushes immediately after `connect()` resolves.
6. The global-`fetch` wrapper installs once at CLI startup before any module captures a `fetch` binding (Step 2 verifies/fixes order, e.g. `native-runtime.ts`'s `provideService(FetchHttpClient.Fetch, fetch)`), and is a no-op pass-through when no credentials are set.
7. Webview: new "Network" tab between "Language" and "About Kilo Code"; i18n `en` source strings only.
8. Tests follow package conventions (global `tests/setup/vscode-mock.ts`, minimal fake contexts, no implementation mocks).

## Upstream / PR strategy

- Develop on a `leocode`-based branch. **Commit policy: never one bulk commit for the feature** — each step lands its own commit(s), grouped by logical unit (a module and its tests commit together), each independently compiling (mirroring the per-step compile gate):
  - Step 1 → `feat(vscode): add proxy-auth credential helpers` (module + tests)
  - Step 2 → `feat(cli): in-memory proxy auth for kilo serve (basic)` (the `kilocode/proxy-auth/` module, endpoints, heap-snapshot guard, tests) + a separate `chore(sdk): regenerate client for proxyAuth endpoints` (generated `packages/sdk/js` only)
  - Step 3 → `feat(vscode): proxy credential state, push wiring, and commands` (state module, connection-service wiring, commands, `package.json`, tests)
  - Step 4 → `feat(vscode): Network settings tab for proxy credentials` (tab, message types, i18n en)
  - Step 5 → `feat(cli): 407 proxy-auth hint for provider errors`
  - Step 6 → `docs(vscode): document corporate proxy authentication` (README + CHANGELOG)
- **Commit hygiene (cherry-pick safety)**: code commits must **never** include agent documentation files (root `AGENTS.md`, `packages/kilo-vscode/AGENTS.md`, `.kilo/agent/*`, other `AGENTS.md`/agent-instruction files). Steps do not modify agent docs by default; if an implementer deems an agent-doc update warranted, it goes in a **separate, dedicated commit** at the very end (after Step 6's code commits), so the feature code commits cherry-pick onto an `origin/main`-based PR branch without it.
- File map of the PR surface: `packages/opencode/src/kilocode/proxy-auth/` (new dir) + Kilo route group additions + at most one marked entry-import line + `packages/opencode/test/kilocode/proxy-auth*` tests + `packages/kilo-vscode/src/services/cli-backend/proxy-auth*.ts` + `src/commands/proxy-auth.ts` + `webview-ui/src/components/settings/NetworkTab.tsx` + message types + `package.json` (commands only, no deps) + `packages/sdk/js` (generated) + `packages/kilo-i18n` (en) + docs.
- PR to `origin` (Kilo-Org/kilocode): cut from `origin/main`, cherry-pick the feature commits; the single shared-file line arrives unmarked. No dependency, lockfile, or guard-file changes → trivially reviewable.
- Optional later: upstream the CLI portion to opencode (requires carrying the `src/kilocode` tree — separate, larger integration; out of scope).

## Piano di implementazione (Implementation plan)

Workflow: **one subagent per step, strictly sequential**. After each step: compile gates run by the subagent, then **user review and approval**; once approved, the step's work is committed per the commit policy in "Upstream / PR strategy" (its own conventional commit(s), never a bulk commit of the whole feature) before the next step starts.

---

### Step 1 — Pure proxy-auth module (extension side) + unit tests

**Obiettivo**: vscode-free helpers in the extension: secret key derivation, embedded-credential detection, credential parsing (mechanism-aware shape), key filter.

**Motivazione**: testable contract shared by Steps 3-4; the extension never rewrites env, so no `applyProxyAuthEnv` is needed here (that logic lives in the CLI, Step 2).

**File da leggere**: `packages/kilo-vscode/src/services/cli-backend/server-manager.ts` (`buildProxyEnv` L366-447); `packages/kilo-vscode/tests/unit/server-manager-proxy-env.test.ts` (test style).

**File da creare**:
- `packages/kilo-vscode/src/services/cli-backend/proxy-auth.ts`:
  - `proxyAuthKey(proxyUrl: string): string | null` — parse (prepend `http://` if no scheme); `kilo.proxyAuth.<scheme>://<lowercase-host>:<resolved-port>` (explicit port or scheme default 80/443); `null` on parse failure, never throws.
  - `isProxyAuthKey(key: string): boolean` — `kilo.proxyAuth.` prefix.
  - `hasEmbeddedCredentials(proxyUrl: string): boolean` — `url.username !== ""`; `false` on parse failure.
  - `parseCred(json: string): { mechanism: "basic" | string; user: string; password: string } | null` — defensive; accept `{ user, password }` (legacy-shape fallback → `mechanism: "basic"`) and `{ mechanism, user, password }`; wrong shape/missing `password` → `null`; never throws.
  - `makeCred(creds: { mechanism?: string; user: string; password: string }): string` — canonical JSON for storage (`mechanism` defaults to `"basic"`).
- `packages/kilo-vscode/tests/unit/proxy-auth.test.ts`: key normalization (case, default ports), embedded detection, `parseCred` valid/legacy/invalid, `makeCred` round-trip, `isProxyAuthKey`, malformed URLs.

**Dipendenze**: none. **Output atteso**: module + green tests; package compiles.

**Verifiche**: `cd packages/kilo-vscode && bun run typecheck && bun run lint && bun test tests/unit/proxy-auth.test.ts`.

**Compilazione**: typecheck + lint pass; fix any compile error before finishing.

**Rischi**: exports unused until Step 3 → `bun run knip` flags them; expected, resolved by later imports — do not unexport.

**Istruzioni per il subagente**: only this step; do not touch `server-manager.ts`; keep the module vscode-free; compile at the end.

---

### Step 2 — CLI: `proxy-auth` module (scheme seam), fetch wrapper, endpoints, SDK regen

**Obiettivo**: the CLI can receive proxy credentials (mechanism-tagged) over its API, keep them in memory only, apply Basic per-request via the `proxy` fetch option, and exposes the seam future Digest/NTLM/Kerberos backends plug into — without ever touching `process.env`, and without new dependencies.

**Motivazione**: leak-proof core (no env, no inheritance to tool subprocesses), no-restart credential changes, and the extensibility/PR-standalone requirements in one bounded module.

**File da leggere**:
- `packages/opencode/src/util/proxy-env.ts` (`getProxyForUrl`/`shouldProxy` — reuse by import).
- `packages/opencode/src/kilocode/server/httpapi/groups/` (pick the catch-all Kilo group, e.g. `KilocodeApi`, or `NetworkApi`; verify path prefix + endpoint declaration pattern) and the matching `handlers/kilocode.ts` (note: `heapSnapshot` handler at `handlers/kilocode.ts:222`, route `groups/kilocode.ts:146,236`).
- `packages/opencode/src/server/auth.ts` + `src/server/routes/instance/httpapi/middleware/authorization.ts` — confirm the new endpoints are protected when a password is configured (extension always sets one); do not edit shared files.
- `packages/opencode/src/session/llm/native-runtime.ts` (L145 `provideService(FetchHttpClient.Fetch, fetch)`) and `src/provider/provider.ts` (L1019-1069) — identify every place a `fetch` binding is captured; ensure the wrapper installs before first use.
- CLI entry/`serve` command path — find the earliest Kilo-owned init hook; if only a shared entry can import the bootstrap, add a **one-line** `// kilocode_change`-marked import (the only permitted shared-file touch; in the upstream PR this line is unmarked).
- Existing Kilo route tests under `packages/opencode/test/kilocode/server/` (endpoint test pattern).

**File da creare/modificare**:
- `packages/opencode/src/kilocode/proxy-auth/` (new directory, Kilo-owned):
  - `types.ts` — `ProxyAuthMechanism = "basic" | "digest" | "ntlm" | "kerberos"`; `ProxyCredentials { mechanism: ProxyAuthMechanism; user?: string; password?: string; domain?: string }`; `ProxyAuthBackend { readonly mechanism: ProxyAuthMechanism; route(targetUrl: string, proxyUrl: string, creds: ProxyCredentials): { proxy?: string } }` (v1: all backends use the `{ proxy }` form; a doc comment specifies the future extension point — a custom-transport executor for handshake schemes and a native-handle transport for Kerberos — **types only in v1, no dead plumbing**); `SUPPORTED_MECHANISMS: ["basic"]` registry constant.
  - `state.ts` — singleton `set(creds)` / `clear()` / `peek()`; `set` validates `mechanism ∈ SUPPORTED_MECHANISMS` (else error the API maps to 501).
  - `resolve.ts` — pure `resolveProxyForUrl(targetUrl, creds?)` per the Analysis data flow (env precedence via `proxy-env.ts`; loopback/`NO_PROXY` bypass; embedded-creds pass-through; with basic creds → `{ proxy: "<proto>://user:pass@host:port" }` via WHATWG URL encoding).
  - `backends/basic.ts` — the v1 `ProxyAuthBackend` (delegates to `resolve.ts`).
  - `fetch-wrapper.ts` — `installFetchWrapper()`: capture `realFetch = globalThis.fetch`; replace `globalThis.fetch` with a pass-through that adds `init.proxy` when `resolveProxyForUrl` returns one (all other init untouched; streaming/duplex preserved). Must never log the proxy URL or credentials.
  - `bootstrap.ts` — `initProxyAuth()`: idempotent wrapper install; called from the CLI startup hook.
  - `index.ts` — barrel exporting the public surface.
- Endpoints on the chosen Kilo group: `proxyAuth.set` (`{ mechanism?: "basic" | "digest" | "ntlm" | "kerberos"; user?: string; password: string }` → 501 for unsupported mechanism) and `proxyAuth.clear`; responses `{ active: boolean; host: string; mechanism: string | null }` (never echo credentials).
- **Heap-snapshot guard** (Kilo-owned): `handlers/kilocode.ts` `heapSnapshot` refuses (clear error) when the proxy-auth state is active — a heap dump would serialize in-memory credentials to disk.
- **No-logging rule**: wrapper, state, handlers never log proxy URLs/credentials; a test captures log output with credentials active and asserts the raw and percent-encoded password never appear.
- Tests in `packages/opencode/test/kilocode/`: `resolveProxyForUrl` unit tests (precedence, no_proxy, loopback bypass, embedded pass-through, encoding, unsupported mechanism rejection); wrapper test (local fake proxy asserting `Proxy-Authorization: Basic`; loopback target untouched); endpoint tests (set/clear/status, auth required when password set, 501 for `ntlm`, **heap-snapshot refused while active**); log-capture test; **env-cleanliness test: a child spawned by the test CLI process sees a proxy env with no embedded credentials**.
- From repo root: `./script/generate.ts` to regenerate `packages/sdk/js/` with the new endpoints; verify the generated `KiloClient` exposes them (read the generated file; never hand-edit it).

**Dipendenze**: none (independent of Steps 1/3-4; runs second per sequencing).

**Output atteso**: `kilo serve` accepts `proxyAuth.set/clear`; Basic proxy auth works with credentials in **no** environment variable of `kilo serve` or any child; unknown mechanisms get a clean 501; SDK client has the new methods; the directory is self-contained and copy-apply-able to `origin/main`.

**Verifiche**: `packages/opencode`: `bun run typecheck` + new/extended test files via `bun test <files>`; root: SDK regen exits 0; `packages/kilo-vscode`: `bun run typecheck` still passes (SDK consumption compiles).

**Compilazione**: all green; fix any compile error before finishing. If a `fetch` binding capture order breaks an existing path, move `initProxyAuth()` earlier (Kilo-owned) — do not restructure shared code.

**Rischi**: (a) global fetch patching order — startup hook + tests exercising the provider path; (b) `proxy` option + `NO_PROXY` interaction — test empirically with a local fake proxy; (c) small key/URL-logic duplication between the two packages — keep functions tiny; if the root duplication guard complains in Step 6, adjust (allowlist last resort).

**Istruzioni per il subagente**: only this step; confine changes to `packages/opencode/src/kilocode/`, its tests, the generated SDK (via `generate.ts`), and at most the one-line marked entry import; never write credentials to `process.env` or disk; if Bun `proxy`-option behavior is in doubt, verify against bun.com docs (WebFetch) before coding.

---

### Step 3 — Extension: session/persistent credential state, push wiring, commands

**Obiettivo**: extension stores/provides mechanism-tagged credentials with **store-by-default-OFF** semantics and pushes them to the backend; palette commands `set`/`clear`/`status`.

**Motivazione**: user-facing control plane; default-off satisfies the security requirement (no keychain write unless the user opts in).

**File da leggere**: `packages/kilo-vscode/src/commands/toggle-auto-approve.ts` (pattern); `src/extension.ts` L87-91 + L597-803; `src/services/cli-backend/connection-service.ts` (public API L92-231, `doConnect` L975-1062, state L896-966); Step 1's `proxy-auth.ts`; the generated SDK client's new `proxyAuth` methods.

**File da creare/modificare**:
- `packages/kilo-vscode/src/services/cli-backend/proxy-auth-state.ts` (new): holds `ephemeral: ProxyCredentials | null` (in-memory, per window, by design for session-only mode) + `context.secrets` access for the persistent secret (`proxyAuthKey`-keyed JSON via `parseCred`/`makeCred`, `mechanism: "basic"` in v1); **stored secrets are read fresh from `SecretStorage` on each sync — no long-lived parsed cache**; `effective()` = ephemeral ?? stored; `set({user, password, remember: boolean})` (remember → `secrets.store(key, makeCred(...))`, else ephemeral only); `clear()` (removes both); `status()` → `{ proxy: string | null; host: string | null; username: string | null; mechanism: string | null; stored: boolean }` (**never** the password). Push failures log with the `[Kilo New]` prefix and contain no credentials/URLs.
- `connection-service.ts`: private `syncProxyAuth()` — client calls `proxyAuth.set` with `state.effective()` or `proxyAuth.clear` when none; invoked (a) right after successful `doConnect` (covers respawn/reload re-push), (b) on `context.secrets.onDidChange` for `isProxyAuthKey` keys, (c) after any state `set`/`clear` (state module exposes `onChange`, subscribed in the service constructor). A 501 "mechanism not supported" from the backend is swallowed silently (future-scheme guard).
- `packages/kilo-vscode/src/commands/proxy-auth.ts` (new): `registerProxyAuthCommands(context, service, state)` + reused `runSetProxyAuth`/`runClearProxyAuth`/`runProxyAuthStatus`:
  - `set`: effective `http.proxy` via a thin `readEffectiveProxy()` (mirrors `buildProxyEnv` activation: `proxySupport === "off"` → none); if none → info "Set the `http.proxy` setting first"; if `hasEmbeddedCredentials` → info "inline credentials in `http.proxy` are in use; stored credentials are ignored"; else prompt username (`showInputBox`, empty = anonymous) + password (`showInputBox({ password: true })`, empty = abort); then `showQuickPick(["Use only for this session (not stored)", "Remember — store securely in the OS keychain"])`, **first item = session-only (default)**; `state.set({user, password, remember: index === 1})` (mechanism `"basic"`); confirmation info naming host + username only.
  - `clear`: `state.clear()` → info "Proxy credentials cleared (host: <host>)".
  - `status`: info with proxy URL, host, username, "Basic" mechanism, "stored in keychain: yes/no" — **never** the password.
- `package.json`: contribute `kilo-code.new.proxyAuth.set/.clear/.status` (`commandPalette: true`); register in `extension.ts` (state constructed with `context`, wired to the service).
- Tests: `tests/unit/proxy-auth-state.test.ts` (fake `secrets` per `kilo-provider-session-refresh.test.ts` L141-151: remember=true writes canonical JSON, remember=false writes nothing to secrets, clear removes both, `status()` never contains the password, `effective()` precedence); `tests/unit/proxy-auth-commands.test.ts` (fake service/client + stubbed `showInputBox`/`showQuickPick` per the repo's existing stub pattern; set→session-only pushes without storing; set→remember stores + pushes; clear pushes clear; status message assertions).

**Dipendenze**: Steps 1-2 (SDK methods must exist).

**Output atteso**: credentials flow to the backend with default-off storage; secret changes and backend respawns re-sync automatically; palette works.

**Verifiche**: `bun test tests/unit/proxy-auth-state.test.ts tests/unit/proxy-auth-commands.test.ts` + `bun test tests/unit/connection-service-question.test.ts` (regression: `{}`-context construction still works) + full `bun run test:unit`.

**Compilazione**: `bun run typecheck` + `bun run lint` from `packages/kilo-vscode`; fix any compile error before finishing.

**Rischi**: never log passwords or proxy URLs (spawn logging prints the command line only — keep it that way); `syncProxyAuth` must tolerate a not-yet-ready client (no-op; runs on connect success).

**Istruzioni per il subagente**: only this step; no webview UI (Step 4); no `packages/opencode` changes; plain-English strings; compile at the end; verify against `@types/vscode` in `node_modules` (1.103 floor) before using any API.

---

### Step 4 — Webview "Network" tab (between Language and About Kilo Code)

**Obiettivo**: discoverable UI: proxy status, Set/Clear, **Remember-checkbox default OFF**, stored-credentials view (host + username only).

**Motivazione**: non-palette users; identical semantics to Step 3.

**File da leggere**: `packages/kilo-vscode/webview-ui/src/components/settings/` (tab list/registration — insert **immediately after the Language tab, before "About Kilo Code"**; one simple existing tab as template; `SettingsSearch.tsx`); `webview-ui/src/types/messages/` (message unions); `src/KiloProvider.ts` (`handleMessage` L1259+, `openSettingsPanel`-style cases, cached-loaded-message pattern); Step 3's state/commands modules; AGENTS.md "Extension ↔ Webview Feature Pattern" (context subscription outside `onMount`).

**File da creare/modificare**:
- `webview-ui/src/components/settings/NetworkTab.tsx` (new) + registration + `SettingsSearch` entries. Content: effective `http.proxy`; "inline credentials in use" badge when applicable; else credential state (session-only / stored-in-keychain / none) showing **host + username + mechanism ("Basic") only**; **"Remember credentials (store in OS keychain)" checkbox, default unchecked**; **Set** / **Clear** buttons (disabled when no proxy or inline credentials); note: "Basic authentication only. Digest/NTLM/Kerberos proxies are not supported yet — use an external local forwarder and point `http.proxy` at it." Built with `@kilocode/kilo-ui` components.
- Message types: host→webview `ProxyAuthStatusLoaded` (same shape as `status()` — no password) pushed when the settings panel opens (cached-message pattern); webview→host `proxyAuth.set { remember: boolean }` / `proxyAuth.clear` actions → host runs the Step 3 `run*` functions, re-pushes status. The username/password prompts run host-side (`showInputBox`); **the password never crosses the webview boundary**.
- i18n: `en` source strings only (existing key conventions in `packages/kilo-i18n`).

**Dipendenze**: Step 3.

**Output atteso**: settings panel shows live status; Set (with/without remember) and Clear behave identically to the palette; tab position matches the requirement.

**Verifiche**: `bun run compile` from `packages/kilo-vscode` (typechecks host + webview, lints, builds both bundles); small unit test for the new host handler path if existing handler tests make it cheap (same fakes as Step 3).

**Compilazione**: `bun run compile` green; fix any compile error before finishing.

**Rischi**: touch only the new tab, its registration, message types, i18n keys; never render the password anywhere.

**Istruzioni per il subagente**: only this step; mirror an existing simple tab's structure; no new dependencies; compile at the end; check `packages/kilo-ui/src/stories/` for component usage if unsure.

---

### Step 5 — 407 proxy-auth hint (Kilo-owned CLI overlay)

**Obiettivo**: actionable hint on 407 instead of raw proxy text.

**Motivazione**: covers the startup race (Assumption 5) and general discoverability.

**File da leggere**: `packages/opencode/src/kilocode/provider/error.ts` (`KiloError.hint` pattern, L90-96); `packages/opencode/src/provider/error.ts` (L189-210, `statusCode` survives); existing `KiloError` tests under `packages/opencode/test/kilocode/`.

**File da modificare**: `packages/opencode/src/kilocode/provider/error.ts` only (Kilo-owned → **no** markers) + its test.

**Attività**: when `statusCode === 407`: hint = the proxy requires authentication; in VS Code use "Kilo Code: Set Proxy Credentials" (or inline `user:pass@` in `http.proxy`); in the CLI embed Basic credentials in `HTTP(S)_PROXY`; other schemes (Digest/NTLM/Kerberos) are not supported — use an external forwarder. One client-neutral string.

**Dipendenze**: none (runs after Step 4 per sequencing).

**Output atteso**: 407 errors show the hint everywhere; other statuses unaffected.

**Verifiche**: `cd packages/opencode && bun run typecheck && bun test <touched test file>`.

**Compilazione**: typecheck green; fix any compile error before finishing.

**Rischi**: additive only; do not modify shared `src/provider/error.ts`.

**Istruzioni per il subagente**: only this step; single-file + test; compile at the end.

---

### Step 6 — Docs (incl. extensibility roadmap) + full guard run + PR packaging notes

**Obiettivo**: document the feature, the scheme-seam roadmap, and the upstream-PR surface; run every CI guard this work can affect.

**Motivazione**: enterprise users need both credential paths, default-off semantics, scheme limitations; maintainers need the extensibility story for the PR review.

**File da modificare**:
- `packages/kilo-vscode/README.md` — "Corporate proxy with authentication": (1) zero-config path = `http.proxy` with inline `user:pass@` (Basic); (2) Kilo credentials: commands + Network tab; **stored only when "Remember" is checked (OS keychain via SecretStorage)**, otherwise session-only; credentials never appear in any environment variable (in-memory in `kilo serve` only); (3) viewing shows host + username only; (4) **Supported: Basic only. Planned (scheme seam in the CLI `proxy-auth` module): Digest and NTLM as dependency-free pure-JS backends; Kerberos/Negotiate requires an OS-level native backend (GSSAPI/SSPI — e.g. a prebuilt libcurl binding or the `kerberos` package); libcurl is not an NTLM option (removed in libcurl 8.24.0). Workaround for all: external local forwarder (`gost`/`squid+ntlm_auth`/`ccproxy`) as the `http.proxy` target**; (5) `kilo-code.new.takeHeapSnapshot` is refused while credentials are active; avoid OS-level crash-dump collection while active.
- `packages/kilo-vscode/CHANGELOG.md` — entry per the file's existing format.
- Compact markdown tables only (no padded cells — `check-md-table-padding` guard).

**Attività** (full gate, in order):
- `packages/kilo-vscode`: `bun run compile`, `bun run test:unit`, `bun run knip` (every export imported — fix by using or unexporting), `bun run check-kilocode-change`.
- `packages/opencode`: `bun run typecheck` + Step 2/5 test files.
- Repo root: `bun run script/check-workflows.ts` (no-op expected), `bun run script/check-md-table-padding.ts`, `bun run script/check-kilocode-duplication.ts`.
- PR packaging check: `git diff --stat` against the feature branch base lists **only** the file map from the "Upstream / PR strategy" section (no dependency/lockfile/guard-file changes); `git log --oneline` shows the per-package conventional commits; **no commit's file list includes any `AGENTS.md` or agent-doc file** (if one does, split it into the separate trailing docs commit per the commit-hygiene rule).

**Dipendenze**: Steps 1-5.

**Output atteso**: docs merged; all guards green; PR surface verified.

**Compilazione**: every command exits 0; fix failures introduced by this feature before finishing.

**Rischi**: Knip on genuinely unused helpers → unexport; duplication guard on the small key/URL logic copies → keep functions minimal, allowlist only as last resort.

**Istruzioni per il subagente**: only this step; no code changes unless a guard fails (then minimal fix); run the gates exactly as listed and report each result.

---

## Criteri di completamento (Completion criteria)

- All 6 steps completed in order, each user-reviewed after its compile gates.
- **No credentials in any environment variable** — not in `kilo serve`'s initial env, not in its runtime env, not in any subprocess env; proven by the Step 2 child-spawn env-cleanliness test.
- **No credentials in any log line or API response** — log-capture test with credentials active passes; `proxyAuth`/status responses and the webview status shape carry at most host + username + mechanism; the heap-snapshot endpoint refuses while credentials are active.
- Session-only is the default (checkbox off, quick-pick first item); "Remember" writes to `SecretStorage` (mechanism-tagged JSON) and re-pushes on every backend (re)start; Clear removes both and tells the backend to clear.
- Network tab sits between "Language" and "About Kilo Code".
- `user:pass@` inline in `http.proxy` always takes precedence; `http.proxySupport: "off"` disables everything; loopback is never proxied.
- **Scheme seam**: `proxyAuth.set` with `mechanism: "digest" | "ntlm" | "kerberos"` returns a clean 501 today and requires no code change beyond adding a backend file + registry entry tomorrow; stored credential shape is mechanism-aware.
- 407 provider errors carry the actionable hint.
- **PR-ready**: diff surface limited to the documented file map; zero dependency changes; at most one marked shared-file line; regenerated SDK in its own commit.
- **Commit hygiene**: the feature is split across the per-step commits defined in the commit policy — **no single bulk commit**; no feature code commit contains agent documentation files (any agent-doc update is a separate trailing commit); every commit independently compiles.
