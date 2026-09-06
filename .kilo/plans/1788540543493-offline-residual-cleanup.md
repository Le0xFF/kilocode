# Piano: chiusura definitiva del funzionamento offline (solo provider OpenAI-compatibili locali)

## Obiettivo

Audit approfondito della codebase post-commit `cfacab50d3` per trovare ciò che è sfuggito alle
rimozioni precedenti dei servizi online Kilo. L'estensione VS Code e il suo backend `kilo serve`
devono funzionare **completamente offline**: gli unici provider utilizzabili sono quelli
OpenAI-compatibili dichiarati dall'utente in `config.provider` (llama.cpp, vLLM, Ollama, LM Studio).
Nessun provider online deve poter entrare in superficie né aprire connessioni in uscita.

Esito dell'audit: **l'implementazione non è ancora completa**. Il picker dei modelli è protetto
(hard cut verificato in `handlers/provider.ts:48-97` e `provider.ts:572-577`), ma restano buchi
funzionali (provider online che riescono a rientrare in `connected`, fetch verso l'esterno non
coperti dal flag offline, UI che implica servizi cloud) e un ingente residuo di codice morto.
Questo piano li risolve in step sequenziali, uno per subagente, con compilazione e revisione utente
a ogni passo.

Principio guida delle correzioni (decisioni utente): **se una funzione deve essere nascosta alla
webview, va rimossa del tutto** — niente toggle/comment-out che lasciano tracce inaccessibili —
purché la rimozione non comprometta le funzionalità normali dell'estensione. In particolare: il
tool websearch viene rimosso completamente (backend + UI + schema + i18n + test); le variabili
d'ambiente online inutilizzate vengono eliminate interamente; lo snapshot models.dev generato in
questa repo viene rigenerato senza alcun provider/modello online.

## Analisi

### Verificato corretto nei commit precedenti

| Area | Stato | Evidenza |
|---|---|---|
| Hard cut catalogo in `GET /provider` | OK | `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts:50-61`: `credentials`+`connected` calcolati prima, `inLocalSurface(id, config.provider ∪ creds ∪ connectedIds)` applicato al catalogo grezzo prima dell'overlay anaconda-desktop |
| Cut service-level in `Provider.Service` | OK | `packages/opencode/src/provider/provider.ts:573-577` (`inLocalSurface` su `cfg.provider`) |
| `KILO_DISABLE_MODELS_FETCH` forzato | OK | `packages/kilo-vscode/src/services/cli-backend/server-manager.ts:40`; disattiva sia il refresh periodico 60 min (`core/src/models-dev.ts:268-271`) sia il fallback fetch in `populate()` (`models-dev.ts:227`) |
| Telemetry / PostHog / OTel PostHog | Rimosso | nessun consumer in scope; OTLP attivo solo se `OTEL_EXPORTER_OTLP_ENDPOINT` impostata |
| Gateway, KiloSessions, marketplace, claw, cloud sessions (host) | Rimosso | route `/kilo/*` smontate; `provider-usage/cloud.ts` no-op stub; presence no-op; `SessionShare.share` → "not available in this build" |
| `kilo serve` a boot | 0 connessioni in uscita | tracciato end-to-end: con env dell'estensione (flag + nessun account/wellknown/MCP remoto/skills URLs/OTLP/mdns) nessuna chiamata parte all'avvio né al primo request |
| Suggestion service | Locale | `opencode/src/suggestion/index.ts` → in-process bus; il generatore è il modello della sessione stessa |
| Apertis | Dormiente | `delete providers["apertis"]` in `opencode/src/provider/models.ts:26`; nessun caller di `cache.fetch("apertis")` |
| Remote control backend | Stub | `opencode/src/kilocode/server/httpapi/handlers/remote.ts:5` → sempre `{enabled:false, connected:false}`; `enable` → 401 |

### Buoi funzionali rimasti (da chiudere)

| # | Buco | Dove | Come si manifesta offline |
|---|---|---|---|
| F1 | **Auto-connect "OpenCode Zen"**: `opencode` resta nel catalogo models.dev (verificato nello snapshot cache: `api: https://opencode.ai/zen/v1`, `npm: @ai-sdk/openai-compatible`, ha modelli free a costo zero). Non è in `LOCAL_PROVIDER_IDS` né in `config.provider` → sopravvive a entrambi i cut; il loader inline (`provider.ts:139-161`) lo auto-connette con `apiKey:"public"` → appare in `connected` e nel picker come "OpenCode Zen"; usarlo fa traffico verso opencode.ai | `packages/opencode/src/provider/provider.ts:136-164`; `packages/core/src/plugin/provider/opencode.ts`; `packages/core/src/v1/config/constants.ts:17` (`OPENCODE_API_KEY` nella lista env); snapshot/cache models.dev | Un provider online visibile e selezionabile senza alcuna configurazione dell'utente |
| F2 | **Env ereditato dallo spawn**: `server-manager.ts:128` passa `{...process.env, ...overrides}` al child → variabili online (`OPENCODE_API_KEY`, `EXA_API_KEY`, `PARALLEL_API_KEY`, `APERTIS_*`, `MODAL_PROXY_TOKEN`) presenti nell'ambiente della shell dell'utente possono riattivare provider online (ramo env `provider.ts:770-789`). Le uniche letture dirette di `process.env` per queste key vivono nei file che il piano rimuove interamente (websearch, model-cache apertis, plugin modal) | `packages/kilo-vscode/src/services/cli-backend/server-manager.ts:32-42,128` | Dipende dall'ambiente utente; chiuso strutturalmente dalla rimozione dei consumer + snapshot senza provider online |
| F3 | **Re-entry plugin-auth**: loop `provider.ts:804-822` — per ogni plugin con auth hook, se esiste una credenziale salvata (`auth.get`) il loader esegue e `mergeProvider` semi-provider assenti dal database cut via `EMPTY_PUBLIC_INFO` (`provider.ts:605-613`). Con la macchina fresca (auth.json vuoto) NON riprende (verificato: i loader tornano `{}` senza token oauth); ma basta un OAuth/API key salvata (Codex, Copilot, xAI, Snowflake, DigitalOcean, Cloudflare, Azure, GitLab, Poe) perché il provider online rientri in `connected`/`all` con i suoi modelli completi (il handler ammette gli id `connected`) | `packages/opencode/src/provider/provider.ts:598-622,605-613,804-822` | Chi ha usato in passato un provider online (es. ChatGPT/Codex) lo ritrova connesso anche in offline |
| F4 | **Websearch solo-online**: tool websearch con soli backend `exa` (`https://mcp.exa.ai/mcp`) e `parallel` (`https://search.parallel.ai/mcp`); nessuna opzione locale. Toggle "Web search" in BrowserTab, permisi `websearch`, flag `KILO_ENABLE_EXA/PARALLEL`, schema `web_search`. → da rimuovere COMPLETAMENTE (backend + UI + schema + i18n + test), senza alcuna traccia residua | `packages/core/src/tool/websearch.ts`; `packages/opencode/src/tool/{websearch,mcp-websearch}.ts`; `registry.ts`; `BrowserTab.tsx`; `config.ts:246-248`; `flag.ts:85,103`; `runtime-flags.ts:34-42`; i18n; test (elenco completo nello Step 4) | Oggi: attivando web search ogni invocazione va online; dopo lo step: funzione assente |
| F5 | **Embedding provider online esposti**: IndexingTab elenca OpenAI/Gemini/Mistral/Vercel AI Gateway/Bedrock/OpenRouter/Voyage oltre a Ollama/openai-compatible (gli unici localizzabili). Nota: il worker di indexing non parte sotto `KILO_PLATFORM=vscode` (`opencode/src/kilocode/bootstrap.ts:48-57`), quindi è latente, ma la UI offre comunque scelte online → restringere la selezione agli embedder locali (ollama, openai-compatible) | `packages/kilo-indexing/src/indexing/service-factory.ts:80-133`; `webview-ui/src/components/settings/IndexingTab.tsx:30-40,62-88` | Utente seleziona un embedder online → traffico esterno quando l'indexing gira |
| F6 | **UI che implica servizi cloud**: (a) sezione "Remote Control" in Experimental (`ExperimentalTab.tsx:31-83`) — backend stub permanente, da rimuovere interamente (sezione + `/remote` + message type + `RemoteStatusService`); (b) sezione Telemetry + link kilo.ai/discord e kilo.ai/support in AboutKiloCodeTab (`AboutKiloCodeTab.tsx:219,232-261`); (c) riga "Kilo Gateway BYOK" con link blog.kilo.ai resa in OGNI dialog di connessione API-key (`ProviderConnectDialog.tsx:533-546`); (d) card errore paid-model "Sign In"/promotion "Sign Up" con bottoni no-op (`ErrorDisplay.tsx:83-106`, `onLogin` mai passata da `TranscriptRow.tsx:140`); (e) fallback form hardcodati amazon-bedrock/google-vertex (`ProviderConnectDialog.tsx:70-120`, i18n `cloud-provider.ts`); (f) "Sign in with ChatGPT" + tag "ChatGPT" in ProvidersTab (`ProvidersTab.tsx:78,134-142,207-211`) — raggiungibile solo se openai/oauth arriva in `connected` (F1/F3) | webview-ui vari file citati | Superficie visiva non-offline; tutte le funzioni vanno rimosse del tutto (non nascoste) |
| F7 | **Browser automation**: setting `kilo-code.new.browserAutomation.enabled` registra `npx @playwright/mcp@latest` → install da registry npm alla prima attivazione (default `false`, quindi condizionale). Si MANTIENE (feature utile, attivazione esplicita dell'utente) ma la description del setting deve dichiarare che richiede accesso a npm registry | `extension.ts:63`; `browser-automation-service.ts:70,80`; `package.json` contribution | Solo se l'utente attiva la feature; documentato come eccezione volontaria |
| F8 | **CLI raw-catalog consumers**: `kilo auth login` (`cli/cmd/providers.ts:367-420`, con `refresh(true)` a :360) e `kilo auth list` (`providers.ts:267`) mostrano l'intero catalogo grezzo (tutti i provider online) come target di login; `kilo models --refresh` (`cli/cmd/models.ts:29`) forza il fetch models.dev; `kilo github install` (`github.handler.ts:170`) fa scegliere dal catalogo grezzo. Rompe solo il TUI/CLI standalone, non l'estensione, ma contraddice il contratto offline | `packages/opencode/src/cli/cmd/*.ts` | TUI/CLI mostra provider online |
| F9 | **$schema app.kilo.ai** incorporato nei file di config creati dall'estensione (l'IDE può fetchare lo schema): `kilo-provider/config-file.ts:31,114`; stesso pattern in `opencode/src/config/config.ts:339,341,394,414,624` e `tui-migrate.ts:12` | host + core/opencode | Latente, guidato dall'IDE |

