/**
 * VS Code-free helpers for proxy authentication.
 *
 * These are pure, testable building blocks shared by the steps that persist
 * per-proxy credentials and hand them to the CLI backend. The extension never
 * rewrites the environment, so there is no env-applying helper here.
 */

export interface ProxyCred {
  mechanism: string
  user: string
  password: string
}

const PREFIX = "kilo.proxyAuth."

/** Parse a proxy URL, prepending `http://` when no scheme is present. */
function toUrl(proxyUrl: string): URL | null {
  const candidate = proxyUrl.includes("://") ? proxyUrl : `http://${proxyUrl}`
  try {
    return new URL(candidate)
  } catch {
    return null
  }
}

/**
 * Stable key identifying the proxy a credential belongs to. Returns
 * `kilo.proxyAuth.<scheme>://<lowercase-host>:<resolved-port>` where the port
 * is the explicit port or the scheme default (80 for http, 443 for https).
 * Returns `null` on parse failure, a non-http(s) scheme, or an empty host;
 * never throws.
 *
 * Limitation: only `http` and `https` proxies are supported. Schemes without
 * a defined default port (e.g. `socks5`) are intentionally rejected because
 * the CLI backend can only inject Basic credentials into http(s) proxy URLs;
 * users with such proxies should embed credentials inline in `http.proxy`
 * or run an external local forwarder.
 */
export function proxyAuthKey(proxyUrl: string): string | null {
  const url = toUrl(proxyUrl)
  if (url === null) return null
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  const scheme = url.protocol.slice(0, -1)
  const host = url.hostname.toLowerCase()
  const port = url.port !== "" ? url.port : scheme === "https" ? "443" : "80"
  return `${PREFIX}${scheme}://${host}:${port}`
}

/** True iff `key` is a key produced by {@link proxyAuthKey}. */
export function isProxyAuthKey(key: string): boolean {
  return key.startsWith(PREFIX)
}

/** True iff the proxy URL carries a username (embedded credentials). */
export function hasEmbeddedCredentials(proxyUrl: string): boolean {
  const url = toUrl(proxyUrl)
  if (url === null) return false
  return url.username !== ""
}

/**
 * Defensively parse a stored credential JSON string. Accepts the legacy
 * `{ user, password }` shape (mechanism defaults to `"basic"`) and the full
 * `{ mechanism, user, password }` shape. Returns `null` for invalid JSON, a
 * non-object payload, non-string `user`/`mechanism`, or a missing/empty
 * `password`; never throws.
 */
export function parseCred(json: string): ProxyCred | null {
  try {
    const data: unknown = JSON.parse(json)
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null
    const obj = data as Record<string, unknown>
    const user = obj.user
    const password = obj.password
    if (typeof user !== "string") return null
    if (typeof password !== "string" || password === "") return null
    const mechanism = obj.mechanism === undefined ? "basic" : obj.mechanism
    if (typeof mechanism !== "string") return null
    return { mechanism, user, password }
  } catch {
    return null
  }
}

/** Serialize credentials to the canonical JSON string used for storage. */
export function makeCred(creds: { mechanism?: string; user: string; password: string }): string {
  const mechanism = creds.mechanism === undefined ? "basic" : creds.mechanism
  return JSON.stringify({ mechanism, user: creds.user, password: creds.password })
}
