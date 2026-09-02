import {
  DEFAULT_SPEECH_TO_TEXT_MODEL,
  SPEECH_TO_TEXT_MODELS,
  type SpeechToTextModelDef,
} from "../../../../src/speech-to-text/models"

type Cfg = {
  enabled_providers?: string[]
  disabled_providers?: string[]
  experimental?: {
    speech_to_text_model?: string
  }
}

export function hasSpeechToTextAccess(cfg: Cfg): boolean {
  return true
}

export function canUseSpeechToText(cfg: Cfg): boolean {
  return hasSpeechToTextAccess(cfg)
}

export function selectedSpeechToTextModel(
  cfg: Cfg,
  models: readonly SpeechToTextModelDef[] = SPEECH_TO_TEXT_MODELS,
): string {
  const id = cfg.experimental?.speech_to_text_model
  return models.find((model) => model.id === id)?.id ?? models[0]?.id ?? DEFAULT_SPEECH_TO_TEXT_MODEL.id
}
