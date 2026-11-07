import { installFetchWrapper } from "./fetch-wrapper"

/**
 * Install the proxy-auth fetch wrapper exactly once. Called from the CLI
 * startup hook (KiloCli.bootstrap) before any command handler runs, so the
 * wrapper precedes every fetch binding that later reads globalThis.fetch.
 */
export function initProxyAuth() {
  installFetchWrapper()
}