### Residui di codice morto / dati (da pulire)

| # | Residuo | Dove |
|---|---|---|
| D1 | Plugin online registrati in `internalPlugins` anche se inutilizzabili offline: Codex(openai), Copilot, Modal, GitLab, Poe, Cloudflare×2, Azure, DigitalOcean, Snowflake, xAI (`opencode/src/plugin/index.ts:68-91`); dipendenze npm correlate in `opencode/package.json` (`opencode-gitlab-auth`, `opencode-poe-auth`, `gitlab-ai-provider`, `@gitlab/gitlab-ai-provider`, `venice-ai-sdk-provider`, `ai-gateway-provider`, `@openrouter/ai-sdk-provider`, `google-auth-library`, tutti gli `@ai-sdk/*` cloud tranne openai/openai-compatible/anthropic, `bonjour-service` per `--mdns`, `xlsx` da CDN tarball) | `packages/opencode/src/plugin/index.ts`, `packages/opencode/package.json` |
| D2 | `BUNDLED_PROVIDERS` contiene ancora `@ai-sdk/anthropic` e `@ai-sdk/openai` (online-default) oltre all'openai-compatible necessario (`provider.ts:110-116`); `AI_SDK_PROVIDERS` include `anthropic`/`openrouter` (`core/src/v1/config/constants.ts:17`) | provider + core |
| D3 | `patchCustomLoaderResult` con casi zenmux/openrouter/vercel/cerebras/azure mai chiamati (`kilocode/provider/provider.ts:~174`); rami provider-specifiche dormienti in `transform.ts` (mistral/openai/anthropic/bedrock/vertex/nvidia/meta/baseten/alibaba/azure/openrouter/llmgateway/venice/moonshotai/google…) e in `getSmallModel`/priorità default-model (`gpt-5`, `claude-sonnet-4`, `gemini-3-pro`, `big-pickle`) | `kilocode/provider/provider.ts`, `provider/transform.ts`, `provider.ts:1172-1252` |
| D4 | Macchinario apertis in `model-cache.ts` (costante URL, `fetchApertisModels`, env `APERTIS_*`) senza caller | `opencode/src/provider/model-cache.ts:39-135` |
| D5 | `PROVIDER_PRIORITY = ["anthropic","deepseek","openai","google","openrouter","vercel"]` nel webview (`webview-ui/src/shared/provider-model.ts:7-14`) | webview |
| D6 | I18n orfani (~82 chiavi in en.ts replicate in ~20 locale files): `sidebar.topBar.kiloClaw/.marketplace/.profile`, famiglia `profile.*` (51), `deviceAuth.*` (19), `session.cloud*` (9), `dialog.provider.tag.recommended`; le prime quattro famiglie sono PROTETTE esplicitamente in `tests/unit/i18n-unused-keys.test.ts:63` (lista runtime) → vanno tolte da lì insieme alle chiavi | `webview-ui/src/i18n/*.ts`, test |
| D7 | Dipendenze morte nell'estensione: `qrcode` (devDep, era del device-flow QR) | `kilo-vscode/package.json` |
| D8 | Tipi messaggio morti: `SelectKiloModelMessage` (`extension-messages.ts:278`), `SyncSessionRequest`/`UnsyncSessionRequest` (`webview-messages.ts:521-532`), guard `cloud:` session-id + modulo `session-cloud-prune.ts` | webview + context/session |
| D9 | TUI-only (rompibile accettabile, decisionale): KiloClaw route/views + dialog con URL app.kilo.ai/claw, console-org dialog, model-picker con grouping "kilo", keybind `news_toggle` morta, `DOCS_URL` kilo.ai/docs (`tui/src/app.tsx`, `component/dialog-console-org.tsx`, `kilocode/components/dialog-claw-*.tsx`, `config/keybind.ts:227,409`, `cli/cmd/tui/app.tsx:46`) | packages/tui + opencode kilocode TUI |
| D10 | Snapshot `KILO_MODELS_DEV`: generato IN QUESTA repo da `script/generate.ts` (fetch models.dev, override offline `MODELS_DEV_API_JSON=<file locale>`), iniettato a build (`build.ts:362`) nel binario compilato; con `bin/kilo` source-wrapper (stato attuale) è undefined al runtime → `populate()` usa la disk cache `~/.local/share/kilo/cache/models.json`, poi `{}` col flag. `generate.ts` crasha se offline senza cache (`:29-46` rethrow). → lo snapshot va rigenerato SENZA provider online (nuovo Step 9) e il file pruned va committo come fonte di generazione | `packages/opencode/script/{generate,build}.ts`, `kilo-vscode/bin/kilo` |
| D11 | Workflow CI `visual-regression.yml` scarica chromium (rischio rete solo in CI, non runtime) | `.github/workflows/` |

### Vincoli

- Marker `kilocode_change` nei file ereditati dal fork (`core/src/models-dev.ts`, `core/src/v1/config/*`, `opencode/src/provider/provider.ts`, `handlers/*`, `config.ts`); file sotto `src/kilocode/` e package interamente Kilo (`kilo-vscode`) non richiedono marker.
- Fork isolation: logica Kilo in mirror sotto `opencode/src/kilocode/`.
- SDK auto-generato: se cambiano endpoint va rigenerato (`bun run script/generate.ts` dalla root); questi step non dovrebbero cambiare endpoint, verificare.
- Knip: ogni export rimosso/import caduto va risolto (`bun run knip` da `packages/kilo-vscode/`).
- `check-kilocode-change`, `check-workflows`, `check-md-table-padding`, typecheck, lint, unit test corrono in CI.
- TUI rompibile: l'estensione usa solo `kilo serve`; rompere TUI/comandi CLI standalone è accettabile (ma non `kilo serve`).
- Il gruppo "Kilo Gateway" è già eliminato dal picker: NON riaprire quel fronte.

## Assunzioni

- [A1] **Conseguenze dirette**: rimuovere il provider `opencode` (Zen) dalla superficie è coerente col requisito "nessun provider online": è un endpoint cloud (zen.opencode.ai) anche se i modelli sono free. Se l'utente vuole usarlo potrà dichiararlo in `config.provider` (BYOK) come farebbe con qualsiasi altro.
- [A2] **Rimozione dei consumer, non scrub dell'env**: le variabili d'ambiente online cessano di esistere come letture nel codice (Step 1: `OPENCODE_API_KEY`; Step 2: `APERTIS_*` via model-cache; Step 3: `MODAL_PROXY_TOKEN` col plugin Modal; Step 4: `EXA_API_KEY`/`PARALLEL_API_KEY`/`KILO_ENABLE_EXA`/`KILO_ENABLE_PARALLEL`/`KILO_WEBSEARCH_PROVIDER` con il websearch). Senza consumer, la loro presenza nell'ambiente ereditato dal child (`server-manager.ts:128`) è inerte. Nessun blocklist da mantenere: l'eredità wholesale di `process.env` resta (serve a `PATH`, proxy, variabili del sistema).
- [A3] **Plugin online**: rimuovere i plugin online da `internalPlugins` (Step 3) rende F3 strutturalmente chiuso per i built-in; i provider plugin-based esterni restano configurabili dall'utente via `plugin_origins` (scelta esplicita dell'utente, accettabile).
- [A4] **Websearch**: rimozione COMPLETA della feature (tool nel backend, toggle e sezioni UI, schema `web_search`, permisi `websearch`, flag `KILO_ENABLE_EXA`/`KILO_ENABLE_PARALLEL`, env `EXA_API_KEY`/`PARALLEL_API_KEY`/`KILO_WEBSEARCH_PROVIDER`, i18n, test) — nessuna traccia residua. Eventuale futuro trasporto locale è un'estensione separata, out of scope.
- [A5] **Remote Control / Telemetry / image-gen**: Remote Control e Telemetry vengono rimosse del tutto da UI (sezioni, `/remote`, message type, `RemoteStatusService`); il backend remote resta uno stub invariato. La sezione Image Generation si MANTIENE (proxy locale media-local verso il provider utente, volutamente mantenuto nei commit precedenti).
- [A6] **TUI**: pulizia cosmetica minima (stringhe/link), nessuna refactoring strutturale del TUI (out of scope).
- [A7] **Dipendenze npm online** in `opencode/package.json`: rimuoverle richiede attenzione agli import statici dei plugin tolti; si fa nello Step 3 insieme ai plugin, non prima.
- [A8] Rebuild di `bin/kilo`: lo stato attuale è un source-wrapper bash (verificato); la rebuild del binario compilato resta opzionale e documentata (D10), non bloccante.

## Piano di implementazione

