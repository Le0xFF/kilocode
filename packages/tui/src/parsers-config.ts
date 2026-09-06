import * as path from "path"
import { existsSync } from "fs"

type WasmSource = {
  // Canonical URL kept as explicit fallback source (used only when KILO_TREE_SITTER_DOWNLOAD is set)
  url: string
  // Basename used for the co-located/vendored file lookup in KILO_TREE_SITTER_WASM_DIR
  file: string
  aliases?: readonly string[]
}

const diffAliases: readonly string[] = ["udiff", "patch"]
const makeAliases: readonly string[] = ["makefile"]

type QuerySet = {
  highlights: string[]
  locals?: string[]
}

const wasms: Record<string, WasmSource> = {
  python: {
    url: "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm",
    file: "tree-sitter-python.wasm",
  },
  rust: {
    url: "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.24.0/tree-sitter-rust.wasm",
    file: "tree-sitter-rust.wasm",
  },
  go: {
    url: "https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.25.0/tree-sitter-go.wasm",
    file: "tree-sitter-go.wasm",
  },
  cpp: {
    url: "https://github.com/tree-sitter/tree-sitter-cpp/releases/download/v0.23.4/tree-sitter-cpp.wasm",
    file: "tree-sitter-cpp.wasm",
  },
  csharp: {
    url: "https://github.com/tree-sitter/tree-sitter-c-sharp/releases/download/v0.23.1/tree-sitter-c_sharp.wasm",
    file: "tree-sitter-c_sharp.wasm",
  },
  bash: {
    url: "https://github.com/tree-sitter/tree-sitter-bash/releases/download/v0.25.0/tree-sitter-bash.wasm",
    file: "tree-sitter-bash.wasm",
  },
  c: {
    url: "https://github.com/tree-sitter/tree-sitter-c/releases/download/v0.24.1/tree-sitter-c.wasm",
    file: "tree-sitter-c.wasm",
  },
  java: {
    url: "https://github.com/tree-sitter/tree-sitter-java/releases/download/v0.23.5/tree-sitter-java.wasm",
    file: "tree-sitter-java.wasm",
  },
  kotlin: {
    url: "https://github.com/fwcd/tree-sitter-kotlin/releases/download/0.3.8/tree-sitter-kotlin.wasm",
    file: "tree-sitter-kotlin.wasm",
  },
  ruby: {
    url: "https://github.com/tree-sitter/tree-sitter-ruby/releases/download/v0.23.1/tree-sitter-ruby.wasm",
    file: "tree-sitter-ruby.wasm",
  },
  php: {
    url: "https://github.com/tree-sitter/tree-sitter-php/releases/download/v0.24.2/tree-sitter-php.wasm",
    file: "tree-sitter-php.wasm",
  },
  scala: {
    url: "https://github.com/tree-sitter/tree-sitter-scala/releases/download/v0.24.0/tree-sitter-scala.wasm",
    file: "tree-sitter-scala.wasm",
  },
  html: {
    url: "https://github.com/tree-sitter/tree-sitter-html/releases/download/v0.23.2/tree-sitter-html.wasm",
    file: "tree-sitter-html.wasm",
  },
  vue: {
    url: "https://github.com/anomalyco/tree-sitter-vue/releases/download/v0.1.2/tree-sitter-vue.wasm",
    file: "tree-sitter-vue.wasm",
  },
  hcl: {
    url: "https://github.com/tree-sitter-grammars/tree-sitter-hcl/releases/download/v1.2.0/tree-sitter-hcl.wasm",
    file: "tree-sitter-hcl.wasm",
  },
  json: {
    url: "https://github.com/tree-sitter/tree-sitter-json/releases/download/v0.24.8/tree-sitter-json.wasm",
    file: "tree-sitter-json.wasm",
  },
  yaml: {
    url: "https://github.com/tree-sitter-grammars/tree-sitter-yaml/releases/download/v0.7.2/tree-sitter-yaml.wasm",
    file: "tree-sitter-yaml.wasm",
  },
  haskell: {
    url: "https://github.com/tree-sitter/tree-sitter-haskell/releases/download/v0.23.1/tree-sitter-haskell.wasm",
    file: "tree-sitter-haskell.wasm",
  },
  css: {
    url: "https://github.com/tree-sitter/tree-sitter-css/releases/download/v0.25.0/tree-sitter-css.wasm",
    file: "tree-sitter-css.wasm",
  },
  julia: {
    url: "https://github.com/tree-sitter/tree-sitter-julia/releases/download/v0.23.1/tree-sitter-julia.wasm",
    file: "tree-sitter-julia.wasm",
  },
  lua: {
    url: "https://github.com/tree-sitter-grammars/tree-sitter-lua/releases/download/v0.5.0/tree-sitter-lua.wasm",
    file: "tree-sitter-lua.wasm",
  },
  ocaml: {
    url: "https://github.com/tree-sitter/tree-sitter-ocaml/releases/download/v0.24.2/tree-sitter-ocaml.wasm",
    file: "tree-sitter-ocaml.wasm",
  },
  clojure: {
    url: "https://github.com/anomalyco/tree-sitter-clojure/releases/download/v0.0.1/tree-sitter-clojure.wasm",
    file: "tree-sitter-clojure.wasm",
  },
  swift: {
    url: "https://github.com/alex-pinkus/tree-sitter-swift/releases/download/0.7.1/tree-sitter-swift.wasm",
    file: "tree-sitter-swift.wasm",
  },
  toml: {
    url: "https://github.com/tree-sitter-grammars/tree-sitter-toml/releases/download/v0.7.0/tree-sitter-toml.wasm",
    file: "tree-sitter-toml.wasm",
  },
  nix: {
    // TODO: Replace with official tree-sitter-nix WASM when published
    // See: https://github.com/nix-community/tree-sitter-nix/issues/66
    url: "https://github.com/ast-grep/ast-grep.github.io/raw/40b84530640aa83a0d34a20a2b0623d7b8e5ea97/website/public/parsers/tree-sitter-nix.wasm",
    file: "tree-sitter-nix.wasm",
  },
  diff: {
    aliases: diffAliases,
    url: "https://github.com/tree-sitter-grammars/tree-sitter-diff/releases/download/v0.1.0/tree-sitter-diff.wasm",
    file: "tree-sitter-diff.wasm",
  },
  elixir: {
    url: "https://github.com/elixir-lang/tree-sitter-elixir/releases/download/v0.3.5/tree-sitter-elixir.wasm",
    file: "tree-sitter-elixir.wasm",
  },
  fsharp: {
    url: "https://github.com/ionide/tree-sitter-fsharp/releases/download/0.3.0/tree-sitter-fsharp.wasm",
    file: "tree-sitter-fsharp.wasm",
  },
  r: {
    url: "https://github.com/r-lib/tree-sitter-r/releases/download/v1.2.0/tree-sitter-r.wasm",
    file: "tree-sitter-r.wasm",
  },
  make: {
    aliases: makeAliases,
    url: "https://github.com/tree-sitter-grammars/tree-sitter-make/releases/download/v1.1.1/tree-sitter-make.wasm",
    file: "tree-sitter-make.wasm",
  },
  vim: {
    url: "https://github.com/tree-sitter-grammars/tree-sitter-vim/releases/download/v0.8.1/tree-sitter-vim.wasm",
    file: "tree-sitter-vim.wasm",
  },
  xml: {
    url: "https://github.com/tree-sitter-grammars/tree-sitter-xml/releases/download/v0.7.0/tree-sitter-xml.wasm",
    file: "tree-sitter-xml.wasm",
  },
  agda: {
    url: "https://github.com/tree-sitter/tree-sitter-agda/releases/download/v1.3.3/tree-sitter-agda.wasm",
    file: "tree-sitter-agda.wasm",
  },
}

