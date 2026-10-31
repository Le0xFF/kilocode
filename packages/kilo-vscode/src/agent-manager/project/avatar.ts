/**
 * Resolve an organization avatar for a project from its Git origin remote.
 *
 * // Offline fork: never download project avatars; cache-only (pre-populated by earlier online installs) or letter tile.
 * A previously cached image is sent to the webview as a data URL; otherwise
 * the sidebar shows a letter tile.
 */

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const owners = new Map<string, string | undefined>()
const images = new Map<string, string>()

function config(root: string): string | undefined {
  const dot = path.join(root, ".git")
  const stat = fs.statSync(dot, { throwIfNoEntry: false })
  if (!stat) return undefined
  if (stat.isDirectory()) return path.join(dot, "config")
  const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dot, "utf8"))
  if (!match) return undefined
  const dir = path.resolve(root, match[1].trim())
  const common = path.join(dir, "commondir")
  if (!fs.existsSync(common)) return path.join(dir, "config")
  return path.join(path.resolve(dir, fs.readFileSync(common, "utf8").trim()), "config")
}

/** Parse the owner of a GitHub remote URL. Custom SSH host aliases for GitHub are accepted. */
export function owner(url: string): string | undefined {
  const match = /github\.com[^:/\s]*[:/]([^/\s]+)\//i.exec(url)
  return match?.[1]
}

/** GitHub owner of the project's origin remote, cached per root. */
export function origin(root: string): string | undefined {
  if (owners.has(root)) return owners.get(root)
  const file = config(root)
  const text = file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  const section = /\[remote "origin"\]([^[]*)/.exec(text)?.[1] ?? ""
  const url = /^\s*url\s*=\s*(.+)$/m.exec(section)?.[1]?.trim()
  const name = url ? owner(url) : undefined
  owners.set(root, name)
  return name
}

function dir() {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache")
  return path.join(base, "kilo", "project-avatars")
}

function file(name: string) {
  return path.join(dir(), `${name.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}.png`)
}

/**
 * Avatar data URL for a project, or undefined when no cached image exists.
 * `done` and `log` are kept for call-site compatibility; `done` is a no-op
 * since no download is ever started. Never throws: an unreadable `.git` or
 * cache file falls back to the letter tile.
 */
export function avatar(
  root: string,
  done: () => void = () => {},
  log: (msg: string) => void = () => {},
): string | undefined {
  void done
  try {
    const name = origin(root)
    if (!name) return undefined
    const cached = images.get(name)
    if (cached) return cached
    const entry = file(name)
    if (!fs.statSync(entry, { throwIfNoEntry: false })) return undefined
    const url = `data:image/png;base64,${fs.readFileSync(entry).toString("base64")}`
    images.set(name, url)
    return url
  } catch (err) {
    log(`avatar: failed to read avatar for ${root}: ${err}`)
    return undefined
  }
}
