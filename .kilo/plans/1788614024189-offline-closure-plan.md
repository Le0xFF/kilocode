# Piano: chiusura definitiva della modalità offline dell'estensione VS Code

## Obiettivo

Chiudere i residui online emersi dall'audit della codebase post-commit `969f948`/`cfacab5`/`1673a9f`, in modo che l'estensione VS Code e il suo backend `kilo serve` funzionino **completamente offline**: gli unici provider raggiungibili sono quelli OpenAI-compatibili locali (llama.cpp, vLLM, Ollama, LM Studio, Atomic Chat) più eventuali custom provider dichiarati dall'utente. Nessun servizio online deve poter essere contattato dal processo, nemmeno come effetto collaterale.

L'audit ha prodotto questa classificazione dei residui:

| # | Residuo | Dove | Tipo | Priorità |
|---|---|---|---|---|
| P1 | HEAD-probe a google.com/example.com/cloudflare.com dopo errori di rete del provider | `packages/opencode/src/session/network.ts:35,207-226` | Attivo (fire su ECONNREFUSED locale) | Alta |
| P2 | Download binary LSP da GitHub/JetBrains/eclipse/hashicorp/npm | `packages/opencode/src/lsp/server.ts` (22 guard site) + flag `KILO_DISABLE_LSP_DOWNLOAD` | Rimozione completa feature (decisione utente) | Alta |
| P3 | Session sharing → `opncd.ai`/console (`ShareNext`) | `packages/opencode/src/share/*`, route `/session/{id}/share`, SDK | Rimozione completa feature (decisione utente) | Media |
| P4 | Auto-update check npm/brew/choco/scoop | `packages/opencode/src/cli/upgrade.ts` + route `POST /global/upgrade` | Rimozione completa feature (decisione utente) | Media |
| P5 | Ineredità piena di `process.env` nel child (OTEL_*, proxy, chiavi API) | `server-manager.ts` (`resolveManagedServerEnv`) | Amplificatore di rischio | Media |
| P6 | `anaconda-desktop` bypassa la whitelist via overlay+plugin | `kilocode/anaconda-desktop/provider.ts`, `plugin/index.ts:57`, `provider/models.ts:27` | Locale ma fuori governance | Bassa |
| P7 | `lynkr` in `models-dev.local.json` ma fuori da `LOCAL_PROVIDER_IDS` | `models-dev.local.json` vs `kilocode/local-providers.ts:1` | Drift del committed snapshot | Bassa |
| P8 | Dead code: `readAuto` per provider "kilo" | `kilocode/session/routed-model.ts:49-50` | Dead branch | Bassa |
| P9 | Dead code: blocco amazonBedrock cross-region in `getSmallModel` | `provider/provider.ts:1150-1168` | Dead branch (~18 righe) | Bassa |
| P10 | Route group `KilocodeApi` / `RemoteApi` ancora montate | `server/routes/instance/httpapi/api.ts:39,42,108,111` | Da verificare se no-op | Bassa |
| P11 | Skill JetBrains stale (pacchetto rimosso) | `.kilo/skills/icon-jetbrains/`, `.kilo/skills/jetbrains-cli-pin/` (+ `release-jetbrains` se presente) | Dead weight docs | Bassa |
| P12 | `PRUNE-NOTES.md` parzialmente stale (contraddice AGENTS.md sulla check-opencode-annotations) | repo root | Stale doc | Bassa |
| P13 | Download on-demand di binary (ripgrep da GitHub, `Npm.add`, `@lancedb/lancedb`, dynamic provider SDK) | `core/src/ripgrep/binary.ts:106-119`, `core/src/npm.ts:115-241`, `core/src/plugin/provider/dynamic.ts:16` | Gated (solo al primo uso/caché fredda) | Documentale |
| P14 | Embedders hosted per indexing (openai/gemini/mistral/vercel/bedrock/openrouter/voyage) | `packages/kilo-indexing/src/indexing/embedders/*` | Gated dalla scelta utente (UI ormai limitata a ollama/openai-compatible) | Documentale |

