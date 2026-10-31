#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Deterministic, read-only guard that asserts the 18 offline invariants (I1–I18)
 * from `docs/upstream-sync.md`. It translates each invariant's grep/`ls` command
 * into a programmatic check so a future upstream sync cannot silently re-activate
 * online surface (models.dev fetch, network probes, gateway/telemetry packages,
 * removed extension surfaces, …).
 *
 * Each check is small and independent; all failures are collected and printed
 * before exiting non-zero. Exit codes: 0 = all invariants hold, 1 = at least one
 * failed. The checks are read-only — this script never writes to the tree.
 */

import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dir, "..")
const SELF = path.relative(ROOT, import.meta.path).replaceAll("\\", "/")

const abs = (rel: string) => path.join(ROOT, rel)
const hasFile = (rel: string) => existsSync(abs(rel))
const hasDir = (rel: string) => {
  const p = abs(rel)
  return existsSync(p) && Bun.file(p).isDirectory()
}

const readText = async (rel: string): Promise<string | null> => {
  if (!hasFile(rel)) return null
  const buf = Bun.file(abs(rel))
  const text = await buf.text().catch(() => null)
  if (text === null) return null
  if (text.includes("\0")) return null
  return text
}

// Strips /* ... */ blocks and // line tails so a comment enumerating a
// pattern can never satisfy a check. String/template literal contents are
// preserved (URL-like strings may contain //); a // inside a regex literal
// still ends the line, which only removes code text — it can cause a rare
// same-line miss, never a comment-satisfied false pass.
const withoutComments = (text: string): string => {
  let out = ""
  let mode: "code" | "line" | "block" | '"' | "'" | "`" = "code"
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i)
    if (mode === "code") {
      const n = text.charAt(i + 1)
      if (c === "/" && (n === "/" || n === "*")) {
        mode = n === "/" ? "line" : "block"
        i++
        continue
      }
      if (c === '"' || c === "'" || c === "`") mode = c
    } else if (mode === "line") {
      if (c !== "\n") continue
      mode = "code"
    } else if (mode === "block") {
      if (c !== "*" || text.charAt(i + 1) !== "/") continue
      mode = "code"
      i++
      continue
    } else if (c === "\\") {
      out += c + text.charAt(i + 1)
      i++
      continue
    } else if (c === mode) mode = "code"
    out += c
  }
  return out
}

// Tracked-file listing (mirrors check-forbidden-strings.ts scoping) so live-import
// and workflow drift checks only ever look at files git tracks, never node_modules.
const ls = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "buffer" })
if (ls.status !== 0) {
  console.error(ls.stderr?.toString().trim() || "git ls-files failed")
  process.exit(1)
}
const tracked = ls.stdout.toString("utf8").split("\0").filter(Boolean).filter((f) => f !== SELF)

interface Check {
  id: string
  name: string
  ok: boolean
  detail?: string
}

const results: Check[] = []
const pass = (id: string, name: string, detail?: string) => results.push({ id, name, ok: true, detail })
const fail = (id: string, name: string, detail: string) => results.push({ id, name, ok: false, detail })

