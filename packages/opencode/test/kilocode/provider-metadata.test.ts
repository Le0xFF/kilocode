import { describe, expect, test } from "bun:test"
import { providerMetadata } from "../../src/kilocode/provider/metadata"

describe("providerMetadata", () => {
  test("returns shared provider key, icon, and priority metadata", () => {
    expect(providerMetadata("openai")).toEqual({
      noteKey: "settings.providers.note.openai",
      icon: "openai",
      priority: 2,
    })
  })

  // kilocode_change - github-copilot left the surface with the online cloud cut; its id keeps the icon but loses note/priority
  test("maps copilot ids to icon-only metadata", () => {
    expect(providerMetadata("github-copilot-custom")).toEqual({
      icon: "github-copilot",
      noteKey: undefined,
      priority: undefined,
    })
  })

  test("uses the Kilo icon for the removed Kilo Gateway provider", () => {
    expect(providerMetadata("kilo")).toEqual({
      icon: "kilo",
      priority: undefined,
    })
  })

  test("falls back to synthetic icon for unknown providers", () => {
    expect(providerMetadata("unknown-provider")).toEqual({ icon: "synthetic" })
  })
})
