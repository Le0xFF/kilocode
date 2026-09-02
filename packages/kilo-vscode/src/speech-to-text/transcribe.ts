import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import { getErrorMessage } from "../kilo-provider-utils"

type Req = {
  model?: string
  data: string
  format: string
  language?: string
}

type Ok = {
  ok: true
  text: string
}

type Err = {
  ok: false
  error: string
  code?: string
}

export type SpeechToTextResult = Ok | Err

export async function transcribeSpeech(
  connection: KiloConnectionService,
  input: Req,
  dir: string,
  signal?: AbortSignal,
): Promise<SpeechToTextResult> {
  const client = connection.getClient()
  try {
    const { data, error } = await client.mediaLocal.stt.transcribe(
      {
        directory: dir || undefined,
        model: input.model ?? "",
        audio: input.data,
        format: input.format,
        ...(input.language ? { language: input.language } : {}),
      },
      { throwOnError: false, signal },
    )

    if (error) {
      const msg = getErrorMessage(error) || "Speech to text failed"
      return { ok: false, error: msg, code: isNotConnected(msg) ? "not_connected" : undefined }
    }
    if (!data || typeof data.text !== "string") {
      return { ok: false, error: "No speech was detected", code: "empty_transcript" }
    }
    const text = data.text.trim()
    if (!text) return { ok: false, error: "No speech was detected", code: "empty_transcript" }
    return { ok: true, text }
  } catch (err) {
    if (signal?.aborted) return { ok: false, error: "Speech transcription cancelled", code: "cancelled" }
    const msg = getErrorMessage(err) || "Speech to text request failed"
    return { ok: false, error: msg, code: msg === "Failed to fetch" ? "not_available" : undefined }
  }
}

function isNotConnected(message: string): boolean {
  return message.toLowerCase().includes("connect")
}