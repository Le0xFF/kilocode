import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { KiloProvider } from "../../src/KiloProvider"
import type { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import { ProxyAuthState } from "../../src/services/cli-backend/proxy-auth-state"
import { readEffectiveProxy } from "../../src/commands/proxy-auth"

const PROXY = "http://proxy.corp:3128"
const INLINE_PROXY = "http://user:pass@proxy.corp:3128"
type Window = {
  showInputBox?: (opts: unknown) => Promise<string | undefined>
  showInformationMessage?: (msg: string) => Promise<unknown>
}

function fakeSecrets() {
  const data = new Map<string, string>()
  return {
    secrets: {
      async get(key: string) {
        return data.get(key)
      },
      async store(key: string, value: string) {
        data.set(key, value)
      },
      async delete(key: string) {
        data.delete(key)
      },
    },
  }
}

/** Fake connection service exposing just the proxy-auth surface the provider uses. */
function fakeService(state: ProxyAuthState) {
  const calls: string[] = []
  const service = {
    proxyAuthState: () => state,
    pushProxyAuth: async () => {
      calls.push("push")
    },
  } as unknown as KiloConnectionService
  return { service, calls }
}

function stubConfig(proxy: string | undefined, support?: string) {
  const original = (vscode.workspace as unknown as { getConfiguration: unknown }).getConfiguration
  ;(vscode.workspace as unknown as { getConfiguration: (s: string) => unknown }).getConfiguration = () => ({
    get: <T>(key: string, fallback?: T) => {
      if (key === "proxy") return (proxy ?? fallback) as T
      if (key === "proxySupport") return (support ?? fallback) as T
      return fallback as T
    },
    inspect: () => ({}),
    update: async () => {},
  })
  return () => {
    ;(vscode.workspace as unknown as { getConfiguration: unknown }).getConfiguration = original
  }
}

function stubWindow(opts: { user?: string; password?: string }) {
  const messages: string[] = []
  let inputs = 0
  const win = vscode.window as unknown as Window
  const original = {
    showInputBox: win.showInputBox,
    showInformationMessage: win.showInformationMessage,
  }
  const values: Array<string | undefined> = [opts.user, opts.password]
  win.showInputBox = async () => {
    const value = inputs < values.length ? values[inputs] : undefined
    inputs++
    return value
  }
  win.showInformationMessage = async (msg) => {
    messages.push(msg)
    return undefined
  }
  return {
    messages,
    inputs: () => inputs,
    restore: () => {
      win.showInputBox = original.showInputBox
      win.showInformationMessage = original.showInformationMessage
    },
  }
}

function makeProvider(state: ProxyAuthState) {
  const { service, calls } = fakeService(state)
  const provider = new KiloProvider({} as never, service)
  const internal = provider as unknown as {
    webview: { postMessage: (message: unknown) => Promise<boolean> } | null
    handleProxyAuthSet(remember: boolean): Promise<void>
    handleProxyAuthClear(): Promise<void>
    sendProxyAuthStatus(): Promise<void>
  }
  const posted: Array<Record<string, unknown>> = []
  internal.webview = {
    postMessage: async (message) => {
      posted.push(message as Record<string, unknown>)
      return true
    },
  }
  const status = () => posted.filter((message) => message.type === "proxyAuthStatusLoaded")
  return { internal, posted, status, calls }
}

describe("proxy auth webview handlers", () => {
  it("set with remember prompts host-side, stores the secret, pushes, and re-pushes credential-free status", async () => {
    const { secrets } = fakeSecrets()
    const state = new ProxyAuthState(secrets, readEffectiveProxy)
    const { internal, status, calls } = makeProvider(state)
    const restoreConfig = stubConfig(PROXY)
    const window = stubWindow({ user: "alice", password: "s3cret" })

    await internal.handleProxyAuthSet(true)

    window.restore()
    restoreConfig()
    expect(calls).toEqual(["push"])
    const last = status().at(-1)
    expect(last).toEqual({
      type: "proxyAuthStatusLoaded",
      proxy: PROXY,
      inlineCredentials: false,
      host: "proxy.corp",
      username: "alice",
      mechanism: "basic",
      stored: true,
    })
    expect(JSON.stringify(last)).not.toContain("s3cret")
  })

  it("set without remember keeps the credential session-only", async () => {
    const { secrets } = fakeSecrets()
    const state = new ProxyAuthState(secrets, readEffectiveProxy)
    const { internal, status } = makeProvider(state)
    const restoreConfig = stubConfig(PROXY)
    const window = stubWindow({ user: "alice", password: "s3cret" })

    await internal.handleProxyAuthSet(false)

    window.restore()
    restoreConfig()
    const last = status().at(-1)
    expect(last?.username).toBe("alice")
    expect(last?.stored).toBe(false)
    expect(last?.mechanism).toBe("basic")
  })

  it("set short-circuits without prompting when no proxy is configured", async () => {
    const { secrets } = fakeSecrets()
    const state = new ProxyAuthState(secrets, readEffectiveProxy)
    const { internal, status } = makeProvider(state)
    const restoreConfig = stubConfig(undefined)
    const window = stubWindow({ user: "alice", password: "s3cret" })

    await internal.handleProxyAuthSet(true)

    window.restore()
    restoreConfig()
    expect(window.inputs()).toBe(0)
    expect(window.messages).toEqual(["Set the `http.proxy` setting first"])
    const last = status().at(-1)
    expect(last?.proxy).toBeNull()
    expect(last?.username).toBeNull()
  })

  it("set is refused for inline credentials and the re-pushed status redacts the URL", async () => {
    const { secrets } = fakeSecrets()
    const state = new ProxyAuthState(secrets, readEffectiveProxy)
    const { internal, posted, status } = makeProvider(state)
    const restoreConfig = stubConfig(INLINE_PROXY)
    const window = stubWindow({ user: "alice", password: "s3cret" })

    await internal.handleProxyAuthSet(true)

    window.restore()
    restoreConfig()
    expect(window.inputs()).toBe(0)
    expect(window.messages).toEqual([
      "Inline credentials in `http.proxy` are in use; stored credentials are ignored",
    ])
    const last = status().at(-1)
    expect(last).toEqual({
      type: "proxyAuthStatusLoaded",
      proxy: "http://proxy.corp:3128",
      inlineCredentials: true,
      host: "proxy.corp",
      username: null,
      mechanism: null,
      stored: false,
    })
    expect(JSON.stringify(posted)).not.toContain("user:pass@")
  })

  it("clear drops the credential, pushes, and re-pushes a credential-free status", async () => {
    const { secrets } = fakeSecrets()
    const state = new ProxyAuthState(secrets, readEffectiveProxy)
    const { internal, status, calls } = makeProvider(state)
    const restoreConfig = stubConfig(PROXY)
    const window = stubWindow({})

    await state.set({ user: "alice", password: "s3cret", remember: true })
    await internal.handleProxyAuthClear()

    window.restore()
    restoreConfig()
    expect(calls).toEqual(["push"])
    expect(window.messages).toEqual([expect.stringContaining("proxy.corp")])
    const last = status().at(-1)
    expect(last?.username).toBeNull()
    expect(last?.mechanism).toBeNull()
    expect(last?.stored).toBe(false)
  })

  it("sendProxyAuthStatus is a no-op when no state is wired", async () => {
    const service = {
      proxyAuthState: () => null,
      pushProxyAuth: async () => {},
    } as unknown as KiloConnectionService
    const provider = new KiloProvider({} as never, service)
    const internal = provider as unknown as {
      webview: { postMessage: (message: unknown) => Promise<boolean> } | null
      sendProxyAuthStatus(): Promise<void>
    }
    const posted: unknown[] = []
    internal.webview = {
      postMessage: async (message) => {
        posted.push(message)
        return true
      },
    }

    await internal.sendProxyAuthStatus()

    expect(posted).toEqual([])
  })
})