// NOTE: FOR markdown, javascript and typescript, we use the opentui built-in parsers
// Warn: when taking queries from the nvim-treesitter repo, make sure to include the query dependencies as well
//       marked for example `; inherits: ecma` at the top of the file. Just put the dependencies before the actual query.
//       ALSO: Some queries use breaking changes in the nvim-treesitter repo, that are not compatible with the (web-)tree-sitter parser.

// kilocode_change start - offline TUI: resolve wasm from the bundled/vendored directory first
// (KILO_TREE_SITTER_WASM_DIR is set by the CLI launcher and the VS Code extension). The
// canonical GitHub release URL below each file is only fetched when the user opts in with
// KILO_TREE_SITTER_DOWNLOAD=1; otherwise a missing local file degrades silently (no syntax
// highlighting for that language) so `kilo run` stays fully usable offline.
const downloadEnabled = ["1", "true"].includes((process.env.KILO_TREE_SITTER_DOWNLOAD ?? "").toLowerCase())
const wasmDir = process.env.KILO_TREE_SITTER_WASM_DIR

function resolveWasm(source: WasmSource): string {
  const local = wasmDir ? path.join(wasmDir, source.file) : undefined
  if (local && existsSync(local)) return local
  if (!downloadEnabled) {
    console.warn(
      `[kilo] tree-sitter wasm ${source.file} not found locally${wasmDir ? ` (${wasmDir})` : ""}; syntax highlighting disabled for this language until you reinstall or set KILO_TREE_SITTER_DOWNLOAD=1`,
    )
    return local ?? source.file
  }
  return source.url
}

