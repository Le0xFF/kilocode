// kilocode_change - offline telemetry stub: PostHog/OTel telemetry was removed with the kilo-telemetry package, so the
// proxy is a no-op singleton that preserves the call sites without any network activity.

export enum TelemetryEventName {
  Unknown = "unknown",
}

export class TelemetryProxy {
  private static instance: TelemetryProxy | null = null

  static getInstance(): TelemetryProxy {
    if (!this.instance) this.instance = new TelemetryProxy()
    return this.instance
  }

  configure(_baseUrl: string, _password?: string): void {}

  setEnabled(_enabled: boolean): void {}

  event(_name: TelemetryEventName, _props?: Record<string, unknown>): void {}

  shutdown(): void {
    TelemetryProxy.instance = null
  }
}