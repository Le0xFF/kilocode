const marker = process.env.KILO_TEST_RUNNER_PID_FILE
if (!marker) throw new Error("KILO_TEST_RUNNER_PID_FILE is required")
const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(60000)"], { stdout: "inherit", stderr: "inherit" })
await Bun.write(marker, String(child.pid))
await Bun.sleep(60_000)
