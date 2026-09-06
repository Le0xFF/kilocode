import { describe, expect, test } from "bun:test"
import { providerKey } from "@/kilocode/provider/cloud-auth"

describe("cloud provider auth", () => {
  // kilocode_change - bedrock/vertex structured-credential helpers removed with the online cloud surface;
  // providerKey keeps those access types out of the generic provider key while returning plain API keys.
  test("does not expose structured credentials as generic provider API keys", () => {
    expect(
      providerKey("amazon-bedrock", {
        type: "api",
        key: "AKIATEST",
        metadata: { authType: "accessKey", secretAccessKey: "secret" },
      }),
    ).toBeUndefined()
    expect(
      providerKey("google-vertex", {
        type: "api",
        key: JSON.stringify({
          type: "service_account",
          project_id: "test-project",
          client_email: "test@example.com",
          private_key: "private-key",
        }),
        metadata: { authType: "serviceAccount" },
      }),
    ).toBeUndefined()
    expect(providerKey("anthropic", { type: "api", key: "sk-test" })).toBe("sk-test")
  })

  test("returns undefined for non-api auth", () => {
    expect(
      providerKey("anthropic", {
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: 1,
      }),
    ).toBeUndefined()
  })
})