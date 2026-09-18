import { describe, expect, it } from "bun:test"

import {
  canChangeProviderKey,
  disabledProviderOptions,
} from "../../webview-ui/src/components/settings/provider-visibility"

describe("canChangeProviderKey", () => {
  const item = { id: "vercel", name: "Vercel", models: {}, source: "config" as const }

  it("offers replacement for configured and stored built-in API keys", () => {
    expect(canChangeProviderKey(item, undefined, undefined)).toBe(true)
    expect(canChangeProviderKey({ ...item, source: "api" }, undefined, [{ type: "api", label: "API key" }])).toBe(true)
  })

  it("excludes environment, OAuth and unknown sources", () => {
    for (const source of ["env", "custom", undefined] as const) {
      expect(canChangeProviderKey({ ...item, source }, undefined, undefined)).toBe(false)
    }
  })

  it("excludes custom providers and local optional-key providers", () => {
    expect(canChangeProviderKey(item, { npm: "@ai-sdk/openai-compatible" }, undefined)).toBe(false)
    // kilocode_change - offline: only the localhost OpenAI-compatible providers keep an optional key
    for (const id of ["atomic-chat", "lmstudio"]) {
      expect(canChangeProviderKey({ ...item, id }, undefined, undefined)).toBe(false)
    }
  })

  it("excludes config keys that override a replacement stored key", () => {
    expect(canChangeProviderKey(item, { options: { apiKey: "configured" } }, undefined)).toBe(false)
    expect(canChangeProviderKey(item, { api_key: "configured" }, undefined)).toBe(false)
    expect(canChangeProviderKey(item, { models: {} }, undefined)).toBe(true)
  })

  it("excludes dialogs that select OAuth or require extra credentials", () => {
    expect(canChangeProviderKey(item, undefined, [])).toBe(false)
    expect(canChangeProviderKey(item, undefined, [{ type: "oauth", label: "Sign in" }])).toBe(false)
    expect(
      canChangeProviderKey(item, undefined, [
        { type: "api", label: "API key" },
        { type: "oauth", label: "Sign in" },
      ]),
    ).toBe(false)
    expect(
      canChangeProviderKey(item, undefined, [
        { type: "api", label: "Credentials", prompts: [{ type: "text", key: "project", message: "Project" }] },
      ]),
    ).toBe(false)
  })
})

describe("disabledProviderOptions", () => {
  it("excludes already disabled providers", () => {
    const options = disabledProviderOptions(
      {
        openai: { id: "openai", name: "OpenAI", env: [], models: {} },
        anthropic: { id: "anthropic", name: "Anthropic", env: [], models: {} },
      },
      ["openai"],
    )

    expect(options).toEqual([{ value: "anthropic", label: "Anthropic" }])
  })

  it("sorts options by provider name", () => {
    const options = disabledProviderOptions(
      {
        zed: { id: "zed", name: "Zed", env: [], models: {} },
        alpha: { id: "alpha", name: "Alpha", env: [], models: {} },
      },
      [],
    )

    expect(options).toEqual([
      { value: "alpha", label: "Alpha" },
      { value: "zed", label: "Zed" },
    ])
  })
})