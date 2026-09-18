import { dict as ar } from "./ar"
import { dict as br } from "./br"
import { dict as bs } from "./bs"
import { dict as da } from "./da"
import { dict as de } from "./de"
import { dict as en } from "./en"
import { dict as es } from "./es"
import { dict as fa } from "./fa"
import { dict as fr } from "./fr"
import { dict as it } from "./it"
import { dict as ja } from "./ja"
import { dict as ko } from "./ko"
import { dict as nl } from "./nl"
import { dict as no } from "./no"
import { dict as pl } from "./pl"
import { dict as ru } from "./ru"
import { dict as th } from "./th"
import { dict as tr } from "./tr"
import { dict as uk } from "./uk"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"
// kilocode_change - wire upstream attention notification locales; the merge dropped this block and left the bundles unimported
import { dict as arAttention } from "./attention/ar"
import { dict as brAttention } from "./attention/br"
import { dict as bsAttention } from "./attention/bs"
import { dict as daAttention } from "./attention/da"
import { dict as deAttention } from "./attention/de"
import { dict as enAttention } from "./attention/en"
import { dict as esAttention } from "./attention/es"
import { dict as faAttention } from "./attention/fa"
import { dict as frAttention } from "./attention/fr"
import { dict as itAttention } from "./attention/it"
import { dict as jaAttention } from "./attention/ja"
import { dict as koAttention } from "./attention/ko"
import { dict as nlAttention } from "./attention/nl"
import { dict as noAttention } from "./attention/no"
import { dict as plAttention } from "./attention/pl"
import { dict as ruAttention } from "./attention/ru"
import { dict as thAttention } from "./attention/th"
import { dict as trAttention } from "./attention/tr"
import { dict as ukAttention } from "./attention/uk"
import { dict as zhAttention } from "./attention/zh"
import { dict as zhtAttention } from "./attention/zht"

const bundles: Record<string, Record<string, string>> = {
  ar: { ...ar, ...arAttention },
  br: { ...br, ...brAttention },
  bs: { ...bs, ...bsAttention },
  da: { ...da, ...daAttention },
  de: { ...de, ...deAttention },
  en: { ...en, ...enAttention },
  es: { ...es, ...esAttention },
  fa: { ...fa, ...faAttention },
  fr: { ...fr, ...frAttention },
  it: { ...it, ...itAttention },
  ja: { ...ja, ...jaAttention },
  ko: { ...ko, ...koAttention },
  nl: { ...nl, ...nlAttention },
  no: { ...no, ...noAttention },
  pl: { ...pl, ...plAttention },
  ru: { ...ru, ...ruAttention },
  th: { ...th, ...thAttention },
  tr: { ...tr, ...trAttention },
  uk: { ...uk, ...ukAttention },
  zh: { ...zh, ...zhAttention },
  zht: { ...zht, ...zhtAttention },
}

export function resolveLocale(lang: string | undefined): string {
  if (!lang) return "en"
  const lower = lang.toLowerCase()
  if (lower.startsWith("zh")) {
    if (lower === "zht") return "zht"
    const traditional =
      lower.includes("hant") || lower.includes("-tw") || lower.includes("-hk") || lower.includes("-mo")
    return traditional ? "zht" : "zh"
  }
  if (lower.startsWith("nb") || lower.startsWith("nn")) return "no"
  if (lower.startsWith("pt")) return "br"
  for (const key of Object.keys(bundles)) {
    if (lower.startsWith(key)) return key
  }
  return "en"
}

export function selectedLocale(vscode: typeof import("vscode")): string {
  const cfg = vscode.workspace.getConfiguration("kilo-code.new")
  const lang = cfg.get<string>("language")
  return resolveLocale(lang || vscode.env.language)
}

export function getCommitMessageLanguage(vscode: typeof import("vscode")): string {
  const cfg = vscode.workspace.getConfiguration("kilo-code.new")
  const commitLang = cfg.get<string>("languageCommitMessage") ?? "sync"
  if (commitLang === "sync") return selectedLocale(vscode)
  return resolveLocale(commitLang)
}

export function translate(
  locale: string,
key: string,
  vars?: Record<string, string | number>,
): string {
  const translations: Record<string, string> = { ...enAttention, ...(bundles[resolveLocale(locale)] ?? {}) }
  let text = translations[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{{${k}}}`, String(v))
    }
  }
  return text
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const locale = selectedLocale(require("vscode") as typeof import("vscode"))
  return translate(locale, key, vars)
}
