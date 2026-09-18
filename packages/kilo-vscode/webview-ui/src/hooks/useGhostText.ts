import { createSignal } from "solid-js"
import type { Accessor } from "solid-js"
import type { ExtensionMessage, WebviewMessage } from "../types/messages"

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

export interface GhostText {
  text: Accessor<string>
  enabled: Accessor<boolean>
  /** Idempotent sync — call from any handler to reconcile ghost text visibility. */
  sync: (textarea: HTMLTextAreaElement | undefined) => void
  /** Schedule a completion request after debounce. Call on every input. */
  scheduleRequest: (val: string, textarea: HTMLTextAreaElement | undefined) => void
  /** Accept the full ghost text suggestion. */
  accept: () => { text: string } | null
  /** Dismiss the current ghost text. */
  dismiss: () => void
  /** Whether the mention dropdown is open (suppresses ghost text). */
  setMentionOpen: (open: boolean) => void
}

// kilocode_change - offline: chat-completion / autocomplete settings messages were removed with the FIM surface,
// so ghost text is inert. All methods are no-ops that preserve the call-site contract without posting those messages.
export function useGhostText(_vscode: VSCodeContext, _getText: () => string, _connected: () => boolean): GhostText {
  const [ghost] = createSignal("")
  const [enabled] = createSignal(false)

  const noop = () => {}

  return {
    text: ghost,
    enabled,
    sync: noop,
    scheduleRequest: noop,
    accept: () => null,
    dismiss: noop,
    setMentionOpen: noop,
  }
}