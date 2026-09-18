# Piano: estensione fully offline — solo provider locali, nessun provider online configurabile

## Obiettivo

Rendere l'estensione VS Code **solo e soltanto offline**: l'utente può configurare **esclusivamente provider locali** (BYOK offline). Il provider **"Kilo Gateway"** (`kilo`, `kilo-auto/*`) e **tutti i provider online built-in** (anthropic, openai, openrouter, google, google-vertex, vercel, deepseek, xai, mistral, groq, cerebras, cohere, perplexity, togetherai, alibaba, snowflake-cortex, sap-ai-core, zenmux, opencode, apertis, anaconda-desktop, …) devono essere **rimossi dal codice**, non solo nascosti in UI.

Regola cardine (decisione utente): **l'utente non configurerà mai un provider online; deve configurare solo BYOK offline.** L'estensione deve quindi **rimuovere ogni possibilità di configurare/usare un provider online**. Non esiste eccezione BYOK-online: la superficie è un **whitelist** di provider locali + quelli che l'utente dichiara esplicitamente in `config.provider`.

### Perché questo copre il caso

- L'unico modo per cui l'utente configura un provider è **`CustomProviderDialog`**, che vincola il package npm a `@ai-sdk/openai-compatible` / `@ai-sdk/openai` (Responses) / `@ai-sdk/anthropic` (Messages), tutti puntati su una `baseURL` fornita dall'utente → è già BYOK offline puro.
- La superficie online viene dai **provider built-in del catalogo models.dev**, più i built-in con chiave da env (`openai` via `OPENAI_API_KEY`, `anthropic` via `ANTHROPIC_API_KEY`) che si auto-collegano ai loro endpoint online di default (non overridabili) → vanno rimossi anche quelli.
- Quindi: **whitelist = `LOCAL_PROVIDER_IDS` ∪ `{id ∈ config.provider}`**; tutto il resto è escluso senza eccezioni.

## Analisi

### Da dove nasce "Kilo Gateway" tra i connected + la lista di provider online

Pipeline verificata nel codice:

1. `packages/core/src/models-dev.ts` carica il catalogo models.dev: cache → **snapshot bundled** (`KILO_MODELS_DEV`, iniettato a build in `script/build.ts:362`) → fetch. Con `KILO_DISABLE_MODELS_FETCH=1` (forzato da `kilo-vscode/src/services/cli-backend/server-manager.ts:40`) l'estensione usa lo **snapshot bundled**, che contiene ancora `kilo` e tutti i provider online.
2. `packages/opencode/src/provider/provider.ts:1398-1400` avvolge l'**intero catalogo** in `catalog`/`database` via `fromModelsDevProvider` (riga 1315), che imposta `source:"custom"` (riga 1334). Così `kilo` passa il filtro `LOCAL_SOURCES = {env, config, custom}` di `ProvidersTab.tsx:23` e viene mostrato come **connected**.
3. `handlers/provider.ts:55-80` restituisce `connected: Object.keys(connected)` dove `connected = Provider.Service.list()`; `kilo` c'è (ha modelli dallo snapshot) → arriva al webview → riga "Kilo Gateway" sotto "Connected providers". Gli altri built-in online compaiono in "Disabled providers" / model picker perché sono nello stesso catalogo.

Conclusione: due interventi collegati — (A) togliere il provider `kilo` gateway morto, (B) **tagliare il catalogo alla whitelist locale** così i built-in online non entrano più in `catalog`/`database`/`connected` e il loro codice diventa dead e si rimuove.

### Dove vive il provider `kilo`

