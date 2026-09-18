import * as vscode from "vscode"
import type { KiloConnectionService } from "../services/cli-backend"

export interface RemoveConfigItemContext {
  connection: KiloConnectionService
  project: () => string | undefined
  directory: () => string
  refresh: () => Promise<void>
  storage?: vscode.Uri
}

export async function removeMcp(ctx: RemoveConfigItemContext, name: string): Promise<boolean> {
  const files: vscode.Uri[] = []
  if (ctx.project()) files.push(vscode.Uri.file(`${ctx.project()}/.kilo/mcp.json`))
  if (ctx.project()) files.push(vscode.Uri.file(`${ctx.project()}/.kilocode/mcp.json`))
  if (ctx.storage) files.push(vscode.Uri.joinPath(ctx.storage, "settings", "mcp_settings.json"))

  let removed = false
  for (const uri of files) {
    const bytes = await vscode.workspace.fs.readFile(uri).then(
      (data) => data,
      () => null,
    )
    if (!bytes) continue

    try {
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<string, unknown>
      const servers = parsed.mcpServers as Record<string, unknown> | undefined
      if (!servers?.[name]) continue
      delete servers[name]
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(parsed, null, 2), "utf8"))
      removed = true
    } catch (err) {
      console.warn("[Kilo New] Failed to remove legacy MCP from", uri.fsPath, err)
    }
  }
  return removed
}