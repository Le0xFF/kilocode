import { resolveProxyForUrl } from "./resolve"
import { State } from "./state"

/**
 * BunFetchRequestInit widened for `proxy: false` (supported at runtime since
 * Bun 1.1 but absent from the pinned bun-types), which pins a request to a
 * direct connection regardless of the proxy environment.
 */
type ProxyInit = Omit<BunFetchRequestInit, "proxy"> & { proxy?: string | false }

let captured: typeof globalThis.fetch | undefined

function target(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return input.url
}

/**
 * Replace globalThis.fetch with a pass-through that adds the Bun `proxy` init
 * option (URL with embedded Basic credentials, or `false` for pinned-direct
 * loopback targets) when proxy-auth state is active. Every other init field
 * is untouched, so streaming/duplex behavior is preserved.
 *
 * A pure no-op (plain delegation) when no credentials are stored. Never logs
 * the proxy URL or credentials. Idempotent; call from the CLI startup hook
 * before any fetch binding is captured.
 */
export function installFetchWrapper() {
  if (captured) return
  const native = globalThis.fetch
  captured = native
  const wrapped: typeof globalThis.fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit | BunFetchRequestInit | ProxyInit) => {
      const creds = State.peek()
      const proxy = creds ? resolveProxyForUrl(target(input), creds).proxy : undefined
      if (proxy === undefined) return native(input, init)
      const next: ProxyInit = { ...init, proxy }
      return native(input, next)
    },
    // The global fetch value also carries `preconnect`; keep it live on the wrapper.
    { preconnect: native.preconnect.bind(native) },
  )
  globalThis.fetch = wrapped
}

/** Restore the captured native fetch. Intended for tests. */
export function restoreFetch() {
  if (!captured) return
  const real = captured
  captured = undefined
  globalThis.fetch = real
}
