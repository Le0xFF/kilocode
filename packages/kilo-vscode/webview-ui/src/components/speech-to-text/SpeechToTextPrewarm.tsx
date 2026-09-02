import { createEffect, type Component } from "solid-js"
import { useConfig } from "../../context/config"
import { getVSCodeAPI } from "../../context/vscode"
import { canUseSpeechToText } from "./availability"

export const SpeechToTextPrewarm: Component = () => {
  const vscode = getVSCodeAPI()
  const { config } = useConfig()
  let prepared = false

  createEffect(() => {
    if (prepared || !canUseSpeechToText(config())) return
    prepared = true
    vscode.postMessage({ type: "speechToTextPrewarm" })
  })

  return null
}
