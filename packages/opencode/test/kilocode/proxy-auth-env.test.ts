import { afterEach, describe, expect, test } from "bun:test"
import { State, installFetchWrapper, restoreFetch } from "../../src/kilocode/proxy-auth"

const envKeys = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY", "no_proxy", "NO_PROXY"]

afterEach(() => {
  State.clear()
})

describe("proxy-auth environment cleanliness", () => {
  test("storing credentials injects nothing into process.env or child process environments", async () => {
    const password = "env-cleanliness-secret"
    State.set({ mechanism: "basic", user: "envuser", password })
    installFetchWrapper()

    const parent: Record<string, string> = {}
    for (const key of envKeys) {
      const value = process.env[key]
      if (value !== undefined) parent[key] = value
    }

    const probe = `
      const names = ${JSON.stringify(envKeys)}
      const out = Object.fromEntries(Object.entries(process.env).filter(([key]) => names.includes(key)))
      process.stdout.write(JSON.stringify(out))
    `
    const child = Bun.spawn({ cmd: ["bun", "-e", probe], stdout: "pipe", stderr: "pipe" })
    const output = await new Response(child.stdout).text()
    const code = await child.exited
    restoreFetch()
    expect(code).toBe(0)

    const inherited: unknown = JSON.parse(output)
    // The child's proxy environment must be exactly what the test process had:
    // nothing added, nothing rewritten by the proxy-auth state.
    expect(inherited).toEqual(parent)

    const dump = JSON.stringify(inherited)
    expect(dump).not.toContain(password)
    expect(dump).not.toContain(encodeURIComponent(password))
  })
})