Ogni step è eseguito da UN subagente distinto, sequenzialmente. Ogni step termina con
compilazione verde + revisione dell'utente prima dello step successivo. Ordine: 1 opencode-zen →
2 env consumers → 3 plugin online → 4 websearch (totale) → 5 layer provider dead-code →
6 UI cloud → 7 igiene host → 8 i18n/messaggi → 9 TUI/CLI → 10 snapshot locale → 11 chiusura.

---

### Step 1 — Eliminare l'auto-connect del provider online "opencode" (Zen)

**Obiettivo**

Che il provider `opencode` non possa più entrare in `connected`/picker salvo essere dichiarato
esplicitamente dall'utente in `config.provider`. È il buco funzionale più importante rimasto
(F1): oggi appare come "OpenCode Zen" connesso su macchine pulite, senza alcuna configurazione.

**Motivazione**

`opencode` sopravvive a entrambi i cut (non è in `LOCAL_PROVIDER_IDS` né in `config.provider`,
ma è nel catalogo models.dev) e il loader inline lo auto-connette con `apiKey:"public"` quando
resta ≥1 modello free. Rimuovendo lo speciale case, il cut esistente lo elimina dalla superficie;
chi volesse Zen lo dichiara in `config.provider` (BYOK) e lo recupera tramite il path
config-served (`provider.ts:660-765`).

**File da leggere**

- `packages/opencode/src/provider/provider.ts` (righe 104-165: `BUNDLED_PROVIDERS`, tipo `CustomLoader`, funzione `custom()`; righe 568-577: cut; righe 824-840: esecuzione dei custom loader)
- `packages/core/src/plugin/provider/opencode.ts` (twin gate `apiKey:"public"`)
- `packages/core/src/v1/config/constants.ts` (lista env incl. `OPENCODE_API_KEY`)
- Test che toccano `opencode`: individuare con `rg -l "opencode" packages/opencode/test packages/kilo-vscode/tests` e leggere quelli rilevanti (es. `test/kilocode/global-config-refresh.test.ts`, `test/kilocode/session-routed-model.test.ts` se usano `opencode` come fixture provider)

**File da modificare**

- `packages/opencode/src/provider/provider.ts`:
  - Rimuovere la voce `opencode:` dall'oggetto restituito da `custom()` (righe 138-162 aggiornando il blocco `kilocode_change start/end` e il commento: "offline surface: no built-in online loaders remain").
  - Aggiornare il commento del blocco `BUNDLED_PROVIDERS` se necessario (restano i 3 package della CustomProviderDialog; `@ai-sdk/openai` resta perché serve ai custom provider Responses — si toglie nello Step 4).
- `packages/core/src/plugin/provider/opencode.ts`: rimuovere il gate `apiKey="public"`/modella-disabled (il plugin non trasforma più nulla di rilevante: valutare se il file intero diventi inutile → in tal caso toglierlo dal registro `core/src/plugin/provider.ts` e dal test `core/test/plugin/...` corrispondente; marker `kilocode_change` da preservare nei file ereditati).
- `packages/core/src/v1/config/constants.ts`: rimuovere `"OPENCODE_API_KEY"` dalla lista env (preservare i marker).
- Eventuali test/fixture che usano `opencode` come provider di esempio: ripuntare a un id locale neutro (es. `lmstudio`) mantenendo intatte le asserzioni di comportamento.

**Attività**

- Applicare le rimozioni; verificare che il loop custom-loader (`provider.ts:824-840`) gestisca un oggetto `custom(dep)` vuoto (deve iterare `Object.entries({})` senza problemi — verificare).
- Grep finale: `rg -n "opencode.zen|\"opencode\"" packages/opencode/src packages/core/src` → solo riferimenti voluti (es. nome package npm, commenti).

**Output atteso**

Su `kilo serve` con machine pulita: `GET /provider` → `all` e `connected` contengono solo
`lmstudio`/`atomic-chat`/`privatemode-ai` + i custom dell'utente; "OpenCode Zen" assente.
Se l'utente mette `opencode` in `config.provider` compare (BYOK).

**Verifiche**

- Smoke: da `packages/opencode/` `KILO_DISABLE_MODELS_FETCH=1 bun run --conditions=browser ./src/index.ts serve --port <libero>` + `curl -s localhost:<porta>/provider` → `connected` senza `opencode`; kill del processo.
- Da `packages/opencode/`: `bun test ./test/kilocode/` (file toccati) + suite provider.
- `bun turbo typecheck` verde dalla root.

**Compilazione**

- `bun turbo typecheck`; risolvere eventuali errori introdotti.

**Rischi**

- Il twin plugin `core/src/plugin/provider/opencode.ts` potrebbe avere altri effetti collaterali (trasformazioni di catalogo) usati da altri test: verificare i consumer prima di cancellare il file.
- Test che usano `opencode` come fixture: ripuntare senza indebolire le asserzioni.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step. Non anticipare gli step successivi (plugin, deps, UI).
- Non introdurre refactoring non richiesti; modifiche minime; preserva i marker `kilocode_change`.
- Compila e fai smoke prima di terminare. Se hai dubbi sul twin plugin, leggi i suoi consumer; usa WebFetch/MCP solo se manca documentazione.

---

### Step 2 — Rimuovere i consumer delle variabili d'ambiente online (env inerti)

**Obiettivo**

Eliminare INTERAMENTE dal codice le letture delle variabili d'ambiente legate a servizi online,
così che la loro eventuale presenza nell'ambiente ereditato dal child `kilo serve`
(`server-manager.ts:128` passa `{...process.env, ...overrides}`) diventi inerte (F2):

- `OPENCODE_API_KEY` → rimuovere da `packages/core/src/v1/config/constants.ts` (lista env).
  La rimozione del loader `opencode` è già fatta nello Step 1; qui si toglie l'ultima lettura.
- `APERTIS_API_KEY` / `APERTIS_BASE_URL` → rimuovere insieme al macchinario apertis di
  `packages/opencode/src/provider/model-cache.ts` (costante `APERTIS_BASE_URL` :39,
  `fetchApertisModels` :78-99, branch `providerID === "apertis"` in `load()` :123-135,
  risoluzione env in `authOptions` :101-121). La service ModelCache resta per
  `clear`/`failedProviders` usate dagli altri provider.

Le altre key (`EXA_API_KEY`, `PARALLEL_API_KEY`, `KILO_WEBSEARCH_PROVIDER`, `MODAL_PROXY_TOKEN`)
vengono eliminate negli Step 4 e 3 rispettivamente, come parte della rimozione dei relativi moduli.

**Motivazione**

Senza consumer nel codice, una variabile online presente nella shell dell'utente non può più
riattivare alcun provider: il ramo env di `provider.ts:770-789` legge `provider.env` dai
metadati catalogo — e lo snapshot rigenerato (Step 9) non elencherà più queste variabili per
nessun provider. Niente blocklist da mantenere, niente filtro da aggiornare.

**File da leggere**

