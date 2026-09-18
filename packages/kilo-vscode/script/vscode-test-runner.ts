#!/usr/bin/env bun
/**
 * Integration-test runner that drives a system VS Code / VSCodium binary directly,
 * replacing the @vscode/test-cli flow (which downloads an instance) with zero
 * downloads and zero writes outside <repoRoot>/.kilo-dev/vscode-test/.
 *
 * Usage:
 *   bun script/vscode-test-runner.ts [--clean] [--exec PATH]
 *
 * Options:
 *   --clean       Wipe user-data/ and extensions/ under the base dir before running
 *   --exec PATH   Explicit VS Code executable (also honors $VSCODE_EXEC_PATH)
 *
 * Environment:
 *   VSCODE_EXEC_PATH  Path to the VS Code/VSCodium executable. If unset, we fall
 *                     back to `which codium|vscodium|code`. Nothing is ever downloaded.
 *
 * Launch strategy (verified against the installed @vscode/test-electron ^2.5.2 typings):
 *   v2.5.2 does NOT expose launchApplication (that is the older 1.x API); it exposes
 *   runTests(options). We therefore call runTests with vscodeExecutablePath set to the
 *   resolved system binary, which makes it skip the download path and spawn the binary
 *   directly. Passing our own --user-data-dir/--extensions-dir launch args keeps all
 *   state under the repo-local base dir, and we strip ELECTRON_ / VSCODE_ prefixed env
 *   vars plus pin the XDG homes so nothing leaks into the real install. Mocha
 *   bootstrapping happens inside the extension host via --extension-tests-path; if the
 *   in-host suite is missing or fails, VS Code exits non-zero and we propagate that as
 *   our exit code. Because runTests spawns the app itself (not a shell), headless
 *   execution must be provided by running this script under xvfb-run when no display is
 *   present.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { delimiter, join, resolve } from "node:path"
import { runTests } from "@vscode/test-electron"

declare const __dirname: string

const win = process.platform === "win32"
// packages/kilo-vscode -> packages -> <repoRoot>
const pkg = resolve(__dirname, "..")
const root = resolve(pkg, "..", "..")
const base = join(root, ".kilo-dev", "vscode-test")
const userDir = join(base, "user-data")
const extDir = join(base, "extensions")
const workspace = join(base, "workspace")

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface Opts {
  clean: boolean
  exec?: string
}

function parse(argv: string[]): Opts {
  const out: Opts = { clean: false }
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]!
    if (!item.startsWith("--")) continue
    if (item === "--clean") {
      out.clean = true
      continue
    }
    const parts = item.slice(2).split("=", 2)
    const key = parts[0]!
    const raw = parts[1]
    if (key === "exec") {
      if (raw) {
        out.exec = raw
        continue
      }
      const next = argv[i + 1]
      if (next && !next.startsWith("--")) {
        out.exec = next
        i++
      }
    }
  }
  return out
}

const opts = parse(process.argv.slice(2))

// ---------------------------------------------------------------------------
// Executable resolution (never downloads)
// ---------------------------------------------------------------------------

function which(name: string): string | null {
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean)
  const exts = win ? [".cmd", ".exe", ".bat", ""] : [""]
  for (const dir of paths) {
    for (const ext of exts) {
      const full = join(dir, name.endsWith(ext) ? name : `${name}${ext}`)
      if (existsSync(full)) return full
    }
  }
  return null
}

function detect(): string {
  const explicit = opts.exec ?? process.env["VSCODE_EXEC_PATH"]
  if (explicit && existsSync(explicit)) return explicit

  for (const name of ["codium", "vscodium", "code"]) {
    const found = which(name)
    if (found) return found
  }

  console.error(
    "[test-runner] Could not find a VS Code / VSCodium executable.\n" +
      "Set VSCODE_EXEC_PATH (e.g. /usr/bin/codium), pass --exec, or install Codium on PATH.\n" +
      "Searched PATH for: codium, vscodium, code",
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Env hygiene (mirrors script/launch.ts)
// ---------------------------------------------------------------------------

function childEnv() {
  // runTests spawns the app with `process.env`, so we mutate process.env in place
  // to guarantee the child receives the hardened environment.
  const env = process.env
  // Pin the XDG homes under the repo-local base dir so the child never touches
  // the real ~/.config/Codium, ~/.local/share/Codium, ~/.cache/Codium, etc.
  env.XDG_DATA_HOME = join(base, "xdg-data")
  env.XDG_CONFIG_HOME = join(base, "xdg-config")
  env.XDG_STATE_HOME = join(base, "xdg-state")
  env.XDG_CACHE_HOME = join(base, "xdg-cache")
  // Keep KILO_TEST_HOME pointed at the base dir if the caller set it.
  const kilo = env.KILO_TEST_HOME
  if (kilo !== undefined) env.KILO_TEST_HOME = kilo.trim()
  // Drop Electron/VS Code vars so the child does not attach to our process tree.
  for (const key of Object.keys(env)) {
    if (key.startsWith("ELECTRON_") || key.startsWith("VSCODE_")) delete env[key]
  }
}

// ---------------------------------------------------------------------------
// Hardening settings (identical defaults to script/launch.ts)
// ---------------------------------------------------------------------------

function settings() {
  const dir = join(userDir, "User")
  const file = join(dir, "settings.json")
  const defaults = {
    "chat.disableAIFeatures": true,
    "editor.accessibilitySupport": "off",
    "extensions.autoCheckUpdates": false,
    "extensions.autoUpdate": false,
    "extensions.ignoreRecommendations": true,
    "security.workspace.trust.enabled": false,
    "task.allowAutomaticTasks": "off",
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": false,
    "window.commandCenter": false,
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(defaults, null, 2) + "\n")
}

// ---------------------------------------------------------------------------
// Headless handling
// ---------------------------------------------------------------------------

function hasDisplay() {
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
}

function reportHeadless() {
  if (hasDisplay()) return
  if (which("xvfb-run")) {
    console.warn(
      "[test-runner] No DISPLAY/WAYLAND_DISPLAY. The app needs a display; set one, or run this\n" +
        "script under xvfb-run for headless execution.",
    )
    return
  }
  console.warn(
    "[test-runner] No DISPLAY/WAYLAND_DISPLAY and xvfb-run is unavailable.\n" +
      "The GUI app will likely fail to start. Install xvfb or provide a display.",
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (opts.clean) {
    console.log("[test-runner] Cleaning previous state...")
    rmSync(join(base, "user-data"), { recursive: true, force: true })
    rmSync(join(base, "extensions"), { recursive: true, force: true })
  }

  mkdirSync(userDir, { recursive: true })
  mkdirSync(extDir, { recursive: true })
  mkdirSync(workspace, { recursive: true })

  const app = detect()
  childEnv()
  settings()

  const tests = join(pkg, "out", "test")
  const hasSuite = existsSync(tests)

  const launchArgs = [
    workspace,
    `--user-data-dir=${userDir}`,
    `--extensions-dir=${extDir}`,
    `--extensionDevelopmentPath=${pkg}`,
    ...(hasSuite ? [`--extensionTestsPath=${tests}`] : []),
    "--disable-extensions",
    "--skip-release-notes",
    "--disable-workspace-trust",
  ]

  const options = {
    vscodeExecutablePath: app,
    extensionDevelopmentPath: pkg,
    extensionTestsPath: tests,
    reuseMachineInstall: true,
    launchArgs,
  }

  reportHeadless()

  console.log("[test-runner] Starting integration test run")
  console.log(`[test-runner] Executable: ${app}`)
  console.log(`[test-runner] Workspace:  ${workspace}`)
  console.log(`[test-runner] State:      ${base}`)
  console.log(`[test-runner] Suite:      ${tests}${hasSuite ? "" : " (missing)"}`)

  if (!hasSuite) {
    console.warn(
      "[test-runner] WARNING: out/test is absent, so no --extensionTestsPath is passed and VS Code\n" +
        "starts an isolated window instead of running a mocha suite. To execute integration tests,\n" +
        "add an in-host runner under src/test (compiled to out/test by `compile-tests`) that exports\n" +
        "a run() function driving mocha over out/test/**/*.test.js.",
    )
  }

  const code = await runTests(options)
  process.exit(code)
}

try {
  await main()
} catch (err) {
  console.error(`[test-runner] ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}