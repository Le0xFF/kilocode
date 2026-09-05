// kilocode_change - bonjour-service dep removed; mDNS is inert (always no-op). The `--mdns` flag still parses but
// does nothing; restore a real implementation (or drop the flag) when network features are re-evaluated.
let currentPort: number | undefined

export function publish(port: number, _domain?: string) {
  if (currentPort === port) return
  currentPort = port
}

export function unpublish() {
  currentPort = undefined
}

export * as MDNS from "./mdns"