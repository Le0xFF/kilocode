import os from "os"
import path from "path"

const root = path.resolve(__dirname, "..")
const argv = process.argv.slice(2)

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    [
      "",
      "Usage: bun run script/run-unit-tests.ts [options] [patterns...]",
      "",
      "Runs unit test files in isolated parallel processes with a RAM-aware concurrency cap.",
      "",
      "Options:",
      "  --concurrency <N>    Max parallel processes (default: min(4, CPU count); on Linux further capped by available RAM, ~2GB per worker)",
      "  --timeout <ms>       Per-test timeout passed to bun test (default: 300000)",
      "  --shard <I/N>        Run one balanced file shard (env: KILO_TEST_SHARD)",
      "  --update-timings     After a full run, merge measured durations into test-unit-timings.json",
      "  --bail               Stop on first failure",
      "  --verbose            Show output for every file inline",
      "  --pattern <substr>   Filter test files by substring match",
      "  -h, --help           Show this help",
      "",
      "Environment:",
      "  KILO_TEST_CONCURRENCY    Override the concurrency cap",
      "  KILO_TEST_FILE_TIMEOUT   Per-file kill deadline in ms (default: 300000)",
      "  KILO_TEST_MEM_AVAILABLE_MB  Simulate available RAM in MB (testing knob)",
      "  KILO_TEST_SHARD          Shard selection as I/N",
      "",
    ].join("\n"),
  )
  process.exit(0)
}

function opt(name: string, fallback: number) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? Number(argv[i + 1]) || fallback : fallback
}

function text(name: string) {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return undefined
  const value = argv[i + 1]
  if (value && !value.startsWith("-")) return value
  console.error(`Missing value for --${name}`)
  process.exit(2)
}

const bail = argv.includes("--bail")
const updateTimings = argv.includes("--update-timings")
const verbose = argv.includes("--verbose")
const dots = !verbose

const intEnv = (name: string, label: string) => {
  const raw = process.env[name]?.trim()
  if (!raw) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    console.error(`Invalid ${label} "${raw}"; expected a positive integer`)
    process.exit(2)
  }
  return value
}

const concurrencyFlag = (() => {
  const i = argv.indexOf("--concurrency")
  if (i < 0) return undefined
  const value = Number(argv[i + 1])
  if (!Number.isSafeInteger(value) || value < 1) {
    console.error(`Invalid --concurrency "${argv[i + 1]}"; expected a positive integer`)
    process.exit(2)
  }
  return value
})()
const concurrencyEnv = intEnv("KILO_TEST_CONCURRENCY", "KILO_TEST_CONCURRENCY")
const memEnv = process.env.KILO_TEST_MEM_AVAILABLE_MB?.trim()
const memAvailableMB = memEnv !== undefined ? Number(memEnv) : await (async () => {
  try {
    const info = await Bun.file("/proc/meminfo").text()
    const match = info.match(/^MemAvailable:\s+(\d+)\s+kB$/m)
    if (!match) return NaN
    return Number(match[1]) / 1024
  } catch {
    return NaN
  }
})()
const ramCap =
  process.platform === "linux" && Number.isFinite(memAvailableMB) && memAvailableMB >= 100
    ? Math.max(1, Math.floor(memAvailableMB / 2048))
    : undefined
const effectiveDefault =
  ramCap === undefined ? Math.min(4, os.availableParallelism()) : Math.min(Math.min(4, os.availableParallelism()), ramCap)
const concurrency = concurrencyFlag ?? concurrencyEnv ?? effectiveDefault
if (ramCap !== undefined && !concurrencyFlag && !concurrencyEnv && ramCap < 4) {
  console.log(`RAM-based cap: ${Math.floor(memAvailableMB)}MB available limits default concurrency to ${ramCap}`)
}

const timeoutEnv = intEnv("KILO_TEST_FILE_TIMEOUT", "KILO_TEST_FILE_TIMEOUT")
const fileTimeout = opt("timeout", timeoutEnv ?? 300000)
const patternFlag = text("pattern")
const patternEnv = process.env.KILO_TEST_PATTERN?.trim() || undefined
if (patternFlag && patternEnv && patternFlag !== patternEnv) {
  console.error(`Conflicting patterns: --pattern=${patternFlag}, KILO_TEST_PATTERN=${patternEnv}`)
  process.exit(2)
}
const pattern = patternFlag ?? patternEnv