const queries: Record<string, QuerySet> = {
  python: {
    highlights: [
      // NOTE: This nvim-treesitter query is currently broken, because the parser is not compatible with the query apparently.
      //       it is using "except" nodes that the parser is complaining about, but it has been in the query for 3+ years.
      //       Unclear.
      // "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/python/highlights.scm",
      "https://github.com/tree-sitter/tree-sitter-python/raw/refs/heads/master/queries/highlights.scm",
    ],
    locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/python/locals.scm"],
  },
  rust: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/rust/highlights.scm"],
    locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/rust/locals.scm"],
  },
  go: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/go/highlights.scm"],
    locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/go/locals.scm"],
  },
  cpp: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/cpp/highlights.scm"],
    locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/cpp/locals.scm"],
  },
  csharp: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c_sharp/highlights.scm"],
    locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c_sharp/locals.scm"],
  },
  bash: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/bash/highlights.scm"],
  },
  c: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c/highlights.scm"],
    locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c/locals.scm"],
  },
  java: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/java/highlights.scm"],
    locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/java/locals.scm"],
  },
  kotlin: {
    highlights: ["https://raw.githubusercontent.com/fwcd/tree-sitter-kotlin/0.3.8/queries/highlights.scm"],
    locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/kotlin/locals.scm"],
  },
  ruby: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/ruby/highlights.scm"],
    locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/ruby/locals.scm"],
  },
  php: {
    highlights: [
      // NOTE: This nvim-treesitter query is currently broken, because the parser is not compatible with the query apparently.
      // "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/php/highlights.scm",
      "https://github.com/tree-sitter/tree-sitter-php/raw/refs/heads/master/queries/highlights.scm",
    ],
  },
  scala: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/scala/highlights.scm"],
  },
  html: {
    highlights: [
      // NOTE: This nvim-treesitter query is currently broken, because the parser is not compatible with the query apparently.
      // "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/html/highlights.scm",
      "https://github.com/tree-sitter/tree-sitter-html/raw/refs/heads/master/queries/highlights.scm",
    ],
    // TODO: Injections not working for some reason
    // injections: [
    //   "https://github.com/tree-sitter/tree-sitter-html/raw/refs/heads/master/queries/injections.scm",
    // ],
  },
  vue: {
    highlights: [
      "https://raw.githubusercontent.com/anomalyco/tree-sitter-vue/v0.1.2/queries/html_tags/highlights.scm",
      "https://raw.githubusercontent.com/anomalyco/tree-sitter-vue/v0.1.2/queries/vue/highlights.scm",
    ],
  },
  hcl: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/hcl/highlights.scm"],
  },
  json: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/json/highlights.scm"],
  },
  yaml: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/yaml/highlights.scm"],
  },
  haskell: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/haskell/highlights.scm"],
  },
  css: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/css/highlights.scm"],
  },
  julia: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/julia/highlights.scm"],
  },
  lua: {
    highlights: ["https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-lua/v0.5.0/queries/highlights.scm"],
    locals: ["https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-lua/v0.5.0/queries/locals.scm"],
  },
  ocaml: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/ocaml/highlights.scm"],
  },
  clojure: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/clojure/highlights.scm"],
  },
  swift: {
    highlights: [
      // NOTE: Using parser repo queries instead of nvim-treesitter due to incompatible #lua-match? predicates
      // "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/highlights.scm
      "https://raw.githubusercontent.com/alex-pinkus/tree-sitter-swift/main/queries/highlights.scm",
    ],
    locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/swift/locals.scm"],
  },
  toml: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/toml/highlights.scm"],
  },
  nix: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/nix/highlights.scm"],
    locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/nix/locals.scm"],
  },
  diff: {
    highlights: ["https://raw.githubusercontent.com/tree-sitter-grammars/tree-sitter-diff/master/queries/highlights.scm"],
  },
  elixir: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/elixir/highlights.scm"],
    locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/elixir/locals.scm"],
  },
  fsharp: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/fsharp/highlights.scm"],
  },
  r: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/r/highlights.scm"],
    locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/r/locals.scm"],
  },
  make: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/make/highlights.scm"],
  },
  vim: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/vim/highlights.scm"],
    locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/vim/locals.scm"],
  },
  xml: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/xml/highlights.scm"],
    locals: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/xml/locals.scm"],
  },
  agda: {
    highlights: ["https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/agda/highlights.scm"],
  },
}

export default {
  parsers: Object.entries(wasms).map(([filetype, source]) => ({
    filetype,
    ...(source.aliases ? { aliases: [...source.aliases] } : {}),
    wasm: resolveWasm(source),
    queries: queries[filetype],
  })),
}