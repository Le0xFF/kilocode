import { Schema } from "effect"

export const ProxyAuthMechanism = Schema.Literals(["basic", "digest", "ntlm", "kerberos"])
export type ProxyAuthMechanism = Schema.Schema.Type<typeof ProxyAuthMechanism>

/**
 * Mechanism-tagged proxy credentials held in server process memory only.
 * `domain` is declared for the future Digest/NTLM backends; v1 ignores it.
 */
export interface ProxyCredentials {
  readonly mechanism: ProxyAuthMechanism
  readonly user?: string
  readonly password?: string
  readonly domain?: string
}

/**
 * Mechanisms the CLI can actually apply to a proxy right now. v1 ships Basic
 * auth only; `digest`, `ntlm`, and `kerberos` are declared so API clients can
 * send them and receive a clean 501 until a backend lands.
 */
export const SUPPORTED_MECHANISMS: readonly ProxyAuthMechanism[] = ["basic"]

/**
 * A pluggable backend that turns (target URL, environment proxy URL,
 * credentials) into a per-request proxy directive for Bun fetch's `proxy` init
 * option.
 *
 * v1 backends use only the `{ proxy }` form: a URL with embedded Basic
 * credentials. Future Digest/NTLM backends will need a custom-transport
 * executor that drives the proxy authentication handshake (challenge/response),
 * and Kerberos will need a native-handle transport; those extension points are
 * deliberately types-only in v1, with no dead plumbing.
 */
export interface ProxyAuthBackend {
  readonly mechanism: ProxyAuthMechanism
  route(targetUrl: string, proxyUrl: string, creds: ProxyCredentials): { proxy?: string | false }
}

export class MechanismNotImplementedError extends Schema.TaggedErrorClass<MechanismNotImplementedError>()(
  "MechanismNotImplementedError",
  {
    message: Schema.String,
    mechanism: ProxyAuthMechanism,
  },
  { httpApiStatus: 501 },
) {}

export class SnapshotBlockedError extends Schema.TaggedErrorClass<SnapshotBlockedError>()(
  "SnapshotBlockedError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}
