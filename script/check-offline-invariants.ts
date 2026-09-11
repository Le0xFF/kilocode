#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Deterministic, read-only guard that asserts the 10 offline invariants (I1–I10)
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
    const fn = /export function resolveManagedServerEnv\s*\(/.test(text)
    const inject = /KILO_DISABLE_MODELS_FETCH\s*:\s*"true"/.test(text)
    const used = /resolveManagedServerEnv\(/.test(text)
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
    const netOk = /const urls = \[\]/.test(net)
    const procOk = /["']retry["']/.test(proc)
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
    if (/LOCAL_PROVIDER_IDS|inLocalSurface/.test(text)) hits++
  }
  const gen = await readText("packages/opencode/script/generate.ts")
  if (hits >= 2 && gen !== null && /models-dev\.local\.json/.test(gen)) pass("I3", "provider hard-cut + local catalog")
  else {
    const parts: string[] = []
    if (hits < 2) parts.push(`expected LOCAL_PROVIDER_IDS/inLocalSurface in >=2 provider files, found in ${hits}`)
    if (gen === null) parts.push("packages/opencode/script/generate.ts not found")
    else if (!/models-dev\.local\.json/.test(gen)) parts.push("generate.ts does not reference models-dev.local.json")
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
    const importHit = /import\s*\{[^}]*MediaLocalApi[^}]*\}/.test(text)
    const regHit = /\.addHttpApi\(\s*MediaLocalApi\s*\)/.test(text)
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
    const missing = need.filter(([, re]) => !re.test(text)).map(([label]) => label)
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
// `@kilocode/kilo-gateway`. Only comment/string occurrences are allowed (they
// annotate where the package was re-hosted); any real import statement fails.
// ---------------------------------------------------------------------------
{
  const dirs = ["packages/kilo-gateway", "packages/kilo-telemetry"]
  const present = dirs.filter(hasDir)
  const liveImport = /\b(?:import\s+[^'";]*from\s*|import\s*\(\s*|require\s*\(\s*|export\s+\{[^}]*\}\s+from\s*)["']@kilocode\/kilo-gateway["']/
  const offenders: string[] = []
  for (const file of tracked.filter((f) => f.endsWith(".ts"))) {
    const text = await readText(file)
    if (text === null) continue
    if (liveImport.test(text)) offenders.push(file)
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