P1–P5 sono i veri buchi funzionali; P6–P12 sono igiene superficiale; P13–P14 restano gated per design (l'utente sceglie esplicitamente cosa configurare) e vanno solo documentati, non rimossi.

## Decisioni prese con l'utente

**D1 — Feature senza controllo GUI vengono rimosse completamente.** Verificato per ciascuna delle tre candidate:
- **LSP download**: esiste un toggle "Enable language server protocol integration" (Settings → Experimental, `ExperimentalTab.tsx:73-84`, bound a `config().lsp !== false`) e una riga permission `lsp` in `PermissionEditor.tsx:105`. Il toggle controlla se gli LSP girano, NON i download: con LSP attivo ma nessun binary installato, su macchina offline tutto degrada comunque a no-op. Non esiste nessuna GUI per riattivare i download → **rimuovere la feature intera**, non disabilitarla via flag.
- **Session sharing**: nessuna superficie UI nell'estensione (né button, né setting row); la config key `share`/`autoshare` è editabile solo a mano in JSON. Con `KILO_DISABLE_SHARE` forzato le route restano montate ma no-op → **rimuovere la feature intera**.
- **Auto-update**: nessuna UI "check for updates" nell'estensione (la About tab mostra solo la versione statica packaged). In `kilo serve` niente trigger automatico: solo la RPC TUI `checkUpgrade` (assente in serve) e `POST /global/upgrade` (chiamata esplicita). → **rimuovere la feature intera**.

Caveat condiviso: `packages/opencode` è anche il runtime CLI standalone (`@kilocode/cli`). Le rimozioni tolgono funzionalità anche al TUI/CLI: LSP (diagnostica agentica nei tool write/edit/read + locally-installed servers), share (link condivisi + integrazione `kilo github`), auto-update (convenienza silenziosa; il comando manuale `kilo upgrade` resta). Accettato perché il prodotto primario di questo ramo è l'estensione offline.

**D2 — La lista di probe esterne diventa vuota e i siti vengono rimossi.** In `session/network.ts` la costante con gli URL pubblici (`google.com`, `example.com`, `cloudflare.com/cdn-cgi/trace`) viene azzerata: con lista vuota `watch` non schedula alcuna richiesta e gli host non sono nemmeno più referenziati nel codice. Niente flag, niente gate: i siti esterni semplicemente non esistono più nel binario.

## Analisi

- Stato attuale: i tre commit di Le0xFF hanno rimosso gateway/telemetry/marketplace/claw/websearch/plugin online e hanno introdotto il cut `inLocalSurface` a livello di servizio e di handler GET /provider, con `KILO_DISABLE_MODELS_FETCH=true` impostato dallo spawn. Il catalogo runtime è il committed snapshot `models-dev.local.json` iniettato come `KILO_MODELS_DEV` in build time.
- Componenti coinvolti: `packages/kilo-vscode/src/services/cli-backend/server-manager.ts` (env dello spawn), `packages/opencode/src/session/network.ts` (probe), `packages/opencode/src/lsp/**` + `tool/lsp.ts` + config schema `lsp` + UI experimental/permission (feature LSP), `packages/opencode/src/share/**` + route session-share + SDK + storage `SessionShareTable` (feature share), `packages/opencode/src/cli/upgrade.ts` + route `/global/upgrade` + worker TUI (feature autoupdate), `packages/core/src/flag/flag.ts`, `packages/opencode/src/kilocode/local-providers.ts`, `packages/opencode/models-dev.local.json`, `packages/opencode/src/provider/provider.ts`, `packages/opencode/src/kilocode/session/routed-model.ts`, `packages/opencode/src/server/routes/instance/httpapi/api.ts`, `.kilo/skills/*`, `PRUNE-NOTES.md`.
- Vincoli architetturali:
  - Le rimozioni complete (step 2–4) toccano il file di layer graph `effect/app-runtime.ts` / `bootstrap-runtime.ts`: ogni nodo rimosso va tolto anche dai grafi, altrimenti la compilazione/runtime fallisce. I tre step sono indipendenti tra loro (nodi diversi dei grafi) e ciascuno termina compilabile.
  - La rimozione share ha accoppiamenti di storage: `SessionShareTable` (SQLite in `core/storage/schema.ts`), migrazioni `kilocode/storage/json-migration.ts`, colonna `share_url` nei tipi di session-import, e `kilo github` (`cli/cmd/github.handler.ts:21,349`) usa `SessionShare.Service`. Strategia: togliere service/routes/SDK/config/UI, MA conservare la tabella e la colonna `share_url` (dati persistuti dagli utenti esistenti) in forma inerte — si evita cosi una data migration invasiva. Se `github.handler.ts` dipende dal service, si adatta a usare la tabella direttamente o si neutralizza quel sottocaso (vedi step 3).
  - Lo SDK TypeScript è generato da `packages/sdk/openapi.json`: rimozioni di route (share, /global/upgrade, lsp-config) richiedono `bun run script/generate.ts` da root prima del typecheck finale dello step.
  - Cambiamenti in file condivisi ereditati dal fork richiedono marker `kilocode_change` (verificati da `bun run script/check-opencode-annotations.ts --worktree`). File interamente Kilo (`packages/opencode/src/kilocode/`, `packages/kilo-vscode/`) non ne hanno bisogno.
  - Ogni step termina con typecheck green (e test dove lo step tocca logica testata).
- Dipendenze rilevanti: nessuna nuova dipendenza npm va aggiunta; alcuni step eliminano codice morto senza introdurre nulla.

## Assunzioni

- Lo scenario di riferimento è `kilo serve` spawned dall'estensione; il TUI/CLI standalone resta secondario e subisce le perdite di feature accettate in D1.
- `anaconda-desktop` resta disponibile come provider locale opzionale (è OpenAI-compatibile e punta a `127.0.0.1`): non si rimuove, si porta sotto la governance della whitelist.
- Gli embedders hosted per indexing restano selezionabili solo se l'utente li configura esplicitamente; l'UI ha già ristretto le opzioni a ollama/openai-compatible, quindi il caso è coperto dalla documentazione.
- Il download on-demand di ripgrep/plugin npm/lancedb/dynamic-SDK (P13) non viene impedito strutturalmente: resta gated da pre-cache/uso esplicito e va documentato.
- Non si tocca il comportamento del tool `webfetch` (capacità intrinseca dell'agente, permission-gated) né i link `openExternal` nella webview (aprono il browser di sistema, non socket del processo).
- I dati esistenti degli utenti (righe `session_share`, colonne `share_url`) restano leggibili/persistiti anche dopo la rimozione della feature: si tratta di compatibilità dati, non di funzionalità.

## Piano di implementazione

### Step 1 — Sanificare l'ambiente dello spawn (P5)

**Obiettivo**

Far sì che il child `kilo serve` spawned dall'estensione parta con un ambiente ridondanza-minimale: rimuovere dall'env ereditato le variabili che possono riattivare percorsi online (tutte le `OTEL_*`, le proxy var ambientali quando il proxy VS Code non è configurato). Niente nuovo flag in questo step: i gate feature vengono rimossi alla radice negli step 2–4.

**Motivazione**

Lo spawn oggi passa `{...process.env}` integro: se l'ambiente utente espone `OTEL_EXPORTER_OTLP_ENDPOINT` o `HTTP_PROXY`/`HTTPS_PROXY` (es. shell con proxy corporate), quelle variabili arrivano al backend e possono riattivare export OTLP o instradare traffico verso un proxy morto. La sanitizzazione chiude il leak per ineredità piena ed è indipendente dalle rimozioni degli step successivi.

**File da leggere**

- `packages/kilo-vscode/src/services/cli-backend/server-manager.ts` (funzione `resolveManagedServerEnv` ~righe 32-42, blocco `env:` dello spawn ~righe 122-164, `buildProxyEnv` ~righe 318-372)
- Test esistenti sullo spawn, se presenti sotto `packages/kilo-vscode/test/` (cercare riferimenti a `resolveManagedServerEnv` o `KILO_DISABLE_MODELS_FETCH` per capire quale convenzione di test usare)

**File da modificare**

- `packages/kilo-vscode/src/services/cli-backend/server-manager.ts`

**Attività**

1. In `resolveManagedServerEnv`, mantenere le override esistenti (`KILO_DISABLE_CHANNEL_DB`, `KILO_EXPERIMENTAL_DISABLE_FILEWATCHER`, `KILO_DISABLE_MODELS_FETCH`) e aggiungere la rimozione esplicita delle chiavi che possono riattivare telemetria o routing proxy accidentale: tutte le chiavi che iniziano con `OTEL_` (ossia `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` e qualsiasi altra `OTEL_*`), più `HTTP_PROXY`/`HTTPS_PROXY`/`http_proxy`/`https_proxy`/`ALL_PROXY`/`all_proxy`/`NO_PROXY`/`no_proxy` quando `buildProxyEnv()` non le sta già reinserendo (ossia quando il proxy VS Code non è configurato: in quel caso il proxy viene da VS Code ed è intenzionale). Implementare con un piccolo helper locale (es. nome a una parola tipo `stripNetVars`) oppure inline con destructuring/`delete`. Attenzione all'ordine nello spawn: `...resolveManagedServerEnv(process.env)` è seguito da `...buildProxyEnv()`, quindi le rimozioni fatte qui vengono sovrascritte correttamente da `buildProxyEnv` quando il proxy VS Code è attivo.
2. Aggiornare/estendere il test unitario esistente che copre `resolveManagedServerEnv` (crearne uno minimale se non esiste) verificando: date in input variabili `OTEL_EXPORTER_OTLP_ENDPOINT` e `HTTP_PROXY` ambientali senza proxy VS Code, esse non compaiono nell'output; con proxy VS Code configurato il comportamento proxy resta quello attuale; `KILO_DISABLE_MODELS_FETCH` resta `"true"`.
3. Verificare che nessun altro call site di `resolveManagedServerEnv` dipenda dalle chiavi rimosse (cercare usi della funzione nel package).

**Output atteso**

Lo spawn del backend eredita un ambiente in cui le variabili `OTEL_*` e le proxy var ambientali (senza proxy VS Code configurato) non arrivano al child. Nessun cambiamento di comportamento per PATH/HOME/chiavi provider/bwrap/tree-sitter.

**Verifiche**

- Typecheck del package: da `packages/kilo-vscode/` eseguire `bun run typecheck`.
- Unit test: da `packages/kilo-vscode/` eseguire `bun test ./test/services/cli-backend` (o il percorso equivalente del test toccato) — tutti verdi.
- Smoke manuale opzionale: avviare l'estensione in dev e ispezionare l'env del processo `kilo serve` figlio (es. `ps eww <pid>`) per confermare assenza di OTEL_*.

**Compilazione**

- Compilare il package `kilo-vscode` (typecheck + eventuale compile/esbuild se il file toccato è incluso nel bundle).
- Verificare che il progetto sia compilabile.
- Risolvere qualsiasi errore di compilazione introdotto durante lo step.

**Rischi**

- Rimuovere le proxy vars ambientali potrebbe sorprendere utenti che usano un proxy senza setting VS Code: mitigato dal fatto che in setup offline puro il proxy è quasi sempre assente, e dal fatto che `buildProxyEnv` reintroduce il proxy VS Code quando configurato.
- Il doppio meccanismo (rimozione + reoverride) va letto con attenzione: se `buildProxyEnv` ritorna un oggetto vuoto quando non c'è proxy, le chiavi rimosse restano rimosse — corretto.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step; non toccare `session/network.ts`, `lsp/`, `share/`, `cli/upgrade.ts` né i passi successivi.
- Non introdurre refactoring non richiesti; non rinominare funzioni esistenti.
- Mantieni le modifiche minime e usa nomi a una parola per i nuovi helper locali.
- Marker `kilocode_change` NON servono: `server-manager.ts` vive in `packages/kilo-vscode/` (intero Kilo).
- Se hai dubbi sul comportamento di `buildProxyEnv`, consulta il file corrispondente prima di scrivere; se serve documentazione esterna, usa WebFetch/MCP invece di supporre.
- Al termine compila/typechecka il package e fai girare i test toccati; risolvi gli errori introdotti prima di considerare concluso lo step.
- Interrompi solo lasciando una codebase compilabile.

---

### Step 2 — Rimuovere del tutto la feature LSP (P2)

**Obiettivo**

Eliminare completamente la sottosistema LSP dal backend e da tutta la superficie dell'estensione: directory `src/lsp/`, tool `lsp`, config key `lsp`, UI (toggle Experimental + riga permission), i18n, storybook, schema core, rigenerazione SDK. Dopo lo step, nessun pathway può scaricare un binary language-server e nessun sito esterno (GitHub releases, JetBrains CDN, eclipse.org, hashicorp, npm registry per LSP) è più referenziato per LSP.

**Motivazione**

Decisione D1: non esiste GUI per controllare i download LSP (il toggle Experimental controlla solo l'on/off della feature, e con binary assenti tutto degrada a no-op), quindi il flag permanente `KILO_DISABLE_LSP_DOWNLOAD` non aggiunge capacità all'utente: meglio rimuovere la feature. Questo cancella tutti i 22 guard site in `lsp/server.ts` (con i relativi `fetch` verso GitHub/JetBrains/eclipse/hashicorp e le `Npm.which` verso il registry) alla radice, anziché mascherarli. Costo accettato: perde la diagnostica LSP anche il CLI standalone (nei tool write/edit/read/apply_patch e nel tool `lsp`), e i locally-installed language servers non verranno più avviati dal backend.

**File da leggere**

- `packages/opencode/src/lsp/` (tutti i 6 file: `server.ts`, `lsp.ts`, `launch.ts`, `language.ts`, `diagnostic.ts`, `client.ts`) per mappare gli export usati altrove
- Consumatori: `packages/opencode/src/tool/lsp.ts`, `tool/registry.ts` (:41 import, :56, :126, :267, :305, :511), `tool/write.ts:34`, `tool/edit.ts:88`, `tool/apply_patch.ts:29`, `tool/read.ts:84`, `session/prompt.ts:171`, `effect/app-runtime.ts:36`, `effect/bootstrap-runtime.ts:6`, `server/routes/instance/httpapi/server.ts:20`, `groups/file.ts:3`, `groups/instance.ts:4`, `handlers/instance.ts:6,20`, `cli/cmd/debug/lsp.ts` + `cli/cmd/debug/index.ts:10`, `kilocode/ts-client.ts:6`, `project/bootstrap.ts:4,28`
- Schema core: `packages/core/src/v1/config/config.ts:236`, `packages/core/src/v1/config/lsp.ts` (file intero), `packages/core/src/v1/config/permission.ts:33`, `packages/core/src/v1/config/migrate.ts:50`
- SDK: `packages/sdk/openapi.json` (campo `lsp` nei config schema, ~linee 31849, 32763)
- Estensione: `webview-ui/src/types/messages/config.ts:152`, `webview-ui/src/components/settings/settings-io.ts:33`, `webview-ui/src/components/settings/ExperimentalTab.tsx:73-84`, `webview-ui/src/components/settings/PermissionEditor.tsx:105`, `webview-ui/src/stories/tool-call-lab.stories.tsx:796-797,903`, i18n webview (`settings.experimental.lsp.*`, `settings.permissions.tool.lsp.*`, `settings.autoApprove.tool.lsp`, `ui.permission.toolLabel.lsp` in tutti i locale files) e i18n host se presente
- Flag: `packages/core/src/flag/flag.ts:54` (`KILO_DISABLE_LSP_DOWNLOAD`) e `packages/opencode/src/effect/runtime-flags.ts:24` (`disableLspDownload`)
- Test: `packages/opencode/test/lsp/` (directory) e altri test che importano LSP (rg `from.*lsp` in `packages/opencode/test`)

**File da modificare / eliminare**

Eliminare:
- `packages/opencode/src/lsp/` (intera directory, 6 file)
- `packages/opencode/src/tool/lsp.ts`
- `packages/opencode/src/cli/cmd/debug/lsp.ts`
- `packages/core/src/v1/config/lsp.ts`
- `packages/opencode/test/lsp/` (o i test LSP trovati)

Modificare (tagliare import/usi):
- `packages/opencode/src/tool/registry.ts` (import :41/:56, istanze :126, :267, gate :305, wiring :511)
- `packages/opencode/src/tool/write.ts`, `tool/edit.ts`, `tool/apply_patch.ts`, `tool/read.ts`, `session/prompt.ts` (usare LSP.Service → rimuovere la chiamata/degradation relativa mantenendo il resto del tool funzionante)
- `packages/opencode/src/effect/app-runtime.ts:36`, `effect/bootstrap-runtime.ts:6` (togliere i nodi LSP dai grafi)
- `packages/opencode/src/server/routes/instance/httpapi/server.ts:20`, `groups/file.ts:3`, `groups/instance.ts:4`, `handlers/instance.ts:6,20`
- `packages/opencode/src/cli/cmd/debug/index.ts:10`
- `packages/opencode/src/kilocode/ts-client.ts:6` (import LSPClient)
- `packages/opencode/src/project/bootstrap.ts:4,28`
- `packages/core/src/v1/config/config.ts:236` (key `lsp`), `permission.ts:33`, `migrate.ts:50`
- `packages/core/src/flag/flag.ts:54` (rimuovere la definizione `KILO_DISABLE_LSP_DOWNLOAD` — orfana dopo la rimozione)
- `packages/opencode/src/effect/runtime-flags.ts:24` (stesso)
- Regenerare: `bun run script/generate.ts` da root (openapi.json perde il campo `lsp` dai config schema; `packages/sdk/js/src/gen/*` aggiornato)
- `packages/kilo-vscode/webview-ui/src/types/messages/config.ts:152`, `settings/settings-io.ts:33`, `settings/ExperimentalTab.tsx:73-84` (riga switch), `settings/PermissionEditor.tsx:105` (riga permission), `stories/tool-call-lab.stories.tsx` (entry lsp), i18n webview (tutti i locale files, 4 chiave circa × N file) e i18n host se contiene le stesse chiavi

**Attività**

1. Mappare con precisione ogni export del modulo `lsp/` consumato fuori dalla directory (fase di lettura sopra) per non lasciare dangling import.
2. Eliminare i file della lista. Nei consumer, tagliare import e blocchi di uso; dove il tool usava LSP per arricchire la risposta (es. diagnostics in read/write), mantenere il tool funzionante senza quella parte (early-skip se il servizio non c'è → ora semplicemente non c'è).
3. Pulire schema core (`lsp` key, permission entry, migration passthrough) e flag/runtime-flags.
4. Rigenerare lo SDK da root (`bun run script/generate.ts`) e verificare il diff di `openapi.json`/`types.gen.ts`.
5. Pulire l'estensione: tipo config, settings-io allow-list, toggle Experimental, riga PermissionEditor, story, i18n (tutti i locale file, tenendo coerenti le chiavi rimanenti — attenzione al protection list degli unused keys se presente).
6. Eseguire i test dei package toccati.

**Output atteso**

Nessun file sotto `src/lsp/`, nessun reference a `LSP.Service`/`LSPClient`/`disableLspDownload` nel tree; la config non accetta più la key `lsp`; l'UI non mostra più il toggle LSP né la permission row; lo SDK non espone il campo. La codebase è compilabile e i test verdi.

**Verifiche**

- Typecheck da `packages/opencode/`, `packages/core/` (se workspace separato per typecheck), `packages/kilo-vscode/`, `packages/sdk/js/`.
- Test: da `packages/opencode/` `bun test` (suite completa, dato l'impatto trasversale sui tool) e da `packages/kilo-vscode/` `bun run test:unit`.
- Knip da `packages/kilo-vscode/`: `bun run knip` (export orfani).
- Guard: `bun run script/check-opencode-annotations.ts --worktree` (marker nei file condivisi modificati: `tool/*.ts`, `session/prompt.ts`, `effect/*.ts`, `server/routes/**`, `core/src/v1/config/*` dove toccati).
- rg finale: `rg -n "lsp" packages/opencode/src` → zero hit significativi (resto al massimo branding/commenti non funzionali); `rg -ni "disableLspDownload"` → zero.

**Compilazione**

- Compilare i package toccati (opencode, core, sdk, kilo-vscode); risolvere errori introdotti.
- È lo step più grande del piano: se il volume di tagli rende insostenibile terminare con tutto verde in un'unica sessione, l'unica suddivisione consentita in due step consecutivi è (a) backend+core+sdk, (b) estensione+i18n — ma lo step (a) deve lasciare compilabile l'estensione esistente (che usa ancora il campo `lsp` nel tipo config fino allo step b: per questo il taglio del tipo config va fatto nello stesso passo del taglio dello schema, cioè in (a)). Preferire fortemente il completamento in un solo step.

**Rischi**

- Perdita di funzionalità locale legittima: i locally-installed language servers non verranno più avviati dal backend (accettato in D1).
- `LSP.Service` è intrecciato nei tool core (write/edit/read/apply_patch/prompt): il taglio va fatto con cura per non degradare il flusso principale dei tool — test suite opencode completa d'obbligo.
- I18n: rimuovere chiavi usate da componenti rimossi va fatta in TUTTI i locale file insieme, per non attivare warning/CI sugli unused keys (verificare la protection list).
- La rigenerazione SDK produce un diff ampio in `packages/sdk/js/src/gen/`: è atteso, verificarlo solo per le sezioni lsp/share/upgrade.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step.
- Parti dalla mappa degli export del modulo `lsp/` prima di tagliare: ogni export consumato fuori direzione deve avere un piano di rimozione esplicito.
- Non rifattorizzare i tool oltre il taglio LSP: se un blocco `if (lsp)` diventa vuoto, elimina solo il blocco.
- Marker `kilocode_change` obbligatori nei file condivisi ereditati dal fork che modifichi (`tool/*`, `session/prompt.ts`, `effect/*`, `server/routes/**`, `core/src/v1/config/*`); NON in `packages/kilo-vscode/`, `kilocode/ts-client.ts`, `project/bootstrap.ts` se sotto area kilocode.
- Usa WebFetch/MCP in caso di dubbio sull'infrastruttura Effect (rimozione nodi dai grafi) invece di inventare pattern.
- Compila/typechecka tutti i package toccati e esegui le suite; risolvii gli errori introdotti prima di chiudere.
- Interrompi solo con codebase compilabile (o con la rara eccezione a due step descritta in Compilazione, comunicata chiaramente).

---

### Step 3 — Rimuovere del tutto la feature session sharing (P3)

**Obiettivo**

Eliminare completamente la feature di condivisione sessioni dal backend, dallo SDK, dalla config, dal TUI e dall'estensione: `src/share/` (share-next + session), route `POST/DELETE /session/{id}/share`, wiring nei layer graph, flag `KILO_AUTO_SHARE`, config keys `share`/`autoshare`, surface TUI (command, keybinds, menu items, tips), SDK methods `Session.share()/unshare()`, i18n. I siti esterni (`opncd.ai`, console URLs) cessano di essere referenziati come target attivi: il fallback URL in `share-next.ts` sparisce con il file.

**Motivazione**

Decisione D1: l'estensione non espone alcuna UI per la sharing (verificato: nessun button/menu/setting row), quindi forzare `KILO_DISABLE_SHARE` lascia solo route no-op e SDK methods morte: meglio rimuovere la feature. Con la rimozione, il layer `ShareNext` esce dai grafi `app-runtime`/`bootstrap-runtime`, le route non vengono più registrate e il fallback `https://opncd.ai` scompare dal binario.

**File da leggere**

- `packages/opencode/src/share/` (tutti i file: `share-next.ts`, `session.ts`)
- Wiring: `server/routes/instance/httpapi/groups/session.ts:98,285-306`, `handlers/session.ts:11,56,259-268,463-464`, `server.ts:48-49`, `effect/app-runtime.ts:50-51`, `effect/bootstrap-runtime.ts:8`
- CLI/TUI: `cli/cmd/run.ts:622` (arg `--share`), `groups/tui.ts:13` (key session_share/unshare), `packages/tui/src/config/keybind.ts:95-96,302-303`, `packages/tui/src/routes/session/index.tsx:132,137,558-581` (menu + copy share URL), `packages/tui/src/feature-plugins/home/tips-view.tsx:174,266-268` (tips)
- Storage/migrazione: `packages/core/src/storage/schema.ts:4` (`SessionShareTable`), `packages/opencode/src/kilocode/storage/json-migration.ts:9,212-493`, `kilocode/session-import/types.ts:166` + `service.ts:63` (colonna `share_url`), `kilocode/pr-link.ts:5`, `kilocode/config/overlay.ts:95` (key `["share"]`)
- Dipendenza incrociata: `cli/cmd/github.handler.ts:21,349` (usa `SessionShare.Service`)
- Config schema: `packages/core/src/v1/config/config.ts:85,89` (`share`/`autoshare`), `config/config.ts:918` (normalizzazione autoshare), `packages/core/src/flag/flag.ts:42` (`KILO_AUTO_SHARE`)
- SDK: `packages/sdk/openapi.json:7671-7830` (route share, operationIds `session.share`/`session.unshare`), field `shareURL` (~:16167) e riferimenti session-share (~:27759, :30779, :36441, :52375, :55869)
- Estensione: plumbing `shareURL` in session import/export sotto `packages/kilo-vscode` (rg `shareURL|share_url`)
- Test: `packages/opencode/test/share/` e test che toccano le route share

**File da modificare / eliminare**

Eliminare:
- `packages/opencode/src/share/` (intera directory)
- `packages/opencode/test/share/` (o i test share trovati)

Modificare:
- `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts` (route POST/DELETE share), `handlers/session.ts` (import + handler share/unshare), `server.ts` (wiring servizi)
- `packages/opencode/src/effect/app-runtime.ts`, `effect/bootstrap-runtime.ts` (nodi ShareNext/SessionShare dai grafi)
- `packages/opencode/src/cli/cmd/run.ts:622` (logica `--share`/auto-share)
- `packages/opencode/src/server/routes/instance/httpapi/groups/tui.ts:13` (action session_share/unshare)
- `packages/tui/src/config/keybind.ts`, `routes/session/index.tsx` (menu item + copy), `feature-plugins/home/tips-view.tsx` (tips)
- `packages/opencode/src/kilocode/storage/json-migration.ts` (ramo di migrazione session_share → adattare: la migrazione storiche va mantenuta operativa sulle vecchie versioni di config? Valutare: se la migrazione legge `session_share/*.json` legacy e scrive in `SessionShareTable`, e la tabella resta, il ramo può restare invariato — decidere in fase di lettura; se la tabella viene rimossa, la migrazione deve diventare discard)
- `packages/opencode/src/kilocode/pr-link.ts:5`, `config/overlay.ts:95`
- `packages/opencode/src/cli/cmd/github.handler.ts` (adattamento: se `SessionShare.Service` era usato per esporre la share URL nel flusso GitHub, sostituire con lettura diretta della tabella/colonna o neutralizzare il sottocaso con commento)
- `packages/core/src/storage/schema.ts:4` — **mantenere** `SessionShareTable` per compatibilità dati (decisione: niente data migration) oppure rimuovere con discard esplicito nella migrazione: scegliere in base a quanto è invadente, preferendo mantenere la tabella inerte
- `packages/core/src/v1/config/config.ts:85,89,918` (key `share`/`autoshare` + normalizzazione), `packages/core/src/flag/flag.ts:42` (`KILO_AUTO_SHARE`)
- `kilocode/session-import/types.ts:166` + `service.ts:63` (colonna `share_url`: mantenerla come colonna inerte o rimuoverla — preferenza: mantenere, è dati utente)
- Rigenerare: `bun run script/generate.ts` da root
- Estensione: plumbing `shareURL` in session import/export (file individuati con rg), i18n se contengono stringhe "share session"
- `packages/kilo-vscode/webview-ui` se contiene message type per share (rg `share` in `types/messages/`)

**Attività**

1. Leggere `share-next.ts` e `session.ts` per confermare che TUTTI i fetch puntano a `opncd.ai`/account URL (così la rimozione del file elimina i target).
2. Decidere il destino di `SessionShareTable` e della colonna `share_url` (default: mantenere entrambi inerti, nessuna data migration) e applicarlo in schema/migration/session-import.
3. Adattare `github.handler.ts` al nuovo stato (nessun service): il sottocaso va neutralizzato con comportamento definito (es. share URL assente → skip) e commentato.
4. Tagliare routes/handlers/wiring/graph, CLI arg, TUI surface, config keys, flag, SDK (rigenerazione), estensione (plumbing + message types + i18n).
5. Eseguire i test dei package toccati (opencode suite completa data la superficie, extension suite, tui se testato).

**Output atteso**

Nessun file sotto `src/share/`, nessuna route `/session/{id}/share`, nessuna method SDK `share()/unshare()`, nessun reference a `opncd.ai` nel tree (verifica con rg), nessun keybind/menu/tip TUI per la sharing, config senza key `share`/`autoshare`. Dati storici (tabella/colonna) restano compatibili.

**Verifiche**

- Typecheck da `packages/opencode/`, `packages/core/`, `packages/tui/` (se presente come package testato), `packages/kilo-vscode/`, `packages/sdk/js/`.
- Test: da `packages/opencode/` `bun test`, da `packages/kilo-vscode/` `bun run test:unit`.
- Knip da `packages/kilo-vscode/`.
- Guard annotazioni (file condivisi modificati).
- rg finale: `rg -n "opncd\.ai" packages/` → zero; `rg -n "ShareNext|SessionShare.Service|session_share" packages/opencode/src` → solo i riferimenti compatibilità-dati deliberatamente mantenuti (documentati con commento).

**Compilazione**

- Compilare i package toccati; risolvere errori introdotti.
- Rara eccezione a due step consentita SOLO se il taglio TUI+SDK risulta troppo couplé con il taglio backend: in tal caso (a) backend+core+storage+SDK, (b) TUI+estensione — e (a) deve restare compilabile (i tipi SDK usati da TUI/extension devono sopravvivere fino a (b) oppure il taglio SDK va in (b): comunicare la scelta).

**Rischi**

- `github.handler.ts` è un dipendente nascosto: se l'adattamento non è pulito, il flusso `kilo github` perde la share URL — accettare con commento, non rompere il comando.
- La migrazione json-legacy che popola `SessionShareTable`: se la tabella resta, la migrazione resta valida così com'è; se viene rimossa, serve un discard esplicito per non far fallire l'upgrade di chi ha dati legacy.
- TUI: rimuovere keybinds/actions senza dimenticare i riferimenti nelle costanti di keybind (file `keybind.ts` ha mapping bidirezionali).

**Istruzioni per il subagente**

- Implementa esclusivamente questo step.
- Prima di tagliare, produciti la lista esatta dei fetch/URL in `share-next.ts` per confermare che i target esterni siano solo opncd/account.
- La decisione tabella/colonna va presa PRIMA dei tagli e documentata nella risposta (con la ragione).
- Non rifattorizzare `github.handler.ts` oltre l'adattamento minimo.
- Marker `kilocode_change` nei file condivisi ereditati (`server/routes/**`, `effect/*.ts`, `cli/cmd/run.ts`, `core/src/v1/config/*`, `core/src/storage/schema.ts` se toccato); NON in `kilocode/*` e `packages/kilo-vscode/`.
- Compila/typechecka tutti i package e esegui le suite; risolvii gli errori introdotti.
- Interrompi solo con codebase compilabile (o eccezione a due step comunicata).

---

### Step 4 — Rimuovere del tutto la feature auto-update (P4)

**Obiettivo**

Eliminare il check/update automatico: `cli/upgrade.ts` (funzione `upgrade()` con `Installation.latest(method)` verso npm registry/brew/choco/scoop), la route `POST /global/upgrade`, la RPC `checkUpgrade` del worker TUI, le action UI del TUI che scattano l'upgrade manuale via SDK, i tip TUI, i flag `KILO_DISABLE_AUTOUPDATE`/`KILO_ALWAYS_NOTIFY_UPDATE`, la config key `autoupdate` (incl. la modalità `"notify"`). Il comando MANUAL `kilo upgrade` (`cli/cmd/upgrade.ts`) e il modulo `installation/` RESTANO (servono anche a `kilo uninstall` e all'update esplicito).

**Motivazione**

Decisione D1: l'estensione non ha UI per l'auto-update (About mostra solo la versione statica packaged) e in `kilo serve` niente scatta il check automaticamente: il flag permanente non darebbe all'utente alcun controllo → rimozione completa. Rimuovendo `cli/upgrade.ts` e la route `/global/upgrade`, i siti `registry.npmjs.org`, `formulae.brew.sh`, `community.chocolatey.org`, `raw.githubusercontent.com` smettono di essere referenziati da code path automatici; restano accessibili solo tramite `kilo upgrade` esplicito (azione cosciente dell'utente, accettata).

**File da leggere**

- `packages/opencode/src/cli/upgrade.ts` (intero: guard a :10, `Installation.latest` a :15, `KILO_ALWAYS_NOTIFY_UPDATE` a :18)
- `packages/opencode/src/installation/index.ts` (funzioni `latest`, `upgrade`, `method` — confermare che `method` serva a `cli/cmd/uninstall.ts:61`)
- `packages/opencode/src/cli/cmd/upgrade.ts` (comando manuale — DA MANTENERE, verificare le sue dipendenze)
- Route: `server/routes/instance/httpapi/groups/global.ts:73,126-132`, `handlers/global.ts:79,112-169` (handler chiama `installation.upgrade` DIRETTAMENTE, non passa per il gate)
- Worker TUI: `packages/opencode/src/cli/tui/worker.ts:4,92` (RPC `checkUpgrade`)
- TUI: `packages/tui/src/app.tsx:1068` (call `sdk.client.global.upgrade({target})`), dialogs/menu "new version available" in `app.tsx`, `feature-plugins/home/tips-view.tsx:247` (tip "opencode upgrade")
- Config: `packages/core/src/v1/config/config.ts:92` (key `autoupdate`: `boolean | "notify"`), handling modalità notify in `upgrade.ts`
- Flag: `packages/core/src/flag/flag.ts:47` (`KILO_DISABLE_AUTOUPDATE`), `KILO_ALWAYS_NOTIFY_UPDATE`
- SDK: `packages/sdk/openapi.json` (route `/global/upgrade`, operationId) → regenerated `sdk/js`
- Test: `packages/opencode/test/effect/runtime-flags.test.ts` (se copre i flag), test di upgrade se presenti

**File da modificare / eliminare**

Eliminare:
- `packages/opencode/src/cli/upgrade.ts`

Modificare:
- `packages/opencode/src/server/routes/instance/httpapi/groups/global.ts` + `handlers/global.ts` (de-registrare `POST /global/upgrade`; se il group `GlobalApi` resta per altri endpoint — health ecc. — tagliare solo la route upgrade)
- `packages/opencode/src/cli/tui/worker.ts` (import + RPC `checkUpgrade`)
- `packages/tui/src/app.tsx` (action/dialog update, call SDK global.upgrade), `tips-view.tsx:247`
- `packages/core/src/v1/config/config.ts:92` (key `autoupdate`), `packages/core/src/flag/flag.ts` (due flag)
- `packages/opencode/src/effect/runtime-flags.ts` se espone i flag
- Rigenerare: `bun run script/generate.ts` da root
- Estensione: verificare con rg `upgrade|global.upgrade` in `packages/kilo-vscode/src` (probabilmente nullo, ma verificare; la webview About tab non fa check update)
- Test che asseriscono i flag/upgrade

**Attività**

1. Confermare che `installation/` sopravvive: `cli/cmd/upgrade.ts` (manuale) e `cli/cmd/uninstall.ts:61` lo usano — NON eliminarlo.
2. Eliminare `cli/upgrade.ts`, de-registrare la route, tagliare worker TUI + surface TUI + config key + flag.
3. Rigenerare lo SDK e verificare il diff (sparisce `/global/upgrade`).
4. Verificare che il TUI compili e funzioni senza la sezione "new version" (le stringhe i18n relative vanno pulite se esistono nei bundle TUI).
5. Eseguire i test toccati.

**Output atteso**

Nessuna code path automatica può contattare npm registry/brew/choco/scoop: l'unico accesso è `kilo upgrade` esplicito. Niente flag `KILO_DISABLE_AUTOUPDATE`/`KILO_ALWAYS_NOTIFY_UPDATE`, niente key `autoupdate`, niente route `/global/upgrade`, niente RPC `checkUpgrade`.

**Verifiche**

- Typecheck da `packages/opencode/`, `packages/core/`, `packages/tui/`, `packages/sdk/js/`.
- Test: da `packages/opencode/` `bun test` (almeno i file runtime-flags/upgrade toccati).
- Guard annotazioni (file condivisi modificati).
- rg finale: `rg -ni "autoupdate|always_notify|KILO_ALWAYS" packages/` → zero; `rg -n "global/upgrade" packages/` → zero.

**Compilazione**

- Compilare i package toccati; risolvere errori introdotti.
- Step autonomo e contenuto: deve terminare compilabile in un'unica passata.

**Rischi**

- Il TUI perde la notifica "nuova versione disponibile": accettato (D1). Il diff in `app.tsx` può essere esteso (dialog + state): tagliare con cura per non rompere il loop principale del TUI.
- `handlers/global.ts` ospita altre route (health): tagliare solo la coppia route+handler upgrade.
- Se la modalità `"notify"` di `autoupdate` ha behavior extra (es. write di un marker file), verificare che la rimozione non lasci file orfani in config migration.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step.
- NON toccare `installation/` né `cli/cmd/upgrade.ts` (comando manuale): la rimozione riguarda solo l'automation.
- Marker `kilocode_change` nei file condivisi ereditati modificati (`cli/tui/worker.ts`, `server/routes/**`, `core/src/v1/config/config.ts`, `core/src/flag/flag.ts`); NON in `packages/tui/` se interamente area fork-Kilo (verificare la natura del file prima di marcare).
- Compila/typechecka e testa al termine; risolvii gli errori introdotti.
- Interrompi solo con codebase compilabile.

---

### Step 5 — Azzerare la lista di probe esterne in session/network.ts (P1)

**Obiettivo**

Rimuovere del tutto i siti esterni raggiungibili da `SessionNetwork.watch`: la costante con `google.com`, `example.com`, `cloudflare.com/cdn-cgi/trace` diventa una lista vuota, così il watcher non schedula NESSUNA richiesta esterna e gli host non sono più referenziati nel codice.

**Motivazione**

Decisione D2: invece di un flag che disattiva le probe, la lista di host viene azzerata à la radice. `watch` mantiene la sua macchina di stati (gestione errori di connessione del provider, retry), ma con zero host da provare il loop di probe degenera in no-op immediato. Su una macchina air-gapped non parte più nessun DNS/TCP verso l'esterno per fault-tolerance; se il provider locale torna disponibile, il retry normale funziona comunque.

**File da leggere**

- `packages/opencode/src/session/network.ts` (intero file: costanti URL ~:35, `watch` ~:207-226, interazione con la sessione)
- I call site di `SessionNetwork`/`network.watch` (rg `network\.watch|SessionNetwork` in `packages/opencode/src`) per capire dove viene attivato
- Eventuali test del modulo (rg `network` in `packages/opencode/test/`)

**File da modificare**

- `packages/opencode/src/session/network.ts`
- Eventuali test del modulo

**Attività**

1. Leggere per intero il file e identificare con precisione: (a) la costante/array degli URL pubblici, (b) il ciclo che li itera, (c) la logica di stato indipendente dalle probe (resume/retry del provider).
2. Sostituire la lista di URL con una lista vuota, con commento `kilocode_change` che spiega: "offline surface: no external probe hosts; the watch loop keeps local provider error handling but performs no outbound probes". Se la struttura del codice itera l'array, con array vuoto il loop non gira: verificare che non ci siano fallback hardcoded altrove nel file (es. un singolo URL di ripiego) e rimuoverli anch'essi.
3. Se con la lista vuota alcune funzioni diventano dead branch (es. "proba succeeded → resume"), valutarne la semplificazione minima: preferire mantenere la struttura (costo zero, massima reversibilità) limitandosi ad azzerare la lista; rifattorizzare solo se il compilatore segnala code morti inutilizzabili.
4. Aggiornare i test: quelli che asserivano le probe verso gli host pubblici vanno adattati (con lista vuota non partono richieste); aggiungere un test che verifichi che `watch` con lista vuota non schedula fetch.
5. Marker `kilocode_change` sui blocchi modificati (file ereditato dal fork, fuori da `src/kilocode/`).

**Output atteso**

Nessun host pubblico referenziato in `network.ts`; dopo un errore di connessione del provider locale il backend spawned non effettua NESSUNA richiesta verso l'esterno; la gestione errori/retry del provider resta intatta.

**Verifiche**

- Typecheck da `packages/opencode/`.
- Test del modulo: da `packages/opencode/` i test di `session/network` (percorso esatto trovato nella fase di lettura).
- Suite opencode opzionale per regressioni (`bun test` se il tempo lo consente).
- Guard: `bun run script/check-opencode-annotations.ts --worktree`.
- rg finale: `rg -n "google\.com|example\.com|cloudflare\.com" packages/opencode/src` → zero (fuori eventuali prompt .txt che menzionano google come esempio di webfetch — verificare e lasciare solo se sono stringhe di prompt, non code path).

**Compilazione**

- Compilare/typeckare `packages/opencode`; risolvere eventuali errori.
- Nessuna dipendenza di compilazione con gli step 2–4 (moduli indipendenti).

**Rischi**

- Se `watch` fa anche polling del provider locale (non solo probe esterne), l'azzeramento della lista deve colpire SOLO le probe esterne: la distinzione va fatta con attenzione in fase di lettura.
- Comportamento fault-tolerance cambiato: su ambienti ibridi il detection di "internet tornato" sparisce — irrilevante per l'obiettivo offline.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step.
- Leggi per intero `network.ts` PRIMA di tagliare: identifica con precisione quali righe fanno le probe esterne e quali la gestione locale.
- Non anticipare gli step successivi; non rifattorizzare il modulo oltre l'azzeramento della lista e le dead branch evidenti.
- Marker `kilocode_change` obbligatorio (file condiviso).
- Compila/typechecka e testa al termine; risolvii gli errori introdotti.
- Interrompi solo con codebase compilabile.

---

### Step 6 — Portare anaconda-desktop sotto la governance della whitelist (P6)

**Obiettivo**

Fermare il doppio bypass della whitelist da parte di `anaconda-desktop` (overlay incondizionato + delete-then-readd), rendendo il suo ingresso nella superficie coerente con `inLocalSurface`.

**Motivazione**

Oggi `anaconda-desktop` entra nel catalogo GET /provider indipendentemente dalla whitelist: `provider/models.ts:27` lo elimina dal catalogo grezzo, poi l'handler lo ri-inietta via `overlayAnacondaDesktop`, e la `AnacondaDesktopPlugin` gli aggiunge auth/model hook. È un provider locale (OpenAI-compatibile, `127.0.0.1`) quindi non viola l'obiettivo offline, ma è l'unico provider che aggira la governance della whitelist senza motivo evidente. Portandolo dentro (aggiungendo l'id a `LOCAL_PROVIDER_IDS`) si uniforma il contratto: "tutto ciò che compare in superficie è governato da `inLocalSurface`".

**File da leggere**

- `packages/opencode/src/kilocode/local-providers.ts` (definizione `LOCAL_PROVIDER_IDS`)
- `packages/opencode/src/kilocode/anaconda-desktop/provider.ts` (PROVIDER_ID, CatalogProvider, overlay)
- `packages/opencode/src/provider/models.ts:23-42` (strip apertis/anaconda-desktop)
- `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts:48-97` (uso di `overlayAnacondaDesktop`)
- `packages/opencode/src/plugin/index.ts:52-59` (registrazione `AnacondaDesktopPlugin`)
- `packages/kilo-vscode/webview-ui/src/components/settings/ProvidersTab.tsx:26` (specchio client-side della whitelist) e `webview-ui/src/utils/local-providers.ts`

**File da modificare**

- `packages/opencode/src/kilocode/local-providers.ts`
- `packages/kilo-vscode/webview-ui/src/components/settings/ProvidersTab.tsx` (specchio)
- `packages/kilo-vscode/webview-ui/src/utils/local-providers.ts` (se mantiene una copia della lista)
- Opzionale: `packages/opencode/src/provider/models.ts` (commento) per documentare che ora anaconda-desktop è in whitelist e lo strip resta solo per coerenza con apertis

**Attività**

1. Aggiungere `"anaconda-desktop"` a `LOCAL_PROVIDER_IDS` in `local-providers.ts`, con commento che spiega che è un provider locale OpenAI-compatibile scoperto sulla macchina.
2. Sincronizzare gli specchi client-side (`ProvidersTab.tsx:26`, `utils/local-providers.ts`) aggiungendo lo stesso id, in modo che il filter client-side della tab Providers continui a mostrarlo.
3. Verificare che, con l'id in whitelist, il flusso `pickBy(... inLocalSurface)` lo conservi già dal catalogo grezzo; valutare se `overlayAnacondaDesktop` e la delete in `models.ts` diventano ridondanti: se lo sono e la simplification è contenuta, rimuovere l'overlay; altrimenti limitarsi ad aggiungere l'id alla whitelist e lasciare overlay/delete invariati, documentando con commento che ora sono belt-and-braces.
4. Eseguire i test provider esistenti (`packages/opencode/test/provider/provider.test.ts`, `test/kilocode/provider-list-failed-state.test.ts`, `provider-saved-auth.test.ts`) per assicurarsi che anaconda-desktop continui a comparire in superficie.

**Output atteso**

`anaconda-desktop` passa attraverso `inLocalSurface` come qualsiasi altro provider locale: compare in superficie perché in whitelist, non perché overlay. Niente cambia per l'utente finale a parità di configurazione.

**Verifiche**

- Typecheck da `packages/opencode/` e da `packages/kilo-vscode/`.
- Test provider: da `packages/opencode/` `bun test ./test/provider` e `bun test ./test/kilocode`.
- Knip da `packages/kilo-vscode/` se si tolgono riferimenti.

**Compilazione**

- Compilare entrambi i package toccati; risolvere errori introdotti.

**Rischi**

- Se `models-dev.local.json` NON contiene anaconda-desktop e l'entry nasce solo dalla plugin/overlay, togliere l'overlay senza aggiungere l'entry al snapshot farebbe sparire il provider: il default prudente è "aggiungi alla whitelist, lascia overlay". Scegliere la simplification solo se verificato che l'entry sopravvive senza overlay.
- Divergenze tra specchio client e server: aggiornare sempre entrambi nello stesso step.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step.
- Prima di decidere se rimuovere l'overlay, verifica empiricamente (leggendo il flusso) che l'entry anaconda-desktop sopravviva al pickBy da sola.
- Non aprire discussioni sulla rimozione totale di anaconda: resta un provider locale valido.
- Marker `kilocode_change` solo nei file ereditati dal fork modificati (`provider/models.ts`, `handlers/provider.ts`); NON in `local-providers.ts` (sotto `src/kilocode/`) né in `packages/kilo-vscode/`.
- Compila/typechecka e testa al termine.

---

### Step 7 — Allineare il committed snapshot models-dev.local.json con la whitelist (P7)

**Obiettivo**

Eliminare il drift tra `models-dev.local.json` (contiene `lynkr`) e `LOCAL_PROVIDER_IDS` (non lo contiene), decidendo esplicitamente il contenuto del catalogo offline.

**Motivazione**

Il committed snapshot è la fonte del catalogo quando `KILO_DISABLE_MODELS_FETCH=1` e non c'è cache a disco. Oggi contiene `lynkr`, provider che il cut runtime getta a meno che non sia configurato: è rumore non spiegato nel dataset "offline generation source". Assunzione di questo piano: `lynkr` non è un provider OpenAI-compatibile locale standard (llama.cpp/vLLM/Ollama/LM Studio) e non è richiesto dall'utente, quindi si rimuove dal JSON. Se l'utente la pensa diversamente, lo dirà in review e il subagente ri-aggiungerà l'entry + l'id.

**File da leggere**

- `packages/opencode/models-dev.local.json` (interezza: struttura e contenuti dei provider)
- `packages/opencode/src/kilocode/local-providers.ts` (per il confronto, post-step-6)
- `packages/opencode/script/generate.ts:14-24` (come il file viene consumato)
- `packages/opencode/script/build.ts` (iniezione `KILO_MODELS_DEV`)

**File da modificare**

- `packages/opencode/models-dev.local.json`

**Attività**

1. Ispezionare l'entry `lynkr` nel JSON: base URL, tipo di API, modelli. Confermare che non sia un endpoint locale OpenAI-compatibile (se lo fosse, ri-valutare: trattare come nello step 6, aggiungere alla whitelist invece di rimuovere).
2. Se confermato non-locale/non-richiesto: rimuovere l'object `lynkr` dal JSON, mantenendo esattamente i provider in `LOCAL_PROVIDER_IDS` (post-step-6: atomic-chat, lmstudio, privatemode-ai, anaconda-desktop se presente nel JSON — verificare e allineare). Verificare che il JSON resti valido.
3. Verificare che nessun test o script aspetti la presenza di `lynkr` (rg `lynkr` in `packages/opencode` e `packages/kilo-vscode`).
4. Verificare che il flusso di build incorpori il JSON a build-time (`script/generate.ts`): normalmente niente da rigenerare a mano — verificare.

**Output atteso**

`models-dev.local.json` contiene esattamente i provider in `LOCAL_PROVIDER_IDS`; il catalogo offline served dallo spawn non include provider inaspettati.

**Verifiche**

- JSON valido: parse del file (es. `bun -e 'JSON.parse(...)'` da root).
- Typecheck da `packages/opencode/`.
- rg: `lynkr` assente da qualunque test/script.

**Compilazione**

- Build/typecheck di `packages/opencode`; risolvere errori.

**Rischi**

- Se qualche utente aveva `lynkr` in `config.provider`, il provider resta comunque visibile via escape-hatch config (il cut ammette gli id configurati): la rimozione dal JSON non lo rompe, toglie solo l'entry precompilata.
- Decisione di contenuto soggetta a review dell'utente: il subagente documenta la scelta nel commit message.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step.
- Non modificare `local-providers.ts` (eventuali aggiunte di id appartengono allo step 6).
- Se l'inspect rivela che `lynkr` è in realtà un endpoint locale OpenAI-compatibile, fermati e segnala nella risposta che serve una decisione: il piano assume rimozione.
- Compila/typechecka al termine.

---

### Step 8 — Rimuovere il dead code di routing per il provider "kilo" (P8)

**Obiettivo**

Eliminare la branch morta `readAuto` in `kilocode/session/routed-model.ts` che confronta con `ProviderV2.ID.make("kilo")` (provider rimosso), e gli altri confronti letterali `=== "kilo"` morti per lo stesso motivo.

**Motivazione**

Dopo la rimozione del provider Kilo Gateway, nessun `providerID` potrà mai valere `"kilo"`: la branch è inutilizzabile e inganna chi legge il codice (fa pensare che esista ancora un auto-routing verso modelli kilo/openrouter). Riduce superficie e chiarisce che l'auto-routing è spento.

**File da leggere**

- `packages/opencode/src/kilocode/session/routed-model.ts` (intero, ~60 righe)
- I call site di `readAuto` (rg `readAuto` in `packages/opencode/src`)
- `packages/opencode/src/cli/cmd/github.handler.ts:296` (confronto `provider === "kilo"`) e il contesto circostante
- `packages/opencode/src/cli/cmd/models.ts:59-62` (tiebreak sort `a === "kilo" || a.startsWith("opencode")`)

**File da modificare**

- `packages/opencode/src/kilocode/session/routed-model.ts`
- `packages/opencode/src/cli/cmd/github.handler.ts` (solo la branch morta, se confermata)
- `packages/opencode/src/cli/cmd/models.ts` (solo il tiebreak, se confermato innocuo rimuoverlo)
- Eventuali test che coprono `readAuto`

**Attività**

1. In `routed-model.ts`: se `readAuto` serve solo a produrre un modello alternativo quando il provider è `kilo`/openrouter-prefix, e quel provider non esiste più, sostituire la funzione con un no-op documentato (`return undefined` con commento "kilo routing removed with the offline surface") oppure rimuoverla del tutto insieme ai call site, se questi non hanno altro ruolo. Preferire la rimozione completa se i call site diventano vuoti; altrimenti il no-op commentato.
2. In `github.handler.ts:296`: verificare il blocco circostante (nota: il file è già stato adattato nello step 3 per la dipendenza da SessionShare — lavorare sulla versione aggiornata); se l'intero ramo `provider === "kilo"` gestiva l'auth GitHub tramite gateway, rimuoverlo (o lasciarlo con commento se la rimozione è invasiva — segnalare).
3. In `models.ts:59-62`: il tiebreak ordina `kilo`/`opencode` per primi; con quei provider assenti il predicato non matcha mai. Semplificare rimuovendo la clausola morta (mantenendo l'ordinamento generico).
4. Eseguire i test CLI/TUI toccati (se presenti sotto `packages/opencode/test/`).

**Output atteso**

Nessun confronto con l'id provider `"kilo"` resta nel codice live; l'auto-routing è documentato come assente.

**Verifiche**

- Typecheck da `packages/opencode/`.
- rg finale: `rg -n '"kilo"|make\("kilo"\)' packages/opencode/src` → restano solo hit di branding (nomi file/config/directory), zero confronti di provider-id.
- Test touchati verdi.

**Compilazione**

- Typecheck/build di `packages/opencode`; risolvere errori.

**Rischi**

- Se `readAuto` avesse un secondo ruolo oltre al routing kilo (es. gestire anche openrouter-prefix per provider custom), il taglio completo romperebbe quel caso: verificare i call site prima di scegliere rimozione vs no-op.
- `github.handler.ts` è un file grande e già toccato nello step 3: coordinarsi sulla versione corrente, niente refactoring contiguo.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step.
- Per ogni candidato di rimozione, leggi il blocco circostante (±30 righe) e conferma che la condizione non possa mai diventare vera; in caso di dubbio scegli il no-op commentato anziché la rimozione.
- Marker `kilocode_change`: `routed-model.ts` è sotto `src/kilocode/` → no marker; `github.handler.ts` e `models.ts` sono condivisi → marker sui blocchi modificati.
- Compila/typechecka e testa al termine.

---

### Step 9 — Rimuovere il blocco bedrock morto in getSmallModel (P9)

**Obiettivo**

Eliminare il blocco di matching cross-regione `amazonBedrock` (~18 righe) in `getSmallModel` in `provider/provider.ts`, inarrivabile in un catalogo solo-locale.

**Motivazione**

`amazonBedrock` non è nel catalogo offline (né in whitelist, né in `models-dev.local.json`): il blocco che fa prefix-matching `global.`/`us.`/`eu.` sulle regioni AWS non può mai fire. La rimozione accorcia la funzione e toglie un riferimento a un provider cloud.

**File da leggere**

- `packages/opencode/src/provider/provider.ts:1109-1173` (interezza di `getSmallModel`, inclusi i commenti kilocode_change già presenti e l'early-return azure a 1136-1140)
- I test che coprono `getSmallModel` (rg `getSmallModel` in `packages/opencode/test/`)

**File da modificare**

- `packages/opencode/src/provider/provider.ts`
- Eventuali test che asserivano il comportamento bedrock

**Attività**

1. Rimuovere il blocco `if (providerID === ProviderV2.ID.amazonBedrock) {...}` (righe ~1150-1168) da `getSmallModel`.
2. Verificare che le costanti `smallModelFamilyPriority`/`priority` (righe ~1214-1215) non vengano invalidate: restano liste di famiglie che per i provider locali semplicemente non matchano — lasciarle invariate in questo step.
3. Se un test di `getSmallModel` costruiva un caso bedrock, aggiornarlo/rimuoverlo.
4. Aggiorare il commento kilocode_change circostante per riflettere la nuova forma della funzione.

**Output atteso**

`getSmallModel` senza la branch bedrock; comportamento invariato per tutti i provider della superficie locale.

**Verifiche**

- Typecheck da `packages/opencode/`.
- Test provider: `bun test ./test/provider` e `./test/kilocode` (i file che toccano getSmallModel).
- Check annotazioni: `bun run script/check-opencode-annotations.ts --worktree`.

**Compilazione**

- Typecheck/build di `packages/opencode`; risolvere errori.

**Rischi**

- Basso: la branch è strutturalmente inarrivabile. Unico rischio è un test che dipendesse dal matching regionale: va aggiornato nello stesso step.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step.
- Tocca solo `getSmallModel` e i suoi test; non riordinare altre parti di `provider.ts`.
- Marker `kilocode_change` obbligatorio (file condiviso).
- Compila/typechecka e testa al termine.

---

### Step 10 — Verifica e pulizia dei route group KilocodeApi/RemoteApi (P10)

**Obiettivo**

Determinare se i route group `KilocodeApi` e `RemoteApi` ancora montati in `api.ts` servono effettivamente qualcosa dopo la rimozione di Remote Control/Gateway, e rimuovere quelli ridondanti.

**Motivazione**

L'audit ha trovato entrambi i group ancora wired in `InstanceHttpApi` (`api.ts:39,42,108,111`). Il commit `969f948` ha rimosso Remote Control (section, `/remote` command, `RemoteStatusService`, message types) lato estensione: se i handler `RemoteApi` sono ormai no-op o inesistenti, il group è peso morto. `KilocodeApi` potrebbe invece servire ancora routes locali (heap snapshot, media-local, ecc.): va verificato caso per caso, non rimosso a cieco.

**File da leggere**

- `packages/opencode/src/server/routes/instance/httpapi/api.ts` (lista completa dei group e import)
- I file che definiscono `RemoteApi` e `KilocodeApi` (individuare i path via import in `api.ts`)
- Lato estensione: verificare quali endpoint `kilo-code` chiama ancora (rg `baseUrl}/remote` e le chiavi dei message type in `packages/kilo-vscode/webview-ui/src/types/messages/`)

**File da modificare**

- `packages/opencode/src/server/routes/instance/httpapi/api.ts` (de-registrare i group morti)
- I file-handler dei group rimossi (da eliminare se orfani)
- Eventuali riferenze residue lato estensione agli endpoint rimossi
- `packages/sdk/openapi.json` + rigenerazione SDK se le route rimosse erano generate

**Attività**

1. Per `RemoteApi`: elencare i route/endpoint che dichiara e verificare se l'estensione li chiama ancora (dopo la rimozione di RemoteStatusService e del message remote). Se nessun call site: de-registrare il gruppo in `api.ts` e cancellare il file handler orfano.
2. Per `KilocodeApi`: enumerare i suoi endpoint e mapparli ai call site extension-side (heap snapshot, media-local, indexing consent, question tool, ecc.). Tenere il gruppo se ancora serve; de-registrarlo solo se TUTTI i suoi endpoint sono morti.
3. Se si rimuove un group, verificare che lo SDK TypeScript non esponga metodi dipendenti da quelle route: farlo rigenerare (`bun run script/generate.ts` da root) solo se le route rimosse avevano counterpart nella HTTP API generata.
4. Eseguire i test server (`packages/opencode/test/server/`) e la suite dell'estensione.

**Output atteso**

Solo route group con endpoint vivi restano montati; i file orfani sono cancellati; lo SDK è coerente.

**Verifiche**

- Typecheck da `packages/opencode/` e `packages/kilo-vscode/` (e `packages/sdk/js/` se rigenerato).
- Test server: da `packages/opencode/` `bun test ./test/server`.
- Suite estensione: da `packages/kilo-vscode/` `bun run test:unit`.

**Compilazione**

- Compilare i package toccati; risolvere errori. Se lo SDK va rigenerato, farlo prima del typecheck finale.

**Rischi**

- `KilocodeApi` probabilmente resta (serve endpoint vivi): il rischio è rimuoverlo per errore — da qui il "verifica caso per caso, non a cieco".
- Rigenerazione SDK: se le route rimosse non erano nell'OpenAPI generato, skip; se lo erano, il diff dello SDK deve essere coerente con i tipi usati dall'estensione.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step.
- Prima di rimuovere un group, produci nella tua risposta la mappatura endpoint→call-site che giustifica la rimozione.
- Non rimuovere `KilocodeApi` senza evidenza che tutti i suoi endpoint siano morti.
- Marker `kilocode_change` in `api.ts` (file condiviso).
- Compila/typechecka e testa al termine.

---

### Step 11 — Pulizia documentale: skill JetBrains stale e PRUNE-NOTES (P11, P12)

**Obiettivo**

Rimuovere i due skill che puntano a `packages/kilo-jetbrains` (pacchetto rimosso) e aggiornare `PRUNE-NOTES.md` dove contraddice lo stato attuale.

**Motivazione**

Gli skill `icon-jetbrains` e `jetbrains-cli-pin` (e `release-jetbrains` se presente in `.kilo/skills/`) istruiscono l'agente a operare su percorsi gradle/frontend inesistenti: sono dead weight che inquina il prompt e confonde. `PRUNE-NOTES.md` afferma che `check-opencode-annotations` è stato rimosso mentre `AGENTS.md` lo documenta ancora come check attivo: va allineato al reale (verificare se lo script esiste ancora in `script/`).

**File da leggere**

- `.kilo/skills/icon-jetbrains/SKILL.md`, `.kilo/skills/jetbrains-cli-pin/SKILL.md`, e `.kilo/skills/release-jetbrains/SKILL.md` se presente
- `PRUNE-NOTES.md` (root)
- `script/` (verificare presenza di `check-opencode-annotations.ts`)
- `AGENTS.md` (sezione Quality Checks, per il confronto)

**File da modificare / eliminare**

- Eliminare `.kilo/skills/icon-jetbrains/` e `.kilo/skills/jetbrains-cli-pin/` (e `release-jetbrains/` se presente e obsoleto)
- `PRUNE-NOTES.md` (correzioni mirate)

**Attività**

1. Cancellare le directory skill obsolete (contenuto interamente riferito a JetBrains).
2. In `PRUNE-NOTES.md`: correggere la riga che dichiara rimossa `check-opencode-annotations` se lo script è ancora presente in `script/` (allineare PRUNE-NOTES ad AGENTS.md); aggiornare eventuali assert su `kilo-gateway`/`kilo-telemetry` che risultino smentiti dallo stato attuale dei `package.json` workspace (verificare se i package esistono ancora su disco: se assenti da `packages/`, correggere la nota).
3. Verificare che nessun altro file punti agli skill rimossi (rg `icon-jetbrains|jetbrains-cli-pin|release-jetbrains` in `.kilo/` e `AGENTS.md`).

**Output atteso**

Nessuno skill JetBrains superstite; `PRUNE-NOTES.md` coerente con `AGENTS.md` e con i package realmente presenti.

**Verifiche**

- `ls .kilo/skills/` → solo skill ancora valide (chart, gh-issues, icon-vscode, kilo-config, vscode-visual-regression).
- rg finale per i nomi skill rimossi → zero hit.
- Rapido typecheck dell'estensione per sicurezza (improbabile impatto).

**Compilazione**

- Nessun impatto sulla compilazione; verificare che il workspace resti integro (nessun reference rotta in `package.json`).

**Rischi**

- Minimale: skill e note non partecipano alla build. Unico rischio è rimuovere uno skill ancora utile: `release-jetbrains` va rimosso solo se il suo workflow è interamente JetBrains.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step.
- Prima di eliminare `release-jetbrains`, leggi il SKILL.md e conferma che operi solo su `packages/kilo-jetbrains`.
- Nelle correzioni a `PRUNE-NOTES.md` mantieni lo stile esistente (elenchi puntati, tono conciso); non riscrivere l'intero documento.
- Niente marker kilocode_change (file non in area di build condivisa).
- Termina verificando l'integrità del workspace.

---

### Step 12 — Documentare i residui gated-per-design e validazione finale end-to-end (P13, P14 + closure)

**Obiettivo**

Registrare in un punto unico i percorsi di rete che restano volontariamente disponibili (gated da scelta utente o pre-cache) e eseguire la validation finale completa: guard CI, typecheck, lint, knip, suite unitarie, e smoke test `kilo serve` offline.

**Motivazione**

P13 (download on-demand di ripgrep/plugin npm/lancedb/dynamic-SDK) e P14 (embedders hosted per indexing) non vengono rimossi in questo piano: sono capacità legittime attivate solo da azione utente o da caché fredda. Dopo gli step precedenti il loro stato è cambiato (LSP rimosso alla radice, share/autoupdate assenti, probe azzerate), quindi va documentata la matrice finale "cosa può ancora parlare con l'esterno e perché" per chiudere l'audit in modo esaustivo. La validation finale prova che l'insieme degli step produce un'estensione effettivamente offline.

**File da leggere**

- Tutti i file modificati negli step 1–11 (diff review)
- `packages/kilo-vscode/CHANGELOG.md` (top entries) e README dell'estensione, per verificare testi stale su funzionalità online (account, gateway, marketplace, remote control, auto-update, sharing, LSP)
- `PRUNE-NOTES.md` (aggiornato nello step 11) come sede naturale della matrice residui

**File da modificare**

- `PRUNE-NOTES.md` (aggiungere sezione "Residui volutamente online (gated)" con la matrice)
- `packages/kilo-vscode/CHANGELOG.md` (voce che riassume questa chiusura offline, stile delle voci esistenti)
- Eventuali sezioni stale di README (solo se trovate in questa fase)

**Attività**

1. Compilare la matrice dei residui gated e aggiungerla a `PRUNE-NOTES.md`:
   - `webfetch` tool: GET arbitrari permission-gated (capacità agente, permission `webfetch`)
   - `skills.urls` config: pull index.json da URL dichiarati dall'utente
   - MCP remote/OAuth: URL dichiarati dall'utente, OAuth apre il browser di sistema
   - Browser automation (`npx @playwright/mcp@latest`): npm registry al primo uso, feature off di default
   - Embedders hosted per indexing: selezionabili solo se l'utente li configura (UI limitata a ollama/openai-compatible)
   - Import PR da GitHub (Agent Manager): `gh`/`git fetch` su azione utente
   - Download on-demand di binary/plugin: ripgrep da GitHub releases se assente a sistema, `Npm.add` per plugin/dynamic-provider-SDK/@lancedb al primo uso con caché fredda
   - Comando `kilo upgrade` manuale: npm registry/brew/choco/scoop su azione esplicita (l'auto-update è stato rimosso)
   - Link `openExternal` nella webview (kilo.ai/docs, github, reddit): aprono il browser di sistema, non socket del processo
   - Assenti per costruzione: models.dev fetch (flag + snapshot), LSP (feature rimossa), session sharing (feature rimossa), auto-update (rimosso), network probe (lista azzerata), telemetry OTel (env sanitizzata)
2. Correggere i testi stale di CHANGELOG/README che descrivono servizi online rimossi (inclusi adesso LSP/sharing/auto-update).
3. Eseguire la validation completa:
   - Da root: `bun run lint`, `bun run typecheck`
   - Da root: `bun run script/check-workflows.ts`, `bun run script/check-md-table-padding.ts`, `bun run script/check-opencode-annotations.ts --worktree`
   - Da `packages/opencode/`: `bun run typecheck`, `bun test`
   - Da `packages/kilo-vscode/`: `bun run typecheck`, `bun run lint`, `bun run knip`, `bun run check-kilocode-change`, `bun run test:unit`
   - Smoke test offline: avviare `kilo serve` (o l'estensione in dev) con una dummy `OPENCODE_API_KEY` e SENZA rete (o con firewall/proxy spia che logga le connessioni uscenti), configurando un provider OpenAI-compatibile locale dummy; verificare che: il catalogo esposto contenga solo i provider locali/dichiarati; non vi siano connessioni uscenti verso host pubblici nelle prime decine di secondi; simulare un errore di connessione del provider e verificare che non partano probe (lista azzerata); aprire un file di una lingua con LSP "rimosso" e verificare nessun attempt di download.
4. Se lo smoke test o i guard trovano residui, risolverli in questo step finale (è il passo di chiusura).

**Output atteso**

Documentazione unica e accurata dei residui voluti; tutta la toolchain CI verde; smoke test offline che dimostra assenza di traffico verso l'esterno.

**Verifiche**

- Tutti i comandi della lista sopra eseguiti e riportati come risultati.
- Output dello smoke test (lista connessioni uscenti osservate: dovrebbe essere vuota o contenere solo il provider locale).

**Compilazione**

- Questo step è la chiusura: a fine step il progetto deve essere completamente compilabile e testato. Qualsiasi fallimento va risolto qui prima di dichiarare completamento.

**Rischi**

- Lo smoke test richiede un ambiente controllato (rete disattivata o proxy spia): se non disponibile, approssimare con ispezione del log delle connessioni del backend.
- Possibili failure di test pre-esistenti (documentate nei commit precedenti come "remaining failing behavioral assertions"): distinguerle dai failure introdotti da questo piano usando baseline se necessario.
- Le rimozioni degli step 2–4 cambiano expectations di test TUI/SDK: se qualche test TUI fallisce per l'assenza di `global.upgrade`/`share`, è un fallout atteso da aggiornare QUI solo se non è stato aggiornato nello step di competenza.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step.
- Non introdurre nuove rimozioni di codice qui, salvo che uno smoke test/guard lo richieda esplicitamente: in quel caso segnalalo chiaramente nella risposta.
- La matrice residui deve essere onesta: elenca anche ciò che resta volontariamente online (webfetch, MCP remote, skills urls, `kilo upgrade` manuale), con la ragione.
- Se un guard fallisce per cause pre-esistenti documentate nei commit di Le0xFF, annotalo come tale senza bloccare lo step.
- Compila/typechecka ed esegui la suite completa al termine; riporta i risultati in tabella.

## Criteri di completamento

- Tutti i 12 step sono stati completati in ordine sequenziale, ciascuno approvato dall'utente prima di procedere al successivo.
- Ogni step ha terminato con una codebase compilabile (typecheck green dei package toccati).
- L'ambiente del child `kilo serve` non contiene variabili `OTEL_*` né proxy var ambientali non gestite da VS Code (`KILO_DISABLE_MODELS_FETCH` resta `"true"`).
- La feature LSP è assente: nessun modulo `lsp/`, nessun tool `lsp`, nessuna key config `lsp`, nessun toggle/permission UI, nessun reference a siti di download LSP.
- La feature session sharing è assente: nessuna route `/session/{id}/share`, nessuna method SDK, nessun TUI surface, nessun reference a `opncd.ai`; i dati storici (tabella/colonna) restano compatibili.
- La feature auto-update è assente: nessuna route `/global/upgrade`, nessuna RPC `checkUpgrade`, nessun flag `KILO_DISABLE_AUTOUPDATE`/`KILO_ALWAYS_NOTIFY_UPDATE`, nessun key `autoupdate`; il comando manuale `kilo upgrade` resta.
- La lista di probe esterne in `session/network.ts` è vuota: nessun host pubblico referenziato, nessun DNS/TCP verso l'esterno dopo errori di connessione.
- `anaconda-desktop` e il contenuto di `models-dev.local.json` sono coerenti con `LOCAL_PROVIDER_IDS`.
- Nessun confronto provider-id contro `"kilo"` resta nel codice live; il blocco bedrock di `getSmallModel` è rimosso.
- Solo route group con endpoint vivi restano montati nell'HTTP API.
- Niente skill JetBrains stale; `PRUNE-NOTES.md` coerente con `AGENTS.md`.
- Matrice dei residui gated documentata; CHANGELOG/README aggiornati.
- Guard CI (lint, typecheck, knip, check-kilocode-change, check-workflows, md-table-padding, check-opencode-annotations) tutti verdi.
- Smoke test `kilo serve` offline: solo provider locali in superficie, zero connessioni uscenti verso host pubblici.