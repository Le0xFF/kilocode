import { resolveProxyForUrl } from "../resolve"
import type { ProxyAuthBackend } from "../types"

/**
 * The v1 backend: Basic proxy auth via credentials embedded in the proxy URL.
 *
 * v1 backends always source the proxy target from the process environment
 * (Bun re-reads the proxy env per request), so the `proxyUrl` argument is
 * informational here. Future handshaking backends (Digest/NTLM/Kerberos) will
 * consume it to drive their exchange against an explicit proxy.
 */
export const basic: ProxyAuthBackend = {
  mechanism: "basic",
  route(targetUrl, _proxyUrl, creds) {
    return resolveProxyForUrl(targetUrl, creds)
  },
}