const shardFlag = text("shard")
const shardEnv = process.env.KILO_TEST_SHARD?.trim() || undefined
if (shardFlag && shardEnv && shardFlag !== shardEnv) {
  console.error(`Conflicting test shards: --shard=${shardFlag}, KILO_TEST_SHARD=${shardEnv}`)
  process.exit(2)
}
const parseShard = (raw: string | undefined) => {
  if (!raw) return undefined
  const match = raw.match(/^(\d+)\/(\d+)$/)
  if (!match) return { error: `Invalid shard "${raw}"; expected I/N` }
  const index = Number(match[1])
  const total = Number(match[2])
  if (index < 1 || index > total) return { error: `Invalid shard "${raw}"; index must be within 1..total` }
  return { value: { index, total } }
}
const parsed = parseShard(shardFlag ?? shardEnv)
let shard: { index: number; total: number } | undefined
if (parsed !== undefined && "error" in parsed) {
  console.error(parsed.error)
  process.exit(2)
} else if (parsed !== undefined) {
  shard = parsed.value
}

const valued = new Set(["--concurrency", "--timeout", "--shard", "--pattern"])
const positional = argv.filter((arg, i) => {
  if (arg.startsWith("-")) return false
  if (i > 0 && valued.has(argv[i - 1])) return false
  return true
})
const patterns = [...new Set(pattern ? [pattern] : [])].concat(positional)

const tty = !!process.stdout.isTTY
const green = (s: string) => (tty ? `\x1b[32m${s}\x1b[0m` : s)
const red = (s: string) => (tty ? `\x1b[31m${s}\x1b[0m` : s)
const yellow = (s: string) => (tty ? `\x1b[33m${s}\x1b[0m` : s)
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s)
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s)

// ---------------------------------------------------------------------------
// Discovery and weighting
// ---------------------------------------------------------------------------

type TimingsEnvelope = { version?: unknown; files?: Record<string, number> }

const timingsPath = path.join(root, "test-unit-timings.json")
const envelope = await Bun.file(timingsPath)
  .json<TimingsEnvelope>()
  .catch(() => ({ files: {} }))
const timings = envelope.files ?? {}

const glob = new Bun.Glob("**/*.test.{ts,tsx}")
const all = (await Array.fromAsync(glob.scan({ cwd: path.join(root, "tests/unit") })))
  .map((file) => file.replaceAll("\\", "/"))
  .filter((file) => !file.endsWith(".spec.ts"))
  .sort()

const selected = patterns.length > 0 ? all.filter((file) => patterns.some((p) => file.includes(p))) : all

const weightCache = new Map<string, number>()
const weight = (file: string) => {
  const cached = weightCache.get(file)
  if (cached !== undefined) return cached
  const value = timings[`tests/unit/${file}`] ?? Bun.file(path.join(root, "tests", "unit", file)).size
  weightCache.set(file, value)
  return value
}

function splitLPT(files: string[], weights: (file: string) => number, n: number): string[][] {
  const sorted = [...files].sort((a, b) => weights(b) - weights(a))
  const shards = Array.from({ length: n }, () => [] as string[])
  const loads = new Array(n).fill(0)
  for (const file of sorted) {
    const idx = loads.indexOf(Math.min(...loads))
    shards[idx].push(file)
    loads[idx] += weights(file)
  }
  return shards
}

if (shard && shard.total > selected.length) {
  console.error(`Test shard count ${shard.total} exceeds selected file count ${selected.length}`)
  process.exit(2)
}

const files = shard ? splitLPT(selected, weight, shard.total)[shard.index - 1] : [...selected].sort((a, b) => weight(b) - weight(a))

if (files.length === 0) {
  console.log("No test files found")
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Result = {
  file: string
  passed: boolean
  code: number
  stdout: string
  stderr: string
  duration: number
  timedout: boolean
  attempts: number
}

type Proc = ReturnType<typeof Bun.spawn>

// ---------------------------------------------------------------------------
// Execution helpers
// ---------------------------------------------------------------------------

const counter = { done: 0 }
const pad = String(files.length).length
const progress = { width: 80 }
const active = new Map<number, Proc>()
const stopping = { promise: undefined as Promise<void> | undefined }
const stopped = { value: false }
const marks = {
  pass: ".",
  retry: "R",
  fail: "F",
  timeout: "T",
} as const
const legend = `Legend: ${marks.pass}=pass ${marks.retry}=pass-after-retry ${marks.fail}=fail ${marks.timeout}=timeout`

function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const promise = (async () => {
    let text = ""
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return text + decoder.decode()
      text += decoder.decode(chunk.value, { stream: true })
    }
  })()
  return {
    promise,
    close: () => reader.cancel().catch(() => undefined),
  }
}

