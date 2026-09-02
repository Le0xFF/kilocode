import { describe, expect, it } from "bun:test"
import { parseSpeechToTextCatalog } from "../../src/speech-to-text/catalog"
import { DEFAULT_SPEECH_TO_TEXT_MODEL } from "../../src/speech-to-text/models"

describe("speech-to-text discovery", () => {
  it("parses local provider/model references from the backend catalog", () => {
    const models = parseSpeechToTextCatalog([
      {
        id: "fish-audio/transcribe-1",
        name: "fish-audio/transcribe-1",
      },
      {
        id: "openai/gpt-4o-mini-transcribe",
        name: "openai/gpt-4o-mini-transcribe",
      },
      {
        id: "whisper/whisper-1",
        name: "whisper/whisper-1",
      },
    ])

    expect(models).toEqual([
      { id: "fish-audio/transcribe-1", label: "transcribe-1", provider: "fish-audio" },
      { id: "openai/gpt-4o-mini-transcribe", label: "gpt-4o-mini-transcribe", provider: "openai" },
      { id: "whisper/whisper-1", label: "whisper-1", provider: "whisper" },
    ])
  })

  it("rejects empty or malformed catalogs so callers can use the static fallback", () => {
    expect(parseSpeechToTextCatalog([])).toBeUndefined()
    expect(parseSpeechToTextCatalog({ data: [] })).toBeUndefined()
    expect(DEFAULT_SPEECH_TO_TEXT_MODEL.id).toBe("nvidia/parakeet-tdt-0.6b-v3")
  })
})
