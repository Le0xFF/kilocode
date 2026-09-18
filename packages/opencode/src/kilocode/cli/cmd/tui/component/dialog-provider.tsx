/**
 * Kilo-specific overrides for the provider dialog.
 *
 * Exports constants and renderers consumed by the shared upstream
 * `dialog-provider.tsx` so the upstream diff stays minimal.
 */

import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
export { selectProvider } from "@/kilocode/anaconda-desktop/tui/setup"

// ---------------------------------------------------------------------------
// Failed-state gutter/description helpers
// ---------------------------------------------------------------------------

/**
 * Returns a red `!` gutter element when the provider is in a failed auth state,
 * or `undefined` if not failed and not connected (falls through to default check).
 */
export function renderGutter(
  providerID: string,
  failed: string[],
  theme: { error: RGBA },
): (() => JSX.Element) | undefined {
  if (!failed.includes(providerID)) return undefined
  return () => <text fg={theme.error}>!</text>
}

/**
 * Returns a description suffix when the provider has encountered an error,
 * or `undefined` to leave the default description unchanged.
 *
 * NOTE: The sync state only carries failed provider IDs, not the error kind.
 * A generic message is used so it remains accurate for auth, network, and
 * schema failure types alike.
 */
export function failedDescription(providerID: string, failed: string[]): string | undefined {
  if (!failed.includes(providerID)) return undefined
  return "(connection error — click to reconnect)"
}

// ---------------------------------------------------------------------------
// Provider priority (replaces upstream map entirely)
// ---------------------------------------------------------------------------

export const PROVIDER_PRIORITY: Record<string, number> = {
  lmstudio: 0,
  "atomic-chat": 1,
  "privatemode-ai": 2,
  "anaconda-desktop": 3,
  openai: 4,
  anthropic: 5,
}

// ---------------------------------------------------------------------------
// Provider descriptions shown next to the name in the selection list
// ---------------------------------------------------------------------------

export const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  lmstudio: "(Local models)",
  "atomic-chat": "(Local models)",
  "privatemode-ai": "(Local models)",
  "anaconda-desktop": "(Local models)",
  openai: "(API key)",
  anthropic: "(API key)",
}

export const PROVIDER_TITLES: Record<string, string> = {}

/** Local OpenAI-compatible providers where API key is optional (localhost). */
export const LOCAL_OPTIONAL_API_KEY = new Set(["atomic-chat", "lmstudio"])

export function isLocalOptionalApiKey(providerID: string) {
  return LOCAL_OPTIONAL_API_KEY.has(providerID)
}

export const LOCAL_API_KEY_PLACEHOLDER = "local"

// ---------------------------------------------------------------------------
// API-key dialog description
// ---------------------------------------------------------------------------

/**
 * Returns a custom description element for the API-key dialog when the
 * provider supports a local server. Returns `undefined` otherwise.
 */
export function renderApiDescription(
  providerID: string,
  theme: { textMuted: RGBA; text: RGBA; primary: RGBA },
): (() => JSX.Element) | undefined {
  if (providerID === "atomic-chat") {
    return () => (
      <text fg={theme.textMuted}>
        Connect to Atomic Chat on this machine (default http://127.0.0.1:1337). Leave API key empty for local server.
      </text>
    )
  }
  return undefined
}

export function apiKeyPlaceholder(providerID: string) {
  return isLocalOptionalApiKey(providerID) ? "Optional for localhost" : "API key"
}