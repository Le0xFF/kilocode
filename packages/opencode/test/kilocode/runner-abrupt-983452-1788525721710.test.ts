const marker = process.env.KILO_TEST_RUNNER_PID_FILE
if (!marker) throw new Error("KILO_TEST_RUNNER_PID_FILE is required")
await Bun.write(marker, String(process.pid))
process.exit(1)
