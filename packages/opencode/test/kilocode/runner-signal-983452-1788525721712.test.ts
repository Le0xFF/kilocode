const marker = process.env.KILO_TEST_RUNNER_PID_FILE
if (!marker) throw new Error("KILO_TEST_RUNNER_PID_FILE is required")
await Bun.write(marker, String(process.pid))
const parent = process.ppid
setInterval(() => process.ppid === parent || process.exit(1), 50)
await Bun.sleep(60_000)
