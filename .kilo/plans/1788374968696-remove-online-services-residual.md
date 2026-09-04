# Piano: rimozione residua dei servizi online Kilo (estensione fully offline)

## Obiettivo

Completare la migrazione dell'estensione VS Code a un funzionamento **fully offline** su soli provider locali OpenAI-compatibili (llama.cpp, vLLM, Ollama, ecc.), rimuovendo i residui di codice relativi ai servizi online Kilo ancora presenti dopo il commit `1673a9fbf1` (*feat: remove online Kilo services*). In particolare:

1. **Sezione "Providers" delle impostazioni**: restare solo la voce **"Custom provider"** (+ i provider locali già connessi). Rimuovere i blocchi "Connected providers" e "Popular providers" (built-in online tipo Anthropic/OpenRouter/Google/Vercel) e l'intera superficie dei built-in.
2. **Dropdown "select model" della chat**: rimuovere completamente le sezioni **"recommended"** e **"kilo gateway"** (gruppi `auto-*` del gateway + modelli con `recommendedIndex`). Restano solo i modelli dei provider locali connessi + eventuali gruppi "favorites"/"most-used" derivati dall'uso.
3. **Sezione "Models"**: i modelli speech-to-text sono solo online → rimuovere interamente la feature STT.
4. **Rimozione completa** del pacchetto `packages/kilo-gateway/` e di tutto ciò che lo dipende (route `/kilo/*`, `KiloPlugin`, `fetchDefaultModel`, telemetry identity, cloud sessions, TUI gateway), a patto di non compromettere l'estensione.

L'estensione spawna solo `kilo serve --port 0` (mai il TUI); quindi rompere il TUI CLI standalone è accettabile, ma **non** rompere `kilo serve` (l'entrypoint include `setup.ts` che importa il gateway).

## Analisi

### Stato attuale (post-commit `1673a9fbf1`)

- Il provider `kilo` e i fallback `kilo-auto` sono già rimossi dal runtime; le route Hono `createKiloRoutes` (`/kilo/*`) sono già smontate (il factory resta esportato ma orfano nel gateway).
- Il fetch del catalogo models.dev è disabilitato via `KILO_DISABLE_MODELS_FETCH=1` (forzato da `packages/kilo-vscode/src/services/cli-backend/server-manager.ts:40`). Con questo flag il catalogo usa **solo cache locale + snapshot build-time** `KILO_MODELS_DEV`; i custom provider locali sono funzionalmente indipendenti dal catalogo (fallback npm `@ai-sdk/openai-compatible`).
- Il backend proxy **media-local** per STT/image-generation è già locale (`packages/opencode/src/kilocode/media-local/`): proxy verso `{baseURL}/audio/transcriptions` del provider OpenAI-compatible in config. Nessun path gateway.
- `hasSpeechToTextAccess` restituisce sempre `true` (accesso gateway già disaccoppiato).

### Residui online da rimuovere (mappatura completa)

| # | Cosa | Dove | Tipo |
|---|---|---|---|
| A | Pacchetto `kilo-gateway` intero | `packages/kilo-gateway/` | package |
| B | `KiloPlugin` + registrazione | `packages/core/src/plugin/provider/kilo.ts`, `plugin/provider.ts:17,54`, test `core/test/plugin/provider-kilo.test.ts` | provider catalog |
| C | Costanti `PROMPTS`/`AI_SDK_PROVIDERS` | `packages/core/src/v1/config/provider.ts:4,18,20` + `opencode/src/kilocode/provider/provider.ts:9` | costanti condivise |
| D | `fetchDefaultModel` blocco kilo | `packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts:3,47-56` | handler server |
| E | `kiloCustomLoaders`/patch schema | `packages/opencode/src/kilocode/provider/provider.ts` | ibrido (keep, de-couple) |
| F | `ENV_FEATURE` import | `packages/opencode/src/kilocode/session/index.ts:17,126` | costante |
| G | `initializeTUIDependencies` | `packages/opencode/src/kilocode/cli/cmd/tui/app.tsx:23,204` | TUI (rompibile) |
| H | dynamic import gateway in bootstrap | `packages/opencode/src/kilocode/cli/setup.ts:74,88` + `src/index.ts:12` | **critico per `kilo serve`** |
| I | Cloud sessions | `import-cloud-session-in-process.ts` (orfano), `cloud-session.ts`, cmd `tui/run/attach/thread` | orfano/TUI |
| J | Provider usage cloud (tRPC) | `core/src/kilocode/provider-usage/cloud.ts`, adapter `managed`, `dialog-provider-usage.tsx`, `modes-migrator.ts` | feature |
| K | Telemetry `identity.ts` → `fetchProfile` | `packages/kilo-telemetry/src/identity.ts`, test, `package.json:22` | package |
| L | Indexing `headers.ts` → `getDefaultHeaders` | `packages/kilo-indexing/src/headers.ts:1,6` | decoupling |
| M | Dipendenze `workspace:*` | `opencode/package.json:99`, `core/package.json:66`, `kilo-indexing/package.json:39`, `kilo-telemetry/package.json:22`, root `package.json:25,30`, `kilo-vscode/script/prepare-sdk.ts:18,22`, `tests/unit/i18n-unused-keys.test.ts:60` | build |
| N | Default settings `kilo-code.new.model.providerID/modelID` | `packages/kilo-vscode/package.json` (`"kilo"` / `"kilo-auto/free"`) | settings |
| O | UI: ModelSelector gruppi recommended/auto | `webview-ui/src/components/shared/ModelSelector.tsx` (memo `groups`, righe 271-394, costanti righe 56-72) + i18n `model.group.recommended`/`model.group.auto` | webview |
| P | UI: ProvidersTab blocchi Connected/Popular | `webview-ui/src/components/settings/ProvidersTab.tsx` (blocchi h4 righe 148, 236; memo `connectedProviders`/`popularProviders` righe 38-51; `ProviderSelectDialog`, `ProviderConnectDialog`) | webview |
| Q | UI: carve-out provider `kilo` | `webview-ui/src/context/provider-utils.ts:44` (`isModelValid`) | webview |
| R | UI: STT in ModelsTab + PromptInput | `ModelsTab.tsx:162-201`, `PromptInput.tsx:1599`, `webview-ui/src/components/speech-to-text/*`, `src/speech-to-text/*`, i18n `speechToText*`/`speechToTextModel*` | webview+host |
| S | Config schema STT | `packages/core/src/v1/config/config.ts` (`experimental.speech_to_text_model`, `experimental.speech_to_text`) | schema |
| T | Media-local STT backend | `packages/opencode/src/kilocode/media-local/{service,group}.ts` (parti STT), handler `media-local.ts`, gruppo API `MediaLocalApi` (mantenere image-gen) | backend |
| U | i18n residuali "Kilo Gateway" | `webview-ui/src/i18n/*.ts` (righe tipo en.ts 218, 584, 836, 838, 1117 + replicate) | i18n |

