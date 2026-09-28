#!/usr/bin/env bun
// Deterministic, fully offline VSIX production path for the offline fork.
// Produces dist-vsix/kilo-code-<version>-<linux|win32>.vsix from a per-target
// staging tree and hard-fails unless the required runtime files (including
// dist/node_modules/{playwright-core,chromium-bidi}) are in the vsce file list.
// Usage: bun run package:vsix [linux|win32]   (default: both targets)
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createVSIX, listFiles, PackageManager } from "@vscode/vsce"

export type Target = {
  key: "linux" | "win32"
  vsceTarget: "linux-x64" | "win32-x64"
  localBinTarget: "linux-x64" | "windows-x64"
  binary: "kilo" | "kilo.exe"
}

// local-bin.ts platform tags are `cli-linux-x64` / `cli-windows-x64`.
export const TARGETS: Target[] = [
  { key: "linux", vsceTarget: "linux-x64", localBinTarget: "linux-x64", binary: "kilo" },
  { key: "win32", vsceTarget: "win32-x64", localBinTarget: "windows-x64", binary: "kilo.exe" },
]

// Relative paths that MUST appear in the vsce file list of every VSIX.
export const REQUIRED_VSIX_FILES = [
  "package.json",
  "dist/extension.js",
  "dist/webview.js",
  "dist/agent-manager.js",
  "dist/node_modules/playwright-core/index.js",
  "dist/node_modules/playwright-core/browsers.json",
  "dist/node_modules/playwright-core/lib/generated/utilityScriptSource.js",
  "dist/node_modules/chromium-bidi/package.json",
  "dist/node_modules/chromium-bidi/node_modules/zod/package.json",
  "dist/node_modules/chromium-bidi/node_modules/mitt/package.json",
  "dist/node_modules/chromium-bidi/node_modules/urlpattern-polyfill/package.json",
  "dist/licenses/playwright-core/LICENSE",
  "README.md",
]

// VSIX file-list entries matching any of these patterns must never ship.
export const FORBIDDEN_VSIX_PATTERNS = [
  "node_modules/", // top level only; dist/node_modules is the playwright runtime
  "tests/",
  "test-results/",
  "storybook-static/",
  "*.vsix",
  "bin/.cli-version",
  "bin/.ffmpeg-target",
]

const root = join(import.meta.dir, "..")
const MIN_SIZE = 100 * 1024 * 1024

// Throws instead of process.exit so stageVsix stays usable from unit tests;
// the CLI entrypoint below logs the message and exits with code 1.
function fail(msg: string): never {
  throw new Error(msg)
}

function isForbidden(file: string): boolean {
  if (!file.startsWith("dist/") && file.includes("node_modules/")) return true
  if (file.startsWith("tests/") || file.startsWith("test-results/") || file.startsWith("storybook-static/")) return true
  if (file.endsWith(".vsix")) return true
  return file === "bin/.cli-version" || file === "bin/.ffmpeg-target"
}

function ffmpegName(target: Target) {
  return target.key === "win32" ? "ffmpeg.exe" : "ffmpeg"
}

// local-bin records the staged ffmpeg helper in process.platform spelling.
function ffmpegMarker(target: Target) {
  return target.key === "win32" ? "win32-x64" : "linux-x64"
}

function runLocalBin(target: Target, root: string) {
  console.log(`[pack-vsix] Staging CLI binary for ${target.localBinTarget} (no --force: never triggers a rebuild)`)
  const res = spawnSync(process.execPath, [join(root, "script", "local-bin.ts"), "--target", target.localBinTarget], {
    cwd: root,
    stdio: "inherit",
  })
  if (res.status !== 0) {
    fail(
      `local-bin.ts exited with code ${res.status} for target ${target.localBinTarget}. ` +
        `If its staleness markers are stale and no network is available, stage the prebuilt CLI binary under ` +
        `packages/opencode/dist/@kilocode/cli-${target.localBinTarget}/bin/ (warm close-out cache) and re-run package:vsix.`,
    )
  }
}

function checkPrereqs(target: Target, root: string) {
  if (!existsSync(join(root, "dist", "extension.js"))) {
    fail("dist/extension.js is missing. Run `bun run build:check:production` from packages/kilo-vscode before packaging.")
  }
  const runtime = ["dist/node_modules/playwright-core/package.json", "dist/node_modules/chromium-bidi/package.json"]
  const missing = runtime.filter((f) => !existsSync(join(root, f)))
  if (missing.length) {
    fail(
      `${missing.join(", ")} missing from dist/. The playwright runtime was not copied into the production bundle — ` +
        `run \`bun run build:check:production\` (the esbuild plugin re-copies the playwright runtime into dist/node_modules).`,
    )
  }
  if (!existsSync(join(root, "bin", target.binary))) {
    fail(
      `bin/${target.binary} is missing. Ensure a prebuilt CLI exists under ` +
        `packages/opencode/dist/@kilocode/cli-${target.localBinTarget}/bin/, or that the machine has network access for a ` +
        `one-time cross-build, then re-run package:vsix.`,
    )
  }
  const ff = ffmpegName(target)
  if (!existsSync(join(root, "bin", ff))) {
    fail(
      `bin/${ff} is missing (local-bin.ts stages it from @ffmpeg-installer/${ffmpegMarker(target)}). ` +
        `Re-run \`bun script/local-bin.ts --target ${target.localBinTarget}\` with network access if it cannot stage offline.`,
    )
  }
  const marker = join(root, "node_modules", ".kilo-ffmpeg-target")
  const expected = ffmpegMarker(target)
  const actual = existsSync(marker) ? readFileSync(marker, "utf8").trim() : "<missing>"
  if (actual !== expected) {
    fail(
      `ffmpeg marker node_modules/.kilo-ffmpeg-target is "${actual}" but local-bin staged "${expected}". ` +
        `local-bin.ts would now hit the network (npm pack @ffmpeg-installer/...). ` +
        `Re-run \`bun script/local-bin.ts --target ${target.localBinTarget}\` with network, or restore the warm marker, ` +
        `then re-run package:vsix.`,
    )
  }
}

