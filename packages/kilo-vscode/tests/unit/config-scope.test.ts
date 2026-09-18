import { describe, expect, it } from "bun:test"
import { splitConfigByScope } from "../../webview-ui/src/utils/config-scope"

describe("splitConfigByScope", () => {
  it("keeps indexing configuration out of project config", () => {
    const split = splitConfigByScope({
      indexing: {
        enabled: true,
        provider: "ollama",
      },
    })

    expect(split.global).toEqual({ indexing: { enabled: true, provider: "ollama" } })
    expect(split.project).toEqual({})
  })

  it("writes indexing provider settings to global config", () => {
    const split = splitConfigByScope({
      indexing: {
        provider: "ollama",
      },
    })

    expect(split.global).toEqual({ indexing: { provider: "ollama" } })
    expect(split.project).toEqual({})
  })

  it("writes the image generation model setting to global config", () => {
    const split = splitConfigByScope({
      experimental: {
        image_generation_model: "openai/gpt-image-1",
      },
    })

    expect(split.global).toEqual({
      experimental: {
        image_generation_model: "openai/gpt-image-1",
      },
    })
    expect(split.project).toEqual({})
  })

  it("writes the shared agent board setting to global config", () => {
    const split = splitConfigByScope({
      shared_agent_board: true,
    })

    expect(split.global).toEqual({
      shared_agent_board: true,
    })
    expect(split.project).toEqual({})
  })
})
