// kilocode_change - offline speech-to-text catalog stub: the local media surface exposes no /media-local/speech endpoint,
// so model discovery degrades to the empty catalog (speech input stays available for users that wire a local recognizer).

export type SpeechToTextModel = {
  id: string
  name: string
  description?: string
}

export type SpeechToTextModelsResult = { ok: true; models: SpeechToTextModel[] } | { ok: false; error: string }

export async function fetchSpeechToTextModels(): Promise<SpeechToTextModelsResult> {
  return { ok: true, models: [] }
}