import { SUPPORTED_MECHANISMS, type ProxyCredentials } from "./types"

export class UnsupportedMechanismError extends Error {
  constructor(public readonly mechanism: string) {
    super(
      `Proxy auth mechanism "${mechanism}" is not supported. Supported mechanisms: ${SUPPORTED_MECHANISMS.join(", ")}.`,
    )
    this.name = "UnsupportedMechanismError"
  }
}

// In-memory singleton: credentials live in process memory only. Nothing here
// ever writes to process.env or to disk, and nothing ever logs the values.
let creds: ProxyCredentials | undefined

export namespace State {
  /**
   * Store credentials after validating the mechanism against
   * SUPPORTED_MECHANISMS; throws UnsupportedMechanismError otherwise.
   */
  export function set(next: ProxyCredentials) {
    if (!SUPPORTED_MECHANISMS.includes(next.mechanism)) throw new UnsupportedMechanismError(next.mechanism)
    creds = next
  }

  /** Forget stored credentials, restoring native environment proxy behavior. */
  export function clear() {
    creds = undefined
  }

  export function peek() {
    return creds
  }

  export function active() {
    return creds !== undefined
  }
}