// ---------------------------------------------------------------------------
// I1 — KILO_DISABLE_MODELS_FETCH injected into the managed-server env.
// The flag must be set inside resolveManagedServerEnv in server-manager.ts, and
// resolveManagedServerEnv must actually be used when the backend spawns.
// ---------------------------------------------------------------------------
{
  const rel = "packages/kilo-vscode/src/services/cli-backend/server-manager.ts"
  const text = await readText(rel)
  if (text === null) {
    fail("I1", "models-fetch disabled at spawn", `${rel} not found`)
  } else {
    // Comments are stripped so a commented-out injection or call cannot satisfy the check.
    const code = withoutComments(text)
    const fn = /export function resolveManagedServerEnv\s*\(/.test(code)
    const inject = /KILO_DISABLE_MODELS_FETCH\s*:\s*"true"/.test(code)
    const used = /resolveManagedServerEnv\(/.test(code)
    if (fn && inject && used) pass("I1", "models-fetch disabled at spawn")
    else {
      const parts: string[] = []
      if (!fn) parts.push("missing resolveManagedServerEnv definition")
      if (!inject) parts.push('missing `KILO_DISABLE_MODELS_FETCH: "true"` injection')
      if (!used) parts.push("resolveManagedServerEnv is defined but never called on spawn")
      fail("I1", "models-fetch disabled at spawn", parts.join("; "))
    }
  }
}

// ---------------------------------------------------------------------------
// I2 — Offline probe zeroing: `const urls = []` in session/network.ts AND an
// early-return "retry" in the offline processor. Without both, ECONNREFUSED parks
// a session in permanent offline state instead of degrading to a normal retry.
// ---------------------------------------------------------------------------
{
  const netRel = "packages/opencode/src/session/network.ts"
  const procRel = "packages/opencode/src/kilocode/session/processor.ts"
  const net = await readText(netRel)
  const proc = await readText(procRel)
  if (net === null || proc === null) {
    fail("I2", "offline probe zeroing", `missing ${[netRel, procRel].find((r) => (r === netRel ? net : proc) === null)}`)
  } else {
    // Comments are stripped: network.ts annotates the zeroing with a
    // kilocode_change comment and processor.ts documents the "retry" fallback.
    const netOk = /const urls = \[\]/.test(withoutComments(net))
    const procOk = /["']retry["']/.test(withoutComments(proc))
    if (netOk && procOk) pass("I2", "offline probe zeroing")
    else {
      const parts: string[] = []
      if (!netOk) parts.push(`no \`const urls = []\` in ${netRel}`)
      if (!procOk) parts.push(`no "retry" early-return in ${procRel}`)
      fail("I2", "offline probe zeroing", parts.join("; "))
    }
  }
}

// ---------------------------------------------------------------------------
// I3 — Provider hard-cut: LOCAL_PROVIDER_IDS + inLocalSurface markers present in
// provider code, and the committed models-dev.local.json snapshot referenced by
// packages/opencode/script/generate.ts (the offline model-catalog source).
// ---------------------------------------------------------------------------
{
  const markerFiles = [
    "packages/opencode/src/provider/models.ts",
    "packages/opencode/src/provider/provider.ts",
    "packages/opencode/src/kilocode/local-providers.ts",
    "packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts",
    "packages/opencode/src/cli/cmd/providers.ts",
    "packages/opencode/src/cli/cmd/github.handler.ts",
  ]
  let hits = 0
  for (const rel of markerFiles) {
    const text = await readText(rel)
    if (text === null) continue
    if (/LOCAL_PROVIDER_IDS|inLocalSurface/.test(withoutComments(text))) hits++
  }
  const gen = await readText("packages/opencode/script/generate.ts")
  // Comments are stripped: a comment naming the identifiers or the snapshot
  // cannot count as the hard-cut being present.
  if (hits >= 2 && gen !== null && /models-dev\.local\.json/.test(withoutComments(gen))) pass("I3", "provider hard-cut + local catalog")
  else {
    const parts: string[] = []
    if (hits < 2) parts.push(`expected LOCAL_PROVIDER_IDS/inLocalSurface in >=2 provider files, found in ${hits}`)
    if (gen === null) parts.push("packages/opencode/script/generate.ts not found")
    else if (!/models-dev\.local\.json/.test(withoutComments(gen))) parts.push("generate.ts does not reference models-dev.local.json")
    fail("I3", "provider hard-cut + local catalog", parts.join("; "))
  }
}

// ---------------------------------------------------------------------------
// I4 — /media-local/* route registered: MediaLocalApi imported AND added via
// .addHttpApi(MediaLocalApi) in the httpapi api setup. Two hits expected.
// ---------------------------------------------------------------------------
{
  const rel = "packages/opencode/src/server/routes/instance/httpapi/api.ts"
  const text = await readText(rel)
  if (text === null) {
    fail("I4", "media-local route registered", `${rel} not found`)
  } else {
    // Comments are stripped: both lines carry kilocode_change annotations
    // and a commented-out import/registration must not satisfy the check.
    const code = withoutComments(text)
    const importHit = /import\s*\{[^}]*MediaLocalApi[^}]*\}/.test(code)
    const regHit = /\.addHttpApi\(\s*MediaLocalApi\s*\)/.test(code)
    if (importHit && regHit) pass("I4", "media-local route registered")
    else {
      const parts: string[] = []
      if (!importHit) parts.push("no MediaLocalApi import")
      if (!regHit) parts.push("no .addHttpApi(MediaLocalApi) registration")
      fail("I4", "media-local route registered", parts.join("; "))
    }
  }
}

// ---------------------------------------------------------------------------
// I5 — Env sanitization at spawn: OTEL_/BUN_ prefixes and NODE_OPTIONS stripped
// inside resolveManagedServerEnv. Any single missing strip means the child
// process inherits telemetry/proxy/toolchain env it should not.
// ---------------------------------------------------------------------------
{
  const rel = "packages/kilo-vscode/src/services/cli-backend/server-manager.ts"
  const text = await readText(rel)
  if (text === null) {
    fail("I5", "spawn env sanitized", `${rel} not found`)
  } else {
    const need: [string, RegExp][] = [
      ['OTEL_ prefix strip', /startsWith\(\s*["']OTEL_["']\s*\)/],
      ['BUN_ prefix strip', /startsWith\(\s*["']BUN_["']\s*\)/],
      ['NODE_OPTIONS strip', /===?\s*["']NODE_OPTIONS["']/],
    ]
    // Comments are stripped: a comment enumerating e.g. startsWith("OTEL_")
    // cannot satisfy a strip assertion.
    const code = withoutComments(text)
    const missing = need.filter(([, re]) => !re.test(code)).map(([label]) => label)
    if (missing.length === 0) pass("I5", "spawn env sanitized")
    else fail("I5", "spawn env sanitized", `missing strips: ${missing.join(", ")}`)
  }
}

// ---------------------------------------------------------------------------
// I6 — Root workspaces.packages is an explicit list pinned to the current count
// (never a `packages/*` glob), so a merge from main cannot resurrect pruned
// packages through a glob entry.
// ---------------------------------------------------------------------------
{
  const raw = await readText("package.json")
  if (raw === null) {
    fail("I6", "explicit workspace list", "root package.json not found")
  } else {
    const pkg = JSON.parse(raw) as { workspaces?: { packages?: unknown } }
    const pkgs = pkg.workspaces?.packages
    if (!Array.isArray(pkgs)) {
      fail("I6", "explicit workspace list", "workspaces.packages is not an array")
    } else {
      const globbed = pkgs.some((p) => typeof p === "string" && /^(packages|\*)\/$|^\*$/.test(p))
      if (pkgs.length !== 22) fail("I6", "explicit workspace list", `workspaces.packages has ${pkgs.length} entries, expected exactly 22`)
      else if (globbed) fail("I6", "explicit workspace list", "workspaces.packages contains a glob entry (must stay an explicit list)")
      else pass("I6", "explicit workspace list", `${pkgs.length} explicit entries, no globs`)
    }
  }
}

// ---------------------------------------------------------------------------
// I7 — Pruned online packages absent from disk, and zero live imports of
// `@kilocode/kilo-gateway`. Comments are stripped before matching so a
// commented-out import cannot false-trip the absence check; string mentions
// (which annotate where the package was re-hosted) are still tolerated.
// ---------------------------------------------------------------------------
{
  const dirs = ["packages/kilo-gateway", "packages/kilo-telemetry"]
  const present = dirs.filter(hasDir)
  const liveImport = /\b(?:import\s+[^'";]*from\s*|import\s*\(\s*|require\s*\(\s*|export\s+\{[^}]*\}\s+from\s*)["']@kilocode\/kilo-gateway["']/
  const offenders: string[] = []
  for (const file of tracked.filter((f) => f.endsWith(".ts"))) {
    const text = await readText(file)
    if (text === null) continue
    if (liveImport.test(withoutComments(text))) offenders.push(file)
  }
  if (present.length === 0 && offenders.length === 0) pass("I7", "gateway/telemetry absent, no live imports")
  else {
    const parts: string[] = []
    if (present.length > 0) parts.push(`pruned directory still exists: ${present.join(", ")}`)
    if (offenders.length > 0) parts.push(`live import of @kilocode/kilo-gateway in: ${offenders.slice(0, 5).join(", ")}${offenders.length > 5 ? `, +${offenders.length - 5} more` : ""}`)
    fail("I7", "gateway/telemetry absent, no live imports", parts.join("; "))
  }
}

// ---------------------------------------------------------------------------
// I8 — Removed extension surfaces absent: kiloclaw dir, RemoteStatusService,
// MarketplacePanelProvider, and the services/autocomplete (gateway FIM) dir.
// These are keep-deleted even when upstream modifies them.
// ---------------------------------------------------------------------------
{
  const paths = [
    "packages/kilo-vscode/src/kiloclaw",
    "packages/kilo-vscode/src/RemoteStatusService.ts",
    "packages/kilo-vscode/src/MarketplacePanelProvider.ts",
    "packages/kilo-vscode/src/services/autocomplete",
  ]
  const existing = paths.filter((p) => existsSync(abs(p)))
  if (existing.length === 0) pass("I8", "removed extension surfaces absent")
  else fail("I8", "removed extension surfaces absent", `still present: ${existing.join(", ")}`)
}

// ---------------------------------------------------------------------------
// I9 — i18n trees exist. The strongest automatable subset: every Kilo-owned
// locale pool exposes an `en.ts` dictionary and the unused-keys test that keeps
// them trimmed is present. Per-key trimming against online surfaces is enforced
// by that test (run via `bun run test:unit`), which this guard does not execute.
// TODO: cross-check each locale file's key set against en.ts (parity across the
// ~20 locales) — left manual because it duplicates the dedicated i18n test.
// ---------------------------------------------------------------------------
{
  const pools = [
    "packages/kilo-i18n/src",
    "packages/kilo-vscode/webview-ui/src/i18n",
    "packages/kilo-vscode/webview-ui/agent-manager/i18n",
    "packages/kilo-ui/src/i18n",
    "packages/kilo-vscode/src/services/cli-backend/i18n",
    "packages/kilo-vscode/src/services/i18n",
  ]
  const missingEn = pools.filter((p) => !hasFile(`${p}/en.ts`))
  const testMissing = !hasFile("packages/kilo-vscode/tests/unit/i18n-unused-keys.test.ts")
  if (missingEn.length === 0 && !testMissing) pass("I9", "i18n trees present", `${pools.length} locale pools have en.ts`)
  else {
    const parts: string[] = []
    if (missingEn.length > 0) parts.push(`missing en.ts in: ${missingEn.join(", ")}`)
    if (testMissing) parts.push("tests/unit/i18n-unused-keys.test.ts not found")
    fail("I9", "i18n trees present", parts.join("; "))
  }
}

// ---------------------------------------------------------------------------
// I10 — Workflow allowlist coherent with the working tree. Reuses the exact
// comparison logic of script/check-workflows.ts (hardcoded allowlist vs the yml
// files present under .github/workflows).
// ---------------------------------------------------------------------------
{
  const active = new Set([
    "beta.yml",
    "check-forbidden-strings.yml",
    "check-kilo-generated-artifacts.yml",
    "check-md-table-padding.yml",
    "codeql.yml",
    "smoke-test.yml",
    "test-vscode.yml",
    "test.yml",
    "typecheck.yml",
    "validate-cli-smoke.yml",
    "visual-regression.yml",
  ])
  const dir = path.join(ROOT, ".github", "workflows")
  if (!existsSync(dir)) {
    fail("I10", "workflow allowlist coherent", ".github/workflows not found")
  } else {
    const actual = new Set(readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")))
    const missing = [...active].filter((f) => !actual.has(f)).sort()
    const extra = [...actual].filter((f) => !active.has(f)).sort()
    if (missing.length === 0 && extra.length === 0) pass("I10", "workflow allowlist coherent", `${actual.size} workflows match allowlist`)
    else {
      const parts: string[] = []
      if (extra.length > 0) parts.push(`unexpected workflows: ${extra.join(", ")}`)
      if (missing.length > 0) parts.push(`allowlisted but absent: ${missing.join(", ")}`)
      fail("I10", "workflow allowlist coherent", parts.join("; "))
    }
  }
}

// ---------------------------------------------------------------------------
// I11 — VSIX packaging self-sufficiency. The scripted offline packager
// (packages/kilo-vscode/script/pack-vsix.ts) must keep asserting that the
// playwright runtime (`dist/node_modules/playwright-core` + `chromium-bidi`)
// ships in the VSIX, and `.vscodeignore` must keep the `!dist/**` negation so
// the whole dist tree survives the pack. Deliberately coarse: it fails loudly
// if the packaging script or its runtime assertions are dropped in a future
// sync, not re-implement the packer.
// ---------------------------------------------------------------------------
{
  const packRel = "packages/kilo-vscode/script/pack-vsix.ts"
  const ignRel = "packages/kilo-vscode/.vscodeignore"
  const pack = await readText(packRel)
  const ign = await readText(ignRel)
  if (pack === null || ign === null) {
    const parts: string[] = []
    if (pack === null) parts.push(`${packRel} not found`)
    if (ign === null) parts.push(`${ignRel} not found`)
    fail("I11", "vsix packaging self-sufficiency", parts.join("; "))
  } else {
    const parts: string[] = []
    // pack-vsix.ts is scanned with comments stripped so a comment naming the
    // runtime cannot satisfy the assertion; .vscodeignore is not JS (comments
    // use #), so its pattern line is matched raw.
    const packCode = withoutComments(pack)
    if (!packCode.includes("dist/node_modules/playwright-core")) parts.push("pack-vsix.ts no longer asserts dist/node_modules/playwright-core")
    if (!packCode.includes("dist/node_modules/chromium-bidi")) parts.push("pack-vsix.ts no longer asserts dist/node_modules/chromium-bidi")
    if (!/^!dist\/\*\*$/m.test(ign)) parts.push(".vscodeignore missing the `!dist/**` negation line")
    if (parts.length === 0) pass("I11", "vsix packaging self-sufficiency")
    else fail("I11", "vsix packaging self-sufficiency", parts.join("; "))
  }
}

// ---------------------------------------------------------------------------
// I12 — VS Code 1.103 floor: engines.vscode and @types/vscode pinned to
// ^1.103.0 in the extension manifest. Any upstream change raising the floor
// (newer vscode APIs, @types/vscode past 1.103) must be rejected or
// neutralized during conflict resolution; a silent bump fails here.
// ---------------------------------------------------------------------------
{
  const rel = "packages/kilo-vscode/package.json"
  const text = await readText(rel)
  if (text === null) {
    fail("I12", "vscode 1.103 floor", `${rel} not found`)
  } else {
    const pkg = JSON.parse(text) as {
      engines?: { vscode?: string }
      devDependencies?: Record<string, string>
      dependencies?: Record<string, string>
    }
    const engine = pkg.engines?.vscode
    const types = pkg.devDependencies?.["@types/vscode"] ?? pkg.dependencies?.["@types/vscode"]
    const parts: string[] = []
    if (engine !== "^1.103.0") parts.push(`engines.vscode is ${engine ?? "missing"}, expected ^1.103.0`)
    if (types !== "^1.103.0") parts.push(`@types/vscode is ${types ?? "missing"}, expected ^1.103.0`)
    if (parts.length === 0) pass("I12", "vscode 1.103 floor")
    else fail("I12", "vscode 1.103 floor", parts.join("; "))
  }
}

// ---------------------------------------------------------------------------
// I13 — Marketplace zeroing: the four catalog fetches in marketplace/api.ts
// are empty-list stubs (no live `fetch(` call, no quoted api.kilo endpoint —
// the offline comment may name the old host, live code cannot), and the
// remote skill download in skill-archive.ts fails fast before any network
// access. During the v7.8.17 sync this surface stayed live for 20 slices.
// ---------------------------------------------------------------------------
{
  const apiRel = "packages/opencode/src/kilocode/marketplace/api.ts"
  const archiveRel = "packages/opencode/src/kilocode/marketplace/skill-archive.ts"
  const api = await readText(apiRel)
  const archive = await readText(archiveRel)
  if (api === null || archive === null) {
    fail("I13", "marketplace zeroed", `missing ${api === null ? apiRel : archiveRel}`)
  } else {
    const parts: string[] = []
    // Comments are stripped first: the offline comment may name the old host,
    // live code cannot, and a comment must not be able to satisfy a check either.
    const apiCode = withoutComments(api)
    if (apiCode.includes("fetch(")) parts.push(`${apiRel} contains a live fetch( call`)
    // Quoted endpoints only, per line.
    if (/(["'`][^"'`\n]*api\.kilo[^"'`\n]*["'`])/.test(apiCode)) parts.push(`${apiRel} references a quoted api.kilo endpoint`)
    if (!withoutComments(archive).includes("marketplace remote skill download is disabled in the offline fork"))
      parts.push(`${archiveRel} missing the offline fail-fast error`)
    if (parts.length === 0) pass("I13", "marketplace zeroed")
    else fail("I13", "marketplace zeroed", parts.join("; "))
  }
}

// ---------------------------------------------------------------------------
// I14 — Full env strip at spawn (extends I5): in addition to the OTEL_/BUN_/
// NODE_OPTIONS strips, every proxy key, every well-known provider API-key
// name, and the AWS_/VERTEX_ credential prefixes must be stripped inside
// resolveManagedServerEnv, or the offline backend inherits credentials it
// should not. Comments are stripped before matching so a comment that merely
// enumerates the keys cannot satisfy the check.
// ---------------------------------------------------------------------------
{
  const rel = "packages/kilo-vscode/src/services/cli-backend/server-manager.ts"
  const text = await readText(rel)
  if (text === null) {
    fail("I14", "spawn env fully sanitized", `${rel} not found`)
  } else {
    const code = withoutComments(text)
    const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "NO_PROXY", "no_proxy"]
    const providerKeys = [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "OPENROUTER_API_KEY",
      "GEMINI_API_KEY",
      "GROQ_API_KEY",
      "MISTRAL_API_KEY",
      "TOGETHER_API_KEY",
      "PERPLEXITY_API_KEY",
      "CLOUDFLARE_API_KEY",
      "COHERE_API_KEY",
      "DEEPSEEK_API_KEY",
      "ZAI_API_KEY",
      "HUGGINGFACE_API_KEY",
      "MINIMAX_API_KEY",
      "GITHUB_TOKEN",
      "COPILOT_GITHUB_DEVICE_ID",
    ]
    const prefixes = ["AWS_", "VERTEX_"]
    const parts: string[] = []
    const missingProxy = proxyKeys.filter((k) => !code.includes(`"${k}"`))
    const presentProvider = providerKeys.filter((k) => code.includes(`"${k}"`))
    const missingPrefix = prefixes.filter((k) => !code.includes(`"${k}"`))
    if (missingProxy.length > 0) parts.push(`proxy keys not stripped: ${missingProxy.join(", ")}`)
    if (presentProvider.length < 16) parts.push(`provider API-key strips: ${presentProvider.length}/16 present`)
    if (missingPrefix.length > 0) parts.push(`credential prefixes not stripped: ${missingPrefix.join(", ")}`)
    if (parts.length === 0) pass("I14", "spawn env fully sanitized", "8 proxy keys + 16 provider keys + AWS_/VERTEX_ prefixes")
    else fail("I14", "spawn env fully sanitized", parts.join("; "))
  }
}

// ---------------------------------------------------------------------------
// I15 — Keep-deleted orphans absent: upstream surfaces the fork deleted that
// must never reappear, even when upstream still modifies them.
// ---------------------------------------------------------------------------
{
  const paths = [
    "packages/opencode/src/lsp",
    "packages/opencode/src/share",
    "packages/opencode/src/account",
    "packages/opencode/src/kilo-sessions",
    "packages/opencode/src/session-hosting",
    "packages/opencode/src/mcp/auth-telemetry.ts",
    "packages/opencode/src/kilocode/claw",
    "packages/opencode/src/kilocode/console",
    "packages/opencode/src/kilocode/event-service",
  ]
  const present = paths.filter((p) => existsSync(abs(p)))
  if (present.length === 0) pass("I15", "keep-deleted orphans absent")
  else fail("I15", "keep-deleted orphans absent", `still present: ${present.join(", ")}`)
}

// ---------------------------------------------------------------------------
// I16 — Auto-update absence: no `"/global/upgrade"` route string and no
// `upgrade` endpoint/handler in the server surface (only removal-comment
// mentions are allowed); the manual `kilo upgrade` CLI is unaffected.
// ---------------------------------------------------------------------------
{
  const dirs = ["packages/opencode/src/server/", "packages/opencode/src/kilocode/server/"]
  const routeString = /(["'`])\/global\/upgrade\1/
  const endpointName = /HttpApiEndpoint\.\w+\(\s*["']upgrade["']/
  const handlerName = /\.handle(?:Raw)?\(\s*["']upgrade["']/
  const offenders: string[] = []
  for (const file of tracked.filter((f) => f.endsWith(".ts") && dirs.some((d) => f.startsWith(d)))) {
    const text = await readText(file)
    if (text === null) continue
    const code = withoutComments(text)
    if (routeString.test(code) || endpointName.test(code) || handlerName.test(code)) offenders.push(file)
  }
  if (offenders.length === 0) pass("I16", "auto-update absent")
  else fail("I16", "auto-update absent", `/global/upgrade surface reappeared in: ${offenders.slice(0, 5).join(", ")}`)
}

// ---------------------------------------------------------------------------
// I17 — New automatic-egress pins: project avatars are cache-only (no fetch,
// no github.com), the webview CSP img-src grants only the webview origin and
// data: (no https:), Agent Manager PR status polling is off by default, and
// the ripgrep binary resolves via KILO_RIPGREP/system/bundled path with no
// on-demand download (no github.com, no HttpClientRequest).
// ---------------------------------------------------------------------------
{
  const avatarRel = "packages/kilo-vscode/src/agent-manager/project/avatar.ts"
  const cspRel = "packages/kilo-vscode/src/webview-html-utils.ts"
  const pkgRel = "packages/kilo-vscode/package.json"
  const rgRel = "packages/core/src/ripgrep/binary.ts"
  const avatar = await readText(avatarRel)
  const csp = await readText(cspRel)
  const raw = await readText(pkgRel)
  const rg = await readText(rgRel)
  if (avatar === null || csp === null || raw === null || rg === null) {
    const missing = [avatarRel, cspRel, pkgRel, rgRel].filter((r) =>
      r === avatarRel ? avatar === null : r === cspRel ? csp === null : r === pkgRel ? raw === null : rg === null,
    )
    fail("I17", "automatic-egress pins", `missing ${missing.join(", ")}`)
  } else {
    const parts: string[] = []
    // Comments are stripped so e.g. an avatar.ts doc comment mentioning
    // github.com cannot satisfy the "no github.com" pin.
    const avatarCode = withoutComments(avatar)
    if (avatarCode.includes("fetch(")) parts.push(`${avatarRel} contains a live fetch( call`)
    if (avatarCode.includes("github.com")) parts.push(`${avatarRel} references github.com`)
    const img = withoutComments(csp)
      .split("\n")
      .find((line) => line.includes("img-src"))
    if (img === undefined) parts.push(`${cspRel} has no img-src CSP line`)
    else if (img.includes("https:")) parts.push(`${cspRel} img-src grants https: (remote images)`)
    const pkg = JSON.parse(raw) as { contributes?: { configuration?: unknown } }
    const configs = Array.isArray(pkg.contributes?.configuration)
      ? pkg.contributes.configuration
      : pkg.contributes?.configuration
        ? [pkg.contributes.configuration]
        : []
    const entry = configs
      .flatMap((cfg) => Object.entries((cfg as { properties?: Record<string, { default?: unknown }> }).properties ?? {}))
      .find(([key]) => key === "kilo-code.new.agentManager.prStatusPolling")
    if (entry?.[1]?.default !== false)
      parts.push(
        `prStatusPolling default is ${entry ? String(entry[1].default) : "missing"}, expected false${entry === undefined ? ` (${pkgRel} setting absent)` : ""}`,
      )
    const rgCode = withoutComments(rg)
    if (rgCode.includes("github.com")) parts.push(`${rgRel} references github.com`)
    if (rgCode.includes("HttpClientRequest")) parts.push(`${rgRel} references HttpClientRequest`)
    if (parts.length === 0) pass("I17", "automatic-egress pins")
    else fail("I17", "automatic-egress pins", parts.join("; "))
  }
}

// ---------------------------------------------------------------------------
// I18 — Probe short-circuit wired: SessionNetwork exports hasProbes() and the
// offline processor short-circuits on it (immediate "retry" fallback when no
// probe hosts exist). Without the wiring, a non-empty urls list re-activates
// live probes even if the network.ts zeroing (I2) is re-applied.
// ---------------------------------------------------------------------------
{
  const netRel = "packages/opencode/src/session/network.ts"
  const procRel = "packages/opencode/src/kilocode/session/processor.ts"
  const net = await readText(netRel)
  const proc = await readText(procRel)
  if (net === null || proc === null) {
    fail("I18", "probe short-circuit wired", `missing ${net === null ? netRel : procRel}`)
  } else {
    const parts: string[] = []
    if (!/export function hasProbes\b/.test(withoutComments(net))) parts.push(`no hasProbes() export in ${netRel}`)
    if (!withoutComments(proc).includes("hasProbes")) parts.push(`no hasProbes short-circuit in ${procRel}`)
    if (parts.length === 0) pass("I18", "probe short-circuit wired")
    else fail("I18", "probe short-circuit wired", parts.join("; "))
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const broken = results.filter((r) => !r.ok)
if (broken.length === 0) {
  console.log(`check-offline-invariants: ok (${results.length}/${results.length} invariants hold).`)
  process.exit(0)
}

console.error(`check-offline-invariants: ${broken.length} of ${results.length} invariants FAILED:`)
for (const r of results) {
  const mark = r.ok ? "PASS" : "FAIL"
  console.error(`  [${mark}] ${r.id} — ${r.name}${r.detail ? `: ${r.detail}` : ""}`)
}
process.exit(1)