- `packages/core/src/provider.ts:7` — `ID = Object.assign(Provider.ID, { kilo: ... })` (marker `kilocode_change`).
- `packages/opencode/src/provider/provider.ts:887-896` — voce loader `kilo:` in `custom()`.
- `packages/opencode/src/kilocode/provider/provider.ts:53` — `variants: providerID === "kilo" ? ... : {}` in `patchModelsDevModel`.
- `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts:128` e `handlers/control.ts:22,32` — `if (ctx.params.providerID === "kilo") invalidatePresence()`.
- `packages/core/src/kilocode/provider-usage.ts:304-305` — resolve `kilo` integration + `byID.get(ProviderV2.ID.kilo)`.
- Snapshot `KILO_MODELS_DEV` (build) e cache locale contengono `kilo` + `kilo-auto/*`.
- Test che usano `"kilo"`/`kilo-auto/*` come fixture (es. `provider-model-metadata.test.ts`, `branch-name.test.ts`, `agent-manager-tool.test.ts`, `tui-sync-event.test.ts`, `provider-cost.test.ts`, `compaction.test.ts`, `websearch.test.ts`, `retry.test.ts`, `global-config-refresh.test.ts`) — fixture stringhe, ri-puntate su un id locale neutro (es. `llamacpp`).

### Dove vivono i provider online built-in

- Catalogo: snapshot `KILO_MODELS_DEV` + `models.json` cache + overlay `anaconda-desktop` + `apertis` (`opencode/src/provider/models.ts:37-52`).
- Loader inline in `opencode/src/provider/provider.ts` → `custom(dep)`: voci `anthropic`, `openai`, `meta`, `xai`, `azure`, `azure-cognitive-services`, `amazon-bedrock`, `llmgateway`, `openrouter`, `nvidia`, `vercel`, `google-vertex`, `google-vertex/anthropic`, `zenmux`, `gitlab`, `cloudflare-workers-ai`, `cloudflare-ai-gateway`, `cerebras`, `snowflake-cortex`, `alibaba`, `sap-ai-core`, `togetherai`, `perplexity`, `mistral`, `groq`, `cohere`, `deepinfra`, `github-copilot`, `venice`, ecc.
- Plugin core in `packages/core/src/plugin/provider/*.ts` registrati in `packages/core/src/plugin/provider.ts` (`ProviderPlugins`).
- Entrypoint SDK in `opencode/src/provider/provider.ts:122-149` → `BUNDLED_PROVIDERS` (mappa npm→factory; include `@ai-sdk/gateway`, `gitlab-ai-provider`, …).
- `packages/core/src/plugin/models-dev.ts` (`ModelsDevPlugin`) — popola `integration`/`catalog` per ogni provider del catalogo con `env.length>0`.

### Vincoli

- **Marker `kilocode_change`**: file ereditati dal fork (`core/src/provider.ts`, `opencode/src/provider/provider.ts`, `handlers/*`, `models-dev.ts`) richiedono marker sui blocchi Kilo; la rimozione di blocchi marcati va fatta preservando i marker adiacenti.
- **Fork isolation rule** (`opencode/AGENTS.md`): logica Kilo in mirror file sotto `src/kilocode/`, chiamata da un singolo marker nel file upstream.
- **SDK auto-generato** (`packages/sdk/js/src/gen/`): se cambiano endpoint/route server, rigenerare con `bun run script/generate.ts` dalla root. Qui non dovrebbero cambiare endpoint; verificare.
- **Knip/CI**: ogni export rimosso deve essere importato da qualche parte o tolto; `check-kilocode-change`, `check-workflows`, `check-md-table-padding`, typecheck, lint, unit test corrono in CI.
- **TUI rompibile**: l'estensione usa solo `kilo serve`; perdere funzioni TUI/cloud-sessions è accettabile.

## Assunzioni

