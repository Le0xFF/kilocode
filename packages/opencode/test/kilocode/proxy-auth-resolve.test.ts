import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { State, UnsupportedMechanismError, resolveProxyForUrl } from "../../src/kilocode/proxy-auth"
import type { ProxyCredentials } from "../../src/kilocode/proxy-auth"

const saved: Record<string, string | undefined> = {}
const keys = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY", "no_proxy", "NO_PROXY"]

beforeEach(() => {
  for (const key of keys) saved[key] = process.env[key]
  for (const key of keys) delete process.env[key]
})

afterEach(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  State.clear()
})

const creds: ProxyCredentials = { mechanism: "basic", user: "svc", password: "pw" }

describe("resolveProxyForUrl", () => {
  test("returns {} without credentials", () => {
    process.env.HTTPS_PROXY = "http://proxy.example:3128"
    expect(resolveProxyForUrl("https://api.example.com/v1")).toEqual({})
  })

  test("returns {} for non-basic mechanisms", () => {
    process.env.HTTPS_PROXY = "http://proxy.example:3128"
    expect(resolveProxyForUrl("https://api.example.com/v1", { mechanism: "ntlm", user: "u", password: "p" })).toEqual({})
  })

  test("returns {} when no environment proxy is configured", () => {
    expect(resolveProxyForUrl("https://api.example.com/v1", creds)).toEqual({})
  })

  test("injects credentials into the environment proxy URL", () => {
    process.env.HTTPS_PROXY = "http://proxy.example:3128"
    expect(resolveProxyForUrl("https://api.example.com/v1", creds)).toEqual({
      proxy: "http://svc:pw@proxy.example:3128/",
    })
  })

  test("protocol-less environment proxies gain the target protocol", () => {
    process.env.HTTP_PROXY = "proxy.example:3128"
    expect(resolveProxyForUrl("http://api.example.com/v1", creds)).toEqual({
      proxy: "http://svc:pw@proxy.example:3128/",
    })
  })

  test("falls back to all_proxy when the scheme variable is unset", () => {
    process.env.ALL_PROXY = "http://proxy.example:3128"
    expect(resolveProxyForUrl("https://api.example.com/v1", creds).proxy).toBe("http://svc:pw@proxy.example:3128/")
  })

  test("no_proxy excludes the target", () => {
    process.env.HTTPS_PROXY = "http://proxy.example:3128"
    process.env.NO_PROXY = "api.example.com"
    expect(resolveProxyForUrl("https://api.example.com/v1", creds)).toEqual({})
    expect(resolveProxyForUrl("https://other.example.com/v1", creds).proxy).toBe("http://svc:pw@proxy.example:3128/")
  })

  test("no_proxy=* disables the proxy entirely", () => {
    process.env.HTTPS_PROXY = "http://proxy.example:3128"
    process.env.NO_PROXY = "*"
    expect(resolveProxyForUrl("https://api.example.com/v1", creds)).toEqual({})
  })

  test("pins loopback targets to a direct connection even without no_proxy", () => {
    process.env.HTTP_PROXY = "http://proxy.example:3128"
    expect(resolveProxyForUrl("http://127.0.0.1:8080/health", creds)).toEqual({ proxy: false })
    expect(resolveProxyForUrl("http://localhost:8080/health", creds)).toEqual({ proxy: false })
    expect(resolveProxyForUrl("http://[::1]:8080/health", creds)).toEqual({ proxy: false })
  })

  test("environment proxy URLs with embedded credentials pass through untouched", () => {
    process.env.HTTPS_PROXY = "https://envuser:envpass@proxy.example:3128"
    expect(resolveProxyForUrl("https://api.example.com/v1", creds)).toEqual({})
    process.env.HTTPS_PROXY = "https://:envpass@proxy.example:3128"
    expect(resolveProxyForUrl("https://api.example.com/v1", creds)).toEqual({})
  })

  test("ignores unsupported environment proxy protocols", () => {
    process.env.ALL_PROXY = "socks5://proxy.example:1080"
    expect(resolveProxyForUrl("https://api.example.com/v1", creds)).toEqual({})
  })

  test("ignores non-HTTP target protocols and unparseable URLs", () => {
    process.env.ALL_PROXY = "http://proxy.example:3128"
    expect(resolveProxyForUrl("ftp://files.example.com/x", creds)).toEqual({})
    expect(resolveProxyForUrl("not a url", creds)).toEqual({})
  })

  test("WHATWG-encodes user and password in the proxy URL", () => {
    process.env.HTTPS_PROXY = "http://proxy.example:3128"
    expect(
      resolveProxyForUrl("https://api.example.com/v1", {
        mechanism: "basic",
        user: "us er@x",
        password: "p:ass/word#frag",
      }),
    ).toEqual({ proxy: "http://us%20er%40x:p%3Aass%2Fword%23frag@proxy.example:3128/" })
  })

  test("keeps an empty user when only a password is stored", () => {
    process.env.HTTPS_PROXY = "http://proxy.example:3128"
    expect(resolveProxyForUrl("https://api.example.com/v1", { mechanism: "basic", password: "secret" })).toEqual({
      proxy: "http://:secret@proxy.example:3128/",
    })
  })
})

describe("State", () => {
  test("stores and clears supported credentials", () => {
    expect(State.peek()).toBeUndefined()
    State.set({ mechanism: "basic", user: "u", password: "p" })
    expect(State.active()).toBe(true)
    expect(State.peek()).toEqual({ mechanism: "basic", user: "u", password: "p" })
    State.clear()
    expect(State.active()).toBe(false)
    expect(State.peek()).toBeUndefined()
  })

  test("rejects unsupported mechanisms with a mapped error", () => {
    for (const mechanism of ["digest", "ntlm", "kerberos"] as const) {
      expect(() => State.set({ mechanism, password: "p" })).toThrow(UnsupportedMechanismError)
    }
    expect(State.peek()).toBeUndefined()
  })
})
