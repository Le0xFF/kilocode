/**
 * Session/persistent credential state for proxy authentication.
 *
 * Credentials are stored by default off: `set` writes to VS Code's SecretStorage
 * (the OS keychain) only when the caller passes `remember`; otherwise the
 * credential lives in memory for the lifetime of this window. The extension
 * never rewrites the environment — the connection service pushes whatever
 * `effective()` yields to the CLI backend.
 *
 * The module is VS Code-free at runtime (only a type import) so it can be unit
 * tested with a minimal fake `secrets` store and an injected proxy reader.
 */
import type * as vscode from "vscode"
import { makeCred, parseCred, proxyAuthKey, type ProxyCred } from "./proxy-auth"

export interface ProxyAuthStatus {
  /** The configured `http.proxy` value, or null when no proxy is active. */
  proxy: string | null
  /** Proxy hostname (lowercased) when a proxy is configured, else null. */
  host: string | null
  /** Username from the effective credential, or null. Never the password. */
  username: string | null
  /** Auth mechanism of the effective credential, or null. */
  mechanism: string | null
  /** True when a credential is persisted in SecretStorage for this proxy. */
  stored: boolean
}

type Secrets = Pick<vscode.SecretStorage, "get" | "store" | "delete">

function toUrl(proxy: string): URL | null {
  const candidate = proxy.includes("://") ? proxy : `http://${proxy}`
  try {
    return new URL(candidate)
  } catch {
    return null
  }
}

/** Lowercased proxy hostname, or null when the value is absent/unparseable. */
export function proxyHost(proxy: string | null): string | null {
  if (proxy === null) return null
  const url = toUrl(proxy)
  if (url === null) return null
  return url.hostname.toLowerCase() || null
}

export class ProxyAuthState {
  private ephemeral: ProxyCred | null = null
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly secrets: Secrets,
    private readonly readProxy: () => string | null,
  ) {}

  /** SecretStorage key for the current proxy, or null when none is valid. */
  private key(): string | null {
    const proxy = this.readProxy()
    if (proxy === null) return null
    return proxyAuthKey(proxy)
  }

  /**
   * The credential that should be pushed to the backend: an in-memory
   * (session-only) credential when present, otherwise the fresh SecretStorage
   * value. Stored secrets are read on every call — never cached.
   */
  async effective(): Promise<ProxyCred | null> {
    if (this.ephemeral) return this.ephemeral
    const key = this.key()
    if (key === null) return null
    const raw = await this.secrets.get(key)
    if (raw === undefined) return null
    return parseCred(raw)
  }

  /**
   * Set the session credential. With `remember`, also persist it in
   * SecretStorage under the proxy's key; without, it stays ephemeral and
   * SecretStorage is never touched.
   */
  async set(input: { user: string; password: string; remember: boolean }): Promise<void> {
    this.ephemeral = { mechanism: "basic", user: input.user, password: input.password }
    if (input.remember) {
      const key = this.key()
      if (key !== null) {
        await this.secrets.store(key, makeCred({ mechanism: "basic", user: input.user, password: input.password }))
      }
    }
    this.fireChange()
  }

  /** Drop the ephemeral credential and remove the persisted secret, if any. */
  async clear(): Promise<void> {
    this.ephemeral = null
    const key = this.key()
    if (key !== null) {
      await this.secrets.delete(key)
    }
    this.fireChange()
  }

  /**
   * A credential-free summary for display. Never includes the password and
   * never the proxy URL with embedded credentials (only the plain proxy value).
   */
  async status(): Promise<ProxyAuthStatus> {
    const proxy = this.readProxy()
    const key = proxy === null ? null : proxyAuthKey(proxy)
    let stored = false
    if (key !== null) {
      const raw = await this.secrets.get(key)
      stored = raw !== undefined
    }
    const cred = await this.effective()
    return {
      proxy,
      host: proxyHost(proxy),
      username: cred ? cred.user : null,
      mechanism: cred ? cred.mechanism : null,
      stored,
    }
  }

  /**
   * Subscribe to a change fired after any `set`/`clear`. Returns a disposable.
   * Lets the connection service re-push the credential to the backend.
   */
  onChange(listener: () => void): { dispose(): void } {
    const listeners = this.listeners
    listeners.add(listener)
    let disposed = false
    return {
      dispose() {
        if (disposed) return
        disposed = true
        listeners.delete(listener)
      },
    }
  }

  private fireChange(): void {
    for (const listener of this.listeners) listener()
  }
}