- [A1] **Whitelist-only**: la superficie dei provider è `LOCAL_PROVIDER_IDS` ∪ `{id ∈ config.provider}`. Nessun provider esterno a questa unione entra in `catalog`/`database`/`connected`, nemmeno se ha credenziali/env (chiusura del gap BYOK-online).
- [A2] I tre package npm della CustomProviderDialog (`@ai-sdk/openai-compatible`, `@ai-sdk/openai`, `@ai-sdk/anthropic`) restano disponibili come **fallback/npm** per i custom provider locali (puntano su `baseURL` dell'utente); si toglie solo l'id `kilo` come *provider built-in*.
- [A3] I provider **locali** riconosciuti come "non-online" sono i self-host/OpenAI-compatibili presenti nello snapshot (`llamacpp`, `vllm`, `ollama`, `lm-studio`, `openai-compatible` generico) + qualsiasi id dichiarato in `config.provider` (custom). La lista esatta `LOCAL_PROVIDER_IDS` va confermata contro lo snapshot (Step 1).
- [A4] `apertis` (fetch verso api.apertis.ai) e `anaconda-desktop` (overlay) sono **non-locali**: esclusi dalla whitelist e rimossi dalla superficie.
- [A5] Il provider `opencode` free-tier è **online** (gate catalogo): escluso dalla whitelist; il suo loader in `kiloCustomLoaders` resta solo se servito da un `config.provider` utente.
- [A6] Non si tocca il runtime di sessione/tool/MCP: si agisce sul layer catalogo/loader/UI/i18n. Le sessioni esistenti che puntano a `kilo` restano valide a livello dati (out of scope la migrazione).
- [A7] `CustomProviderDialog` resta invariato nella sua semantica (già offline BYOK); non va aggiunto alcun nuovo pannello "connessione" per provider online.

## Piano di implementazione

Ogni step è eseguito da un subagente distinto, sequenziale, e termina con compilazione (typecheck verde salvo eccezione dichiarata). Ordine: prima decollarlo dal runtime (così i tagli successivi non rompono `kilo serve`), poi tagliare il catalogo alla whitelist, poi UI, poi rimuovere il codice orfano, infine cleanup + guard.

---

### Step 1 — Audit del catalogo e definizione della whitelist locale

**Obiettivo**

Determinare con precisione quali id provider sono nello snapshot `KILO_MODELS_DEV`/cache e definire la **whitelist** `LOCAL_PROVIDER_IDS` (quelli da mantenere in superficie). Prodotto: la lista canonica da usare negli step successivi.

**Motivazione**

Il taglio del catalogo (Step 3) e il filtro UI (Step 4) dipendono da una whitelist affidabile. Senza audit si rischia di escludere un locale reale o di tenerne uno online.

**File da leggere**

- `packages/opencode/script/generate.ts` e `script/build.ts` (come si produce `KILO_MODELS_DEV`)
- Lo snapshot/cache (`models.json` under cache o artefatto di build; in alternativa `packages/opencode/test/tool/fixtures/models-api.json` per enumerare gli id)
- `packages/opencode/src/provider/models.ts` (overlay apertis + anaconda)
- `packages/kilo-vscode/webview-ui/src/components/settings/provider-catalog.ts` e `provider-visibility.ts` (eventuali liste esistenti)
- `packages/kilo-vscode/src/shared/provider-model.ts` (`CUSTOM_PROVIDER_PACKAGE`, `isCustomProviderPackage`)

**Attività**

- Elencare tutti gli id provider dello snapshot.
- Classificare: **locali/self-host** (llamacpp, vllm, ollama, lm-studio, openai-compatible generico) → `LOCAL_PROVIDER_IDS`; **online/built-in** (tutti gli altri, inclusi apertis/anaconda/kilo) → da rimuovere.
- Verificare se llamacpp/vllm/ollama sono nello snapshot o solo come custom (se solo custom, la clausola `config.provider` li copre).
- Documentare la policy finale: `surface = LOCAL_PROVIDER_IDS ∪ {id ∈ config.provider}`, **nessuna eccezione per credenziali**.

**Output atteso**

Una lista `LOCAL_PROVIDER_IDS` (array di stringhe) e la regola di whitelist, pronte a essere codificate in Step 3/4.

**Verifiche**

- Lista coerente con i provider locali che l'utente usa oggi.
- apertis/anaconda/kilo classificati online/esclusi (A4/A5).

**Compilazione**

- Step di analisi: se si crea `packages/opencode/src/kilocode/local-providers.ts`, typecheck di `opencode`; altrimenti nessuna modifica a sorgente.

**Rischi**

- Lo snapshot potrebbe non essere presente in dev (solo a build). Mitigato usando il fixture JSON o forzando la generazione.

**Istruzioni per il subagente**

- Solo questo step. Non modificare ancora UI né runtime.
- Se serve WebFetch/MCP per capire il formato dello snapshot, usarlo.
- Compila se tocchi sorgente.

---

### Step 2 — Rimuovere il provider `kilo` gateway dal runtime

**Obiettivo**

Eliminare ogni riferimento al provider `kilo` dal runtime, così `kilo serve` non lo produce più e non appare più in `connected`.

**Motivazione**

`kilo` è il "Kilo Gateway": senza gateway (rimosso nel piano precedente) è morto. Va tolto da ID, loader, patch, handler e provider-usage.

**File da leggere**

- `packages/core/src/provider.ts` (riga 6-7, blocco `kilocode_change`)
- `packages/opencode/src/provider/provider.ts` (righe 887-896 loader `kilo:`)
- `packages/opencode/src/kilocode/provider/provider.ts` (riga 53 `providerID === "kilo"`)
- `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts` (riga 128) e `handlers/control.ts` (righe 22, 32)
- `packages/core/src/kilocode/provider-usage.ts` (righe 304-305)
- Grep globale `ProviderV2.ID.kilo|=== "kilo"|id: "kilo"|kilo-auto` in `packages/opencode/src` e `packages/core/src`

**File da modificare / rimuovere**

- `core/src/provider.ts` — rimuovere l'override `kilo` da `ID` (preservare i marker adiacenti).
- `opencode/src/provider/provider.ts` — rimuovere la voce `kilo:` da `custom()`.
- `opencode/src/kilocode/provider/provider.ts` — semplificare `patchModelsDevModel` (ramo `kilo` morto).
- `handlers/provider.ts` + `handlers/control.ts` — rimuovere i `if (... === "kilo") invalidatePresence()` (o renderli no-op).
- `core/src/kilocode/provider-usage.ts` — rimuovere il ramo `kilo` (resolve/byID) se ora orfano.

**Attività**

- Eseguire le rimozioni sopra.
- Ri-puntare le **test fixtures** che usano `"kilo"`/`kilo-auto/*` a un id locale neutro (es. `llamacpp` + modello `qwen2.5`) — `provider-model-metadata.test.ts`, `branch-name.test.ts`, `agent-manager-tool.test.ts`, `tui-sync-event.test.ts`, `provider-cost.test.ts`, `compaction.test.ts`, `websearch.test.ts`, `retry.test.ts`, `global-config-refresh.test.ts` (e `oauth-branding.test.ts` se verifica `originator:"kilo"` in openai.ts: adeguare l'assert se quel branding resta).
- Verificare che nessun altro punto produca `kilo` in `connected`.

**Output atteso**

`kilo serve` avvia; `GET /provider` / `/config/providers` non contengono più `kilo`; nessun test fallisce per `kilo`.

**Verifiche**

- `rg "ID.kilo|\"kilo\"|kilo-auto" packages/opencode/src packages/core/src` → solo eventuali marker/commenti residui da pulire.
- Smoke: da `packages/opencode/` `bun run --conditions=browser ./src/index.ts serve --port 0` → avvio ok; chiamare l'endpoint provider e verificare assenza di `kilo`.
- `bun turbo typecheck` (root) verde.

**Compilazione**

- `bun turbo typecheck`. Risolvere errori. Nessun import rotto atteso.

**Rischi**

- `invalidatePresence` per `kilo` potrebbe essere l'unico caller di quella funzione → se orfano, valutarne retention/drop (knip).
- Fixture condivise: assicurarsi che la re-mappatura su `llamacpp` non cambi l'outcome atteso (adattare le asserzioni senza indebolirle).

**Istruzioni per il subagente**

- Solo questo step. Non toccare il filtro catalogo (Step 3) né UI (Step 4).
- Marker `kilocode_change` da preservare nei file ereditati.
- Compila e fai smoke prima di terminare.

---

### Step 3 — Tagliare il catalogo alla whitelist locale (cut del dato)

**Obiettivo**

Far sì che il catalogo usato dal provider service contenga **solo** `LOCAL_PROVIDER_IDS ∪ {id ∈ config.provider}`, in modo che i built-in online non entrino più in `catalog`/`database`/`connected` né nelle liste esposte. È il "taglio" che rende morti i loader online.

**Motivazione**

Anziché disabilitare ~30 provider uno a uno, si filtra l'intera fonte (`modelsDevSvc.get()`) con la whitelist di Step 1. Chiusura del gap BYOK-online: **nessun** id esterno alla whitelist passa, indipendentemente da credenziali/env. I built-in online (inclusi `openai`/`anthropic` key'd da env) spariscono.

**File da leggere**

- `packages/opencode/src/provider/provider.ts` (righe 1398-1401 costruzione `catalog`/`database`; 1438-1446 `configProviders`/`disabled`/`enabled`; 1598-1617 merge env/apikeys)
- `packages/core/src/models-dev.ts` (fonte dati)
- La lista `LOCAL_PROVIDER_IDS` prodotta in Step 1
- `opencode/src/provider/models.ts` (overlay apertis/anaconda da escludere)

**File da modificare**

- Nuovo modulo: `packages/opencode/src/kilocode/local-providers.ts` (mirror, per fork-isolation) con `LOCAL_PROVIDER_IDS` e una funzione `inLocalSurface(id, configuredIds) => boolean` che restituisce `LOCAL_PROVIDER_IDS.has(id) || configuredIds.has(id)`.
- `opencode/src/provider/provider.ts` — dopo `const modelsDev = yield* modelsDevSvc.get()`, applicare il filtro **prima** di costruire `catalog`/`database`: `const filteredCatalog = pickBy(modelsDev, (_item, id) => inLocalSurface(id, new Set(Object.keys(cfg.provider ?? {}))))`. Escludere `apertis`/`anaconda-desktop` dall'overlay presentato (A4).

**Attività**

- Implementare il filtro whitelist: un id è in superficie **iff** è in `LOCAL_PROVIDER_IDS` oppure è dichiarato in `cfg.provider`. Nient'altro.
- Garantire che i provider custom (creati via `CustomProviderDialog`, `source:config/custom`) restino visibili: hanno `config.provider[id]`.
- Preservare i marker `kilocode_change` e aggiungere il marker sul nuovo blocco filtro.

**Output atteso**

`catalog`/`database` contengono solo whitelist + configurati. `kilo serve` avvia. I built-in online (anche quelli key'd da env) non compaiono più in `connected` né nelle liste.

**Verifiche**

- Smoke `kilo serve` + endpoint provider: la lista `all`/`connected` contiene solo whitelist/configurati; impostare `OPENAI_API_KEY` non fa comparire `openai`.
- Un custom provider OpenAI-compatible configurato continua a comparire e a funzionare.
- `bun turbo typecheck` verde.

**Compilazione**

- `bun turbo typecheck`. Risolvere errori.

**Rischi**

- Se un test presuppone un built-in online presente nel catalogo, adeguarlo (ora è assente per design).
- Assicurarsi che il filtro non interferisca con la risoluzione `npm`/`api.url` dei custom (che leggono `modelsDev[providerID]?.npm`): per i custom la `npm` viene da `config.provider`, quindi l'esclusione dal catalogo non li rompe.

**Istruzioni per il subagente**

- Solo questo step. Non tagliare ancora i loader/plugin (Step 5): qui si agisce solo sul dato.
- Riusare la lista di Step 1. Nessuna eccezione "ha credenziali".
- Compila prima di terminare.

---

### Step 4 — UI: tab Providers = solo "Custom provider" + locali connessi

**Obiettivo**

In `ProvidersTab.tsx` garantire che "Connected providers" mostri **solo** i provider in superficie (whitelist ∪ configurati, source `env`/`config`/`custom`) e che la voce fissa "Custom provider" resti. Con il taglio di Step 3 i built-in online non arrivano più; si rafforza il filtro lato UI per robustezza e si riflette la whitelist anche in "Disabled providers".

**Motivazione**

Doppia sicurezza: anche se un built-in dovesse restare nei dati, la tab mostra solo la voce Custom + i locali; il blocco "Disabled providers" elenca solo ciò che è in superficie.

**File da leggere**

- `packages/kilo-vscode/webview-ui/src/components/settings/ProvidersTab.tsx` (memo `connectedProviders` righe 37-44; `LOCAL_SOURCES` riga 23; `sourceTag` 57-70; blocco Connected 139-225; Custom 227-276; Disabled 278-379)
- `packages/kilo-vscode/webview-ui/src/components/settings/provider-visibility.ts` (`disabledProviderOptions`)
- `packages/kilo-vscode/webview-ui/src/context/provider.ts` / `provider-utils.ts` (fonte dati `providers()`/`connected()`)

**File da modificare**

- `ProvidersTab.tsx` — estendere il filtro `connectedProviders` a `LOCAL_SOURCES.has(source) && inLocalSurfaceId(item.id)` (lista condivisa o copia webview). Far operare `disabledProviderOptions` sulla stessa superficie ridotta.
- Eventuale helper webview `inLocalSurfaceId` in `provider-catalog.ts`, allineato alla whitelist host.

**Attività**

- Applicare il doppio filtro (source locale + id in whitelist/configurati).
- Confermare che la voce "Custom provider" sia sempre renderizzata e che `CustomProviderDialog` crei/modifichi un provider OpenAI-compatible (resta intatta, già offline).
- Verificare che `ProviderConnectDialog` (usato per ChatGPT/Anaconda/BYOK) resti raggiungibile solo per provider in superficie (con i built-in online rimossi, i suoi casi online spariscono).

**Output atteso**

Tab Providers: voce "Custom provider" + i locali connessi (badge Config/Custom/Environment) + "Disabled providers" limitato alla whitelist. Nessun "Kilo Gateway", nessun built-in online.

**Verifiche**

- Aprire Impostazioni → tab Providers (dev launch `bun run extension` o test mirati): visibile solo Custom + locali + disabled locali.
- `bun run knip`/`lint` da `packages/kilo-vscode/`: nessun componente orfano.
- Typecheck + lint verdi.

**Compilazione**

- Da `packages/kilo-vscode/`: `bun run typecheck` + `bun run lint`. Risolvere errori.

**Rischi**

- Se la whitelist webview diverge da quella host, un locale potrebbe non mostrare. Allineare le due fonti (meglio: esporre la superficie già filtrata dal backend nel payload `providers`, così il webview non rifiltra).

**Istruzioni per il subagente**

- Solo questo step. Non toccare ModelSelector (già fatto) né STT.
- Preferire fidarsi del dato già filtrato dal backend (Step 3) e usare il filtro UI come safety net.
- Compila (typecheck+lint) prima di terminare.

---

### Step 5 — Rimuovere i loader/plugin/SDK entrypoint dei provider online (whitelist-only)

**Obiettivo**

Rimuovere dal codice i provider online divenuti dead dopo il taglio whitelist (Step 3): voci loader in `custom()`, plugin core in `ProviderPlugins`, e entrypoint in `BUNDLED_PROVIDERS` che non servono a whitelist + custom.

**Motivazione**

Con la whitelist, i built-in online non vengono più istanziati: i relativi loader/plugin/entrypoint sono dead code. Toglierli realizza "completely removed from the code" e fa passare knip.

**File da leggere**

- `packages/opencode/src/provider/provider.ts` → `custom(dep)` (righe ~183-1000): identificare le voci da rimuovere (tutte quelle non-whitelist/non-custom) e `BUNDLED_PROVIDERS` (righe 122-149)
- `packages/core/src/plugin/provider.ts` (`ProviderPlugins`, righe 35-69) e i singoli `packages/core/src/plugin/provider/<x>.ts`
- `packages/opencode/src/kilocode/provider/provider.ts` (`kiloCustomLoaders`: `github-copilot-enterprise`, `opencode`)
- Grep degli import/usi di ogni plugin prima di rimuoverlo

**File da modificare / rimuovere**

- `opencode/src/provider/provider.ts` — rimuovere le voci `custom()` non-whitelist e le relative righe in `BUNDLED_PROVIDERS`. **Mantenere** `@ai-sdk/openai-compatible`, `@ai-sdk/openai`, `@ai-sdk/anthropic` (i tre package della CustomProviderDialog) e quanto serve ai locali.
- `core/src/plugin/provider.ts` — rimuovere i plugin non-whitelist da `ProviderPlugins`; cancellare i file `plugin/provider/<x>.ts` orfani.
- `opencode/src/kilocode/provider/provider.ts` — snellire `kiloCustomLoaders` (togliere `github-copilot-enterprise`; tenere `opencode` solo se servito da config).
- `core/src/plugin/models-dev.ts` (`ModelsDevPlugin`) — neutralizzare (no-op) se con il taglio non aggiunge più nulla, per non rompere il reload eventi.

**Attività**

- Per ogni candidato: grep import/usi; se orfano, rimuovere loader/plugin/entrypoint.
- Conservare rigorosamente: `openai-compatible` (+ `openai`/`anthropic` come package custom) e i plugin dei provider in `LOCAL_PROVIDER_IDS`.
- Neutralizzare `ModelsDevPlugin` se sennò orfano.

**Output atteso**

Nessun loader/plugin/entrypoint online; knip pulito; `kilo serve` avvia; i locali + custom funzionano.

**Verifiche**

- `bun run knip` da `packages/kilo-vscode/` (e dai pacchetti toccati): nessun export orfano.
- `bun turbo typecheck` verde.
- Smoke `kilo serve` + un custom provider funziona.

**Compilazione**

- `bun turbo typecheck` (+ `bun run knip`). Risolvere errori. Se la rimozione di un plugin rompe un import altrove, correggere l'import (fix di import, non nuova feature).

**Rischi**

- Rimuovere un loader ancora usato da un locale/custom lo spegnerebbe. Mitigato tenendo i package custom + i plugin in whitelist.
- `ModelsDevPlugin` alimenta il reload catalogo: preferire no-op controllato.

**Istruzioni per il subagente**

- Solo questo step. Non reintrodurre provider.
- Verificare sempre gli import prima di eliminare.
- Compila (typecheck + knip) prima di terminare.

---

### Step 6 — Pulizia finale: default settings, i18n residui, CSS, guard CI

**Obiettivo**

Ultima passata: default factory delle settings (confermare `""`), stringhe i18n residue "Kilo Gateway"/provider online, CSS orfano, e validazione di tutte le guard CI.

**Motivazione**

Chiusura: niente default che punti a provider online, niente stringhe "Kilo Gateway" superflue, guard verdi.

**File da leggere**

- `packages/kilo-vscode/package.json` (proprietà `kilo-code.new.model.*`)
- `packages/kilo-vscode/src/provider-actions.ts` (`computeDefaultSelection`, failsoft su default vuoti)
- `packages/kilo-vscode/webview-ui/src/i18n/*.ts` (chiavi residue `model.group.*`, `settings.providers.*`, `provider.*` per built-in, menzioni "Kilo Gateway")
- `packages/kilo-vscode/webview-ui/src/styles/welcome.css` (classi orfane tipo `.account-switcher-balance`)
- Commenti stale in `migration-service.ts` / `SettingsEditorProvider.ts`

**File da modificare**

- `package.json` — confermare default `kilo-code.new.model.providerID/modelID = ""` (aggiornare description se serve).
- `i18n/*.ts` — rimuovere le chiavi orfane/menzionanti provider online/Kilo Gateway senza più oggetto (tutte le lingue in modo coerente).
- `welcome.css` — rimuovere classi orfane.
- Eventuali commenti (cosmetico).

**Attività**

- Eseguire la pulizia.
- Verificare `computeDefaultSelection` failsoft (nessun throw all'avvio con default vuoto + nessun provider locale).
- Lanciare TUTTE le guard e farle passare.

**Verifiche (guard)**

- Da `packages/kilo-vscode/`: `bun run knip`, `bun run check-kilocode-change`, `bun run typecheck`, `bun run lint`, `bun run test:unit`.
- Dalla root: `bun run script/check-workflows.ts`, `bun run script/check-md-table-padding.ts`.
- `rg -i "kilo gateway|kilo-auto|api\.kilo\.ai|kiloapps" packages/kilo-vscode/` → solo riferimenti documentali voluti.
- `rg -i "speech_to_text|speechToText|/stt/" packages/` → clean (riconferma).

**Output atteso**

Guard verdi; nessun default/provider online residuo; stringhe "Kilo Gateway" assenti dalla UI.

**Compilazione**

- Tutte le guard sopra passano; risolvere ciò che le modifiche introducono.

**Rischi**

- Chiave i18n ancora consumata → typecheck/lint la segnalano; rimuovere il consumer o re-introdurre la chiave.
- Cambiare un default a vuoto richiede failsoft (gestito).

**Istruzioni per il subagente**

- Solo questo step (pulizia finale).
- Prestare attenzione al failsoft di `computeDefaultSelection`.
- Eseguire TUTTE le guard e farle passare.
- Compila e testa prima di terminare.

---

## Criteri di completamento

- Tutti gli step (1-6) completati, ciascuno verificabile in modo indipendente.
- Ogni step termina con codebase compilabile (typecheck verde).
- In tab **Providers**: solo la voce "Custom provider" + i provider locali in whitelist/configurati + "Disabled providers" limitato alla whitelist. **Nessuna** voce "Kilo Gateway" e nessun built-in online.
- `kilo serve` avvia; un custom provider OpenAI-compatibile funziona end-to-end.
- **Nessun provider online è configurabile/usa bile**: impostare una chiave env (es. `OPENAI_API_KEY`) o una API key non fa comparire/usare un built-in online (whitelist-only).
- Il provider `kilo` e i suoi modelli `kilo-auto/*` non sono più prodotti dal runtime; i loro loader/ID sono rimossi.
- I built-in online non sono più presentati e il relativo codice orfano è stato rimosso (knip pulito).
- Guard CI verdi: `knip`, `check-kilocode-change`, `check-workflows`, `check-md-table-padding`, typecheck, lint, unit test.

## Domande aperte / out of scope

- [Q1] **BYOK online**: risolto — **soppresso**. L'estensione è whitelist-only: un provider online (anthropic, openai, openrouter, …) non è né presentabile né utilizzabile, indipendentemente da API key/env/OAuth. L'utente configura solo BYOK offline tramite `CustomProviderDialog`.
- [Q2] **Config esistente con provider online**: se l'utente ha in `config.provider` un id online (es. `openrouter`), la clausola `config.provider` lo mantiene in superficie (scelta dell'utente). Out of scope forzare la migrazione a locali; un follow-up potrebbe bloccare esplicitamente gli id online in `config.provider`.
- [Q3] **Snapshot bundled**: si mantiene il meccanismo `KILO_MODELS_DEV` (serve ai custom provider il metadata + fallback npm); il taglio avviene a runtime sul set presentato (whitelist), non riscrivendo lo snapshot.
- [Q4] **Sessioni esistenti** che puntano a `kilo`/modelli online restano a livello dati (out of scope la migrazione, coerente col piano precedente).