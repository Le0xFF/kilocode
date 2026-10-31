import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as gh from "../../src/agent-manager/gh"
import * as shellEnv from "../../src/agent-manager/shell-env"
import { PRStatusPoller } from "../../src/agent-manager/PRStatusPoller"
import type { Worktree } from "../../src/agent-manager/WorktreeStateManager"

const execute = spyOn(gh, "execGhRead")
const shell = spyOn(shellEnv, "execWithShellEnv")

const head = "a".repeat(40)

function poller(worktrees: Worktree[], statuses: Array<{ pr: unknown; error?: string }>) {
  const instance = new PRStatusPoller({
    getWorktrees: () => worktrees,
    getWorkspaceRoot: () => "/repo",
    onStatus: (_id, pr, error) => statuses.push({ pr, error }),
    log: () => undefined,
  })
  return instance
}

function timer(instance: PRStatusPoller): unknown {
  return (instance as unknown as { timer: unknown }).timer
}

async function waitFor(fn: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("Timed out waiting for condition")
    await Bun.sleep(5)
  }
}

beforeEach(() => {
  execute.mockReset()
  shell.mockReset()
  execute.mockImplementation(async (args: string[]) => {
    if (args[0] === "pr") throw new Error("no pull requests found")
    return { stdout: "", stderr: "" }
  })
  shell.mockImplementation(async (cmd: string, args: string[]) => {
    if (cmd === "git" && args[0] === "rev-parse") return { stdout: `${head}\n`, stderr: "" }
    return { stdout: "", stderr: "" }
  })
})

afterAll(() => {
  execute.mockRestore()
  shell.mockRestore()
})

describe("PRStatusPoller automatic polling gate", () => {
  it("starts no timers and no gh traffic while polling is disabled", async () => {
    const statuses: Array<{ pr: unknown; error?: string }> = []
    const instance = poller([], statuses)
    instance.setEnabled(false)
    await Bun.sleep(50)
    expect(timer(instance)).toBeUndefined()
    expect(execute.mock.calls).toEqual([])
    expect(statuses).toEqual([])
  })

  it("schedules the next poll while polling is enabled and clears it on disable", async () => {
    const instance = poller([], [])
    instance.setEnabled(true)
    await waitFor(() => timer(instance) !== undefined)
    expect(timer(instance)).toBeDefined()
    // The poll cycle probes gh before it can fetch anything.
    expect(execute.mock.calls.some((call) => call[0]?.[0] === "--version")).toBe(true)
    instance.setEnabled(false)
    expect(timer(instance)).toBeUndefined()
  })
})

describe("PRStatusPoller manual refresh", () => {
  it("serves a manual refresh while automatic polling is disabled", async () => {
    const worktrees: Worktree[] = [
      { id: "wt1", path: process.cwd(), branch: "feature", parentBranch: "main", createdAt: "" },
    ]
    const statuses: Array<{ pr: unknown; error?: string }> = []
    const instance = poller(worktrees, statuses)
    instance.refresh("wt1", false, true)
    await waitFor(() => statuses.length > 0)
    expect(statuses).toEqual([{ pr: null, error: undefined }])
    // A manual fetch ran gh, and no poll timer was scheduled as a result.
    expect(execute.mock.calls.length).toBeGreaterThan(0)
    expect(timer(instance)).toBeUndefined()
  })

  it("ignores a non-manual refresh while polling is disabled", async () => {
    const worktrees: Worktree[] = [
      { id: "wt1", path: process.cwd(), branch: "feature", parentBranch: "main", createdAt: "" },
    ]
    const statuses: Array<{ pr: unknown; error?: string }> = []
    const instance = poller(worktrees, statuses)
    // Worktree recovery refreshes without a manual flag: while polling is disabled it must not
    // spawn gh (and so cannot surface a gh_missing/gh_auth toast) for an action that never
    // asked for PR status.
    instance.refresh("wt1", true)
    await Bun.sleep(50)
    expect(execute.mock.calls).toEqual([])
    expect(statuses).toEqual([])
    expect(timer(instance)).toBeUndefined()
  })

  it("keeps serving manual refreshes while automatic polling is enabled", async () => {
    const worktrees: Worktree[] = [
      { id: "wt1", path: process.cwd(), branch: "feature", parentBranch: "main", createdAt: "" },
    ]
    const statuses: Array<{ pr: unknown; error?: string }> = []
    const instance = poller(worktrees, statuses)
    instance.setEnabled(true)
    await waitFor(() => timer(instance) !== undefined)
    const before = execute.mock.calls.length
    instance.refresh("wt1")
    await waitFor(() => execute.mock.calls.length > before)
    expect(statuses.at(-1)).toEqual({ pr: null, error: undefined })
    instance.stop()
  })
})
