import { describe, expect, it } from "bun:test"
import { makeCred, proxyAuthKey } from "../../src/services/cli-backend/proxy-auth"
import { ProxyAuthState } from "../../src/services/cli-backend/proxy-auth-state"

const PROXY = "http://proxy.corp:3128"
const KEY = proxyAuthKey(PROXY)!

function fakeSecrets() {
  const data = new Map<string, string>()
  const calls: Array<{ op: "store" | "delete"; key: string; value?: string }> = []
  const secrets = {
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
  }
  return { secrets, data, calls }
}

describe("ProxyAuthState", () => {
  it("persists to SecretStorage with the canonical makeCred JSON when remembering", async () => {
    const { secrets, data, calls } = fakeSecrets()
    const state = new ProxyAuthState(secrets, () => PROXY)
    await state.set({ user: "alice", password: "s3cret", remember: true })

    expect(KEY).toBe("kilo.proxyAuth.http://proxy.corp:3128")
    expect(calls).toEqual([{ op: "store", key: KEY, value: makeCred({ mechanism: "basic", user: "alice", password: "s3cret" }) }])
    expect(data.get(KEY)).toBe(makeCred({ mechanism: "basic", user: "alice", password: "s3cret" }))
  })

  it("keeps the credential session-only (ephemeral) without touching SecretStorage", async () => {
    const { secrets, calls } = fakeSecrets()
    const state = new ProxyAuthState(secrets, () => PROXY)
    await state.set({ user: "bob", password: "pw", remember: false })

    expect(calls).toEqual([])
    expect(await state.effective()).toEqual({ mechanism: "basic", user: "bob", password: "pw" })
  })

  it("clear() removes both the ephemeral credential and the stored secret", async () => {
    const { secrets, data, calls } = fakeSecrets()
    const state = new ProxyAuthState(secrets, () => PROXY)
    await state.set({ user: "alice", password: "s3cret", remember: true })
    expect(data.get(KEY)).toBeDefined()

    await state.clear()

    expect(data.get(KEY)).toBeUndefined()
    expect(await state.effective()).toBeNull()
    expect(calls).toEqual([
      { op: "store", key: KEY, value: makeCred({ mechanism: "basic", user: "alice", password: "s3cret" }) },
      { op: "delete", key: KEY },
    ])
  })

  it("never exposes the password in status()", async () => {
    const { secrets } = fakeSecrets()
    const state = new ProxyAuthState(secrets, () => PROXY)
    await state.set({ user: "alice", password: "supersecret", remember: true })

    const status = await state.status()

    expect(JSON.stringify(status)).not.toContain("supersecret")
    expect(status.proxy).toBe(PROXY)
    expect(status.host).toBe("proxy.corp")
    expect(status.username).toBe("alice")
    expect(status.mechanism).toBe("basic")
    expect(status.stored).toBe(true)
  })

  it("prefers the ephemeral credential over the stored one", async () => {
    const { secrets } = fakeSecrets()
    const state = new ProxyAuthState(secrets, () => PROXY)
    await state.set({ user: "stored-user", password: "stored-pw", remember: true })
    await state.set({ user: "session-user", password: "session-pw", remember: false })

    expect(await state.effective()).toEqual({ mechanism: "basic", user: "session-user", password: "session-pw" })
  })

  it("yields null and skips storage when no proxy is configured", async () => {
    const { secrets, calls } = fakeSecrets()
    const state = new ProxyAuthState(secrets, () => null)
    await state.set({ user: "alice", password: "pw", remember: true })

    expect(calls).toEqual([])
    const status = await state.status()
    expect(status.proxy).toBeNull()
    expect(status.host).toBeNull()
    expect(status.stored).toBe(false)
  })
})
