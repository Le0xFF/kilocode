import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, test } from "bun:test"
import { State, installFetchWrapper, restoreFetch } from "../../src/kilocode/proxy-auth"

const envKeys = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY", "no_proxy", "NO_PROXY"]
const savedEnv: Record<string, string | undefined> = {}

let proxy: ReturnType<typeof Bun.serve>
let target: ReturnType<typeof Bun.serve>
let seen: Array<{ url: string; auth: string | null }>
let expected: string | null

beforeAll(() => {
  for (const key of envKeys) savedEnv[key] = process.env[key]
  seen = []
  proxy = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const auth = request.headers.get("proxy-authorization")
      seen.push({ url: request.url, auth })
      if (auth === expected) return new Response("proxied")
      return new Response("proxy rejected", { status: 407 })
    },
  })
  target = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("direct"),
  })
  process.env.HTTP_PROXY = proxy.url.href
  process.env.HTTPS_PROXY = proxy.url.href
  delete process.env.NO_PROXY
  delete process.env.no_proxy
  installFetchWrapper()
})

beforeEach(() => {
  seen = []
  expected = null
  State.clear()
})

afterEach(() => {
  State.clear()
})

afterAll(async () => {
  State.clear()
  restoreFetch()
  await proxy.stop(true)
  await target.stop(true)
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe("proxy-auth fetch wrapper", () => {
  test("with no credentials the wrapper is a pass-through and the environment proxy applies natively", async () => {
    const response = await fetch("http://target.invalid/api")
    expect(response.status).toBe(200)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.auth).toBeNull()
  })

  test("with basic credentials the proxy receives the Basic Proxy-Authorization header", async () => {
    State.set({ mechanism: "basic", user: "proxyuser", password: "s3cret" })
    expected = "Basic " + Buffer.from("proxyuser:s3cret").toString("base64")
    const response = await fetch("http://target.invalid/api")
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("proxied")
    expect(seen).toHaveLength(1)
    expect(seen[0]?.auth).toBe(expected)
  })

  test("loopback targets connect directly even though the environment proxies everything", async () => {
    State.set({ mechanism: "basic", user: "proxyuser", password: "s3cret" })
    expected = "Basic " + Buffer.from("proxyuser:s3cret").toString("base64")
    const response = await fetch(`http://127.0.0.1:${target.port}/`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("direct")
    expect(seen).toHaveLength(0)
  })

  test("clearing credentials restores the native environment proxy behavior", async () => {
    State.set({ mechanism: "basic", user: "proxyuser", password: "s3cret" })
    expected = null
    State.clear()
    const response = await fetch("http://target.invalid/api")
    expect(response.status).toBe(200)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.auth).toBeNull()
  })

  test("log output never contains the raw or percent-encoded password", async () => {
    const raw = "p@ss wörd"
    const encoded = "p%40ss%20w%C3%B6rd"
    State.set({ mechanism: "basic", user: "proxyuser", password: raw })
    expected = "Basic " + Buffer.from(`proxyuser:${raw}`).toString("base64")
    const chunks: string[] = []
    const write = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }) as typeof write
    try {
      const response = await fetch("http://target.invalid/secret-path")
      expect(response.status).toBe(200)
    } finally {
      process.stderr.write = write
    }
    const output = chunks.join("")
    expect(output).not.toContain(raw)
    expect(output).not.toContain(encoded)
  })
})