### Vincoli architetturali

- **`kilo serve` deve continuare a avviarsi**: l'entrypoint `src/index.ts:12` importa `KiloCli` da `kilocode/cli/setup.ts`, che fa dynamic import di `@kilocode/kilo-gateway` nel `bootstrap()`. Bisogna decollare quel import prima di cancellare il pacchetto, altrimenti il binario spawenato dall'estensione crasha all'avvio.
- **Marker `kilocode_change`**: file ereditati dal fork (`config.ts`, `provider.ts`, `models-dev.ts`, `handlers/config.ts`, ecc.) richiedono marker per i blocchi Kilo. La rimozione di blocchi marcati va fatta preservando i marker sui blocchi adiacenti.
- **SDK auto-generato** (`packages/sdk/js/src/gen/`): se si tolgono endpoint dal server opencode (es. route media-local STT), va rigenerato con `bun run script/generate.ts` dalla root.
- **Knip/CI**: ogni export rimosso deve essere importato da qualche parte o va tolto; `check-kilocode-change` e `check-workflows` corrono in CI.
- **TUI rompibile**: l'estensione non usa il TUI né le cloud sessions; quei comandi (`tui`, `run`, `attach`, `thread`) possono perdere funzioni gateway senza impatto sull'estensione.

## Assunzioni

- [A1] L'estensione userà **solo** provider locali OpenAI-compatibili (llama.cpp, vLLM, Ollama). Nessuna API key BYOK per Anthropic/OpenAI/OpenRouter/Google sarà più necessaria. Di conseguenza i built-in del catalogo (anthropic, openai, openrouter, google, vercel, deepseek) restano disponibili come *catalogo* (via snapshot/cache) ma non saranno presentati in UI (nessun blocco "Popular", nessun "kilo").
- [A2] La **feature image-generation locale** (stesso meccanismo media-local di STT) viene **mantenuta** (non è un servizio online Kilo; è un proxy locale verso il provider utente). Si tocca solo la parte STT di `media-local`.
- [A3] Il **pacchetto `kilo-telemetry`** viene **rimosso** insieme al gateway: l'init della telemetry è già assente dal runtime e l'unico vincolo era `identity.ts → fetchProfile`. Si toglie dal workspaces array root e dai riferimenti `prepare-sdk.ts`/test i18n.
- [A4] Accettabile rompere il **TUI CLI standalone** e i comandi `run`/`attach`/`thread` nella loro integrazione gateway/cloud-sessions: l'estensione li usa solo tramite `serve`.
- [A5] Le costanti `PROMPTS` e `AI_SDK_PROVIDERS` sono **generiche** (usate anche dai custom provider locali per `prompt`/`ai_sdk_provider` nello schema). Vanno ri-ospitate in un modulo condiviso del core e i valori letterali mantenuti identici, così i file di config esistenti continuano a validarsi.
- [A6] Apertis (overlay modello in `opencode/src/provider/models.ts`) è un provider BYOK terzo-party con chiave propria, non un servizio Kilo: viene **mantenuto**. Anaconda Desktop (locale) viene **mantenuto**.
- [A7] Il default factory `kilo-code.new.model.providerID/modelID` viene portato a un valore neutro/non-impostato (`""`/`""`), così `computeDefaultSelection` cade sul primo ramo (`config.model`) o segnala "no default". Non si introduce un nuovo provider default.
- [A8] I gruppi "favorites"/"most-used" nel dropdown restano (derivati dall'uso dell'utente sui modelli locali). Il gruppo "auto" (`auto-*`) scompare perché legato al routing automatico del gateway.

## Piano di implementazione

Ogni step è eseguito da un subagente distinto, sequenziale, e termina con compilazione. Ordine scelto per minimizzare le finestre di code non compilabile: si decollano prima i punti di contatto runtime, poi si pulisce l'UI, e infine si elimina il pacchetto e la feature STT.

---

### Step 1 — Decollare il bootstrap CLI dal gateway (sblocca `kilo serve`)

**Obiettivo**

