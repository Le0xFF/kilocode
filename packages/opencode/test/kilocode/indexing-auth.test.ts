import { describe, expect, test } from "bun:test"
import { hasKiloIndexingAuth, resolveKiloIndexingAuth } from "../../src/kilocode/indexing-auth"

describe("Kilo indexing auth resolution", () => {
  test("detects auth from explicit indexing Kilo config", () => {
    const auth = resolveKiloIndexingAuth({
      config: { indexing: { kilo: { apiKey: "idx-token", baseUrl: "https://idx.test", organizationId: "org_idx" } } },
    })

    expect(auth).toEqual({ apiKey: "idx-token", baseUrl: "https://idx.test", organizationId: "org_idx" })
    expect(hasKiloIndexingAuth({ config: { indexing: { kilo: { apiKey: "idx-token" } } } })).toBe(true)
  })

  test("detects auth from provider config, provider state, auth storage, and env", () => {
    expect(
      resolveKiloIndexingAuth({ config: { provider: { kilo: { options: { apiKey: "cfg-token" } } } } }).apiKey,
    ).toBe("cfg-token")
    expect(resolveKiloIndexingAuth({ provider: { options: { kilocodeToken: "provider-token" } } }).apiKey).toBe(
      "provider-token",
    )
    expect(resolveKiloIndexingAuth({ auth: { type: "oauth", access: "oauth-token", accountId: "org_oauth" } })).toEqual(
      {
        apiKey: "oauth-token",
        organizationId: "org_oauth",
      },
    )
    expect(resolveKiloIndexingAuth({ env: { KILO_API_KEY: "env-token", KILO_ORG_ID: "org_env" } })).toEqual({
      apiKey: "env-token",
      organizationId: "org_env",
    })
  })
})
