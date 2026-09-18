// kilocode_change - new file
// Pure shutdown sequence for the embedded TUI worker. Extracted so unit tests can
// assert dispose → stopServer ordering without loading worker.ts side effects.
export function createWorkerShutdown(input: {
  dispose: () => Promise<void>
  stopServer: () => Promise<void>
}) {
  return async () => {
    await input.dispose()
    await input.stopServer()
  }
}
