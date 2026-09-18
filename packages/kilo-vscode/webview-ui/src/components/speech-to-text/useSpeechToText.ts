import { createSignal, onCleanup } from "solid-js"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { Accessor } from "solid-js"
import type { ExtensionMessage, WebviewMessage } from "../../types/messages"

type VSCode = {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

export type SpeechState = "idle" | "starting" | "recording" | "transcribing" | "error"

type Lang = {
  t: (key: string) => string
}

export type InsertTranscript = (text: string) => void

type StartOptions = {
  model: string
  insert: InsertTranscript
}

type StopOptions = {
  done?: () => void
  ready?: () => boolean
}

export type SpeechToText = {
  state: Accessor<SpeechState>
  error: Accessor<string | undefined>
  active: Accessor<boolean>
  start: (opts: StartOptions) => void
  stop: (opts?: StopOptions) => void
  cancel: () => void
  clear: () => void
}

// Upstream v7.7.4 extended the hook with a server param (unused by the offline
// webview, which drives STT through vscode message round-trips); the extra arg
// is accepted and ignored so call sites keep their upstream arity.
export function useSpeechToText(vscode: VSCode, _server?: unknown, lang?: Lang): SpeechToText
export function useSpeechToText(vscode: VSCode, lang: Lang): SpeechToText
export function useSpeechToText(
  vscode: VSCode,
  langOrServer: Lang | unknown,
  maybeLang?: Lang,
): SpeechToText {
  const lang = typeof (langOrServer as Lang)?.t === "function" ? (langOrServer as Lang) : (maybeLang as Lang)
  const [state, setState] = createSignal<SpeechState>("idle")
  const [error, setError] = createSignal<string | undefined>()
  const active = () => state() === "starting" || state() === "recording" || state() === "transcribing"
  const prefix = globalThis.crypto?.randomUUID?.() ?? `stt-${Math.random().toString(36).slice(2)}`

  let request = ""
  let counter = 0
  let insert: InsertTranscript | undefined
  let done: (() => void) | undefined
  let ready: (() => boolean) | undefined
  let pending = false

  const unsub = vscode.onMessage((msg) => {
    if (!isSpeechMessage(msg)) return
    if (msg.requestId !== request) return

    if (msg.type === "speechToTextStarted") {
      if (state() !== "starting") return
      setState("recording")
      if (pending) transcribe()
      return
    }

    if (msg.type === "speechToTextCancelled") {
      cleanup()
      setState("idle")
      setError(undefined)
      return
    }

    if (msg.type === "speechToTextError") {
      if (msg.code === "not_authenticated") {
        login()
        return
      }
      fail(msg.error)
      return
    }

    const text = msg.text.trim()
    if (!text) {
      fail(lang.t("speechToText.error.emptyTranscript"))
      return
    }

    const next = ready?.() === false ? undefined : done
    insert?.(text)
    cleanup()
    setState("idle")
    setError(undefined)
    next?.()
  })

  onCleanup(() => {
    unsub()
    cancel()
  })

  function start(opts: StartOptions) {
    if (active()) return
    insert = opts.insert
    setError(undefined)

    counter++
    request = `${prefix}-${counter}`
    setState("starting")
    vscode.postMessage({
      type: "speechToTextStart",
      requestId: request,
      model: opts.model,
      language: langCode(),
    })
  }

  function stop(opts?: StopOptions) {
    if (state() !== "starting" && state() !== "recording") return
    done = opts?.done
    ready = opts?.ready
    if (state() === "starting") {
      pending = true
      return
    }
    transcribe()
  }

  function transcribe() {
    pending = false
    setState("transcribing")
    vscode.postMessage({ type: "speechToTextStop", requestId: request })
  }

  function cancel() {
    if (request && active()) vscode.postMessage({ type: "speechToTextCancel", requestId: request })
    cleanup()
    setState("idle")
    setError(undefined)
  }

  function clear() {
    if (state() !== "error") return
    cleanup()
    setState("idle")
    setError(undefined)
  }

  function login() {
    const message = lang.t("speechToText.error.loginRequired")
    // kilocode_change - offline: device-flow sign-in is inert, so the action falls back to dismiss
    showToast({
      variant: "error",
      title: message,
      actions: [
        { label: lang.t("common.signIn"), onClick: "dismiss" },
        { label: lang.t("common.dismiss"), onClick: "dismiss" },
      ],
    })
    fail(message, false)
  }

  function fail(message: string, toast = true) {
    cleanup()
    setState("error")
    setError(message)
    if (toast) showToast({ variant: "error", title: lang.t("speechToText.error.title"), description: message })
  }

  function cleanup() {
    request = ""
    insert = undefined
    done = undefined
    ready = undefined
    pending = false
  }

  return { state, error, active, start, stop, cancel, clear }
}

function isSpeechMessage(
  msg: ExtensionMessage,
): msg is Extract<
  ExtensionMessage,
  { type: "speechToTextStarted" | "speechToTextCancelled" | "speechToTextResult" | "speechToTextError" }
> {
  return (
    msg.type === "speechToTextStarted" ||
    msg.type === "speechToTextCancelled" ||
    msg.type === "speechToTextResult" ||
    msg.type === "speechToTextError"
  )
}

function langCode() {
  return (navigator.language || "en").split("-")[0] || "en"
}
