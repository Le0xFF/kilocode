// Local mirror of webview-ui/src/utils/session-activity.ts for the extension host.
// The host must not import from webview-ui (breaks tsc rootDir); keep semantics in sync.

export type Activity = "waiting" | "error" | "retry" | "busy" | "done" | "scheduled" | "idle"