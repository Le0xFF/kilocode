// Local mirror of webview-ui/src/utils/session-activity.ts for the extension host.
// The host must not import from webview-ui (breaks tsc rootDir); keep semantics in sync.

export type Activity = "waiting" | "error" | "retry" | "busy" | "done" | "idle"

const STATES: Activity[] = ["done", "busy", "retry", "error", "waiting"]

export function isActivity(value: unknown): value is Activity {
  return value === "idle" || (typeof value === "string" && STATES.includes(value as Activity))
}