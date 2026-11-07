import { getProxyForUrl } from "@/util/proxy-env"
import type { ProxyCredentials } from "./types"

/** The `proxy` directive the fetch wrapper adds to Bun's per-request init. `false` forces a direct connection. */
export type ProxyDirective = { proxy?: string | false }

function isLoopback(hostname: string): boolean {
  const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname
  if (host === "localhost" || host === "0.0.0.0" || host === "::1" || host === "::ffff:127.0.0.1") return true
  const octets = host.split(".")
  return octets.length === 4 && octets[0] === "127"
}

/**
 * Resolve the per-request `proxy` init value for a target URL.
 *
 * Precedence (credentials active and basic with a password):
 * - loopback target → `{ proxy: false }`: loopback traffic is pinned to a
 *   direct connection, even when the environment would otherwise proxy it.
 * - no environment proxy for the URL (unset, or excluded by NO_PROXY, which
 *   proxy-from-env also applies to explicit proxy values) → `{}`: Bun's
 *   native environment proxy handling applies.
 * - environment proxy URL already embeds credentials → `{}`: those take
 *   precedence over the stored credentials and pass through untouched.
 * - otherwise → `{ proxy }` with the stored Basic credentials injected into
 *   the environment proxy URL, WHATWG-encoded via the URL API.
 *
 * Without active credentials the result is always `{}`, leaving Bun's native
 * environment behavior untouched.
 */
export function resolveProxyForUrl(targetUrl: string, creds?: ProxyCredentials): ProxyDirective {
  if (!creds || creds.mechanism !== "basic" || !creds.password) return {}
  if (!URL.canParse(targetUrl)) return {}
  const target = new URL(targetUrl)
  if (target.protocol !== "http:" && target.protocol !== "https:") return {}
  if (isLoopback(target.hostname)) return { proxy: false }
  const envProxy = getProxyForUrl(target)
  if (!envProxy) return {}
  if (!URL.canParse(envProxy)) return {}
  const url = new URL(envProxy)
  if (url.protocol !== "http:" && url.protocol !== "https:") return {}
  if (url.username || url.password) return {}
  url.username = creds.user ?? ""
  url.password = creds.password
  return { proxy: url.toString() }
}

/**
 * The host the stored credentials would apply to: the environment-configured
 * proxy, when one exists. Null when no environment proxy is set (or NO_PROXY
 * excludes everything), in which case the credentials are inert.
 */
export function proxyHost(): string | null {
  const probe = getProxyForUrl("https://example.invalid") ?? getProxyForUrl("http://example.invalid")
  if (!probe) return null
  try {
    return new URL(probe).host
  } catch {
    return null
  }
}