async function signal(proc: Proc, sig: "SIGTERM" | "SIGKILL") {
  if (process.platform === "win32") {
    const args = ["/pid", String(proc.pid), "/T"]
    if (sig === "SIGKILL") args.push("/F")
    const kill = Bun.spawn(["taskkill", ...args], {
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
    })
    await kill.exited
    return
  }
  for (const target of [-proc.pid, proc.pid]) {
    try {
      process.kill(target, sig)
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH") continue
      console.error(`warn: failed to signal ${target} with ${sig}:`, error)
    }
  }
}

async function terminate(proc: Proc) {
  if (proc.exitCode !== null) return
  await signal(proc, "SIGTERM")
  const exited = Symbol("exited")
  const result = await Promise.race([proc.exited.then(() => exited), Bun.sleep(3_000)])
  if (result === exited) return
  await signal(proc, "SIGKILL")
  await Promise.race([proc.exited, Bun.sleep(3_000)])
}

function finish(proc: Proc) {
  const promise = (async () => {
    await Promise.race([proc.exited, Bun.sleep(2_000)])
  })().finally(() => {
    active.delete(proc.pid)
  })
  return promise
}

function shutdown(code: number) {
  if (stopping.promise) return stopping.promise
  stopping.promise = (async () => {
    stopped.value = true
    const children = [...active.values()]
    await Promise.all(children.map(terminate))
    await Promise.all(children.map(finish))
    process.exit(code)
  })()
  return stopping.promise
}

process.once("SIGINT", () => void shutdown(130))
process.once("SIGTERM", () => void shutdown(143))

async function run(file: string): Promise<Result> {
  const start = performance.now()
  const killed = { value: false }

  const proc = Bun.spawn(["bun", "test", file, "--timeout", String(fileTimeout)], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    detached: process.platform !== "win32",
    // Bun does not honor NODE_OPTIONS=--max-old-space-size (verified: a 64MB cap
    // allows ~100MB allocations to succeed silently), so the RAM-based
    // concurrency cap above is the primary anti-OOM guardrail.
  })
  active.set(proc.pid, proc)

  const stdout = drain(proc.stdout)
  const stderr = drain(proc.stderr)
  const code = await Promise.race([
    proc.exited.then((value) => ({ timedout: false, value })),
    Bun.sleep(fileTimeout).then(() => ({ timedout: true, value: -1 })),
  ]).then(async (result) => {
    if (result.timedout) {
      killed.value = true
      await terminate(proc)
    }
    await finish(proc)
    return result.timedout ? (proc.exitCode ?? result.value) : result.value
  })
  const output = await Promise.race([
    Promise.all([stdout.promise, stderr.promise]).then((value) => ({ closed: true, value })),
    Bun.sleep(2_000).then(() => ({ closed: false, value: ["", ""] as [string, string] })),
  ]).then(async (result) => {
    if (result.closed) return result.value
    await signal(proc, "SIGKILL")
    await Promise.all([stdout.close(), stderr.close()])
    return Promise.all([stdout.promise, stderr.promise])
  })

  return {
    file,
    passed: code === 0,
    code,
    stdout: output[0],
    stderr: output[1],
    duration: performance.now() - start,
    timedout: killed.value,
    attempts: 1,
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function mark(result: Result) {
  if (result.timedout) return marks.timeout
  if (!result.passed) return marks.fail
  if (result.attempts > 1) return marks.retry
  return marks.pass
}

function report(result: Result) {
  counter.done++
  if (dots) {
    process.stdout.write(mark(result))
    if (counter.done % progress.width === 0) process.stdout.write("\n")
    return
  }

  const idx = String(counter.done).padStart(pad)
  const secs = (result.duration / 1000).toFixed(1)
  const tries = result.attempts > 1 ? dim(` [attempt ${result.attempts}/2]`) : ""

  if (result.timedout) {
    console.log(
      `[${idx}/${files.length}] ${red("TIME")} ${result.file} ${dim(`(${secs}s - exceeded ${fileTimeout / 1000}s)`)}${tries}`,
    )
    return
  }

  if (!result.passed) {
    console.log(`[${idx}/${files.length}] ${red("FAIL")} ${result.file} ${dim(`(${secs}s)`)}${tries}`)
    if (result.stderr.trim()) console.log(result.stderr)
    if (result.stdout.trim()) console.log(result.stdout)
    return
  }

  if (result.attempts > 1) {
    console.log(`[${idx}/${files.length}] ${yellow("FLAKY")} ${result.file} ${dim(`(${secs}s)`)}${tries}`)
    if (result.stdout.trim()) console.log(dim(result.stdout))
    return
  }

  console.log(`[${idx}/${files.length}] ${green("PASS")} ${result.file} ${dim(`(${secs}s)`)}`)
  if (result.stdout.trim()) console.log(dim(result.stdout))
}

// ---------------------------------------------------------------------------
// Parallel execution
// ---------------------------------------------------------------------------

console.log(`\nRunning ${bold(String(files.length))} test files with concurrency ${bold(String(concurrency))}`)
if (shard) console.log(`Using balanced test shard ${shard.index}/${shard.total}`)
if (dots) console.log(dim(legend))
console.log()

const start = performance.now()
const results: Result[] = []
const queue = [...files].sort((a, b) => weight(b) - weight(a))

const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
  while (queue.length > 0 && !stopped.value) {
    const file = queue.shift()!
    let result = await run(file)
    while (!result.passed && !result.timedout && result.attempts <= 1 && !stopped.value) {
      const retry = await run(file)
      retry.attempts = result.attempts + 1
      result = retry
    }
    results.push(result)
    report(result)
    if (bail && !result.passed) stopped.value = true
  }
})