- `packages/core/src/v1/config/constants.ts` (lista env con `OPENCODE_API_KEY`)
- `packages/opencode/src/provider/model-cache.ts` (righe 39-135, macchinario apertis)
- `packages/opencode/src/provider/provider.ts` (righe 770-801: rami env/apikey, per conferma che nessun'altra lettura diretta resti)
- Grep finale: `rg -n "OPENCODE_API_KEY|APERTIS_API_KEY|APERTIS_BASE_URL" packages/ --glob '!*/node_modules/*'`

**File da modificare**

- `packages/core/src/v1/config/constants.ts`: rimuovere `"OPENCODE_API_KEY"` dalla lista env (marker `kilocode_change` adiacenti da preservare).
- `packages/opencode/src/provider/model-cache.ts`: rimuovere costante URL, `fetchApertisModels`, la branch apertis in `load()`, la risoluzione `APERTIS_*` in `authOptions` (che diventa `{}` semplice o viene rimossa se inutile). Marker `kilocode_change` da aggiornare.
- Eventuali test che asseriscono su apertis/OPENCODE_API_KEY: ricalibrare o rimuovere.

**Attività**

- Applicare le rimozioni; verificare che `ModelCache.Service` compili ancora con i soli metodi usati (`clear`, `failedProviders`).
- Grep finale sulle tre/due variabili → zero hit in `src/` (ammessi solo commenti storici/documentazione).

**Output atteso**

Nessuna lettura di `OPENCODE_API_KEY`/`APERTIS_*` nel codice; un'eventuale presenza di queste
variabili nell'ambiente utente non ha più effetto sul backend.

**Verifiche**

- Da `packages/opencode/`: `bun run typecheck`; `bun test ./test/kilocode/` sui file toccati.
- Smoke `kilo serve` + `curl /provider` invariato rispetto allo Step 1.
- `bun turbo typecheck` verde dalla root.

**Compilazione**

- `bun turbo typecheck`; risolvere eventuali errori introdotti.

**Rischi**

- `authOptions` di model-cache potrebbe essere chiamata anche per anaconda-desktop: verificare che la rimozione della branch apertis non cambi il comportamento per gli altri id (deve restare no-op).
- La lista env di `constants.ts` alimenta lo schema config v1: verificare che nessun test decodifichi config con `OPENCODE_API_KEY`.

**Istruzioni per il subagente**

- Solo questo step. Nessun cambiamento in UI né nei plugin.
- Modifiche minime; preserva i marker `kilocode_change` nei file ereditati.
- Compila e testa prima di terminare.

---

### Step 3 — Chiusura strutturale del re-entry plugin-auth: rimuovere i plugin online built-in

**Obiettivo**

Rimuovere dai plugin interni i provider online (Codex/openai-OAuth, GitHub Copilot, Modal, GitLab,
Poe, Cloudflare Workers/AI-Gateway, Azure, DigitalOcean, Snowflake Cortex, xAI) così che il loop
di plugin-auth (`provider.ts:804-822`) non possa più riseminare provider fuori-superficie anche in
presenza di credenziali salvate (F3), e togliere le relative dipendenze npm (D1/D2 parzialmente).

**Motivazione**

Con i plugin rimossi, `plugin.list()` non produce più auth-hook per id online: il loop salta tutto
(`if (!plugin.auth) continue`) e l'unica via d'ingresso resta `config.provider` (BYOK esplicito) —
il contratto voluto. I provider restano comunque utilizzabili dall'utente installandoli come plugin
esterni (`plugin_origins`) se davvero necessari.

**File da leggere**

- `packages/opencode/src/plugin/index.ts` (righe 12-35 import, 67-91 `internalPlugins`)
- I file plugin da rimuovere/neutralizzare: `plugin/openai/codex.ts`, `plugin/github-copilot/copilot.ts`, `plugin/modal/*`, `plugin/cloudflare.ts`, `plugin/azure.ts`, `plugin/digitalocean.ts`, `plugin/snowflake-cortex.ts`, `plugin/xai.ts`
- `packages/opencode/package.json` (dipendenze: `opencode-gitlab-auth`, `opencode-poe-auth`, `gitlab-ai-provider`, `@gitlab/gitlab-ai-provider`, `venice-ai-sdk-provider`, `ai-gateway-provider`, `@openrouter/ai-sdk-provider`, `google-auth-library`, `@ai-sdk/*` cloud non necessari)
- `packages/opencode/src/provider/provider.ts` (righe 857-869: blocco gitlab discovery — diventa morto se il plugin gitlab va via; verificare i consumer prima di tagliare)
- Test opencode che importano quei plugin (individuare con `rg -l "codex|copilot|modal|cloudflare|digitalocean|snowflake|xai|azure" packages/opencode/test`)

**File da modificare**

- `packages/opencode/src/plugin/index.ts`: da `internalPlugins(flags)` rimuovere i plugin online (mantenere `AtomicChatPlugin`, `AnacondaDesktopPlugin` e il gating `flags.disableDefaultPlugins`).
- File plugin online: valutare per ciascuno se (a) si rimuove il file intero + i suoi test, oppure (b) si neutralizza l'export se altro codice lo importa ancora (il subagente decide in base agli import reali trovati col grep; preferire la rimozione quando clean).
- `packages/opencode/package.json`: rimuovere le dipendenze divenute orfane (verificare con `rg` che nessun modulo sopravvissuto le importi; `@ai-sdk/openai` e `@ai-sdk/anthropic` RESTANO in questo step — servono ai custom provider — si valutano nello Step 5).
- Rimuovere anche la lettura di `MODAL_PROXY_TOKEN` (`plugin/modal/modal.ts:12`) insieme al plugin.
- Blocco gitlab discovery in `provider.ts:857-869`: se il discovery loader gitlab non esiste più, semplificare/rimuovere il blocco (marker adiacenti da preservare).
- Test coinvolti: ricalibrare o rimuovere quelli che testavano comportamento gateway/online dei plugin rimossi.

**Attività**

- Grep sistematico degli import di ogni plugin prima di tagliare.
- Eseguire `bun run knip` da `packages/kilo-vscode/` e dalla root se disponibile per emergere export orfani; risolverli.

**Output atteso**

`plugin.list()` contiene solo plugin locali/neutri; con auth.json contenente una vecchia credenziale
Codex/Copilot/etc., `GET /provider` non mostra più quel provider in `connected`. Dipendenze npm orfane tolte.

**Verifiche**

- Smoke `kilo serve` (come Step 1) + test opencode suite provider/plugin toccate.
- `bun turbo typecheck` verde; `bun run knip` (kilo-vscode) verde.
- Da `packages/opencode/`: `bun test ./test/kilocode/` sui file toccati.

**Compilazione**

- `bun turbo typecheck`; risolvere errori. Attenzione ai cycle di import rimossi.

**Rischi**

- Alcuni plugin hanno hook `provider.models`/`chat.params` usati anche da provider locali? Verificare caso per caso (es. `openai-compatible` plugin vive in core e NON si tocca).
- Rimuovere dipendenze npm cambia `bun.lock`: eseguire `bun install` dopo le modifiche a `package.json`.
- Il blocco gitlab discovery potrebbe servire a `anaconda-desktop`/altro: verificare i consumer di `discoveryLoaders`.

**Istruzioni per il subagente**

- Solo questo step. Non toccare UI (Step 6) né i bundled npm (Step 5).
- Preferire rimozioni complete a commenti-out; mantenere i marker `kilocode_change` nei file ereditati.
- Dopo aver modificato `package.json` eseguire `bun install` prima di compilare.
- Compila, typecheck, knip e test toccati prima di terminare.

---

### Step 4 — Rimozione completa del tool websearch (nessuna traccia residua)

**Obiettivo**

Eliminare la feature websearch dall'intero stack: implementazioni nel backend, registrazione nel
registry, schema config, permessi, flag/env, UI (toggle in BrowserTab + permission editor), i18n e
test. Non deve restare NESSUNA traccia (A4): niente toggle nascosta, niente no-op, niente chiave
orfana. La tab "Web Tools"/Browser resta con la sola sezione Browser Automation (F7, mantenuta).

**Motivazione**

I soli backend del tool sono online (Exa `mcp.exa.ai`, Parallel `search.parallel.ai`); non esiste
un trasporto locale. Lasciare una toggle che punta a un servizio cloud contraddice il contratto
offline; nasconderla lascerebbe un controllo inaccessibile ma ancora presente nel protocollo.

**File da leggere** (per conferma dei blocchi esatti prima di tagliare)

- `packages/core/src/tool/websearch.ts` (intero file, da eliminare)
- `packages/opencode/src/tool/websearch.ts`, `packages/opencode/src/tool/mcp-websearch.ts`, `packages/opencode/src/tool/websearch.txt` (da eliminare)
- `packages/opencode/src/tool/registry.ts` (:32 import, :40 Env comment, :80-85 `webSearchEnabled`, :134, :266, :302, :362-365 filtro, :535 `Env.node`)
- `packages/core/src/v1/config/config.ts` (:246-248 `web_search`), `packages/core/src/v1/config/permission.ts` (:32)
- `packages/core/src/flag/flag.ts` (:85 `KILO_ENABLE_EXA`, :103 `KILO_ENABLE_PARALLEL`), `packages/opencode/src/effect/runtime-flags.ts` (:34-42 `enableExa`/`enableParallel`)
- Permessi: `packages/core/src/plugin/agent.ts:176`, `packages/core/src/plugin/skill/customize-opencode.md:414,416`, `packages/opencode/src/permission/index.ts:520` (`SCALAR_ONLY_PERMISSIONS`), `packages/opencode/src/agent/agent.ts:239,263`, `packages/opencode/src/acp/permission.ts:160`, `packages/opencode/src/cli/cmd/agent.ts:28`, `packages/opencode/src/cli/cmd/github.handler.ts:807`, `packages/opencode/src/kilocode/agent/index.ts:172,346,545,608`, `packages/kilo-vscode/src/shared/work-style-presets.ts:81`
- TUI/CLI rendering: `packages/opencode/src/cli/cmd/run/tool.ts` (:35, :112, :360-366, :939+, :1025+, :1243-1253), `packages/opencode/src/kilocode/plugins/session-v2-debug.tsx` (:14, :503), `packages/opencode/src/kilocode/skills/kilo-config.md:146`
- Webview: `packages/kilo-vscode/webview-ui/src/components/settings/BrowserTab.tsx` (:54-56 `updateWebsearch`, :58 `overridden`, :83-108 sezione Web Search), `settings-io.ts:37` (`KNOWN_KEYS`), `PermissionEditor.tsx:117`, `components/chat/tool-default-open.ts:11`, `components/chat/permission-dock-utils.ts:54`, `types/messages/config.ts:156` (`web_search?: boolean`), `stories/composite.stories.tsx:1003-1019`, `stories/tool-call-lab.stories.tsx:396-397`
- i18n (tutti i ~20 file `webview-ui/src/i18n/*.ts`): `ui.permission.toolLabel.webSearch`, `settings.permissions.tool.websearch.title/description`, `settings.webTools.webSearch.enable/title/description`, `settings.autoApprove.tool.websearch`; riwording di `settings.webTools.description` ("web search and browser automation" → solo browser automation) e eventuale rename di `settings.webTools.title` se la tab diventa browser-only (verificare come è titolata la tab in `Settings.tsx` :339,:413)
- SDK: `packages/sdk/js/src/v2/gen/types.gen.ts` (:2298 `websearch?` permission, :2652 `web_search?`), `packages/sdk/openapi.json` (:31849) — rigenerati con `bun run script/generate.ts` dalla root (lo schema v1 cambia)
- Test: elenco completo sotto

**File da eliminare**

- `packages/core/src/tool/websearch.ts`
- `packages/opencode/src/tool/websearch.ts`, `packages/opencode/src/tool/mcp-websearch.ts`, `packages/opencode/src/tool/websearch.txt`
- `packages/opencode/test/tool/websearch.test.ts`
- `packages/opencode/test/kilocode/sandbox/http-tools.test.ts` (se interamente dedicato al provider websearch — verificare; altrimenti ricalibrare)

**File da modificare** (blocchi precisi)

- I file "permessi/registrazione/i18n/UI/SDK" elencati sopra: rimuovere le righe/blocchi indicati.
- `packages/core/src/tool/builtins.ts`: :15 import `WebSearchTool`, :45 `WebSearchTool.node` nei deps.
- `packages/opencode/src/tool/registry.ts`: tutti i punti elencati; verificare prima se `Env.node` (:535) serve ad altri tool dello stesso graph (grep `Env.` nel file) — rimuovere solo se orfano.
- BrowserTab: dopo la rimozione la tab contiene solo Browser Automation → valutare rinome titolo tab/i18n (`settings.webTools.*`) per riflettere il contenuto; aggiornare `Settings.tsx` se il label della tab viene da lì.
- `config.ts` (core v1): rimuovere `web_search` dallo schema; aggiungere una migrazione/tolleranza per i config utente esistenti che contengono `web_search: true/false` (il decode zod `.optional` rimosso fallirebbe su chiavi sconosciute SOLO se lo schema è strict — verificare il comportamento di decode usato; se strict, aggiungere una strip/migrazione in `data-migration` o accettare la chiave ignota: decisione del subagente documentata, preferire la migrazione che rimuove la chiave dal JSON dell'utente).
- Rigenerare SDK: `bun run script/generate.ts` dalla root dopo aver modificato gli schema (endpoint invariati, cambia lo schema config/permission).

**Test da ricalibrare** (rimuovere i riferimenti a websearch, mantenere intatte le asserzioni residue)

- `packages/opencode/test/tool/registry.test.ts` (:79-84, :163-191)
- `packages/opencode/test/tool/parameters.test.ts` (:26, :53, :296) + rigenerare `test/tool/__snapshots__/parameters.test.ts.snap`
- `packages/opencode/test/kilocode/ask-agent-permissions.test.ts` (:21, :48, :225)
- `packages/opencode/test/kilocode/config/config.test.ts` (:417-419)
- `packages/opencode/test/kilocode/server/config-overlay.test.ts` (:436-464)
- `packages/opencode/test/permission/next.toConfig.test.ts` (:65-84)
- Rigenerare `packages/opencode/test/cli/help/__snapshots__/help-snapshots.test.ts.snap`
- `packages/kilo-vscode/tests/unit/permission-description.test.ts` (:97-98, :123, :219), `tests/unit/session-utils.test.ts` (:467-469), `tests/permission-dock-dropdown.spec.ts` (:187-197)
- DA LASCIARE INVARIAI (sono fixture wire-format OpenAI, non il nostro tool): `test/kilocode/session-processor-incomplete-response-retry.test.ts:460-487` e `test/session/llm.test.ts:1001` (`web_search` come nome tool nel payload remoto).

**Output atteso**

`rg -in "websearch|web_search|exa|parallel" packages/*/src packages/kilo-vscode/webview-ui/src packages/sdk/js/src` → zero hit (salvo i due fixture wire-format citati e commenti voluti); la tab Web Tools mostra solo Browser Automation; gli agenti explore/scout funzionano senza il permesso websearch.

**Verifiche**

- Da `packages/opencode/`: `bun test ./test/tool/` + `bun test ./test/kilocode/` (file toccati) + `bun run typecheck`.
- Dalla root: `bun turbo typecheck` verde.
- Da `packages/kilo-vscode/`: `bun run typecheck` + `bun run lint` + `bun run knip` + `bun run test:unit` + `bun run compile`.
- Smoke `kilo serve` + `curl /provider` invariato.

**Compilazione**

- Tutto verde; risolvere errori. Eseguire `bun run script/generate.ts` (root) prima dei typecheck finali se si tocca lo schema.

**Rischi**

- Decode config strict su `web_search` residuo nei file utente → prevedere la migrazione (vedi sopra) altrimenti l'avvio fallisce per chi ha la chiave in config.
- `Env.node` nel graph del registry: verificare i consumer prima di rimuovere.
- Le snapshot (parameters, help) vanno RIGENERATE, non corrette a mano.

**Istruzioni per il subagente**

- Solo questo step. Rimozione totale: niente "nascondi", niente commenti-out, niente no-op.
- Non toccare la sezione Browser Automation (resta) né Image Generation.
- Ordine suggerito: elimina i file → taglia i blocchi nei file shared → i18n (tutti i locale) → SDK regen → test → guard.
- Compila, esegui i test e le guard prima di terminare.

---

### Step 5 — Snellire BUNDLED_PROVIDERS, costanti AI_SDK e dead-code del layer provider

**Obiettivo**

Portare il layer provider in coerenza col contratto: bundled npm ridotti all'effettivo minimo,
costanti senza id online, e rimozione del dead code identificato (D2, D3).

**Motivazione**

Dopo gli Step 1-4 i carichi online sono chiusi; qui si elimina il resto del peso morto nel layer
provider per rendere leggibile e stabile la superficie offline (e ridurre la superficie di futuro
fork-sync).

**File da leggere**

- `packages/opencode/src/provider/provider.ts` (righe 110-116 `BUNDLED_PROVIDERS`; 292-310 `EMPTY_PUBLIC_INFO`/`toPublicInfo`; 1172-1252 rami provider-specifici in `getSmallModel`/`defaultModelIDs`)
- `packages/opencode/src/provider/transform.ts` (rami per id online: mistral, openai, anthropic, bedrock, google-vertex-anthropic, nvidia, meta, baseten, alibaba-cn, azure, openrouter, llmgateway, venice, moonshotai, google, zai/zhipuai, lilac)
- `packages/opencode/src/kilocode/provider/provider.ts` (`patchCustomLoaderResult` switch con casi zenmux/openrouter/vercel/cerebras/azure — verificare i caller reali)
- `packages/core/src/v1/config/constants.ts` (`AI_SDK_PROVIDERS`)
- `webview-ui/src/components/settings/CustomProviderDialog*` (quali package npm offre come scelta all'utente)

**File da modificare**

- `BUNDLED_PROVIDERS`: valutare se `@ai-sdk/anthropic` e `@ai-sdk/openai` restino. Regola: un package bundled serve se (a) è offerto dalla CustomProviderDialog come scelta all'utente (BYOK puntato sulla baseURL dell'utente) OPPURE (b) è l'`api.npm` tipico dei custom provider. Verificare cosa offre la Dialog: se le tre scelte restano, i tre bundled restano (documentare col commento); se la Dialog offre solo openai-compatible, ridurre di conseguenza.
- `AI_SDK_PROVIDERS` in `constants.ts`: allineare alla lista che la Dialog effettivamente offre (marker da preservare).
- `transform.ts`: rimuovere i rami relativi a provider che non possono più entrare in `providers` (id non locali e non configurabili via Dialog). Attenzione: i rami per `openai`/`anthropic` RESTANO se i rispettivi package restano bundled (usabili dai custom). Il subagente produce una tabella id→ramo→destino e applica solo i tagli certi.
- `patchCustomLoaderResult` (mirror kilocode): rimuovere i casi mai chiamati; se la funzione intera resta usata per altri casi, snellirla.
- Rami `getSmallModel`/priorità: rimuovere special-case per provider ormai impossibili (azure, bedrock cross-region, prefix openai/github-copilot) SE il provider non può più arrivare in `s.providers`; otherwise lasciare (inoffensivi). Decisione documentata.

**Attività**

- Per ogni taglio: grep i consumer e i test prima di rimuovere.
- Eseguire test opencode del layer provider (`test/provider/`, `test/kilocode/provider*`) e ricalibrare solo ciò che riflette il nuovo contratto.

**Output atteso**

Layer provider senza rami morti; bundled/npm minimi e giustificati; typecheck/knip verdi.

**Verifiche**

- `bun turbo typecheck` verde.
- Da `packages/opencode/`: `bun test ./test/provider/` + `bun test ./test/kilocode/` (file toccati).
- Smoke `kilo serve` + `curl /provider` invariato rispetto allo Step 4 (nessuna regressione di superficie).

**Compilazione**

- `bun turbo typecheck`; risolvere errori.

**Rischi**

- Tagli eccessivi in `transform.ts` possono rompere variant di custom provider openai-compatible: mantenere i rami generic e quelli dei package bundled presenti.
- `patchCustomLoaderResult` è un mirror kilocode: modificarlo non richiede marker ma va fatto col medesimo criterio dei file upstream.

**Istruzioni per il subagente**

- Solo questo step. Tabella delle decisioni di taglio da allegare al report finale.
- Minimo churn: niente riordini/stylistic changes.
- Compila ed esegui i test del layer prima di terminare.

---

### Step 6 — UI webview: rimuovere del tutto le funzioni che implicano servizi cloud

**Obiettivo**

Rimuovere dal webview (con i relativi host handler e message type) tutte le funzioni che comunicano
servizi cloud o gateway: Remote Control (+`/remote`), sezione Telemetry + link kilo.ai in About,
riga "Kilo Gateway BYOK" con link blog.kilo.ai, card errore paid-model/promotion con bottoni no-op,
fallback form bedrock/vertex, "Sign in with ChatGPT"/tag ChatGPT in ProvidersTab, e restringere la
selezione degli embedding provider ai soli embedder locali (F5-F6). Regola: **rimuovere, non
nascondere** — se la funzione scompare dalla UI, scompare anche dal protocollo e dall'host.
La sezione Image Generation si MANTIENE (media-local, proxy verso il provider utente).

**Motivazione**

L'estensione è offline: ogni controllo che punta a un servizio cloud (anche oggi inattivo, come
Remote Control) fuorvia l'utente e mantiene vivi message-type e handler nel protocollo. Nascondere
senza rimuovere lascerebbe funzioni inaccessibili ancora presenti nel codice.

**File da leggere**

- `webview-ui/src/components/settings/ExperimentalTab.tsx` (sezioni Remote Control ~31-83 e Image Generation ~146-187 — quest'ultima si MANTIENE)
- `webview-ui/src/components/settings/AboutKiloCodeTab.tsx` (link ~219-235, sezione telemetry ~240-261)
- `webview-ui/src/components/settings/ProviderConnectDialog.tsx` (fallback ~70-120; riga BYOK ~533-546)
- `webview-ui/src/components/chat/ErrorDisplay.tsx` (card paid-model/promotion ~83-128) + `TranscriptRow.tsx:140` (passaggio `onLogin`)
- `webview-ui/src/components/settings/ProvidersTab.tsx` (tag ChatGPT :78; blocco signIn ~134-142, 207-211)
- `webview-ui/src/components/settings/IndexingTab.tsx` (:30-40, :62-88 — selezione embedder: restringere a `ollama` e `openai-compatible`)
- `webview-ui/src/hooks/useSlashCommand.ts` (comando `/remote` ~185-190)
- `webview-ui/src/types/messages/extension-messages.ts` + `webview-messages.ts` (tipi remote: `RemoteStatusMessage` ext:1251, `RequestRemoteStatusMessage`/`ToggleRemoteMessage`/`SetRemoteEnabledMessage` web:1174-1185)
- Host: `packages/kilo-vscode/src/services/RemoteStatusService.ts` e i case in `KiloProvider.ts:1285-1290`, chiamata `remoteService.refresh()` in `extension.ts:77` → rimuovere TUTTI (il backend remote è uno stub permanente: `handlers/remote.ts:5`)
- i18n: chiavi `settings.experimental.remote.*`, `settings.aboutKiloCode.telemetry.*`, `settings.aboutKiloCode.support.*`, `error.paidModel.*`, `error.promotionLimit.*`, `settings.providers.action.signInChatGPT`, tag chatgpt (se esiste), `cloud-provider.*`, chiavi embedder online di IndexingTab (vedi Step 7 per la sweep globale)

**File da modificare**

- I componenti sopra: rimuovere sezioni/blocchi/button COMPLETAMENTE; mantenere intatti i rimanenti contenuti delle tab (Models, Providers, Agent Behaviour, …; Image Generation resta in Experimental).
- IndexingTab: nella lista degli embedding provider esporre solo `ollama` e `openai-compatible` (localizzabili); togliere le voci OpenAI/Gemini/Mistral/Vercel AI Gateway/Bedrock/OpenRouter/Voyage dalla selezione (nota: il worker indexing non gira sotto KILO_PLATFORM=vscode, quindi l'impatto runtime è zero; la scelta resta coerente col contratto).
- `useSlashCommand.ts`: rimuovere `/remote`.
- Message types: rimuovere i tipi remote da entrambe le union; dall'host rimuovere `RemoteStatusService` (o ridurla a no-op se importata altrove — verificarne i consumer), i case `toggleRemote`/`setRemoteEnabled`/`requestRemoteStatus` in `KiloProvider.ts:1285-1290` e la chiamata `remoteService.refresh()` in `extension.ts:77`.
- i18n: rimuovere le chiavi rese orfane da questo step in TUTTI i locale file (replicate 1:1 negli ~20 file `webview-ui/src/i18n/*.ts`); la sweep complessiva delle famiglie residue è lo Step 7.

**Attività**

- Grep i consumer di ogni blocco rimosso per non lasciare import morti (knip lo verificherà).
- Verificare che le story touchate (es. `stories/settings.stories.tsx` se mostra quelle sezioni) restino coerenti — aggiornare solo se renderizzano i blocchi rimossi.

**Output atteso**

Settings senza sezioni Remote Control/Telemetry/kilo.ai; dialog di connessione senza riga Gateway né
form bedrock/vertex; ErrorDisplay senza card sign-in no-op; ProvidersTab senza ChatGPT; IndexingTab
solo embedder locali; `/remote` assente; nessun message type remote nel protocollo.

**Verifiche**

- Da `packages/kilo-vscode/`: `bun run typecheck`, `bun run lint`, `bun run knip`, `bun run test:unit` (incluso `tests/unit/i18n-unused-keys.test.ts` — se le chiavi tolte erano nella protection list di runtime a :63, aggiornare la lista).
- Build webview: `bun run compile` da `packages/kilo-vscode/` per catturare errori del bundle.

**Compilazione**

- Typecheck + lint + knip + test:unit + compile verdi; risolvere errori.

**Rischi**

- Rimuovere message type usati ancora dall'host: fare webview+host NELLO STESSO step (già previsto) per non spezzare il protocollo.
- Le i18n replicate: usare sostituzione sistematica (stessa chiave in ogni locale); validare che nessun locale perda la chiave mentre un altro ce l'ha (test i18n).

**Istruzioni per il subagente**

- Solo questo step. Non toccare backend opencode/core (lo stub `handlers/remote.ts` resta invariato).
- Non rimuovere la sezione Image Generation (media-local, volutamente mantenuta).
- Rimuovere, non commentare out: se la funzione non è nell'UI non deve esistere nel protocollo.
- Compila tutto il pacchetto extension prima di terminare.

---

### Step 7 — Igiene host: schema $schema, browser-automation, dipendenze morte

**Obiettivo**

Chiudere i residui host-side: `$schema` app.kilo.ai nei file config generati (F9), dipendenza
`qrcode` morta (D7), e messa in sicurezza della browser-automation (F7, default false — basta
documentarla, opzionale: aggiungere un note nella description del setting che richiede rete).

**Motivazione**

Piccole perdite/ingombri che non rompono nulla ma contraddicono l'immagine "completamente
offline" (lo schema remoto è fetchato dall'IDE; `qrcode` era del device-flow rimosso).

**File da leggere**

- `packages/kilo-vscode/src/kilo-provider/config-file.ts` (riga 31 `SCHEMA`, uso a :114)
- `packages/opencode/src/config/config.ts` (righe 339,341,394,414,624: `$schema` URL) e `opencode/src/config/tui-migrate.ts:12` — valutare se i file config creati dal BACKEND debbano perdere lo schema remoto (decisione: sì, sostituire con nessun `$schema` o con uno locale; marker da preservare in `config.ts`)
- `packages/kilo-vscode/package.json` (`qrcode` devDep; verificare i consumer con `rg qrcode packages/kilo-vscode`)
- `packages/kilo-vscode/package.json` contribution `kilo-code.new.browserAutomation.enabled` (description)

**File da modificare**

- `config-file.ts`: rimuovere la costante `SCHEMA` e il campo `$schema` dal JSON generato (o puntarlo a uno schema locale se esiste in repo — verificare; altrimenti assente).
- `config.ts`/`tui-migrate.ts`: stesso trattamento per i template di config del backend (se i template sono stringhe con URL, rimuoverli; marker `kilocode_change` da aggiornare).
- `package.json`: rimuovere `qrcode` se nessun consumer; eseguire `bun install`.
- Description del setting browserAutomation: precisare che abilitarlo richiede accesso a npm registry (npx).

**Attività**

- Grep consumer di `qrcode` e di `$schema` prima di tagliare.
- Verificare che i test che leggono i file config generati non asseriscano sullo `$schema`.

**Output atteso**

Nessun riferimento a `app.kilo.ai` in `packages/kilo-vscode/src` né nei template config del backend
(allowed: solo docs/CHANGELOG storici); `qrcode` assente dalle deps.

**Verifiche**

- `rg -n "app.kilo.ai|kilo.ai" packages/kilo-vscode/src packages/opencode/src` → solo riferimenti voluti/documentati (es. DOCS_URL del TUI, Step 8).
- Da `packages/kilo-vscode/`: typecheck + lint + knip + test:unit.
- `bun turbo typecheck` dalla root.

**Compilazione**

- Risolvere errori introdotti; `bun install` dopo il cambio deps.

**Rischi**

- Clienti/estensioni terze che si aspettano lo `$schema` nei file generati: impatto solo IDE (autocomplete schema), accettabile.
- Se `qrcode` è usato da storybook/test visual, valutarne la retention con motivazione.

**Istruzioni per il subagente**

- Solo questo step. Modifiche minime.
- Compila e testa prima di terminare.

---

### Step 8 — Sweep i18n orfani e tipi messaggio morti (webview)

**Obiettivo**

Rimuovere definitivamente le chiavi i18n orfane (D6) e i message-type morti (D8), allineando la
protection list del test `i18n-unused-keys`.

**Motivazione**

~82 chiavi per locale (×20 file) descrivono panel rimossi (profile, deviceAuth, cloud, claw,
marketplace, recommended-tag) e mantengono rumore in ogni merge futuro; i message-type morti
(`SelectKiloModelMessage`, `SyncSessionRequest`/`UnsyncSessionRequest`) e i guard `cloud:`
session-id sono reliquie del cloud sessions rimosso.

**File da leggere**

- `webview-ui/src/i18n/en.ts` (famiglie: `sidebar.topBar.kiloClaw/.marketplace/.profile` :679-681; `dialog.provider.tag.recommended` :84; `session.cloud*` :486-518; `deviceAuth.*` :520-538; `profile.*` :545-618,1100-1101) e gli altri ~19 locale file (stesse chiavi)
- `packages/kilo-vscode/tests/unit/i18n-unused-keys.test.ts` (protection list runtime a :63)
- `webview-ui/src/types/messages/extension-messages.ts:278` (`SelectKiloModelMessage`), `webview-messages.ts:521-532` (`SyncSessionRequest`/`UnsyncSessionRequest`)
- `webview-ui/src/context/session.tsx` (:367,:1818,:2437,:2569 guard `cloud:`), `webview-ui/src/context/session-cloud-prune.ts`, `webview-ui/src/components/chat/PromptInput.tsx:264,269`

**File da modificare**

- Tutti i file `webview-ui/src/i18n/*.ts`: rimuovere le chiavi orfane identificate (verificare PRIMA che siano ancora orfane POST Step 4 e 6: le chiavi websearch (`settings.webTools.webSearch.*`, `ui.permission.toolLabel.webSearch`, …) sono state tolte nello Step 4; le chiavi remote/telemetry/paidModel/promotionLimit/signInChatGPT/cloud-provider sono state tolte nello Step 6 — qui si rimuove ciò che resta orfano).
- `i18n-unused-keys.test.ts`: rimuovere dalla protection list i prefissi/runtime namespace che spariscono (`profile.`, `deviceAuth.`, `session.cloud.`, `dialog.provider.tag.recommended`).
- Message unions: rimuovere i tipi morti + eventuali referenze residue (verificare che host/webview non li usino più).
- Guard `cloud:` e `session-cloud-prune.ts`: rimuovere se il modulo non ha altri consumer (verificare import); altrimenti ridurre al minimo mantenendoli (sono filtri difensivi a costo zero).

**Attività**

- Procedura: per ogni famiglia di chiavi, grep `` t("prefisso`` e `tr("prefisso`` in `webview-ui/src` (escluso `i18n/`) per confermare l'orfanità DOPO gli Step 4 e 6, poi rimuovere in bulk da tutti i locale.
- Validare JSON/TS: le i18n sono oggetti TS literal — la rimozione va fatta in modo simmetrico.

**Output atteso**

Zero chiavi orfane rilevabili dal test (che ora NON le protegge più); message union snellite; test verdi.

**Verifiche**

- Da `packages/kilo-vscode/`: `bun run test:unit` (specialmente `tests/unit/i18n-unused-keys.test.ts`), `bun run typecheck`, `bun run lint`, `bun run knip`, `bun run compile`.

**Compilazione**

- Tutto verde; risolvere errori.

**Rischi**

- Rimuovere una chiave ancora usata da un componente dinamico (template literal `sidebar.topBar.${action.key}` copre i 3 topBar keys → VERIFICARE che `SidebarTopBar.tsx` non produca mai `kiloClaw`/`marketplace`/`profile` come action key prima di tagliarle; se il dynamic lookup potrebbe fallire a runtime, mantenere i 3 topBar keys o restringere la lista actions).
- Sincronia tra i 20 file di locale: una chiave mancante in un solo locale rompe quel locale a runtime.

**Istruzioni per il subagente**

- Solo questo step (dopo lo Step 6).
- Usare sostituzioni sistematiche per chiave su tutti i locale; mai editing manuale parziale.
- Compila/testa tutto il pacchetto prima di terminare.

---

### Step 9 — Pulizia TUI/CLI (cosmetica, rompibile accettabile)

**Obiettivo**

Rimuovere dal TUI/CLI le stringhe e i riferimenti ai servizi online morti: link `app.kilo.ai/claw`
nei dialog claw, `DOCS_URL` kilo.ai/docs, keybind `news_toggle` orfano, grouping "kilo" nel
model-picker TUI, e far sì che i comandi `kilo auth login/list` e `kilo models --refresh` non
presentino/forzino il catalogo online (F8) — applying lo stesso `inLocalSurface` cut già usato
dall'HTTP handler.

**Motivazione**

L'estensione non usa il TUI, ma lo stesso binario lo contiene: allineare il contratto evita
confusione e chiude gli ultimi consumers del catalogo grezzo.

**File da leggere**

- `packages/opencode/src/cli/cmd/providers.ts` (:267, :360-420, :522 — catalog access in auth list/login/logout)
- `packages/opencode/src/cli/cmd/models.ts:29` (refresh)
- `packages/opencode/src/cli/cmd/github.handler.ts:170`
- `packages/opencode/src/kilocode/cli/cmd/tui/app.tsx:46` (`DOCS_URL`) e :191,202 (commenti gateway)
- `packages/tui/src/component/dialog-model.tsx:77,192-194`, `packages/tui/src/kilocode/model-picker.ts:4-18` (grouping kilo)
- `packages/tui/src/config/keybind.ts:227,409` (`news_toggle`), `packages/tui/src/component/dialog-console-org.tsx`, `packages/opencode/src/kilocode/components/dialog-claw-{upgrade,setup}.tsx`
- `packages/opencode/src/kilocode/local-providers.ts` (riuso di `inLocalSurface`)

**File da modificare**

- `providers.ts`: applicare `pickBy(catalog, (_item,id) => inLocalSurface(id, configuredIds∪creds))` alle liste presentate in `auth login`/`auth list` (importare `inLocalSurface`); in `auth logout` mantenere il name lookup ma filtrato.
- `models.ts`: `--refresh` resta (è un'azione esplicita dell'utente, documentare che va online) oppure rimetterlo dietro un flag; decisione del subagente documentata.
- `github.handler.ts:170`: filtrare la lista provider con `inLocalSurface`.
- Stringhe/link: rimuovere `DOCS_URL` pointing a kilo.ai/docs (o puntarla a docs locali se esistono in repo — altrimenti rimuovere l'azione "docs.open"), URL claw nei dialog, comments gateway in `app.tsx`, keybind `news_toggle` (verificare che nessun binding predefinito la usi), grouping "kilo" nel picker TUI (ridurre a sorting generico).
- `dialog-console-org.tsx`: il blocco è gated su `switchableOrgCount > 1` (mai vero offline) → rimuovere dialog+palette entry.

**Attività**

- Grep finale `rg -n -i "kilo.gateway|kilo-auto|app.kilo.ai|blog.kilo.ai|kilo.ai" packages/opencode/src packages/tui/src` → solo riferimenti voluti residui documentati.
- Test TUI/CLI opencode coinvolti (`test/kilocode/help.test.ts`, `cli-shutdown`, `cmd/remote`, ecc.) da ricalibrare se asseriscono sulle cose rimosse.

**Output atteso**

TUI/CLI senza riferimenti a servizi online; comandi auth/models operanti sulla superficie locale.

**Verifiche**

- Da `packages/opencode/`: `bun test ./test/kilocode/` sui file toccati; `bun run typecheck` (pacchetto).
- `bun turbo typecheck` dalla root.

**Compilazione**

- Risolvere errori; la TUI può essere "rotta" nelle funzioni gateway ma il typecheck deve passare.

**Rischi**

- Rimuovere la keybind potrebbe rompere config migratori (`tui-migrate.ts`): verificare i mapping.
- I filter sui comandi auth cambiano UX TUI: accettabile per contratto offline.

**Istruzioni per il subagente**

- Solo questo step. Non toccare webview/host.
- Documentare ogni decisione (es. destino di `--refresh`).
- Compila e testa prima di terminare.

---

### Step 10 — Rigenerare lo snapshot models.dev senza provider online (fonte commitata)

**Obiettivo**

Portare i DATI in coerenza col contratto offline: lo snapshot models.dev generato in questa repo
(`script/generate.ts` → `KILO_MODELS_DEV` iniettato a build, D10) non deve contenere NESSUN
provider/modello online. Il file JSON pruned viene **committo** come fonte di generazione, così
ogni rebuild del binario riparte dalla stessa superficie locale anche offline.

**Motivazione**

Oggi lo snapshot (cache `packages/opencode/node_modules/.cache/models-dev-api.json`, gitignored)
contiene l'intero catalogo pubblico: verificato `has("openrouter")=true`, `has("anthropic")=true`,
`has("opencode")=true` (con `api: https://opencode.ai/zen/v1`). Con `bin/kilo` source-wrapper lo
snapshot embedded è undefined al runtime (vince la disk cache `~/.local/share/kilo/cache/models.json`,
poi `{}` col flag — catena verificata in `models-dev.ts:222-242`), ma il NEXT binario compilato
riporterebbe tutto il catalogo online. In più `generate.ts` crasha se offline e senza cache
(`:29-46` rethrow): con una fonte locale committa la rebuild diventa deterministica e offline.

**File da leggere**

- `packages/opencode/script/generate.ts` (:11 `KILO_MODELS_URL`, :15 override `MODELS_DEV_API_JSON`, :29-46 fallback/crash, :48 `parseModelsSnapshot`)
- `packages/opencode/src/kilocode/provider/models-snapshot-shape.ts` (`validateModelsSnapshot`: valida struttura id/name/env[]/models{} non vuoti + limit.context/output per modello; NON filtra i provider)
- `packages/opencode/script/build.ts` (:18 import generate, :362 `KILO_MODELS_DEV`, smoke test ~:411-429 che esegue `kilo --pure models anthropic` con `KILO_DISABLE_MODELS_FETCH=1` — VERIFICARE questo smoke: con uno snapshot senza `anthropic` fallirebbe → va ricalibrato su un provider presente, es. `lmstudio`)
- `packages/kilo-vscode/script/local-bin.ts` (:128 hash di `MODELS_DEV_API_JSON` nello staleness check, :144-145 pass-through alla build)
- La cache corrente `packages/opencode/node_modules/.cache/models-dev-api.json` (o un fetch di `https://models.dev/api.json` se disponibile) come input di partenza

**File da modificare / creare**

- Nuovo file committo, es. `packages/opencode/models-dev.local.json` (il subagente sceglie nome/location coerenti col repo e documenta la scelta): contenuto = snapshot models.dev dal quale sono rimossi TUTTI i provider non locali, via script (`jq 'with_entries(select(.key as $k | ["lmstudio","ollama","vllm","llamacpp","atomic-chat","privatemode-ai"] | index($k) != null))'` oppure l'inverso: mantenere solo `LOCAL_PROVIDER_IDS` ∪ i provider OpenAI-compatibili self-host presenti nel catalogo). Validare il risultato con `parseModelsSnapshot` (deve passare: ogni provider mantenuto ha id/name/env[]/models non vuoti) e verificare `jq 'has("anthropic"), has("openrouter"), has("opencode"), has("kilo")'` → tutti false.
- `packages/opencode/script/generate.ts`: rendere la fonte locale il default della build offline — priorità: (1) `MODELS_DEV_API_JSON` se impostato, (2) file locale committo `models-dev.local.json` se esiste, (3) fetch models.dev + cache (comportamento attuale, per chi vuole il catalogo completo). In alternativa minima: lasciare generate.ts invariato e far puntare `build.ts`/`local-bin.ts` a `MODELS_DEV_API_JSON=<repo>/models-dev.local.json`. Decisione del subagente, documentata; in entrambi i casi `bun run script/build.ts` offline senza rete né cache deve RIUSCIRE (non più crash).
- `packages/opencode/script/build.ts`: ricalibrare lo smoke test post-build (oggi `kilo --pure models anthropic`) su un provider presente nello snapshot locale.
- Eventuale `.gitignore`: assicurarsi che il nuovo file sia tracciato (non sotto `node_modules/`).

**Attività**

- Produrre il JSON pruned dall'input (cache o fetch); validare con `parseModelsSnapshot`; verificare i `has(...)` attesi.
- Cablare la fonte nella chain generate/build/local-bin secondo la scelta documentata.
- Rebuild di prova: da `packages/opencode/` `MODELS_DEV_API_JSON=<file locale> bun run script/build.ts --single --skip-install` (offline-tollerante); poi da `packages/kilo-vscode/` `bun script/local-bin.ts --force` se si vuole il binario compilato (altrimenti il source-wrapper resta valido, A8).
- Smoke: `KILO_DISABLE_MODELS_FETCH=1 <bin/kilo> serve --port <libero>` + `curl /provider` → `all` contiene solo i provider dello snapshot locale (+ custom dell'utente); nessun built-in online nemmeno nello scenario "cache assente" (simulare rimuovendo temporaneamente `~/.local/share/kilo/cache/models.json`).

**Output atteso**

Fonte snapshot committata senza alcun provider online; `generate.ts`/`build.ts` offline-tolleranti;
smoke con cache assente mostra solo superficie locale; `bin/kilo` rebuilt (o wrapper documentato).

**Verifiche**

- `jq 'has("anthropic"), has("openrouter"), has("opencode"), has("kilo")' models-dev.local.json` → `false,false,false,false`.
- Build offline riuscita (nessun fetch, nessuna cache).
- Smoke `kilo serve` + `curl /provider` come sopra.
- `bun turbo typecheck` verde.

**Compilazione**

- `bun turbo typecheck`; risolvere errori. La rebuild del binario può essere lunga: se l'ambiente non lo consente, documentare che il source-wrapper copre il dev.

**Rischi**

- Valutazione di quali provider siano "OpenAI-compatibili self-host" nel catalogo (vllm/ollama/llamacpp/lm-studio hanno id variabili in models.dev): il subagente usa `LOCAL_PROVIDER_IDS` + verifica dei campi `npm`/`api` delle entry per decidere cosa mantenere; in caso di dubbio mantenere SOLO l'insieme minimo certo (`lmstudio`, `atomic-chat`, `privatemode-ai`) — gli altri li configura l'utente via `config.provider`.
- Lo smoke test di build.ts potrebbe aver altre asserzioni legate ad `anthropic`: ricalibrarle tutte.
- Se `local-bin.ts` fa staleness check sull'hash di `MODELS_DEV_API_JSON`, aggiornare il suo default al file locale committo.

**Istruzioni per il subagente**

- Solo questo step. Usa `jq`/script per editare il JSON, mai editing manuale; validare con `JSON.parse`.
- Non toccare runtime/UI (già chiusi dagli step precedenti); qui si agisce solo sui dati e sulla toolchain di generazione.
- Compila e fai le verifiche prima di terminare; documenta la decisione generate/build e il nome del file committo.

---

### Step 11 — Guard finali, rebuild binario e validazione end-to-end

**Obiettivo**

Chiusura: tutte le guard CI verdi, `bin/kilo` in stato coerente (source-wrapper o rebuilt — D10),
validazione che `kilo serve` parta senza connessioni in uscita e che l'estensione mostri solo
superficie locale.

**Motivazione**

Gli step precedenti validano per area; qui si valida il sistema intero e si lascia il repo in
stato pushabile.

**Attività**

- Da `packages/kilo-vscode/`: `bun run knip`, `bun run check-kilocode-change`, `bun run typecheck`, `bun run lint`, `bun run test:unit`, `bun run compile`.
- Dalla root: `bun run script/check-workflows.ts`, `bun run script/check-md-table-padding.ts`, `bun turbo typecheck`, `bun run lint` (se presente a livello root).
- Da `packages/opencode/`: `bun test` (suite completa opencode; se mass-run dà artifact noti `ManagedRuntime disposed`, eseguire per directory: `test/kilocode/`, `test/provider/`, `test/server/`, `test/session/`, `test/tool/`).
- Binario: stato atteso = rebuilt nello Step 10 con lo snapshot locale (o source-wrapper documentato, A8); verificare che `bin/kilo` funzioni (`./bin/kilo --version` o equivalente).
- Smoke offline definitivo: da `packages/opencode/` avviare `KILO_DISABLE_MODELS_FETCH=1 KILO_PLATFORM=vscode <bin/kilo> serve --port <libero>` in un ambiente con `OPENCODE_API_KEY`/`EXA_API_KEY`/`ANTHROPIC_API_KEY` poste in ambiente (devono restare INERTI: nessun consumer dopo gli Step 1-4) e senza cache models (`~/.local/share/kilo/cache/models.json` assente) → `curl /provider`: `all`/`connected` = solo locali + custom; `curl /global/health` ok; verificare (facoltativo, con `ss`/`netstat` se disponibili) assenza di socket outbound verso host non-loopback dopo 5 min. Kill del processo.
- Sweep finale cross-repo: `rg -n -i "kilo gateway|kilo-auto|kilosessions|app.kilo.ai|posthog|sentry.io|statsig" packages/ --glob '!*/node_modules/*' --glob '!*.md'` → elenco residui accettabili (docs/CHANGELOG storici) vs da segnalare; più `rg -in "websearch|web_search|exa\.ai|parallel\.ai" packages/*/src packages/kilo-vscode/webview-ui/src` → zero (salvo i due fixture wire-format documentati nello Step 4).
- Validazione visiva (richiede display/VSCodium — se non eseguibile in ambiente dichiararlo): `bun run extension:isolated` → Settings → Models/Providers/Experimental/About/Indexing: nessun "Kilo Gateway", nessuna Remote Control, nessuna Telemetry section, nessun ChatGPT button, nessuna web-search, embedder solo locali; picker con soli locali/custom.

**Output atteso**

Tutte le guard verdi; smoke confermato; report finale dei residui accettabili.

**Compilazione**

- Tutte le passano; risolvere ciò che le modifiche introducono.

**Rischi**

- Suite opencode massiva lenta/instabile in ambiente: usare esecuzione per-directory.
- Launch VSCodium headless non disponibile: la validazione visiva resta compito umano, segnalato.

**Istruzioni per il subagente**

- Solo questo step (chiusura).
- Eseguire TUTTE le guard e farle passare; riportare esattamente cosa non poteva essere eseguito.

---

## Criteri di completamento

- Tutti gli step (1-11) completati, ciascuno verificabile in modo indipendente e terminato con codebase compilabile.
- `kilo serve` (con env dell'estensione) apre ZERO connessioni in uscita all'avvio e a regime, con solo provider locali configurati; variabili online presenti nell'ambiente utente (`OPENCODE_API_KEY`, `EXA_API_KEY`, …) restano inerte (nessun consumer nel codice).
- Websearch assente da ogni layer: backend, UI, schema, permessi, i18n, test — nessuna traccia residua.
- `GET /provider` espone solo `LOCAL_PROVIDER_IDS ∪ config.provider ∪ connected-legittimi`: nessun "OpenCode Zen", nessun built-in online, nemmeno con credenziali storiche salvate e nemmeno con la cache models assente (snapshot locale senza provider online).
- Webview: nessuna funzione Remote Control/Telemetry/Kilo-Gateway/ChatGPT/web-search (rimosse del tutto, non nascoste); embedder selezionabili solo locali; i18n senza chiavi orfane; message union senza tipi morti.
- Layer provider: nessun plugin online built-in, bundled npm minimi e giustificati, dead code (apertis, patchCustomLoaderResult, rami transform morti) rimosso.
- TUI/CLI: comandi auth/models sulla superficie locale; stringhe/link online rimossi.
- Snapshot models.dev committo senza alcun provider/modello online; toolchain generate/build offline-tollerante.
- Guard CI verdi: knip, check-kilocode-change, check-workflows, check-md-table-padding, typecheck, lint, unit test (kilo-vscode 41xx/0, opencode suite verdi).
- `bin/kilo` in stato documentato (rebuilt con snapshot locale o source-wrapper).

## Domande aperte / out of scope

- [Q1] **Sessioni esistenti** su provider online (`kilo-auto/*`, `opencode/...`): restano valide a livello dati; migrazione out of scope (coerente coi piani precedenti).
- [Q2] **Upstream models.dev**: continuerà a esporre i provider online; qui lo snapshot è generato in questa repo e viene rigenerato/prutato localmente senza dipendere dall'upstream (Step 10). Out of scope negoziare upstream.
- [Q3] **Backend locale per websearch/embedding**: il tool websearch è rimosso del tutto; un eventuale futuro trasporto locale (es. endpoint OpenAI-compatibile per search/embedding) è un'estensione separata, out of scope.
- [Q4] **Browser automation** (`npx @playwright/mcp@latest`): mantenuta come eccezione volontaria (default off, attivazione esplicita dell'utente, richiede npm registry); documentata nella description del setting.
- [Q5] **CI visual-regression** che scarica chromium (D11): rischio solo CI, non runtime; out of scope.
- [Q6] **Plugin esterni dell'utente** (`plugin_origins`) che aggiungono provider online: scelta esplicita dell'utente, permessa (A3).