import { $ } from "bun"
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join, sep } from "node:path"

/**
 * Static ripgrep releases staged next to the CLI binary per target, so the
 * packaged backend resolves ripgrep with zero network (KILO_RIPGREP). Only
 * x64 targets ship in the VSIX; anything else warns and falls back to system
 * ripgrep.
 *
 * Release archives and their .sha256 checksums are cached in a user-level,
 * git-clean-proof directory (see ripgrepCacheDir). The staleness marker
 * stays in node_modules/.kilo-rg-target, so wiping node_modules invalidates
 * it but staging still recovers from the user-level cache with no network.
 */
const releases: Record<string, { url: string; file: string; archive: "tar.gz" | "zip" }> = {
  "linux-x64": {
    url: "https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-x86_64-unknown-linux-musl.tar.gz",
    file: "rg",
    archive: "tar.gz",
  },
  "win32-x64": {
    // Static MSVC build: the gnu build dynamically links libwinpthread-1.dll /
    // libgcc_s_seh-1.dll, which the release zip does not ship, so it cannot
    // launch on stock Windows.
    url: "https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-x86_64-pc-windows-msvc.zip",
    file: "rg.exe",
    archive: "zip",
  },
}

// User-level cache dir: ~/.cache (or $XDG_CACHE_HOME) on linux, %LOCALAPPDATA%
// on windows, ~/Library/Caches on darwin. Lives outside the repo, so it
// survives `git clean` and fresh node_modules installs.
export function ripgrepCacheDir(): string {
  if (process.platform === "win32") {
    if (!process.env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is unset; cannot locate the ripgrep archive cache")
    return join(process.env.LOCALAPPDATA, "kilo-ripgrep")
  }
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches", "kilo-ripgrep")
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "kilo-ripgrep")
}

// The release's per-asset .sha256 files embed the digest in machine-specific
// text (CertUtil output on windows, sha256sum lines on linux); the digest
// itself is always a bare 64-hex token.
function digest(text: string): string | undefined {
  return text.match(/[0-9a-f]{64}/i)?.[0]?.toLowerCase()
}

export async function ensureRipgrepForTarget(target: string, bin: string): Promise<void> {
  const spec = releases[target]
  if (!spec) {
    console.warn(`No bundled ripgrep release is available for target ${target}; the backend will use system ripgrep.`)
    return
  }

  const dest = join(bin, spec.file)
  const marker = join(bin, "..", "node_modules", ".kilo-rg-target")
  if (existsSync(dest) && existsSync(marker) && (await Bun.file(marker).text()).trim() === target) return

  // Warm close-out cache: the user-level archive + checksum pair keeps staging
  // working with no network, even after a node_modules wipe drops the marker.
  const cache = ripgrepCacheDir()
  mkdirSync(cache, { recursive: true })
  const name = spec.url.split("/").pop()
  if (!name) throw new Error(`Could not derive a release archive name from ${spec.url}`)
  const archive = join(cache, name)
  const sum = join(cache, `${name}.sha256`)

  const tmp = join(bin, ".rg-tmp")
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })

  try {
    // Partial files land in the cache dir itself: a rename into the cache
    // must stay on one filesystem (the cache is user-level, tmp is not).
    if (!existsSync(sum)) {
      const partial = join(cache, `${name}.sha256.partial`)
      await $`curl -fL --retry 3 --retry-delay 2 --connect-timeout 15 -o ${partial} ${spec.url}.sha256`.quiet()
      renameSync(partial, sum)
    }
    if (!existsSync(archive)) {
      const partial = join(cache, `${name}.partial`)
      await $`curl -fL --retry 3 --retry-delay 2 --connect-timeout 15 -o ${partial} ${spec.url}`.quiet()
      renameSync(partial, archive)
    }
    // Verify before extracting; cached archives re-verify against the cached
    // checksum so warm re-staging works fully offline.
    const hex = digest(await Bun.file(sum).text())
    if (!hex) throw new Error(`Could not read a sha256 digest from the cached checksum for ${name}`)
    const actual = new Bun.CryptoHasher("sha256").update(await Bun.file(archive).arrayBuffer()).digest("hex")
    if (actual !== hex) {
      throw new Error(`Ripgrep release archive ${name} failed sha256 verification: expected ${hex}, got ${actual}`)
    }
    if (spec.archive === "zip") {
      if (!Bun.which("unzip")) {
        throw new Error("install `unzip` (or libarchive's tar) to stage the win32 ripgrep archive")
      }
      await $`unzip -o -q ${archive} -d ${tmp}`.quiet()
    } else {
      await $`tar -xzf ${archive} -C ${tmp}`.quiet()
    }
    const dir = readdirSync(tmp).find((entry) => entry.startsWith("ripgrep-"))
    if (!dir) throw new Error(`Ripgrep release archive ${name} did not extract a ripgrep-* directory`)
    // Path-traversal guard: the extracted payload must stay inside the staging dir.
    const base = realpathSync(tmp)
    const payload = realpathSync(join(tmp, dir))
    if (!payload.startsWith(base + sep)) {
      throw new Error(`Ripgrep release archive ${name} extracted outside the staging directory`)
    }
    copyFileSync(join(payload, spec.file), dest)
    if (!target.startsWith("win32")) chmodSync(dest, 0o755)
    mkdirSync(join(bin, "..", "node_modules"), { recursive: true })
    await Bun.write(marker, `${target}\n`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
