/**
 * Remote Session Relay TUI indicator
 *
 * RemoteIndicator component for the footer status bar. The remote session relay
 * is not available in this build, so the indicator never renders.
 */

import { Show } from "solid-js"
import type { Event } from "@kilocode/sdk/v2"

interface Props {
  sdk: any
  theme: any
  event: {
    on: <Type extends Event["type"]>(type: Type, handler: (event: Extract<Event, { type: Type }>) => void) => () => void
  }
}

export function RemoteIndicator(props: Props) {
  return <Show when={false}><text>◆</text></Show>
}