await Promise.all(workers)

if (dots && counter.done % progress.width !== 0) console.log()

const elapsed = (performance.now() - start) / 1000

// ---------------------------------------------------------------------------
// Failure details
// ---------------------------------------------------------------------------

const failures = results.filter((r) => !r.passed).sort((a, b) => a.file.localeCompare(b.file))

if (failures.length > 0 && !verbose) {
  console.log(`\n${bold(red("--- FAILURES ---"))}\n`)
  for (const f of failures) {
    const tag = f.timedout ? " (TIMED OUT)" : ""
    console.log(`${bold(red(f.file))}${tag}:`)
    const output = (f.stderr || f.stdout).trim()
    if (output) console.log(output.split("\n").map((l) => "  " + l).join("\n"))
    console.log()
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.passed).length
const flaky = results.filter((r) => r.passed && r.attempts > 1)

console.log(
  `\n${bold(String(results.length))} files | ` +
    `${green(passed + " passed")} | ` +
    `${failures.length > 0 ? red(failures.length + " failed") : failures.length + " failed"} | ` +
    `${flaky.length > 0 ? yellow(flaky.length + " flaky") : flaky.length + " flaky"} | ` +
    `${elapsed.toFixed(1)}s\n`,
)

if (flaky.length > 0) {
  const sorted = flaky.slice().sort((a, b) => a.file.localeCompare(b.file))
  console.log(`${bold(yellow("--- FLAKY (passed on retry) ---"))}\n`)
  for (const r of sorted) {
    console.log(`  ${yellow(r.file)} ${dim(`(passed on attempt ${r.attempts}/2)`)}`)
  }
  console.log()
}

// ---------------------------------------------------------------------------
// Timings update
// ---------------------------------------------------------------------------

if (updateTimings) {
  if (patterns.length > 0 || shard) {
    console.log("\n--update-timings skipped: needs a full run (no pattern or shard)")
  } else {
    const fresh = Object.fromEntries(
      results.filter((result) => result.passed).map((result) => [`tests/unit/${result.file}`, Math.round(result.duration)] as const),
    )
    const merged = Object.fromEntries(Object.entries({ ...timings, ...fresh }).sort(([a], [b]) => a.localeCompare(b)))
    await Bun.write(timingsPath, JSON.stringify({ version: 1, files: merged }, null, 2) + "\n")
    console.log(
      `\nUpdated test-unit-timings.json: ${Object.keys(fresh).length} re-measured, ${Object.keys(merged).length} total`,
    )
  }
}

process.exit(failures.length > 0 ? 1 : 0)