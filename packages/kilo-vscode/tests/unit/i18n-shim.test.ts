import { describe, it, expect } from "bun:test"
import { resolveLocale, selectedLocale, t, translate } from "../../src/services/i18n"

describe("extension host i18n", () => {
  it("falls back to the key itself when the dictionary has no entry", () => {
    // The extension-host dictionary is empty after the online-services removal
    // (its only entries were autocomplete status-bar strings), so a lookup of
    // any key returns the key unchanged.
    const result = t("settings.notifications.sounds")
    expect(result).toBe("settings.notifications.sounds")
  })

  it("returns the key itself for unknown key", () => {
    expect(t("nonexistent.key.that.does.not.exist")).toBe("nonexistent.key.that.does.not.exist")
  })

  it("returns empty string for empty key", () => {
    expect(t("")).toBe("")
  })

  it("interpolates variables into a resolved template", () => {
    // translate() looks up the (empty) host dict, falls back to the key, then
    // applies `{{var}}` substitution over whatever text it produced.
    const result = translate("de", "{{count}} items", { count: "5" })
    expect(result).toBe("5 items")
    expect(result).not.toContain("{{")
  })

  it("leaves unreferenced vars intact in template", () => {
    const result = translate("de", "keep {{providers}}", { unrelated: "value" })
    expect(result).toContain("{{providers}}")
  })

  it("resolves supported locale variants", () => {
    expect(resolveLocale("de-DE")).toBe("de")
    expect(resolveLocale("pt-BR")).toBe("br")
    expect(resolveLocale("nb-NO")).toBe("no")
    expect(resolveLocale("zh-CN")).toBe("zh")
    expect(resolveLocale("zh-Hant")).toBe("zht")
    expect(resolveLocale("zh-TW")).toBe("zht")
  })

  it("falls back to English for unsupported locales", () => {
    expect(resolveLocale("sv-SE")).toBe("en")
  })

  it("prefers Kilo new language setting over VS Code language", () => {
    const vscode = {
      env: { language: "en" },
      workspace: {
        getConfiguration: (section: string) => ({
          get: () => (section === "kilo-code.new" ? "de" : undefined),
        }),
      },
    } as unknown as typeof import("vscode")

    expect(selectedLocale(vscode)).toBe("de")
  })

  it("uses VS Code language when Kilo language setting is automatic", () => {
    const vscode = {
      env: { language: "nl" },
      workspace: {
        getConfiguration: () => ({
          get: () => undefined,
        }),
      },
    } as unknown as typeof import("vscode")

    expect(selectedLocale(vscode)).toBe("nl")
  })
})