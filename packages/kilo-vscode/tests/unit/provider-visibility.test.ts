import { describe, expect, it } from "bun:test"

import { disabledProviderOptions } from "../../webview-ui/src/components/settings/provider-visibility"

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