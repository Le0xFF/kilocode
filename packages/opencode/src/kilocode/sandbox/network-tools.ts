export const opaque = [
  { id: "semantic_search", file: "kilocode/tool/semantic-search.ts" },
  // kilocode_change - LSP removed; no lsp tool in the sandbox network list
] as const

export const host = [
  { id: "interactive_terminal", file: "kilocode/tool/interactive-terminal.ts" },
  { id: "notebook_execute", file: "kilocode/tool/notebook-host.ts" },
  { id: "background_process", file: "kilocode/tool/background-process.ts" },
] as const
