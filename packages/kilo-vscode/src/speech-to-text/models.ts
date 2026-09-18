// kilocode_change - offline speech-to-text model catalog: empty by default; the local surface has no hosted speech models.
export interface SpeechToTextModelDef {
  readonly id: string
  readonly label?: string
  readonly provider?: string
  readonly verbatim?: boolean
}

const models: SpeechToTextModelDef[] = []

export const SPEECH_TO_TEXT_MODELS: readonly SpeechToTextModelDef[] = models
export const DEFAULT_SPEECH_TO_TEXT_MODEL: SpeechToTextModelDef = models[0] ?? { id: "" }

export function getSpeechToTextModel(id: string | undefined): SpeechToTextModelDef {
  if (id) {
    const found = models.find((model) => model.id === id)
    if (found) return found
  }
  return DEFAULT_SPEECH_TO_TEXT_MODEL
}