function removeStaleDistVsix(root: string) {
  const dist = join(root, "dist")
  if (!existsSync(dist)) return
  for (const entry of readdirSync(dist, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".vsix")) {
      console.log(`[pack-vsix] Removing stale ${join("dist", entry.name)}`)
      rmSync(join(dist, entry.name), { force: true })
    }
  }
}

function buildStaging(target: Target, root: string) {
  const staging = join(tmpdir(), "kilo-vscode-vsix", `${target.key}-${process.pid}`)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  // Mandatory sources; optional ones are skipped gracefully when absent.
  // assets/ holds the manifest icon, which vsce's IconProcessor requires.
  const mandatory = ["package.json", ".vscodeignore", "dist", "bin", "assets"]
  const optional = ["README.md", "LICENSE", "THIRD_PARTY_LICENSES", "audio-wav"]
  for (const name of [...mandatory, ...optional]) {
    const src = join(root, name)
    if (!existsSync(src)) {
      if (mandatory.includes(name)) fail(`required staging source "${name}" is missing from ${root}`)
      console.log(`[pack-vsix] Skipping optional staging source "${name}" (not present)`)
      continue
    }
    cpSync(src, join(staging, name), { recursive: true, dereference: true })
  }
  // local-bin.ts stages both platform binaries into the shared bin/ tree; ship
  // only this target's executables and keep every shared helper (tree-sitter,
  // sandbox relay/seccomp, bwrap, licenses) so each VSIX matches the
  // per-platform close-out artifact composition.
  const foreign = target.key === "linux" ? ["kilo.exe", "ffmpeg.exe"] : ["kilo", "ffmpeg"]
  for (const name of foreign) rmSync(join(staging, "bin", name), { force: true })
  return staging
}

function checkFileList(target: Target, files: string[]) {
  const set = new Set(files)
  const required = [...REQUIRED_VSIX_FILES, `bin/${target.binary}`, `bin/${ffmpegName(target)}`, "bin/tree-sitter/tree-sitter.wasm"]
  const missing = required.filter((f) => !set.has(f))
  const forbidden = files.filter(isForbidden)
  if (missing.length || forbidden.length) {
    if (missing.length) console.error(`[pack-vsix] Missing required VSIX files:\n  ${missing.join("\n  ")}`)
    if (forbidden.length) console.error(`[pack-vsix] Forbidden VSIX files present:\n  ${forbidden.slice(0, 50).join("\n  ")}`)
    fail(`pre-pack file-list check failed for target ${target.key}: ${missing.length} required file(s) missing, ${forbidden.length} forbidden file(s) present`)
  }
}

// Stages one target: local-bin CLI staging, prereq assertions, stale-VSIX
// purge, tmpdir staging tree, and the pre-pack vsce file-list assertions.
// Returns the staging dir (caller removes it) and the asserted file list.
export async function stageVsix(target: Target, root: string) {
  runLocalBin(target, root)
  checkPrereqs(target, root)
  removeStaleDistVsix(root)
  const staging = buildStaging(target, root)
  const files = await listFiles({ cwd: staging, packageManager: PackageManager.None })
  checkFileList(target, files)
  return { staging, files }
}

async function packTarget(target: Target, version: string) {
  const { staging, files } = await stageVsix(target, root)
  const out = join(root, "dist-vsix", `kilo-code-${version}-${target.key}.vsix`)
  mkdirSync(join(root, "dist-vsix"), { recursive: true })
  console.log(`[pack-vsix] Packing target ${target.key}: ${files.length} files -> ${out}`)
  await createVSIX({
    cwd: staging,
    packagePath: out,
    target: target.vsceTarget,
    version,
    updatePackageJson: false,
    dependencies: false,
    skipLicense: true,
  })
  const size = statSync(out).size
  rmSync(staging, { recursive: true, force: true })
  if (size <= MIN_SIZE) {
    fail(`artifact ${out} is only ${(size / 1048576).toFixed(1)} MB (<=100 MB). A VSIX without the CLI binary or the dist tree is far smaller — the staged tree was incomplete.`)
  }
  console.log(`[pack-vsix] OK target ${target.key}: ${out} (${(size / 1048576).toFixed(1)} MB, ${files.length} files)`)
}

async function main() {
  const arg = process.argv[2]
  const wanted = arg ? TARGETS.filter((t) => t.key === arg) : TARGETS
  if (!wanted.length) fail(`unknown target "${arg}" (expected "linux" or "win32")`)
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version
  for (const target of wanted) await packTarget(target, version)
  console.log(`[pack-vsix] Done: ${wanted.map((t) => `kilo-code-${version}-${t.key}.vsix`).join(", ")} in ${join(root, "dist-vsix")}`)
}

if (import.meta.main) {
  try {
    await main()
  } catch (err) {
    console.error(`[pack-vsix] ERROR: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}