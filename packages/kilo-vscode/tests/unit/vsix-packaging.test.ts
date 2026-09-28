import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { builtinModules, createRequire } from "node:module"
import { listFiles, PackageManager } from "@vscode/vsce"
import { FORBIDDEN_VSIX_PATTERNS, REQUIRED_VSIX_FILES, TARGETS, stageVsix } from "../../script/pack-vsix"

const ROOT = path.resolve(import.meta.dir, "../..")

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])

// try/catch-guarded optional native peer deps of the bundled `ws`: ws falls back
// to its JS implementations when they are absent, so an offline VSIX without
// them must not crash activation.
const OPTIONAL = new Set(["bufferutil", "utf-8-validate"])

// A real require target is a valid npm specifier. The import regex below also
// matches `from "..."` text inside string literals of the minified bundle; those
// captures are never valid module names and are dropped here.
const VALID_SPEC = /^(@[\w.-]+\/)?[\w.-]+(?:\/[\w.-]+)*$/

// Same require/import scan as tests/unit/esbuild-dependencies.test.ts.
function findSpecifiers(content: string): string[] {
  const specifiers = new Set<string>()
  const requireRegex = /require\(["']([^"']+)["']\)/g
  const importRegex = /(?:import|from)\s+["']([^"']+)["']/g
  for (const match of content.matchAll(requireRegex)) specifiers.add(match[1])
  for (const match of content.matchAll(importRegex)) specifiers.add(match[1])
  return Array.from(specifiers)
}

// Mirrors pack-vsix.ts isForbidden for each FORBIDDEN_VSIX_PATTERNS entry.
function rule(pattern: string) {
  if (pattern === "node_modules/") return (file: string) => !file.startsWith("dist/") && file.includes("node_modules/")
  if (pattern === "*.vsix") return (file: string) => file.endsWith(".vsix")
  if (pattern.endsWith("/")) return (file: string) => file.startsWith(pattern)
  return (file: string) => file === pattern
}

describe("VSIX packaging", () => {
  it(".vscodeignore keeps the playwright runtime in and dev junk out of the VSIX file list", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-vscode-vsix-ignore-"))
    const staging = path.join(dir, "staging")
    try {
      fs.mkdirSync(staging, { recursive: true })
      for (const file of ["package.json", ".vscodeignore"]) {
        fs.copyFileSync(path.join(ROOT, file), path.join(staging, file))
      }
      for (const file of [
        "dist/extension.js",
        "dist/node_modules/playwright-core/browsers.json",
        "dist/node_modules/chromium-bidi/package.json",
        "node_modules/fake-pkg/index.js",
        "tests/unit/junk.test.ts",
        "storybook-static/junk.js",
        "dist/stale.vsix",
      ]) {
        const target = path.join(staging, file)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, "x")
      }
      const files = await listFiles({ cwd: staging, packageManager: PackageManager.None })
      for (const file of [
        "dist/extension.js",
        "dist/node_modules/playwright-core/browsers.json",
        "dist/node_modules/chromium-bidi/package.json",
      ]) {
        expect(files, `expected the VSIX file list to include ${file}`).toContain(file)
      }
      const junk = files.filter((file) => file.startsWith("node_modules/") || file.startsWith("tests/") || file.startsWith("storybook-static/"))
      expect(junk, `dev junk must not ship in the VSIX: ${junk.join(", ")}`).toEqual([])
      // vsce negations have unconditional precedence over ignore patterns, so the
      // `!dist/**` negation rescues a stale dist/*.vsix from `**/*.vsix` and it
      // cannot be kept out via .vscodeignore. pack-vsix.ts instead purges
      // dist/*.vsix before staging and forbids *.vsix in the pre-pack file list.
      expect(files, "dist/stale.vsix is kept by vsce negation precedence; only the packager keeps it out of the VSIX").toContain(
        "dist/stale.vsix",
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("packager staging includes the full playwright runtime", async () => {
    if (!fs.existsSync(path.join(ROOT, "dist", "extension.js")) || !fs.existsSync(path.join(ROOT, "bin", "kilo"))) {
      console.log("[vsix-packaging] skip: dist/extension.js and/or bin/kilo missing (run the production build first)")
      return
    }
    const target = TARGETS.find((t) => t.key === "linux")!
    // stageVsix derives the staging dir from the target key and this process' pid.
    const staging = path.join(os.tmpdir(), "kilo-vscode-vsix", `linux-${process.pid}`)
    try {
      await stageVsix(target, ROOT)
      const files = await listFiles({ cwd: staging, packageManager: PackageManager.None })
      const present = new Set(files)
      const required = [...REQUIRED_VSIX_FILES, `bin/${target.binary}`, "bin/ffmpeg", "bin/tree-sitter/tree-sitter.wasm"]
      const missing = required.filter((file) => !present.has(file))
      expect(missing, `required VSIX files missing from the staged tree: ${missing.join(", ")}`).toEqual([])
      expect(files, "nested chromium-bidi dependency copy missing").toContain("dist/node_modules/chromium-bidi/node_modules/zod/package.json")
      for (const pattern of FORBIDDEN_VSIX_PATTERNS) {
        const hits = files.filter(rule(pattern))
        expect(hits, `forbidden VSIX pattern ${pattern} present: ${hits.slice(0, 20).join(", ")}`).toEqual([])
      }
    } finally {
      fs.rmSync(staging, { recursive: true, force: true })
    }
  }, 60_000)

  it("production extension bundle is self-sufficient for offline installs", () => {
    if (!fs.existsSync(path.join(ROOT, "dist", "extension.js"))) {
      console.log("[vsix-packaging] skip: dist/extension.js missing (run the production build first)")
      return
    }
    const bundle = path.join(ROOT, "dist", "extension.js")
    const content = fs.readFileSync(bundle, "utf8")
    const specs = findSpecifiers(content).filter(
      (spec) =>
        VALID_SPEC.test(spec) &&
        !spec.startsWith(".") &&
        !spec.startsWith("/") &&
        !BUILTINS.has(spec) &&
        !spec.startsWith("node:") &&
        spec !== "vscode",
    )
    expect(specs, "expected the production bundle to declare at least one bare runtime module").not.toEqual([])
    // Resolving from the bundle location is not enough on a dev machine: a bare
    // specifier may resolve through the package node_modules, which an offline
    // install does not have. Every non-optional module must resolve inside
    // dist/ — the only tree the VSIX ships.
    const dist = path.dirname(bundle)
    const req = createRequire(bundle)
    const unshipped = specs
      .filter((spec) => !OPTIONAL.has(spec))
      .filter((spec) => {
        try {
          return !req.resolve(spec).startsWith(dist + path.sep)
        } catch {
          return true
        }
      })
    expect(unshipped, `bare specifiers unresolvable from the shipped dist/ tree: ${unshipped.join(", ")}`).toEqual([])
  })
})