Rendere `packages/opencode/src/kilocode/cli/setup.ts` e `src/index.ts` indipendenti da `@kilocode/kilo-gateway`, così il binario `kilo serve` (spawenato dall'estensione) non importa più il gateway. Questo è il prerequisito per poter cancellare il pacchetto negli step successivi senza rompere l'estensione.

**Motivazione**

`setup.ts:74` fa `import("@kilocode/kilo-gateway")` nel `bootstrap()` usando `gateway.ENV_FEATURE`, `gateway.ENV_VERSION` e `migrateLegacyKiloAuth` (riga 88). `src/index.ts:12` importa `KiloCli` da `setup.ts`. Finché questo import esiste, cancellare `packages/kilo-gateway/` rompe l'avvio di `kilo serve`.

**File da leggere**

- `packages/opencode/src/kilocode/cli/setup.ts` (intero)
- `packages/opencode/src/index.ts` (righe ~1-30, import di `KiloCli`)
- `packages/kilo-gateway/src/api/constants.ts` (valori di `ENV_FEATURE`, `ENV_VERSION`; `ENV_FEATURE = "KILOCODE_FEATURE"`)
- `packages/opencode/src/kilocode/session/index.ts` (per capire se `ENV_FEATURE` è usato altrove — no, è isolato qui)

**File da modificare**

- `packages/opencode/src/kilocode/cli/setup.ts`
- (eventualmente) `packages/opencode/src/index.ts` se espone qualcosa dipendente

**Attività**

- Definire localmente in `setup.ts` le costanti `const ENV_FEATURE = "KILOCODE_FEATURE"` e `const ENV_VERSION = <valore>` (copiare i valori letterali da `kilo-gateway/src/api/constants.ts`).
- Rimuovere la dynamic `import("@kilocode/kilo-gateway")` e sostituire gli usi di `gateway.ENV_FEATURE`/`gateway.ENV_VERSION` con le costanti locali.
- Gestire `migrateLegacyKiloAuth`: è una migrazione one-shot dell'auth legacy Kilo (device flow). Per un'estensione fully offline su provider locali, la migrazione è irrilevante → sostituirla con un no-op (o rimuoverne la chiamata, loggando che è saltata). Se `migrateLegacyKiloAuth` ha effetti collaterali su file di config usati dai provider locali, verificare e mantenere solo quel sotto-effetto; altrimenti drop.
- Verificare che nessun altro punto di `setup.ts`/`index.ts` importi il gateway.
- Marcare le modifiche con `kilocode_change` nei file ereditati dal fork.

**Output atteso**

`kilo serve` si avvia senza importare `@kilocode/kilo-gateway`. Il TUI può ancora importarlo (step successivo); il bootstrap serve è pulito.

**Verifiche**

- `rg "@kilocode/kilo-gateway" packages/opencode/src/index.ts packages/opencode/src/kilocode/cli/setup.ts` → nessun match.
- Avvio smoke: da `packages/opencode/` `bun dev serve` (o equivalente) parte senza crash su missing-module del gateway nel path `serve`.
- Il path TUI (`app.tsx`) può ancora fallire — è atteso e gestito nello Step 5.

**Compilazione**

- Da `packages/opencode/`: `bun run typecheck`.
- Risolvere errori introdotti. Il progetto deve compilare (il gateway esiste ancora, quindi nessun import rotto).

**Rischi**

- `migrateLegacyKiloAuth` potrebbe toccare file di credenziali usati anche da provider locali. Mitigato verificando gli effetti collaterali prima del drop.
- Se `ENV_VERSION` deriva da una variabile dinamica (non una stringa fissa), replicare la stessa logica di risoluzione.

**Istruzioni per il subagente**

- Implementa solo questo step. Non toccare TUI, cloud sessions, o altri import gateway (sono step dedicati).
- Non aggiungere refactoring non richiesto.
- Consulta la doc/diff di `kilo-gateway/src/api/constants.ts` per i valori esatti di `ENV_FEATURE`/`ENV_VERSION` (usa WebFetch/MCP solo se il valore non è deducibile dal file locale).
- Compila e verifica prima di terminare.

---

### Step 2 — Decollare `kilo-indexing` dal gateway

**Obiettivo**

Rendere `packages/kilo-indexing` indipendente da `@kilocode/kilo-gateway` inlineando la costante `DEFAULT_HEADERS` (oggi derivata da `getDefaultHeaders`).

**Motivazione**

`kilo-indexing/src/headers.ts:1` importa `getDefaultHeaders` dal gateway; `headers.ts:6` definisce `DEFAULT_HEADERS = getDefaultHeaders()` usato solo da `embedders/openrouter.ts:88` (header statici `User-Agent`/`Content-Type` per richieste OpenRouter). È l'unica dipendenza runtime del pacchetto. Decollarlo permette di rimuovere la dipendenza `workspace:*` e poi il pacchetto gateway.

**File da leggere**

- `packages/kilo-indexing/src/headers.ts`
- `packages/kilo-indexing/src/embedders/openrouter.ts` (uso di `DEFAULT_HEADERS`, riga ~88)
- `packages/kilo-gateway/src/headers.ts` (implementazione di `getDefaultHeaders`, righe 53-58; `getUserAgent`)
- `packages/kilo-indexing/package.json`

**File da modificare**

- `packages/kilo-indexing/src/headers.ts`
- `packages/kilo-indexing/package.json` (rimuovere `"@kilocode/kilo-gateway": "workspace:*"` riga 39)

**Attività**

- Inline in `headers.ts` una definizione locale: `export const DEFAULT_HEADERS = { "User-Agent": <user-agent>, "Content-Type": "application/json" }` replicando esattamente i valori prodotti da `getDefaultHeaders` (verificare il formato User-Agent da `kilo-gateway/src/headers.ts`).
- Rimuovere l'import dal gateway.
- Rimuovere la dipendenza `@kilocode/kilo-gateway` da `kilo-indexing/package.json`.
- Verificare che nessun altro file di `kilo-indexing` importi il gateway (grep).

**Output atteso**

`kilo-indexing` compila e funziona senza il gateway. L'embedder OpenRouter continua a inviare gli stessi header.

**Verifiche**

- `rg "@kilocode/kilo-gateway" packages/kilo-indexing/` → nessun match.
- Test indexing (se presenti) passano; l'embedder openrouter produce gli stessi header.

**Compilazione**

- `bun install` alla root (per riflettere la rimozione della dipendenza workspace), poi typecheck del pacchetto interessato (`bun turbo typecheck` o typecheck di `kilo-indexing`/`core` a seconda di chi lo consuma).
- Risolvere errori.

**Rischi**

- Il formato esatto dello `User-Agent` deve coincidere per non cambiare identificazione nelle richieste OpenRouter. Copiare la stringa/la funzione di costruzione, non inventarla.

**Istruzioni per il subagente**

- Solo questo step. Non toccare `kilo-telemetry` (Step separato).
- Se `getUserAgent` è una funzione con variabili dinamiche, replicarla localmente in modo equivalente.
- Compila prima di terminare.

---

### Step 3 — Decollare `core` dal gateway (costanti + KiloPlugin)

**Obiettivo**

Rimuovere da `packages/core` le due connessioni al gateway: (a) le costanti `PROMPTS`/`AI_SDK_PROVIDERS` usate dallo schema config v1, ri-ospitarle in un modulo condiviso del core; (b) il `KiloPlugin` (provider `kilo` del catalogo) e la sua registrazione.

**Motivazione**

- `core/src/v1/config/provider.ts:4` importa `PROMPTS`, `AI_SDK_PROVIDERS` dal gateway per gli schemi `Schema.Literals` di `prompt`/`ai_sdk_provider`. Queste costanti sono **generiche** (usate anche dai custom provider locali via `KILO_MODEL_SCHEMA_EXTENSIONS` in `opencode/src/kilocode/provider/provider.ts`), quindi vanno spostate nel core mantenendo i valori identici.
- `core/src/plugin/provider/kilo.ts` (`KiloPlugin`) riscrive il provider `kilo` verso `createKilo`/`KILO_OPENROUTER_BASE` ed è registrato in `core/src/plugin/provider.ts:17,54`. Con il provider `kilo` già fuori dal runtime, il plugin è morto.

**File da leggere**

- `packages/kilo-gateway/src/api/constants.ts` (valori esatti di `PROMPTS` e `AI_SDK_PROVIDERS`, righe 92-108)
- `packages/core/src/v1/config/provider.ts` (righe 4, 18, 20)
- `packages/opencode/src/kilocode/provider/provider.ts` (riga 9 import; usi di `PROMPTS`/`AI_SDK_PROVIDERS` in `KILO_MODEL_SCHEMA_EXTENSIONS`)
- `packages/core/src/plugin/provider/kilo.ts` (intero)
- `packages/core/src/plugin/provider.ts` (righe 17, 54)
- `packages/core/test/plugin/provider-kilo.test.ts`
- `packages/core/package.json` (riga 66)

**File da modificare**

- Nuovo: `packages/core/src/v1/config/constants.ts` (o moduli simili) con `PROMPTS` e `AI_SDK_PROVIDERS` come array `as const` (valori copiati identici dal gateway).
- `packages/core/src/v1/config/provider.ts` (import dalle nuove costanti locali invece che dal gateway)
- `packages/opencode/src/kilocode/provider/provider.ts` (import delle costanti dal nuovo modulo core invece che da `@kilocode/kilo-gateway`)
- `packages/core/src/plugin/provider/kilo.ts` (rimuovere il file)
- `packages/core/src/plugin/provider.ts` (rimuovere import + voce `KiloPlugin` dal list `ProviderPlugins`)
- `packages/core/test/plugin/provider-kilo.test.ts` (rimuovere)
- `packages/core/package.json` (rimuovere dipendenza gateway riga 66)

**Attività**

- Creare il modulo costanti nel core con `export const PROMPTS = [...] as const` e `export const AI_SDK_PROVIDERS = [...] as const` (valori identici: `PROMPTS = ["codex","gemini","beast","anthropic","trinity","anthropic_without_todo","ling","gpt55"]`, `AI_SDK_PROVIDERS = ["anthropic","openai","openai-compatible","openrouter"]`).
- Re-indirizzare gli import in `core/src/v1/config/provider.ts` e in `opencode/src/kilocode/provider/provider.ts` verso il nuovo modulo.
- Eliminare `KiloPlugin` (file + registrazione + test).
- Rimuovere la dipendenza gateway da `core/package.json`.
- Marcare `kilocode_change` dove necessario nei file ereditati.

**Output atteso**

`packages/core` non importa più `@kilocode/kilo-gateway`. Lo schema config v1 valida ancora i file esistenti (stessi literal). Il provider `kilo` non è più nel catalogo.

**Verifiche**

- `rg "@kilocode/kilo-gateway" packages/core/` → nessun match (salvo commenti).
- Uno schema di config con `prompt`/`ai_sdk_provider` valido continua a passare validazione (test schema se presenti).
- Il catalogo provider non contiene più `kilo`.

**Compilazione**

- `bun install` alla root (cambiamento dipendenze workspace), poi `bun turbo typecheck`.
- Risolvere errori. `opencode` ora importa le costanti dal core: assicurarsi che il path di import sia risolto (dipendenza `@opencode-ai/core` già presente in `opencode`).

**Rischi**

- Se `opencode` non espone correttamente il path del nuovo modulo costanti, l'import fallisce. Verificare che il modulo sia esposto nell'`exports` di `@opencode-ai/core` (aggiungere l'export point se serve).
- Valori literal diversi → break di config esistenti. Tenere identici.

**Istruzioni per il subagente**

- Solo questo step. Non cancellare ancora il pacchetto gateway (Step 8).
- Verificare l'`exports` map di `packages/core/package.json` per esporre il nuovo modulo se `opencode` lo importa via subpath.
- Usa WebFetch/MCP solo se i valori delle costanti non sono leggibili dal file locale (devono però provenire da `constants.ts` del gateway, fonte di verità pre-eliminazione).
- Compila prima di terminare.

---

### Step 4 — Decollare il server opencode dal gateway (handler + session + TUI + cloud + dialog)

**Obiettivo**

Rimuovere tutti gli import di `@kilocode/kilo-gateway` in `packages/opencode/src` tranne quelli già gestiti (Step 1 setup.ts). A questo punto solo `opencode` importerà ancora il gateway, e lo elimineremo nello Step 8.

**Motivazione**

Residui in `opencode/src`:
- `server/routes/instance/httpapi/handlers/config.ts:3,47-56` — `fetchDefaultModel` + blocco default-model del provider `kilo` (marcato `kilocode_change`).
- `kilocode/session/index.ts:17,126` — `ENV_FEATURE` (sostituire con costante locale).
- `kilocode/cli/cmd/tui/app.tsx:23,204` — `initializeTUIDependencies` dal `@kilocode/kilo-gateway/tui` (TUI rompibile).
- `kilocode/server/import-cloud-session-in-process.ts` — orfano, importa `fetchCloudSessionForImport`/`getToken`/`prepareSessionImport`/`SessionImportValidationError`.
- `kilocode/modes-migrator.ts:9` — type `OrganizationMode`.
- `kilocode/components/dialog-provider-usage.tsx:4` + feature provider-usage cloud (`core/src/kilocode/provider-usage/cloud.ts`, adapter `managed`).
- `kilocode/cloud-session.ts` + cmd `tui/run/attach/thread` (cloud sessions, TUI/headless).

**File da leggere**

- `packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts` (righe 1-60)
- `packages/opencode/src/kilocode/session/index.ts` (righe 10-30, 120-130)
- `packages/opencode/src/kilocode/cli/cmd/tui/app.tsx` (righe 20-30, 200-210)
- `packages/opencode/src/kilocode/server/import-cloud-session-in-process.ts` (intero)
- `packages/opencode/src/kilocode/modes-migrator.ts` (righe 1-20)
- `packages/opencode/src/kilocode/components/dialog-provider-usage.tsx` (righe 1-20)
- `packages/core/src/kilocode/provider-usage/cloud.ts` (adattatore `managed`)
- `packages/opencode/src/kilocode/cloud-session.ts` e i cmd `tui.ts`/`run.ts`/`attach.ts`/`thread.ts` (usi di `importCloudSession`)
- `packages/opencode/src/kilocode/provider/provider.ts` (già de-coupled nello Step 3; verificare resti)

**File da modificare**

- `handlers/config.ts` — rimuovere import `fetchDefaultModel` + il blocco `if (providers[ProviderV2.ID.kilo]) {...}` (preservando i marker `kilocode_change` adiacenti).
- `session/index.ts` — definire localmente `const ENV_FEATURE = "KILOCODE_FEATURE"`; rimuovere l'import gateway.
- `app.tsx` — neutralizzare `initializeTUIDependencies` (no-op o rimozione del blocco di init gateway nel TUI). Il TUI perde l'integrazione gateway: accettabile.
- `import-cloud-session-in-process.ts` — rimuovere il file (orfano) e qualsiasi riferimento.
- `modes-migrator.ts` — sostituire il type `OrganizationMode` importato con una definizione locale minimale o rimuovere il migrator se è solo per i mode Kilo org.
- `dialog-provider-usage.tsx` + feature provider-usage cloud — rimuovere il componente e l'adattatore `managed`/`cloud.ts` (feature "provider usage" legata al coding-plan/byok Kilo). Se il componente è montato in una screen TUI, neutralizzarne l'uso.
- `cloud-session.ts` + cmd `tui/run/attach/thread` — rimuovere `importCloudSession` e i suoi call site (o no-op). Accettabile perdere le cloud sessions nei cmd headless.

**Output atteso**

Nessun file in `packages/opencode/src` importa `@kilocode/kilo-gateway`. `kilo serve` e l'estensione funzionano; TUI/cloud-sessions perdono l'integrazione gateway.

**Verifiche**

- `rg "@kilocode/kilo-gateway" packages/opencode/src/` → nessun match.
- `kilo serve` si avvia e risponde alle chiamate SDK usate dall'estensione (`provider.list`, `media-local/stt`, ecc.).
- Il blocco default-model rimosso non cambia il comportamento per i provider locali (i locali prendono il default da `config.model`/settings, vedi Step 6).

**Compilazione**

- `bun turbo typecheck` (oppure typecheck di `opencode`).
- Risolvere errori. Il gateway esiste ancora (Step 8 lo cancella), quindi nessun import rotto.

**Rischi**

- Rimuovere `initializeTUIDependencies` potrebbe lasciare il TUI senza init necessari per altre features. Mitigato rendendolo un no-op che mantiene l'inizializzazione locale (effetti, config) e skip solo la parte gateway.
- Il provider-usage `managed` potrebbe essere usato da una screen Settings; se è così, neutralizzare la screen anziché romperla.

**Istruzioni per il subagente**

- Solo questo step. Non cancellare il pacchetto (Step 8). Non toccare UI webview (Step 5-7).
- Per ogni file, verificare se è davvero orfano (grep degli importanti) prima di eliminarlo.
- Se una feature (cloud sessions, provider usage, TUI gateway) è ancora montata in una view accessibile dall'estensione, preferire neutralizzare (no-op/disabled) piuttosto che eliminare crassamente.
- Consulta WebFetch/MCP per il contratto di `initializeTUIDependencies` se non chiaro dal file locale.
- Compila prima di terminare.

---

### Step 5 — UI: rimuovere le sezioni "recommended" e "kilo gateway" dal ModelSelector

**Obiettivo**

Nel dropdown "select model" della chat, rimuovere i gruppi **recommended** (modelli con `recommendedIndex !== undefined`) e **auto** (`auto-*`, routing gateway). Restano i modelli dei provider connessi (locali) raggruppati per provider + eventuali gruppi favorites/most-used.

**Motivazione**

`ModelSelector.tsx` (memo `groups`, righe 271-394) costruisce i gruppi nell'ordine `[favorites, auto, recommended, mostUsed, ...rest(per provider)]`. Con soli provider locali:
- `auto-*` sono i modelli di routing automatico del gateway → da togliere.
- `recommendedIndex` è metadata del catalogo Kilo (modeli "consigliati" dal gateway) → da togliere.
- `rest` (per provider) con `providerSortKey` basato su `PROVIDER_PRIORITY` (solo 6 built-in) va riordinato/raffinato: i provider locali custom non sono in quella lista.

**File da leggere**

- `packages/kilo-vscode/webview-ui/src/components/shared/ModelSelector.tsx` (costanti righe 56-72; memo `groups` 271-394; `visibleModels` 221-228; `ModelSelector` wrapper 1149+)
- `packages/kilo-vscode/webview-ui/src/components/shared/model-selector-utils.ts` (`isAuto`, `isSmall`, `providerSortKey`, `rankModelSearch`, `mostUsedModels`)
- `packages/kilo-vscode/src/shared/provider-model.ts` (`PROVIDER_PRIORITY`, `providerOrderIndex`, `isCustomProviderPackage`)
- `packages/kilo-vscode/webview-ui/src/types/messages/providers.ts` (`EnrichedModel.recommendedIndex`)
- `packages/kilo-vscode/webview-ui/src/i18n/en.ts` (chiavi `model.group.*`, righe 148-151)

**File da modificare**

- `ModelSelector.tsx` — rimuovere le costanti `AUTO_KEY`/`RECOMMENDED_KEY` (mantenere `CLEAR_KEY`/`FAVORITES_KEY`/`MOST_USED_KEY`), rimuovere i rami `autos`/`recommended` nel memo `groups`, rimuovere il push in `autos`/`recommended`. Mantenere `favorites` e `mostUsed`.
- `model-selector-utils.ts` — rimuovere/neutralizzare `isAuto`/`isSmall`/`autoChoices`/`autoSummary` se non più usati; aggiornare `rankModelSearch`/`mostUsedModels` a non considerare `recommendedIndex`.
- `provider-model.ts` — (facoltativo) estendere `PROVIDER_PRIORITY` o basare l'ordine dei gruppi "rest" su un criterio locale (es. ordine di connessione). Minimale: mantenere `providerOrderIndex` (i custom finiscono in coda, accettabile).
- `types/messages/providers.ts` — opzionale: rimuovere `recommendedIndex` da `EnrichedModel` se diventa dead field (verificare usi residui).
- `i18n/*.ts` — rimuovere le chiavi `model.group.auto` e `model.group.recommended` (in tutte le lingue).

**Output atteso**

Il dropdown mostra: (eventuale) Clear, Favorites, Most used, poi i modelli raggruppati per provider locale connesso. Nessuna sezione "Recommended" né "Auto Models". I modelli `auto-*` e quelli con `recommendedIndex` non appaiono più.

**Verifiche**

- Lancia l'estensione in dev (`bun run extension` da root) e apri il dropdown "select model": si vedono solo i modelli dei provider locali + favorites/most-used.
- `rg "recommended|auto-small|auto-" packages/kilo-vscode/webview-ui/src/components/shared/ModelSelector.tsx` → nessun ramo attivo.
- `knip` non lamenta export orfani (rimuovere helper divenuti inutilizzati).

**Compilazione**

- Da `packages/kilo-vscode/`: `bun run typecheck` e `bun run lint`.
- Risolvere errori.

**Rischi**

- Se `visibleModels` filtrava già su `connected()`, i built-in non-connessi erano già esclusi; rimuovere `recommended`/`auto` non cambia la visibilità dei locali. Verificare che un provider locale connesso mostri tutti i suoi modelli (nessun filtro implicito per `recommendedIndex`).
- Rimuovere `recommendedIndex` dal tipo potrebbe rompere altri consumer (ModelPreview, search). Preferire mantenerla come campo ignorato se usata altrove.

**Istruzioni per il subagente**

- Solo questo step. Non toccare ProvidersTab (Step 6) né STT (Step 7).
- Mantieni i gruppi favorites/most-used (decisione utente).
- Non introdurre nuovi filtri complessi: basta smettere di popolare i gruppi auto/recommended.
- Compila (typecheck+lint del webview) prima di terminare.

---

### Step 6 — UI: sezione "Providers" → solo "Custom provider" + locali connessi

**Obiettivo**

In `ProvidersTab.tsx`, rimuovere i blocchi **"Connected providers"** e **"Popular providers"** e tutta la superficie dei built-in (ProviderSelectDialog, ProviderConnectDialog, "Show more providers"). Restare la voce fissa **"Custom provider"** (+ CustomProviderDialog) e, se presente, la lista "Disabled providers".

> Nota decisione utente: era stato scelto "Custom + Connected locali". Tuttavia, poiché l'obiettivo dichiarato è "deve restare soltanto la voce 'Custom provider'" e i built-in online vengono rimossi, la lettura coerente è: mostrare la voce **Custom provider** e i **provider locali già configurati/connessi** (source `config`/`custom`/`env`), escludendo i built-in online. Implementare così: filtrare `connectedProviders` a sole voci con `source ∈ {config, custom, env}` (locali) e rimuovere "Popular providers" (che elenca built-in non-connessi). Se il filtro rende vuota la sezione connessi, mostrare comunque la voce "Custom provider".

**Motivazione**

`ProvidersTab.tsx` oggi mostra: "Connected providers" (da `provider.connected()`), "Popular providers" (built-in via `isPopularProvider`), la voce statica "Custom provider", "Show more providers" (apre `ProviderSelectDialog`), e "Disabled providers". I built-in online (Anthropic, OpenRouter, Google, Vercel…) sono in "Popular"; i custom locali hanno badge `source` (Config/Custom/Environment). Per restare su soli locali: tenere la voce Custom provider + i connessi con source locale; togliere Popular, Show more, e i dialog di connessione built-in.

**File da leggere**

- `packages/kilo-vscode/webview-ui/src/components/settings/ProvidersTab.tsx` (intero; blocchi h4 righe 148, 236; memo `connectedProviders`/`popularProviders` 38-51; `sourceTag` 65-78; voce Custom 291-336; Disabled 373-474)
- `packages/kilo-vscode/webview-ui/src/components/settings/ProviderSelectDialog.tsx`
- `packages/kilo-vscode/webview-ui/src/components/settings/ProviderConnectDialog.tsx`
- `packages/kilo-vscode/src/shared/provider-model.ts` (`CUSTOM_PROVIDER_ID`, `isCustomProviderPackage`)
- `packages/kilo-vscode/webview-ui/src/context/provider.ts` / `provider-utils.ts` (fonte dati `provider.providers()`, `connected()`)
- `packages/kilo-vscode/webview-ui/src/i18n/en.ts` (chiavi `settings.providers.*`, `dialog.provider.*`, `provider.custom.*`)

**File da modificare**

- `ProvidersTab.tsx` — rimuovere i blocchi "Popular providers" e "Show more providers"; filtrare `connectedProviders` a `source ∈ {config, custom, env}`; mantenere la voce "Custom provider" e "Disabled providers".
- Rimuovere (o non più usare) `ProviderSelectDialog.tsx` e `ProviderConnectDialog.tsx` se diventano orfani (verificare altri consumer; `CustomProviderDialog` resta).
- `provider-utils.ts` — rimuovere il carve-out `selection.providerID !== "kilo"` in `isModelValid` (riga 44): ora la validità è solo `connected.includes(providerID)`.
- `i18n/*.ts` — rimuovere chiavi `settings.providers.group.recommended`, `dialog.provider.viewAll`, tag built-in, ecc. che diventano orfane (le chiavi `provider.custom.*` e `settings.providers.tag.custom` restano).

**Output atteso**

La tab "Providers" mostra: la voce "Custom provider" (con Connect→CustomProviderDialog), i provider locali già connessi (badge Config/Custom/Environment), e la lista "Disabled providers". Nessuna voce di provider built-in online, nessun "Show more providers".

**Verifiche**

- Aprire Impostazioni → tab Providers: visibile solo "Custom provider" + eventuali locali connessi + disabled.
- `CustomProviderDialog` crea/modifica un provider OpenAI-compatible (baseURL + apiKey) e appare nella lista connessi.
- `knip`/lint: nessun componente orfano esportato.

**Compilazione**

- Da `packages/kilo-vscode/`: `bun run typecheck` + `bun run lint`.
- Risolvere errori.

**Rischi**

- Filtrare su `source` richiede che il backend esponga `source` corretto per i custom locali (già fatto in `fetchProviderData`: `source:"config"/"custom"/"env"`). Verificare che un provider creato via CustomProviderDialog abbia `source` locale e compaia.
- Se `ProviderConnectDialog` è usato anche per riconnettere un locale, valutarne la retention; altrimenti rimuoverlo.

**Istruzioni per il subagente**

- Solo questo step. Non toccare ModelSelector (Step 5) né STT (Step 7).
- Seguire la decisione: voce "Custom provider" + locali connessi; niente built-in.
- Verificare i consumer di ogni componente rimosso prima di eliminarlo (grep).
- Compila (typecheck+lint) prima di terminare.

---

### Step 7 — Rimuovere la feature Speech-to-Text (STT)

**Obiettivo**

Rimuovere interamente la feature STT: config schema, backend media-local (parte STT), estensione host-side (`src/speech-to-text/`), webview (`components/speech-to-text/`, ModelsTab row, PromptInput mic button), i18n. Mantenere la parte **image-generation** di media-local.

**Motivazione**

I modelli STT (parakeet, whisper, gpt-4o-transcribe, chirp-3) sono solo online/terzo-party; non esiste un percorso per usarli con un modello locale generico (il proxy punta a un provider OpenAI-compatible ma l'insieme di modelli è una lista fissa orientata online e la feature è storicamente legata al gateway). Essendo "solo online", si rimuove. L'image generation (stesso meccanismo media-local) resta.

**File da leggere**

- `packages/core/src/v1/config/config.ts` (righe 307-327: `speech_to_text_model`, `speech_to_text`)
- `packages/kilo-vscode/src/speech-to-text/` (`models.ts`, `catalog.ts`, `transcribe.ts`, `capture.ts`, `handler.ts`)
- `packages/kilo-vscode/webview-ui/src/components/speech-to-text/` (`availability.ts`, `model-selector.ts`, `shortcut.ts`, `SpeechToTextButton.tsx`, `SpeechToTextPrewarm.tsx`, `useSpeechToText.ts`)
- `packages/kilo-vscode/webview-ui/src/components/settings/ModelsTab.tsx` (righe 162-201, row STT)
- `packages/kilo-vscode/webview-ui/src/components/chat/PromptInput.tsx` (riga ~1599, `<SpeechToTextButton>`)
- `packages/opencode/src/kilocode/media-local/service.ts` (parti `sttModels`/`sttTranscribe`/`resolveEndpoint` audio), `group.ts` (endpoint `/stt/*`), handler `media-local.ts`, `api.ts` (`MediaLocalApi`), `server.ts`
- `packages/kilo-vscode/webview-ui/src/i18n/en.ts` (chiavi `speechToText*`, `settings.models.speechToText*`)
- `packages/kilo-vscode/src/KiloProvider.ts` (handler messaggi STT, se presenti)

**File da modificare**

- `packages/core/src/v1/config/config.ts` — rimuovere `speech_to_text_model` e `speech_to_text` da `experimental` (mantenere `image_generation*`).
- `packages/kilo-vscode/src/speech-to-text/` — rimuovere la directory.
- `packages/kilo-vscode/webview-ui/src/components/speech-to-text/` — rimuovere la directory.
- `ModelsTab.tsx` — rimuovere la `SettingsRow` STT e gli import correlati.
- `PromptInput.tsx` — rimuovere `<SpeechToTextButton>` e lo stato `speech`/`startSpeech` associati.
- Backend `media-local` — rimuovere `sttModels`/`sttTranscribe` da `service.ts`, gli endpoint `/stt/*` da `group.ts`, gli handler STT da `media-local.ts`, e le route STT dalla `MediaLocalApi`/`server.ts`. Mantenere `imgModels`/`imgGenerate`.
- `i18n/*.ts` — rimuovere tutte le chiavi `speechToText*` e `settings.models.speechToText*` (tutte le lingue).
- `KiloProvider.ts` — rimuovere gli handler di messaggio STT (es. `speechToText*`) se presenti.

**Output atteso**

Nessuna traccia di STT: nessuna config, nessun pulsante microfono, nessuna row in Models, nessuno endpoint `/media-local/stt/*`. Image generation intatta.

**Verifiche**

- `rg -i "speech_to_text|speechToText|/stt/" packages/` → nessun match (salvo eventuali commentari residui da pulire).
- `bun run script/generate.ts` dalla root per rigenerare l'SDK (gli endpoint `/media-local/stt/*` spariranno dal client gen). Poi typecheck.
- L'estensione si avvia; il pulsante microfono non è più presente in chat; image generation funziona.

**Compilazione**

- Dalla root: `bun run script/generate.ts` (regenera `packages/sdk/js/`).
- Da `packages/kilo-vscode/`: `bun run typecheck` + `bun run lint`. Da `packages/opencode/`: `bun run typecheck`.
- Risolvere errori.

**Rischi**

- Rigenerare l'SDK cambia `packages/sdk/js/src/gen/` (file generati, non editabili a mano). Assicurarsi che il diff contenga solo la rimozione degli endpoint STT.
- `resolveEndpoint` in `service.ts` è condiviso tra STT e image-gen: rimuovere solo il ramo audio, mantenere quello image.
- Se `KiloProvider.ts` ha un case di messaggio STT, rimuoverlo per evitare message-id orfani nel contract host↔webview.

**Istruzioni per il subagente**

- Solo questo step. Non toccare i passi precedenti.
- Distinguere accuratamente la parte STT da quella image-gen in `media-local` (stesso file `service.ts`/`group.ts`).
- Rigenerare l'SDK PRIMA del typecheck finale.
- Compila (opencode + kilo-vscode) prima di terminare.

---

### Step 8 — Rimuovere i pacchetti `kilo-gateway` e `kilo-telemetry` + dipendenze

**Obiettivo**

Cancellare fisicamente `packages/kilo-gateway/` e `packages/kilo-telemetry/`, rimuovere le loro dipendenze `workspace:*` da tutti i package.json, aggiornare il workspaces array root, e pulire i riferimenti residuali (`prepare-sdk.ts`, test i18n).

**Motivazione**

Dopo gli Step 1-4 nessun file in `opencode`/`core`/`kilo-indexing` importa più il gateway. `kilo-telemetry` aveva come unico vincolo `identity.ts → fetchProfile` (gateway) e l'init già assente dal runtime. Ora entrambi i pacchetti sono morti e possono andare.

**File da leggere**

- `package.json` (root, workspaces array righe 19-44)
- `packages/opencode/package.json` (riga 99), `packages/core/package.json` (riga 66), `packages/kilo-indexing/package.json` (riga 39), `packages/kilo-telemetry/package.json` (riga 22)
- `packages/kilo-vscode/script/prepare-sdk.ts` (righe 18, 22)
- `packages/kilo-vscode/tests/unit/i18n-unused-keys.test.ts` (riga 60)
- `packages/kilo-telemetry/src/identity.ts` e `__tests__/identity.test.ts` (verifica ultimo uso)
- Eventuali `turbo.json` / `tsconfig` (già verificato: nessun reference espresso)

**File da modificare / rimuovere**

- Rimuovere la directory `packages/kilo-gateway/`.
- Rimuovere la directory `packages/kilo-telemetry/`.
- Root `package.json` — togliere `"packages/kilo-gateway",` (riga 25) e `"packages/kilo-telemetry",` (riga 30) dal workspaces array.
- `packages/opencode/package.json` — togliere riga 99.
- `packages/core/package.json` — togliere riga 66.
- `packages/kilo-indexing/package.json` — togliere riga 39.
- `packages/kilo-vscode/script/prepare-sdk.ts` — togliere `"packages/kilo-telemetry"` (22) e `"packages/kilo-gateway"` (18) dagli `inputs`.
- `packages/kilo-vscode/tests/unit/i18n-unused-keys.test.ts` — togliere il path `packages/kilo-gateway` dalla lista di scan (riga 60).
- Eventuali riferimenti in `AGENTS.md`/changelog: lasciare (sono documenti, non bloccanti) oppure aggiornare se facile.

**Attività**

- Eseguire le rimozioni sopra.
- `bun install` alla root per risolvere il grafo workspace aggiornato (rimuove i link node_modules dei pacchetti eliminati).
- Verificare che non restino import/alias `@kilocode/kilo-gateway` o `@kilocode/kilo-telemetry` in alcun package.json o sorgente.

**Output atteso**

I due pacchetti non esistono più; il grafo workspace è coerente; `bun install` passa; nessun import rotto.

**Verifiche**

- `ls packages/` → non ci sono più `kilo-gateway`/`kilo-telemetry`.
- `rg "@kilocode/kilo-gateway|@kilocode/kilo-telemetry" packages/` → nessun match (salvo documentazione).
- `bun install` alla root termina senza errori.
- `bun turbo typecheck` verde.

**Compilazione**

- `bun install` (root) + `bun turbo typecheck`.
- Risolvere errori. Questo è lo step in cui eventuali import missati negli Step 1-4 emergono: correggerli qui (sono ancora correzioni di import, non nuove feature).

**Rischi**

- Un import gateway/telemetry dimenticato in un file non mappato (es. un test, uno script) rompe il typecheck. Il grep globale lo rivela; correggere.
- `prepare-sdk.ts` usa quei path per fingerprintare l'SDK: rimuoverli evita warning di dir mancante.

**Istruzioni per il subagente**

- Solo questo step. È il passo "grande pulizia".
- Dopo `bun install`, eseguire il typecheck completo e correggere qualunque import residuo emerso.
- Non reintrodurre i pacchetti.
- Compila prima di terminare.

---

### Step 9 — Pulizia finale: default settings, i18n residui, guard CI

**Obiettivo**

Ultima passata di pulizia: default factory delle settings, stringhe i18n "Kilo Gateway" residuali, CSS orfano, e validazione delle guard CI (knip, check-kilocode-change, check-workflows, check-md-table-padding).

**Motivazione**

- `packages/kilo-vscode/package.json`: `kilo-code.new.model.providerID` default `"kilo"` e `kilo-code.new.model.modelID` default `"kilo-auto/free"` puntano ancora al provider online rimosso. Portarli a `""`/`""` (decisione A7) così `computeDefaultSelection` cade su `config.model` o segnala assenza.
- i18n residuali che citano "Kilo Gateway" (`en.ts` righe 218, 584, 836, 838, 1117 + replicate in tutte le lingue) riferiti a STT/profile/balance/hide-prompt-training: aggiornare o rimuovere quelle che non hanno più senso (es. descrizioni STT già tolte nello Step 7; `profile.*`/`deviceAuth.*` se la surface account è sparita).
- `welcome.css:474` `.account-switcher-balance` (classe orfana), commenti `migration-service.ts`/`SettingsEditorProvider.ts`.
- Guard CI: knip (export orfani), `check-kilocode-change` (marker), `check-workflows`, `check-md-table-padding`.

**File da leggere**

- `packages/kilo-vscode/package.json` (proprietà `kilo-code.new.model.*`, righe ~781-1079)
- `packages/kilo-vscode/src/provider-actions.ts` (`computeDefaultSelection` 163-172)
- `packages/kilo-vscode/webview-ui/src/i18n/*.ts` (chiavi residue)
- `packages/kilo-vscode/webview-ui/src/styles/welcome.css` (riga 474)
- `packages/kilo-vscode/src/legacy-migration/migration-service.ts` (commenti device-auth, righe 452, 469)
- `packages/kilo-vscode/src/SettingsEditorProvider.ts` (commenti, righe 23, 109)

**File da modificare**

- `package.json` — settare default `kilo-code.new.model.providerID` = `""`, `kilo-code.new.model.modelID` = `""` (e aggiornare le description).
- `i18n/*.ts` — rimuovere/aggiornare le chiavi orfane o che citano "Kilo Gateway" senza più oggetto (tutte le lingue in modo coerente).
- `welcome.css` — rimuovere `.account-switcher-balance` se orfano.
- Commenti nei file indicati (cosmetico, facoltativo).

**Output atteso**

Nessun default pointing a provider online; nessuna stringa "Kilo Gateway" superflua; guard CI verdi.

**Verifiche**

- Da `packages/kilo-vscode/`: `bun run knip` (nessun export orfano), `bun run check-kilocode-change`, `bun run typecheck`, `bun run lint`, `bun run test:unit`.
- Dalla root: `bun run script/check-workflows.ts` e `bun run script/check-md-table-padding.ts`.
- `rg -i "kilo gateway|kilo-auto|api\.kilo\.ai|kiloapps" packages/kilo-vscode/` → solo eventuali riferimenti documentali voluti.

**Compilazione**

- Tutte le guard sopra devono passare. Risolvere ciò che introducono le modifiche di questo step.

**Rischi**

- Cambiare i default a `""` richiede che `computeDefaultSelection` gestisca il caso "né config.model né vscodePID/MID" senza lanciare un errore fatale all'avvio (oggi `throw new Error("No default model available")`). Verificare il caller: se un utente apre l'estensione senza aver configurato un provider locale, il messaggio default vuoto non deve crashare; eventualmente il webview mostra "no model selected". Adattare `computeDefaultSelection`/il caller a gestire il vuoto graciosamente (non throw) se serve.
- Rimuovere chiavi i18n usate ancora da qualche componente → typecheck/lint i18n le segnalano; rimuovere anche il consumer o re-introdurre la chiave.

**Istruzioni per il subagente**

- Solo questo step (pulizia finale).
- Prestare attenzione al comportamento di `computeDefaultSelection` con default vuoti: garantire un failsoft (nessun throw all'avvio).
- Eseguire TUTTE le guard CI elencate e farle passare.
- Compila e testa prima di terminare.

---

## Criteri di completamento

- Tutti gli step (1-9) completati, ciascuno verificabile in modo indipendente.
- Ogni step termina con una codebase compilabile (typecheck verde); l'unica eccezione ammessa è interna a uno step se la modifica è distribuita su due sub-step consecutivi dello stesso step.
- `packages/kilo-gateway/` e `packages/kilo-telemetry/` non esistono più; nessun package.json li riferisce.
- L'estensione si avia e funziona: `kilo serve` parte, la sidebar chat apre, il dropdown "select model" elenca solo modelli di provider locali (+ favorites/most-used), la tab "Providers" mostra solo "Custom provider" + locali connessi, non c'è il pulsante STT, l'image generation locale funziona.
- Nessuna funzionalità extra introdotta; i built-in online e i servizi Kilo (gateway, auth device-flow, balance, profile, cloud sessions, autocomplete/FIM online) non sono più raggiungibili.
- Guard CI verdi: `knip`, `check-kilocode-change`, `check-workflows`, `check-md-table-padding`, typecheck, lint, unit test.

## Domande aperte / out of scope

- [Q1] **TUI CLI standalone**: viene degradato (perde gateway-init, cloud sessions, provider-usage). Out of scope ripristinarlo; l'estensione non lo usa. Se in futuro serve un TUI offline, va ricostruito su provider locali.
- [Q2] **Catalogo models.dev**: si mantiene (`models-dev.ts` + snapshot + cache) per non rompere i fallback npm/api dei custom provider, pur essendo offline. Non si rimuove il bundle dello snapshot.
- [Q3] **Apertis**: mantenuto come provider BYOK terzo-party (non è un servizio Kilo). Se si vuole togliere anche l'unico fetch esterno residuo oltre models.dev, è un follow-up separato.
- [Q4] **Migrazione config esistente**: utenti con config che dichiarano provider online (anthropic/openrouter con API key) continueranno a validarli (lo schema non vieta i built-in); semplicemente non verranno presentati in UI. Out of scope forzare la migrazione a locali.
- [Q5] **Telemetry**: il pacchetto è rimosso; se in futuro si vuole una telemetria locale/offline, va ripensata indipendentemente.