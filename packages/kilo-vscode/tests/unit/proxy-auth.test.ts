import { describe, it, expect } from "bun:test"
import {
  proxyAuthKey,
  isProxyAuthKey,
  hasEmbeddedCredentials,
  parseCred,
  makeCred,
} from "../../src/services/cli-backend/proxy-auth"

describe("proxyAuthKey", () => {
  it("lowercases an uppercase host", () => {
    expect(proxyAuthKey("http://EXAMPLE.com:8080")).toBe("kilo.proxyAuth.http://example.com:8080")
    expect(proxyAuthKey("https://Proxy.CORP:443")).toBe("kilo.proxyAuth.https://proxy.corp:443")
  })

  it("preserves an explicit port", () => {
    expect(proxyAuthKey("http://proxy.corp.example:3128")).toBe("kilo.proxyAuth.http://proxy.corp.example:3128")
  })

  it("applies the scheme default port when none is explicit (http -> 80)", () => {
    expect(proxyAuthKey("http://proxy.corp.example")).toBe("kilo.proxyAuth.http://proxy.corp.example:80")
  })

  it("applies the scheme default port when none is explicit (https -> 443)", () => {
    expect(proxyAuthKey("https://proxy.corp.example")).toBe("kilo.proxyAuth.https://proxy.corp.example:443")
  })

  it("prepends http:// to scheme-less input", () => {
    expect(proxyAuthKey("proxy.corp.example:3128")).toBe("kilo.proxyAuth.http://proxy.corp.example:3128")
    expect(proxyAuthKey("proxy.corp.example")).toBe("kilo.proxyAuth.http://proxy.corp.example:80")
  })

  it("returns null for malformed URLs and never throws", () => {
    expect(proxyAuthKey("http://")).toBeNull()
    expect(proxyAuthKey("")).toBeNull()
    expect(proxyAuthKey("://bad")).toBeNull()
    expect(proxyAuthKey("ht!tp://bad host")).toBeNull()
    expect(() => proxyAuthKey("http://")).not.toThrow()
    expect(() => proxyAuthKey("")).not.toThrow()
  })

  it("returns null for a non-http(s) scheme", () => {
    expect(proxyAuthKey("socks5://proxy.corp.example:1080")).toBeNull()
  })
})

describe("isProxyAuthKey", () => {
  it("is true for the kilo.proxyAuth. prefix", () => {
    expect(isProxyAuthKey("kilo.proxyAuth.http://example.com:80")).toBe(true)
    expect(isProxyAuthKey("kilo.proxyAuth.https://example.com:443")).toBe(true)
  })

  it("is false otherwise", () => {
    expect(isProxyAuthKey("proxyAuth.http://example.com:80")).toBe(false)
    expect(isProxyAuthKey("kilo.proxyauth.http://example.com")).toBe(false)
    expect(isProxyAuthKey("kilo.proxyAuthx")).toBe(false)
    expect(isProxyAuthKey("")).toBe(false)
  })
})

describe("hasEmbeddedCredentials", () => {
  it("is true when a username is present", () => {
    expect(hasEmbeddedCredentials("http://user@proxy.corp.example")).toBe(true)
  })

  it("is true when username and password are present", () => {
    expect(hasEmbeddedCredentials("http://user:secret@proxy.corp.example:8080")).toBe(true)
  })

  it("is false without credentials", () => {
    expect(hasEmbeddedCredentials("http://proxy.corp.example:8080")).toBe(false)
    expect(hasEmbeddedCredentials("proxy.corp.example")).toBe(false)
  })

  it("is false for a malformed URL", () => {
    expect(hasEmbeddedCredentials("http://")).toBe(false)
    expect(hasEmbeddedCredentials("not a url")).toBe(false)
  })
})

describe("parseCred", () => {
  it("parses the full mechanism shape", () => {
    const json = JSON.stringify({ mechanism: "digest", user: "alice", password: "s3cret" })
    expect(parseCred(json)).toEqual({ mechanism: "digest", user: "alice", password: "s3cret" })
  })

  it("defaults the mechanism to basic for the legacy { user, password } shape", () => {
    const json = JSON.stringify({ user: "alice", password: "s3cret" })
    expect(parseCred(json)).toEqual({ mechanism: "basic", user: "alice", password: "s3cret" })
  })

  it("returns null for invalid JSON", () => {
    expect(parseCred("not json")).toBeNull()
    expect(parseCred("{")).toBeNull()
    expect(parseCred("")).toBeNull()
  })

  it("returns null for a non-object payload", () => {
    expect(parseCred("42")).toBeNull()
    expect(parseCred('"a string"')).toBeNull()
    expect(parseCred("null")).toBeNull()
    expect(parseCred('["a"]')).toBeNull()
  })

  it("returns null for non-string user or mechanism", () => {
    expect(parseCred(JSON.stringify({ user: 123, password: "p" }))).toBeNull()
    expect(parseCred(JSON.stringify({ mechanism: 7, user: "u", password: "p" }))).toBeNull()
  })

  it("returns null for a missing or empty password", () => {
    expect(parseCred(JSON.stringify({ user: "u" }))).toBeNull()
    expect(parseCred(JSON.stringify({ user: "u", password: "" }))).toBeNull()
  })
})

describe("makeCred", () => {
  it("defaults the mechanism to basic when omitted", () => {
    expect(makeCred({ user: "alice", password: "s3cret" })).toBe(
      JSON.stringify({ mechanism: "basic", user: "alice", password: "s3cret" }),
    )
  })

  it("preserves an explicit mechanism", () => {
    expect(makeCred({ mechanism: "digest", user: "alice", password: "s3cret" })).toBe(
      JSON.stringify({ mechanism: "digest", user: "alice", password: "s3cret" }),
    )
  })

  it("round-trips through parseCred with the default mechanism", () => {
    const stored = makeCred({ user: "alice", password: "s3cret" })
    expect(parseCred(stored)).toEqual({ mechanism: "basic", user: "alice", password: "s3cret" })
  })

  it("round-trips through parseCred with an explicit mechanism", () => {
    const stored = makeCred({ mechanism: "digest", user: "alice", password: "s3cret" })
    expect(parseCred(stored)).toEqual({ mechanism: "digest", user: "alice", password: "s3cret" })
  })
})
