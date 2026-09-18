import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"

import { removeMcp, type RemoveConfigItemContext } from "../../src/kilo-provider/remove-config-item"

const storage = "/storage/settings/mcp_settings.json"

function context(opts: { project?: string }): RemoveConfigItemContext {
  return {
    connection: {} as RemoveConfigItemContext["connection"],
    project: () => opts.project,
    directory: () => "/repo",
    refresh: async () => {},
    storage: vscode.Uri.file("/storage"),
  }
}

async function read(file: string): Promise<Record<string, unknown>> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(file))
  return JSON.parse(Buffer.from(bytes).toString("utf8"))
}

function patchFs(files: Record<string, string>) {
  const workspace = vscode.workspace as unknown as { fs: { readFile: (uri: { fsPath: string }) => Promise<Uint8Array>; writeFile: (uri: { fsPath: string }, data: Uint8Array) => Promise<void> } }
  workspace.fs.readFile = async (uri) => new TextEncoder().encode(files[uri.fsPath] ?? "")
  workspace.fs.writeFile = async (uri, data) => {
    files[uri.fsPath] = Buffer.from(data).toString("utf8")
  }
}

describe("remove config item adapter", () => {
  let files: Record<string, string>

  beforeEach(() => {
    files = {}
  })

  afterEach(async () => {
    for (const key of Object.keys(files)) delete files[key]
  })

  it("removes MCP servers from all scopes when a project is set", async () => {
    const project = "/repo"
    const local = `${project}/.kilo/mcp.json`
    const legacy = `${project}/.kilocode/mcp.json`
    files[local] = '{"mcpServers":{"memory":{}}}'
    files[legacy] = '{"mcpServers":{"memory":{}}}'
    files[storage] = '{"mcpServers":{"memory":{}}}'
    patchFs(files)

    const removed = await removeMcp(context({ project }), "memory")

    expect(removed).toBe(true)
    expect(JSON.parse(files[local])).toEqual({ mcpServers: {} })
    expect(JSON.parse(files[legacy])).toEqual({ mcpServers: {} })
    expect(JSON.parse(files[storage])).toEqual({ mcpServers: {} })
  })

  it("removes MCP servers globally when there is no project", async () => {
    const project = "/repo"
    const local = `${project}/.kilo/mcp.json`
    files[local] = '{"mcpServers":{"memory":{}}}'
    files[storage] = '{"mcpServers":{"memory":{}}}'
    patchFs(files)

    const removed = await removeMcp(context({}), "memory")

    expect(removed).toBe(true)
    expect(JSON.parse(files[storage])).toEqual({ mcpServers: {} })
    expect(JSON.parse(files[local])).toEqual({ mcpServers: { memory: {} } })
  })

  it("returns false when the server is not configured anywhere", async () => {
    const project = "/repo"
    const local = `${project}/.kilo/mcp.json`
    files[local] = '{"mcpServers":{"other":{}}}'
    files[storage] = '{"mcpServers":{"other":{}}}'
    patchFs(files)

    const removed = await removeMcp(context({ project }), "missing")

    expect(removed).toBe(false)
    expect(JSON.parse(files[local])).toEqual({ mcpServers: { other: {} } })
  })
})