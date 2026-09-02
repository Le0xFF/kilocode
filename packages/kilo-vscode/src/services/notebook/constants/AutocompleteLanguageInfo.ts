export interface AutocompleteLanguageInfo {
  name: string
  singleLineComment?: string
}

const IDS: Record<string, AutocompleteLanguageInfo> = {
  typescript: { name: "TypeScript", singleLineComment: "//" },
  typescriptreact: { name: "TypeScript", singleLineComment: "//" },
  javascript: { name: "JavaScript", singleLineComment: "//" },
  javascriptreact: { name: "JavaScript", singleLineComment: "//" },
  json: { name: "JSON" },
  jsonc: { name: "JSON" },
  python: { name: "Python", singleLineComment: "#" },
  java: { name: "Java", singleLineComment: "//" },
  cpp: { name: "C++", singleLineComment: "//" },
  c: { name: "C", singleLineComment: "//" },
  csharp: { name: "C#", singleLineComment: "//" },
  scala: { name: "Scala", singleLineComment: "//" },
  go: { name: "Go" },
  rust: { name: "Rust", singleLineComment: "//" },
  haskell: { name: "Haskell", singleLineComment: "--" },
  php: { name: "PHP", singleLineComment: "//" },
  ruby: { name: "Ruby", singleLineComment: "#" },
  swift: { name: "Swift", singleLineComment: "//" },
  kotlin: { name: "Kotlin", singleLineComment: "//" },
  clojure: { name: "Clojure", singleLineComment: ";" },
  julia: { name: "Julia", singleLineComment: "# " },
  fsharp: { name: "F#", singleLineComment: "//" },
  r: { name: "R", singleLineComment: "#" },
  dart: { name: "Dart", singleLineComment: "//" },
  solidity: { name: "Solidity", singleLineComment: "//" },
  yaml: { name: "YAML", singleLineComment: "#" },
  markdown: { name: "Markdown" },
  lua: { name: "Lua", singleLineComment: "--" },
  luau: { name: "Lua", singleLineComment: "--" },
}

export function languageForId(id: string): AutocompleteLanguageInfo | undefined {
  return IDS[id]
}