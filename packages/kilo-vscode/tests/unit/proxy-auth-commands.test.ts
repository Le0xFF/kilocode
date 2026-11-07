import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import type { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import { ProxyAuthState } from "../../src/services/cli-backend/proxy-auth-state"
import {
  registerProxyAuthCommands,
  readEffectiveProxy,
  runClearProxyAuth,
  runProxyAuthStatus,
  runSetProxyAuth,
} from "../../src/commands/proxy-auth"

const PROXY = "http://proxy.corp:3128"
type Window = {
  showInputBox?: (opts: unknown) => Promise<string | undefined>
  showQuickPick?: (items: readonly string[]) => Promise<string | undefined>
  showInformationMessage?: (msg: string) => Promise<unknown>
}

function fakeSecrets() {
  const data = new Map<string, string>()
  const calls: Array<{ op: "store" | "delete"; key: string; value?: string }> = []
  return {
    secrets: {
      async get(key: string) {
        return data.get(key)
      },
      async store(key: string, value: string) {
        data.set(key, value)
        calls.push({ op: "store", key, value })
      },
      async delete(key: string) {
        data.delete(key)
        calls.push({ op: "delete", key })
      },
    },
    calls,
  }
}

/** Fake client + service mirroring the connection service's push (effective → set/clear). */
function fakeService(state: ProxyAuthState) {
  const calls: Array<{ op: "set" | "clear"; params?: { mechanism: string; user: string; password: string } }> = []
  const client = {
    kilocode: {
      proxyAuth: {
        set: async (params: { mechanism: string; user: string; password: string }) => {
          calls.push({ op: "set", params })
          return { data: {}, error: undefined }
        },
        clear: async () => {
          calls.push({ op: "clear" })
          return { data: {}, error: undefined }
        },
      },
    },
  }
  const service = {
    pushProxyAuth: async () => {
      const cred = await state.effective()
      if (cred) await client.kilocode.proxyAuth.set({ mechanism: cred.mechanism, user: cred.user, password: cred.password })
      else await client.kilocode.proxyAuth.clear()
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

function stubWindow(opts: { user?: string | undefined; password?: string | undefined; choice?: string | undefined }) {
  const messages: string[] = []
  const win = vscode.window as unknown as Window
  const original = {
    showInputBox: win.showInputBox,
    showQuickPick: win.showQuickPick,
    showInformationMessage: win.showInformationMessage,
  }
  const values: Array<string | undefined> = [opts.user, opts.password]
  let input = 0
  win.showInputBox = async () => {
    const value = input < values.length ? values[input] : undefined
    input++
    return value
  }
  win.showQuickPick = async () => opts.choice
  win.showInformationMessage = async (msg) => {
    messages.push(msg)
    return undefined
  }
  return {
    messages,
    restore: () => {
      win.showInputBox = original.showInputBox
      win.showQuickPick = original.showQuickPick
      win.showInformationMessage = original.showInformationMessage
    },
  }
}

describe("proxy auth commands", () => {
  it("session-only set pushes to the client without storing a secret", async () => {
    const { secrets, calls } = fakeSecrets()
    const state = new ProxyAuthState(secrets, readEffectiveProxy)
    const { service, calls: pushes } = fakeService(state)
    const restoreConfig = stubConfig(PROXY)
    const window = stubWindow({ user: "alice", password: "s3cret", choice: "Use only for this session (not stored)" })

    await runSetProxyAuth(state, service)

    window.restore()
    restoreConfig()
    expect(calls).toEqual([])
    expect(pushes).toEqual([{ op: "set", params: { mechanism: "basic", user: "alice", password: "s3cret" } }])
    expect(window.messages).toEqual([expect.stringContaining("proxy.corp")])
    expect(window.messages[0]).toContain("alice")
    expect(window.messages[0]).not.toContain("s3cret")
  })

  it("remember set stores the secret and pushes to the client", async () => {
    const { secrets, calls } = fakeSecrets()
    const state = new ProxyAuthState(secrets, readEffectiveProxy)
    const { service, calls: pushes } = fakeService(state)
    const restoreConfig = stubConfig(PROXY)
    const window = stubWindow({ user: "alice", password: "s3cret", choice: "Remember — store securely in the OS keychain" })

    await runSetProxyAuth(state, service)

    window.restore()
    restoreConfig()
    expect(calls).toEqual([{ op: "store", key: "kilo.proxyAuth.http://proxy.corp:3128", value: expect.stringContaining("s3cret") }])
    expect(pushes).toEqual([{ op: "set", params: { mechanism: "basic", user: "alice", password: "s3cret" } }])
  })

  it("clear pushes clear to the client", async () => {
    const { secrets } = fakeSecrets()
    const state = new ProxyAuthState(secrets, readEffectiveProxy)
    const { service, calls } = fakeService(state)
    const restoreConfig = stubConfig(PROXY)
    const window = stubWindow({})

    await state.set({ user: "alice", password: "s3cret", remember: true })
    await runClearProxyAuth(state, service)

    window.restore()
    restoreConfig()
    expect(calls).toEqual([{ op: "clear" }])
    expect(window.messages).toEqual([expect.stringContaining("proxy.corp")])
  })

  it("status reports host and username but never the password", async () => {
    const { secrets } = fakeSecrets()
    const state = new ProxyAuthState(secrets, readEffectiveProxy)
    const restoreConfig = stubConfig(PROXY)
    const window = stubWindow({})

    await state.set({ user: "alice", password: "supersecret", remember: false })
    await runProxyAuthStatus(state)

    window.restore()
    restoreConfig()
    expect(window.messages).toHaveLength(1)
    const msg = window.messages[0]
    expect(msg).toContain("proxy.corp")
    expect(msg).toContain("alice")
    expect(msg).toContain("Basic")
    expect(msg).toContain("stored in keychain: no")
    expect(msg).not.toContain("supersecret")
  })

  it("short-circuits when no proxy is configured", async () => {
    const { secrets } = fakeSecrets()
    const state = new ProxyAuthState(secrets, readEffectiveProxy)
    const { service, calls } = fakeService(state)
    const restoreConfig = stubConfig(undefined)
    const window = stubWindow({})

    await runSetProxyAuth(state, service)

    window.restore()
    restoreConfig()
    expect(calls).toEqual([])
    expect(window.messages).toEqual(["Set the `http.proxy` setting first"])
  })

  it("short-circuits when inline credentials are embedded in http.proxy", async () => {
    const { secrets } = fakeSecrets()
    const state = new ProxyAuthState(secrets, readEffectiveProxy)
    const { service, calls } = fakeService(state)
    const restoreConfig = stubConfig("http://user:pass@proxy.corp:3128")
    const window = stubWindow({})

    await runSetProxyAuth(state, service)

    window.restore()
    restoreConfig()
    expect(calls).toEqual([])
    expect(window.messages).toEqual(["Inline credentials in `http.proxy` are in use; stored credentials are ignored"])
  })

  it("registers the three Command Palette commands", () => {
    const { secrets } = fakeSecrets()
    const state = new ProxyAuthState(secrets, readEffectiveProxy)
    const { service } = fakeService(state)
    const registered: string[] = []
    const context = {
      subscriptions: [] as Array<{ dispose(): void }>,
    } as unknown as vscode.ExtensionContext
    const original = vscode.commands.registerCommand
    ;(vscode.commands as unknown as { registerCommand: (id: string) => unknown }).registerCommand = (id: string) => {
      registered.push(id)
      return { dispose: () => {} }
    }
    try {
      registerProxyAuthCommands(context, service, state)
      expect(registered).toEqual(["kilo-code.new.proxyAuth.set", "kilo-code.new.proxyAuth.clear", "kilo-code.new.proxyAuth.status"])
    } finally {
      ;(vscode.commands as unknown as { registerCommand: (id: string) => unknown }).registerCommand = original
    }
  })
})
