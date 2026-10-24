import { describe, expect, test } from "bun:test"
import { kebabToTitleCase, parseResponse } from "../../src/kilocode/marketplace/api"

describe("marketplace catalog api", () => {
  test("parses json and yaml marketplace responses", () => {
    expect(parseResponse('{"items":[{"id":"x"}]}')).toEqual({ items: [{ id: "x" }] })
    expect(parseResponse("items:\n  - id: x\n")).toEqual({ items: [{ id: "x" }] })
  })

  test("formats kebab ids for skill display names", () => {
    expect(kebabToTitleCase("campaign-writer")).toBe("Campaign Writer")
  })
})
