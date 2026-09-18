# Chiusura finale offline: dead code e residui online (audit post 6f749c2)

## Obiettivo

Chiudere l'ultima fascia di **dead code** e **residui online** rimasti nel repo dopo i sei commit di Le0xFF (`3864eff → 6f749c2`) che hanno reso l'estensione VS Code completamente offline (solo provider locali OpenAI-compatible: llama.cpp, vLLM, Ollama, LM Studio + provider custom dichiarati dall'utente). L'analisi è stata fatta con tre subagenti paralleli su: (1) CLI `packages/opencode/src` + `packages/llm/src` + `packages/core/src`, (2) estensione `packages/kilo-vscode/**` + `packages/kilo-i18n`, (3) pacchetti secondari (`tui`, `server`, `codemode`, `schema`, `protocol`, `ui`, `plugin`, `kilo-indexing`, `kilo-memory`, `kilo-sandbox`, `kilo-ui`, `effect-*`, `http-recorder`, `plugin-atomic-chat`, `sdk/js`).

L'implementazione va bene nella sostanza: i servizi online Kilo sono tutti rimossi e il catalogo provider è hard-cut. Questo piano copre solo i **residui** individuati, in step piccoli e sequenziali, ciascuno compilabile e verificabile da un subagente distinto.

## Analisi — stato attuale

### Superficie funzionante (verificata pulita, non toccare)

- Catalogo provider hard-cut via `inLocalSurface` (`packages/opencode/src/kilocode/local-providers.ts`: `lmstudio`, `atomic-chat`, `privatemode-ai`, `anaconda-desktop` + `configuredIds`); snapshot offline committed `models-dev.local.json`; `KILO_DISABLE_MODELS_FETCH=true` forzata allo spawn.
- Nessun import residuo di `@kilocode/kilo-gateway`, `@kilocode/kilo-telemetry`, `kilo-exa`, `generate-image`, `websearch` tool, LSP, share, claw, console in `opencode/src`, `llm/src`, `core/src` (un solo commento stantio in `kilocode/cli/setup.ts:22`).
- Barile `llm` providers = Anthropic/Azure/OpenAI/OpenAICompatible; protocolli = anthropic-messages/openai-chat/openai-compatible/openai-responses; `native-request.ts` gate solo sui tre npm in superficie.
- Estensione: esbuild entries tutte esistenti, `.vscodeignore` pulito, comandi/keybindings senza orfani, `knip.json ignoreDependencies` coerenti, `resolveManagedServerEnv` sanifica `OTEL_*`/`BUN_*`/`NODE_OPTIONS`/proxy, `drainNetworkWaits` presente.
- TUI: tree-sitter download opt-in (`KILO_TREE_SITTER_DOWNLOAD`), plugin install etichettato "requires npm registry access", nessun default remoto. `plugin-atomic-chat` solo loopback gated. `kilo-indexing` senza fetch a startup.
- SDK: nessun namespace `client.kilo`, niente `experimental.console`, niente `session.share/unshare`, niente `global.upgrade`; `network.*` consumato da `connection-service.ts` (drain) + TUI + `run.ts`.

### Buco funzionale principale (da correggere, Step 1-2)

**Sessioni parcheggiate in stato "offline" che non si risolvono mai.** In `packages/opencode/src/session/network.ts` la lista host di probe è `urls = []` (commit 5d613a0), quindi `probe()` fa sempre `false` e il watch loop non può mai auto-ripristinare. Nel frattempo `processor.ts:handleOffline` (usato da `retryOpts` → `SessionRetry.policy` in `session/processor.ts:964-979`) intercetta **ogni** errore di connessione del provider — incluso `ECONNREFUSED` verso un provider locale 127.0.0.1 (il caso tipico: server llama.cpp/Ollama momentaneamente giù o modello in caricamento) — lo converte in `ask()` e mette la sessione in `{type:"offline"}`. Conseguenze:

- **Estensione**: il webview mostra "Network disconnected — reconnecting..." (`WorkingIndicator.tsx:71`, i18n `session.status.offline`) ma **non c'è alcun UI per rispondere/rifiutare** il wait (nessun componente renderizza `networkWait`); il turno resta bloccato finché l'utente non abortisce a mano oppure il backend muore e `drainNetworkWaits` (`connection-service.ts:71-79`) rifiuta tutto al riattacco. Un singolo `ECONNREFUSED` transitorio sul provider locale lascia la sessione in stall permanente.
- **TUI**: ha invece il prompt `NetworkPrompt` (`tui/src/routes/session/network.tsx`) con Esc per rifiutare — comportamento accettabile, ma il messaggio "Waiting for network..." è fuorvante in superficie offline (si sta aspettando un endpoint locale, non internet).

Correzione scelta (minimale, conservativa): se la lista di probe è vuota non serve aspettare una rete esterna — il retry normale della policy si riprende. Si short-circuita `handleOffline` quando `urls.length === 0` restituendo `"retry"` subito (il prossimo attempt riprova il provider con backoff; se fallisce ancora, `retryable()` decide se continuare o fermarsi; l'abort continua a funzionare). Il meccanismo resta intatto per chi volesse re-introdurre host di probe.

### Dead code confermato (Step 3-8)

| # | Dove | Cosa | Evidenza |
|---|---|---|---|
| D1 | `opencode/src/kilocode/balance-refresh.ts` | intero file: zero importatori | esisteva per il sidebar balance rimosso |
| D2 | `opencode/src/kilocode/provider/codex-refresh.ts` + case `CodexAuthExpiredError` in `message-v2.ts:756-763` | `refreshCodexAuth` mai chiamata; unica throw site dentro a essa → ramo `fromError` irraggiungibile | usato solo dai test `test/kilocode/codex-auth-refresh.test.ts` + fixture worker |
| D3 | `opencode/src/auth/index.ts:8` export `OAUTH_DUMMY_KEY` | consumato solo da `test/session/llm-native.test.ts` | nessuna consumer di produzione |
| D4 | `core/src/models-dev.ts:269-272` fork ambien­te `refresh().repeat(spaced 60min)` + `fetchAndWrite`/`fresh`/`loadSnapshot` + flag `KILO_MODELS_URL`/`KILO_MODELS_PATH`/`KILO_DISABLE_MODELS_FETCH` (flag.ts) | con snapshot committed + `KILO_DISABLE_MODELS_FETCH=true` il populate parte sempre da disco/snapshot e la fetch è morta; il fork gira comunque a vuoto | `kilo models --refresh` resta l'unico caller legittimo (user-gated) |
| D5 | `core/src/kilocode/provider-usage/cloud.ts:48-55` `base()` → `https://app.kilo.ai` | output mai emesso perché `Cloud.load` è stub no-op | managed adapter degrada a vuoto |
| D6 | `llm/src/cache-policy.ts:42` `RESPECTS_INLINE_HINTS` include `"bedrock-converse"` | protocollo eliminato dal barile | ridurre a `["anthropic-messages"]` |
| D7 | `kilo-indexing/src/config.ts:37-45,160-166` opzione embedder `kilo` (zod + Effect Schema) | nessun branch factory la consuma (`service-factory.ts` gestisce solo openai/ollama/openai-compatible/gemini/mistral/vercel-ai-gateway/bedrock/openrouter/voyage; `model-registry.ts:60` profilo vuoto) → scegliere `provider:"kilo"` farebbe throw; UI limita già a ollama/openai-compatible | rimuovibile |
| D8 | `ui/src/theme/loader.ts:78-84` `loadThemeFromUrl` (+ re-export `ui/src/theme/index.ts:36`, `kilo-ui/src/theme/index.ts:29`) | zero caller nel workspace | funzione orphan |
| D9 | `kilo-vscode/webview-ui/src/styles/prompt-input.css:651-692` blocchi `.prompt-speech-button*` | speech-to-text rimosso; nessun TSX rende quelle classi (solo nomi icona `speech-bubble`) | CSS morto |
| D10 | `kilo-vscode/webview-ui/src/styles/provider-usage.css` (intero) + `@import` in `chat.css:29` | sezione provider-usage/balance rimosso; nessun componente usa le classi | CSS morto |
| D11 | Controllo "Share mode" in `ExperimentalTab.tsx:11-58` + key `share` (`types/messages/config.ts:147`) + `"share"` in `settings-io.ts:28` KNOWN_KEYS + famiglia i18n `settings.experimental.share.*` nei 21 locale | il backend v1 non dichiara più `share` né `autoshare` (commento in `core/src/v1/config/config.ts:85`); il controllo scrive una key che l'offline backend scarta silenziosamente | **buco UI live**: controllo che punta a capacità backend rimossa |
| D12 | `tui/src/component/dialog-retry-action.tsx:10,43,81-85,101-109` `KILO_PRICING_URL` + special-case `showGoTreatment` (BGPulse) | `retryable()` non emette mai `action` (commento "Kilo does not emit OpenCode Go actions") → `props.link` sempre undefined; il trattamento pricing è morto (e puntava alla pagina pricing online di Kilo) | semplificare il componente |
| D13 | `tui/src/feature-plugins/home/tips-view.tsx:279` tip "/connect with OpenCode Zen" | è **dentro** il blocco commentato `/* ... */` (righe ~168-289, "hide the entire list for if it is accidentally used"): cosmetico-zero, pulizia opzionale | verificare lo stato reale del blocco prima di toccarlo |

### Residui cosmetici accettati (NON rimuovere, solo documentare nello Step finale)

- Link `openExternal` nella webview: `FeedbackDialog.tsx` (github issues / kilo.ai discord / kilo.ai support — raggiungibile dal WelcomeEmptyState, non fa POST), `CustomProviderDialog.tsx` docs link (rilevanti per custom provider), `MigrationWizard.tsx` blog/docs links, `AboutKiloCodeTab.tsx` (github/reddit), `useSlashCommand.ts:119` kilo.ai/docs. Tutti gated dal browser di sistema, coerenti con la matrice PRUNE-NOTES.
- `mcp/oauth-provider.ts:47` `client_uri: "https://kilo.ai"` (metadata OAuth MCP remote, user-gated).
- `installation/index.ts` Npm/Brew/Choco/Scoop/Release: tutti usati dal comando manuale `kilo upgrade`/`uninstall` (gated). `Release.install` = `https://kilo.ai/cli/install` (metodo curl dell'upgrade manuale).
- `kilo.ai/docs` in prompt txt, `CONFIG_DOCS_URL`, log "Failed to fetch models.dev", `$schema` JSON nei temi tui, commenti attributivi vari.
- Flag `--mdns` + stub `server/mdns.ts`: iner­ti ma cablati (parse → `setupMdns` → no-op publish); niente I/O, niente consumer. Lasciare.
- `WellKnown` auth type + `KILO_AUTH_CONTENT`: live (`kilo login <url>` wellknown + control-plane workspace).
- Rami `amazon-bedrock`/`google-vertex` in `cloud-auth.ts:providerKey`: guardie difensive economiche per credenziali storicamente salvate.
- Gemini compatibility branch in `llm/src/protocols/utils/tool-schema.ts` (per endpoint openai-compatible shaped-gemini).
- `tauri://localhost` origins in `server/src/cors.ts:17`: allowlist innocua (Tauri non è una superficie Kilo).
- SDK `gen/types.gen.ts`: doc-comment `opencode.ai` (rigenerabili, cosmético).
- `kilo-indexing/model-registry.ts:5-6` commento stantio "fetched from Cloud": correggere il commento.
- `kilo-vscode/src/legacy-migration/migration-service.ts` `migrateAutocomplete`/`ghostServiceSettings`: residuo della migrazione legacy (valori migrati senza consumer). **Lasciare**: la legacy migration è una superficie intenzionalmente mantenuta (A9 in PRUNE-NOTES).

## Assunzioni

- La correzione del buco offline (Step 1-2) usa la semantica "probe list vuota ⇒ nessun atteso-network, fallback al retry normale". Non si introduce un nuovo UI per i network-wait nell'estensione: chi vuole uscire dallo stall usa Cancel (già presente nel WorkingIndicator via `isRetrying`? no — verifica: il bottone Cancel esiste solo per `retry`; il piano aggiunge la stessa affordance per `offline` nello Step 2).
- I provider usage endpoints `/kilocode/provider-usage*` restano (superficie SDK live, testata, usata anche da strumenti esterni); NON si rimuove il servicio in questo piano (decisione di API surface separata).
- Rimuovere `KILO_DISABLE_MODELS_FETCH` dal flag set è ok perché l'estensione lo forza allo spawn e il CLI lo usa come fallback; chi imposta manualmente gli altri flag mantiene la fetch esplicita.
- Ogni step termina con compilazione verde dei package toccati e suite unitaria del package.

## Piano di implementazione

I passi sono sequenziali (10 step). Ogni passo è eseguito da un subagente diverso, autosufficiente. Dopo ogni passo: compilazione obbligatoria + revisione utente. Step 1-2 chiudono il buco offline-stall; Step 3-8 rimuovono dead code/residui; Step 9 protegge `bun test` dall'OOM con parallelismo calibrato su RAM in entrambi i package; Step 10 è la verifica finale end-to-end e guardie CI.

---

### Step 1 — Correggere il buco offline: `handleOffline` deve short-circuitare con probe list vuota

**Obiettivo**

Far sì che, in superficie offline (host di probe azzerati), un errore di connessione al provider locale (es. `ECONNREFUSED` su 127.0.0.1) non parcheggi la sessione in uno stato "offline" che non si risolve mai, ma degradi al normale retry con backoff della policy.

**Motivazione**

È l'unico vero bug comportamentale rimasto: oggi un `ECONNREFUSED` transitorio (server locale in riavvio, modello in caricamento) blocca il turno in attesa di una rete esterna che non esisterà mai; l'estensione non ha UI per rispondere al wait e il TUI chiede "Esc to stop" con messaggio fuorviante. Con `urls=[]`, `probe()` è sempre falso e `watch()` non ripristina nulla.

**File da leggere**

- `packages/opencode/src/session/network.ts` (const `urls`, `probe`, `watch`, `ask`, `Event.*`)
- `packages/opencode/src/kilocode/session/processor.ts` (`handleOffline` :139-178, `retryOpts` :187-204)
- `packages/opencode/src/session/retry.ts` (`policy` :130-177, ramo offline :152-162)
- `packages/opencode/src/session/message-v2.ts` (`fromError` caso `SessionNetwork.disconnected` :764-776)
- `packages/opencode/test/session/network.test.ts`, `packages/opencode/test/kilocode/session-processor-network-offline.test.ts`, `packages/opencode/test/session/processor-effect.test.ts` (:559-560), `packages/opencode/test/kilocode/run-network.test.ts`
- `packages/tui/src/routes/session/network.tsx` (copy del prompt, per lo Step 2)

**File da modificare**

- `packages/opencode/src/session/network.ts`: aggiungere un export readonly della lunghezza della probe list, es. `export const probeHosts = () => urls.length` (oppure esporre `urls.length` tramite funzione `hasProbes()`).
- `packages/opencode/src/kilocode/session/processor.ts`: in `handleOffline`, prima di `SessionNetwork.ask`, se `!hasProbes()` loggare `log.info("offline handler skipped: no probe hosts", { sessionID })` e restituire immediatamente `Effect.succeed("retry")` (senza cambiare status).
- Test: aggiornare `test/kilocode/session-processor-network-offline.test.ts` e `test/session/processor-effect.test.ts` dove il test dipendeva da `ask` being called per errori disconnessi: con probe list vuota l'handler ora ritorna `"retry"` senza pubblicare `Asked`. Se i test simulano `ask` con spy, adeguare l'aspettativa (spy non chiamato) oppure forzare una probe list sintetica se il test verifica il flusso completo asked→reply. Verificare anche `test/kilocode/run-network.test.ts` (emette `session.network.asked` a livello di evento: resta valido perché il TUI gestisce event-driven; non toccare se non rompe).

**Attività**

1. Esposizione read-only della presenza di probe host in `network.ts`.
2. Short-circuit in `handleOffline` quando assente.
3. Ricompilare i test sopra elencati eseguendoli: da `packages/opencode` `bun run typecheck` poi `bun test test/session/network.test.ts test/kilocode/session-processor-network-offline.test.ts test/session/processor-effect.test.ts test/kilocode/run-network.test.ts`.
4. Se qualche test fallisce perché asseriva il vecchio comportamento (wait park), aggiornare l'asserzione documentando il nuovo contratto in un commento `// kilocode_change - offline surface: no probe hosts means immediate retry fallback`.

**Output atteso**

Con un provider locale configurato e il suo server spento, il primo `ECONNREFUSED` produce retry/backoff normali (status `retry` con countdown e bottone Cancel esistenti) invece dello stall `offline` permanente; il secondo fallimento segue la policy di `retryable()`.

**Verifiche**

- Typecheck opencode verde.
- I quattro file di test sopra passano.
- Smoke manuale (facoltativo ma consigliato): avviare `kilo serve` con dummy local provider, lanciare una sessione, spegnere il server locale → il turno entra in retry, non in offline-stall.

**Compilazione**

- Da `packages/opencode`: `bun run typecheck`. Risolvere ogni errore introdotto. Compilazione completa richiesta a fine step.

**Rischi**

- Cambia la classificazione dell'errore visto dall'utente (ora vede "retrying" invece di "offline"). Accettato: in superficie offline "network" == endpoint locale.
- Test che assertivano eventi `session.network.asked` per errori disconnessi vanno riallineati; attenzione a non rompere `run-network.test.ts` che lavora a livello SSE.

**Istruzioni per il subagente**

- Implementa solo questo step; non toccare il TUI né l'estensione.
- Non introdurre refactoring oltre lo short-circuit e l'esposizione della probe list.
- Se non sei sicuro del comportamento di `Effect.succeed` vs `yield*` in quel punto, leggi `network.ts` e `retry.ts` prima di scrivere.
- Compila e corri i test indicati; se falliscono per cause preesistenti (baseline documentata nei commit precedenti), verificarlo con `git stash` A/B e annotarlo.

---

### Step 2 — Allineare le UX ai nuovi semantici: TUI copy + Cancel per offline nell'estensione

**Obiettivo**

Rendere coerenti le interfacce col comportamento corretto dallo Step 1: il TUI non dice più "waiting for network" quando non c'è rete esterna da attendere; l'estensione offre lo stesso "Cancel" del retry anche nello stato `offline` (così lo stall residuo — es. wait creato da un'istanza vecchia del backend — è sempre sfuggibile).

**Motivazione**

Lo Step 1 elimina il caso nuovo di stall, ma (a) il prompt TUI `NetworkPrompt` mostra "Waiting for network... Press Esc to stop this turn" anche quando il wait è per un endpoint locale, e (b) il `WorkingIndicator` dell'estensione mostra il bottone Cancel solo quando `info.type === "retry"`; con uno stato `offline` ereditato (backend non aggiornato durante la stessa sessione, o wait generato prima del fix deployato) l'utente non ha azione diretta.

**File da leggere**

- `packages/tui/src/routes/session/network.tsx` (intero)
- `packages/tui/src/routes/session/index.tsx` (:461 call site di `DialogRetryAction.show` — capire come vengono passati i waits di rete al NetworkPrompt; il rendering del NetworkPrompt è event-driven via `session.network.asked`)
- `packages/kilo-vscode/webview-ui/src/components/shared/WorkingIndicator.tsx` (:83 `isRetrying`, :112-122 Show del botton Cancel)
- `packages/kilo-vscode/webview-ui/src/i18n/en.ts` e gli altri 20 locale (key `session.status.offline`, valutare se riutilizzare la label di cancel esistente `ui.sessionTurn.cancel`)
- `packages/kilo-vscode/tests/unit/` eventuali test che toccano WorkingIndicator/statusInfo

**File da modificare**

- `packages/tui/src/routes/session/network.tsx`:当 `restored === false`, sostituire le righe "Waiting for network..." con copy neutro tipo "Connection lost — retrying automatically" (in inglese, unico locale del TUI) mantenendo "Press Esc to stop this turn." Se si vuole distinguere il caso probe-less non serve: il componente è generico.
- `packages/kilo-vscode/webview-ui/src/components/shared/WorkingIndicator.tsx`: estendere `isRetrying` a `const actionable = () => info.type === "retry" || info.type === "offline"` e usare `actionable()` sia per il `<Show>` del countdown (che resta solo per retry, usando `isRetrying`) sia per il bottone Cancel; `handleCancelRetry` invia `abort` (già corretto per entrambi gli stati).
- Eventuale aggiornamento di un test unitario dell'estensione che asserta la presenza/assenza del bottone per stato.

**Attività**

1. Copy TUI.
2. Botton Cancel per `offline` nel WorkingIndicator.
3. `bun run typecheck` + `bun run lint` da `packages/kilo-vscode`; da `packages/tui` il typecheck passa col root turbo (`bun turbo typecheck` da root).
4. Se esistono visual-regression baselines del dock in stato offline (`webview-ui/src/stories/tool-call-lab.stories.tsx:1028-1034` ha una story offline), verificare che il nuovo bottone non rompa le baseline; in tal caso aggiornare le stories/baseline seguendo la skill `vscode-visual-regression`.

**Output atteso**

TUI: messaggio onesto ("Connection lost — retrying automatically"). Estensione: in stato `offline` compare il bottone Cancel accanto allo spinner, identico a quello di `retry`.

**Verifiche**

- Typecheck/lint estensione verdi; `bun run test:unit` da `packages/kilo-vscode` verde (4093+ test).
- Root: `bun turbo typecheck` include il TUI.
- Eventuali storybook stories offline coerenti.

**Compilazione**

- `bun run compile` da `packages/kilo-vscode` (typecheck + lint + bundle) e `bun turbo typecheck` da root. Risolvere errori introdotti.

**Rischi**

- Baseline di visual regression del dock: il bottone aggiuntivo cambia l'altezza/larghezza della riga in stato offline; le stories devono essere aggiornate nella stessa modifica.

**Istruzioni per il subagente**

- Solo questo step: copy TUI + bottone Cancel estensione. Non toccare `network.ts`.
- Usa WebFetch/MCP solo se dubiti dell'API dei componenti kilo-ui (Button/Show).
- Mantieni i nomi delle i18n key esistenti; non aggiungere key nuove se `ui.sessionTurn.cancel` basta.

---

### Step 3 — Dead code CLI: `balance-refresh.ts`, `codex-refresh.ts` + case `CodexAuthExpiredError`, export `OAUTH_DUMMY_KEY`

**Obiettivo**

Rimuovere moduli di processo senza chiamanti nati dalla superficie account/Kilo Gateway eliminata.

**Motivazione**

- `balance-refresh.ts` (pub/sub per il refresh del saldo sidebar) ha zero importatori: il saldo era del profile cloud rimosso.
- `refreshCodexAuth` non è wired in nessun loader (il plugin Codex online è stato rimosso in 969f948140); l'unica throw site di `CodexAuthExpiredError` è dentro a essa, quindi anche il ramo `case e instanceof CodexAuthExpiredError` in `MessageV2.fromError` è irraggiungibile.
- `OAUTH_DUMMY_KEY` è esportato da `auth/index.ts` ma consumato solo da `test/session/llm-native.test.ts`.

**File da leggere**

- `packages/opencode/src/kilocode/balance-refresh.ts`
- `packages/opencode/src/kilocode/provider/codex-refresh.ts`
- `packages/opencode/src/session/message-v2.ts` (:39 import, :756-763 case)
- `packages/opencode/src/auth/index.ts` (:8)
- `packages/opencode/test/kilocode/codex-auth-refresh.test.ts`, `packages/opencode/test/kilocode/fixture/codex-auth-refresh-worker.ts`, `packages/opencode/test/session/llm-native.test.ts`
- `packages/opencode/package.json` / `bun.lock` (solo se le dipendenze di quei moduli diventano orfane: `Flock` resta usata altrove — verificare)

**File da modificare**

- Eliminare `packages/opencode/src/kilocode/balance-refresh.ts`.
- Eliminare `packages/opencode/src/kilocode/provider/codex-refresh.ts` + il test + la fixture worker (se la fixture è usata da altri test, valutare: la ricerca mostra usi solo in `codex-auth-refresh.test.ts`).
- In `message-v2.ts`: togliere l'import e il case `CodexAuthExpiredError`.
- In `auth/index.ts`: togliere l'export; nel test `llm-native.test.ts` definire la costante localmente (è un valore letterale, non serve shared).
- Verificare con knip/eslint che non restino riferimenti (barili, index).

**Attività**

1. Cancellazioni + cleanup import/case.
2. `bun run typecheck` da `packages/opencode`; `bun test test/session/llm-native.test.ts` + eventuale test che importava la fixture.
3. `bun run knip` da `packages/kilo-vscode` (guardia CI cross-package) e root lint/typecheck.

**Output atteso**

Nessun riferimento a `balance-refresh`, `codex-refresh`, `CodexAuthExpiredError`, `OAUTH_DUMMY_KEY` fuori dai test adattati; compilazione verde.

**Verifiche**

- Grep repo-wide: zero hit per i simboli rimossi (salvo commenti storici voluti).
- Typecheck opencode + test indicati verdi.

**Compilazione**

- `bun turbo typecheck` da root (copre opencode); risolvere errori introdotti.

**Rischi**

- Low. Attenzione a non rimuovere `Flock` da `package.json` (usata da `models-dev.ts` e altrove).

**Istruzioni per il subagente**

- Solo cancellazioni e adattamenti minimi dei test.
- Non wireare `refreshCodexAuth` in nessun loader: la decisione è rimuoverla (il provider openai/Codex OAuth online è fuori superficie; un futuro loader la reintrodurrà).
- Verifica finale grep-based prima di terminare.

---

### Step 4 — Dead code core/llm/kilo-indexing/ui: fetch machinery di models-dev, `base()` cloud, literal bedrock, opzione embedder `kilo`, `loadThemeFromUrl`, commento stantio

**Obiettivo**

Rimuovere meccanismi HTTP/flag inutilizzabili in superficie offline e costanti morte nei package di supporto.

**Motivazione**

- `core/src/models-dev.ts`: con snapshot committed + `KILO_DISABLE_MODELS_FETCH=true` forzata, `populate` risolve sempre da disco/snapshot; il fork ambientale `refresh().repeat(spaced 60min)` gira a vuoto, e `fetchApi`/`fetchAndWrite`/`fresh` + i flag `KILO_MODELS_URL`/`KILO_MODELS_PATH`/`KILO_DISABLE_MODELS_FETCH` restano come superficie confusa. Il caller legittimo è `kilo models --refresh` (`cli/cmd/models.ts`), user-gated.
- `provider-usage/cloud.ts:base()` costruisce URL `app.kilo.ai` mai emessi (stub no-op).
- `llm/src/cache-policy.ts:42`: `"bedrock-converse"` nel set `RESPECTS_INLINE_HINTS` è un protocollo inesistente.
- `kilo-indexing/src/config.ts`: opzione embedder `kilo` (due schemi, zod + Effect) non consumata da `service-factory.ts`; `model-registry.ts` la ha a profilo vuoto.
- `ui/src/theme/loader.ts:78-84` `loadThemeFromUrl` (fetch tema da URL) senza caller; re-export in `ui/src/theme/index.ts` e `kilo-ui/src/theme/index.ts`.
- `kilo-indexing/src/indexing/model-registry.ts:5-6` commento "fetched from Cloud" stantio.

**File da leggere**

- `packages/core/src/models-dev.ts` (intero), `packages/core/src/flag/flag.ts` (entry dei 3 flag + consumers), `packages/core/src/kilocode/models-refresh.ts`
- `packages/opencode/src/cli/cmd/models.ts` (caller di `refresh(true)`)
- `packages/core/src/kilocode/provider-usage/cloud.ts`
- `packages/llm/src/cache-policy.ts`
- `packages/kilo-indexing/src/config.ts`, `packages/kilo-indexing/src/indexing/service-factory.ts`, `packages/kilo-indexing/src/indexing/model-registry.ts`, `packages/kilo-indexing/src/indexing/config-manager.ts` (se legge la key `kilo`)
- `packages/ui/src/theme/loader.ts`, `packages/ui/src/theme/index.ts`, `packages/kilo-ui/src/theme/index.ts`
- `packages/opencode/test/plugin/models-dev*.test.ts` e test che settano `KILO_MODELS_*`

**File da modificare**

- `core/src/models-dev.ts`: semplificare `populate` a disco→snapshot→(solo se `!KILO_DISABLE_MODELS_FETCH`) fetch; eliminare il fork ambientale `if (!Flag.KILO_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) yield* Effect.forkScoped(refresh()...)` oppure tenerlo solo come refresh-on-demand: decisione — **rimuovere il fork** (con la flag true forzata dall'estensione non serve; il CLI standalone che vuole il refresh periodico può usare `kilo models --refresh`). Mantenere `refresh(force)` public per il comando.
- `core/src/flag/flag.ts`: rimuovere `KILO_MODELS_URL` e `KILO_MODELS_PATH` se l'unico consumer è `models-dev.ts` (verificare: grep repo-wide prima di tagliare; se `script/generate.ts` o build usano `KILO_MODELS_PATH`, tenere quella flag). `KILO_DISABLE_MODELS_FETCH` resta (l'estensione la imposta allo spawn e il CLI la consulta).
- `provider-usage/cloud.ts`: rimuovere `base()` e l'uso di `managementUrl` in `managed()` (o lasciare `managementUrl` come campo opzionale vuoto — preferire la rimozione dell'URL online dal calcolo, mantenendo la forma dati).
- `llm/src/cache-policy.ts`: `RESPECTS_INLINE_HINTS = new Set(["anthropic-messages"])`.
- `kilo-indexing/src/config.ts`: togliere il blocco `kilo` da entrambi gli schemi; `model-registry.ts`: rimuovere la voce `kilo: ""` e correggere il commento stantio; verificare che `config-manager.ts` non validi/legga la key.
- `ui/src/theme/loader.ts` + i due `index.ts`: rimuovere `loadThemeFromUrl` e i re-export.
- Aggiornare test che referenziano i flag tolti o l'embedder `kilo`.

**Attività**

1. Applicare le riduzioni sopra, una per modulo.
2. Grep repo-wide per i simboli tolti (`KILO_MODELS_URL`, `KILO_MODELS_PATH`, `loadThemeFromUrl`, embedder "kilo") e pulire chiamate residue.
3. `bun turbo typecheck` da root; `bun test` mirati: `packages/core` (se ha suite), `packages/llm` (`bun test` da lì), `packages/kilo-indexing` (se ha test), `packages/opencode` `bun test test/cli/cmd/models* 2>/dev/null` o equivalente per il comando models.

**Output atteso**

Nessuna fetch models.dev automatica a startup; nessun riferimento a host `app.killo/app.kilo.ai` in `provider-usage`; llm cache-policy coerente col barile protocolli; indexing senza opzione `kilo`; theme loader senza fetch.

**Verifiche**

- Typecheck radice verde su tutti i package.
- Test dei package toccati verdi (o failure pre-esistenti documentate verificate via stash A/B).
- Grep: zero hit per i simboli rimossi.

**Compilazione**

- `bun turbo typecheck` da root; risolvere ogni errore introdotto.

**Rischi**

- Tagliare `KILO_MODELS_PATH` potrebbe rompere flussi di build/test che la impostano (es. `script/generate.ts`, test fixtures): verificare i consumers PRIMA di rimuovere, e tenere la flag se usata fuori da `models-dev.ts`.
- L'embedder `kilo` in config: utenti con config storiche che lo dichiarano avrebbero decode error se il campo diventa unknown — verificare il comportamento di strictness dello schema v1 (di solito ignora le key sconosciute; confermare).

**Istruzioni per il subagente**

- Prima modifica, grep ogni simbolo che intendi rimuovere su TUTTO il repo (anche `packages/sdk`, `packages/kilo-vscode/script`, `script/`) per non tagliare un consumer nascosto.
- Se `KILO_MODELS_PATH` risulta usata da tooling di generazione/build, tenerla e documentarlo in un commento.
- Non toccare `provider-usage.ts` (solo `cloud.ts`).

---

### Step 5 — Estensione: rimuovere il controllo "Share mode" orfano (key `share` + i18n 21 locale)

**Obiettivo**

Eliminare dalla tab Experimental un controllo che scrive una key che il backend offline ignora, più la key dal contract e la famiglia i18n.

**Motivazione**

Il feature di session sharing è stato rimosso dal backend (`core/src/v1/config/config.ts:85` commenta "no share/autoshare keys"; lo schema `experimental` non ha `share`). Eppure `ExperimentalTab.tsx:11-58` rende un Select manual/auto/disabled che chiama `updateConfig({ share: next })`: la value viene persistita nel config webview e spedita al backend che la scarta. È il più chiaro buco UI live residuo.

**File da leggere**

- `packages/kilo-vscode/webview-ui/src/components/settings/ExperimentalTab.tsx` (:11-20 SHARE_OPTIONS, :38-58 SettingsRow Share, :23-33 updateConfig/updateExperimental)
- `packages/kilo-vscode/webview-ui/src/types/messages/config.ts` (:147 `share?: "manual"|"auto"|"disabled"`)
- `packages/kilo-vscode/webview-ui/src/components/settings/settings-io.ts` (:28 `"share"` in KNOWN_KEYS)
- `packages/kilo-vscode/webview-ui/src/i18n/*.ts` (21 file: family `settings.experimental.share.title/description/manual/auto/disabled`)
- `packages/kilo-vscode/tests/unit/i18n-unused-keys.test.ts` (protection list)
- `packages/core/src/v1/config/config.ts` (:85 area, per conferma che `share`/`autoshare` non esistono più)

**File da modificare**

- `ExperimentalTab.tsx`: rimuovere interface `ShareOption`, `SHARE_OPTIONS`, il `SettingsRow` Share (righe 38-58) e l'import di `Select` se non usato altrove nel file (è usato anche per imageGenerationModel: tenere).
- `types/messages/config.ts`: rimuovere il campo `share` dal type Config.
- `settings-io.ts`: rimuovere `"share"` da KNOWN_KEYS.
- I 21 file i18n: rimuovere le 5 key `settings.experimental.share.*`.
- `tests/unit/i18n-unused-keys.test.ts`: allineare la protezione (le key non sono più presenti in alcun dictionary).
- Verificare che nessun altro codice legga `config().share` (grep in `webview-ui/src` e `src/`).

**Attività**

1. Rimozioni sopra.
2. Grep `\.share\b` e `"share"` in `packages/kilo-vscode` per catch consumer residui (es. serialization settings-io, stored settings defaults).
3. `bun run typecheck` + `bun run lint` + `bun run test:unit` da `packages/kilo-vscode`.
4. `bun run knip` (l'i18n removal può influenzare la proteção list).

**Output atteso**

La tab Experimental non mostra più Share mode; il contract e i 21 dictionary non contengono più la key; suite unitaria verde.

**Verifiche**

- Grep: zero occorrenze di `settings.experimental.share.` e di `share:` nel contract.
- Unit tests verdi (incluso `i18n-unused-keys.test.ts`).

**Compilazione**

- `bun run compile` da `packages/kilo-vscode` (typecheck + lint + bundle webview). Risolvere errori introdotti.

**Rischi**

- Utenti con setting salvata `share: "auto"`: al load, la key sconosciuta viene ignorata da `settings-io` (comportamento standard per key non in KNOWN_KEYS) — verificare che il merge non faccia throw.
- Stories che mostrano la tab experimental (visual regression): se una baseline cattura il pannello con il controllo share, aggiornare la baseline.

**Istruzioni per il subagente**

- Solo questa rimozione; non toccare altri controlli della tab.
- Se trovi un consumer di `config().share` fuori da quelli noti, fermati e segnalalo invece di rimuovere alla cieca.

---

### Step 6 — Estensione: rimuovere CSS morto (speech button, provider-usage)

**Obiettivo**

Pulire i blocchi CSS senza consumer nel webview.

**Motivazione**

- `prompt-input.css:651-692`: regole `.prompt-speech-button*` + keyframes per lo speech-to-text rimosso/adattato; nessun componente rende quelle classi (solo nomi d'icona `speech-bubble`, che non matchano).
- `styles/provider-usage.css` (intero file, ~82 righe) + `@import "./provider-usage.css"` in `chat.css:29`: sezione provider-usage/balance rimosso; zero classi usate da componenti.

**File da leggere**

- `packages/kilo-vscode/webview-ui/src/styles/prompt-input.css` (:640-700 per il contesto del blocco)
- `packages/kilo-vscode/webview-ui/src/styles/chat.css` (:25-35 per l'import)
- `packages/kilo-vscode/webview-ui/src/styles/provider-usage.css` (intero)
- Grep di verifica: `rg "prompt-speech" webview-ui/src` e `rg "provider-usage" webview-ui/src --glob '*.tsx'` (devono tornare solo i file css)

**File da modificare**

- `prompt-input.css`: eliminare il blocco `.prompt-speech-button` … `@keyframes prompt-speech-recording-pulse` (righe ~651-692).
- `chat.css`: eliminare la riga `@import "./provider-usage.css";`.
- Eliminare il file `styles/provider-usage.css`.

**Attività**

1. Applicare le rimozioni.
2. Grep finale per assicurarsi che nessun altro `@import` o reference a quei file/classi esista.
3. `bun run compile` da `packages/kilo-vscode` (il bundle esbuild risolve gli `@import` CSS: un import rotto faila la build).
4. Verificare che le visual-regression baselines non includano aree style-dipendenti da quei blocchi (sono classi senza consumer: improbabile, ma controllare che la build del bundle produca CSS identico nelle parti rimanenti).

**Output atteso**

Bundle webview buildato senza gli import rimossi; nessuna classe orfana.

**Verifiche**

- `bun run compile` verde da `packages/kilo-vscode`.
- Grep: zero hit per `prompt-speech` e `provider-usage` in `webview-ui/src`.

**Compilazione**

- `bun run compile` da `packages/kilo-vscode`; risolvere errori introdotti (es. import css mancante).

**Rischi**

- Quasi nulli: sono regole senza consumer. Attenzione solo a non tagliare regole adiacenti valide nel CSS.

**Istruzioni per il subagente**

- Solo CSS. Non toccare TSX.
- Dopo la rimozione, ricostruire il bundle per conferma che esbuild risolva gli import.

---

### Step 7 — TUI: rimuovere lo special-case pricing morto in `DialogRetryAction`

**Obiettivo**

Semplificare il dialog di retry togliendo il trattamento "Go treatment"/BGPulse legato a `KILO_PRICING_URL`, mai raggiunto in superficie Kilo.

**Motivazione**

`SessionRetry.retryable()` non emette mai `action` (commento `// kilocode_change - Kilo does not emit OpenCode Go actions`), quindi `props.link` è sempre `undefined` e `showGoTreatment()` (che confronta `link === KILO_PRICING_URL`) è sempre falso. Il costo: costante online `https://kilo.ai/pricing`, import di `BgPulse`, logica di overlay/selected dedicata. Il componente resta per i futuri action link (generico), senza il caso pricing.

**File da leggere**

- `packages/tui/src/component/dialog-retry-action.tsx` (intero)
- `packages/opencode/src/session/retry.ts` (:68-88, per conferma che `action` non viene mai popolato)
- Call site `packages/tui/src/routes/session/index.tsx:461` (come viene passato `evt.properties.status.action`)
- `packages/tui/src/component/bg-pulse.tsx` (verificare se ha altri consumer prima di decidere se tiene — probabilmente sì, usato da altri dialog; non rimuoverlo qui)

**File da modificare**

- `dialog-retry-action.tsx`: rimuovere `KILO_PRICING_URL`, `showGoTreatment`, `textBg`, l'uso di `BgPulse` (box position absolute con zIndex 0), e il ramo ternario `showGoTreatment() ? ... : ...` nel rendering del Link (restare sul semplice `<Link href={props.link}>` centrato). Mantenere `open(props.link)` in `runAction` per i futuri link.
- Se `BgPulse` resta usato altrove non toccarlo; se il subagente scopre che è usato SOLO qui, lasciarlo comunque (fuori scope) e segnalarlo.

**Attività**

1. Semplificazione del componente.
2. `bun turbo typecheck` da root (il TUI compila col turbo).
3. Verificare che nessuna story/test TUI asserisca il BGPulse in quel dialog.

**Output atteso**

DialogRetryAction senza costanti online né special-case; comportamento identico per link assenti (caso attuale).

**Verifiche**

- Typecheck verde.
- Grep: zero hit per `KILO_PRICING_URL`.

**Compilazione**

- `bun turbo typecheck` da root; risolvere errori introdotti.

**Rischi**

- Minimi: è rimozione di ramo morto. Attenzione a mantenere l'accessibilità (focus order dismiss/action invariato).

**Istruzioni per il subagente**

- Solo questo componente. Non toccare `retry.ts`.
- Se `showGoTreatment` fosse usato da altri componenti (verificare con grep `showGoTreatment`), fermati e segnala.

---

### Step 8 — Pulizia cosmetica final: tips commentati, $schema theme, commento model-registry, PRUNE-NOTES/CHANGELOG

**Obiettivo**

Ultima passata di residui cosmetici e aggiornamento della documentazione di chiusura.

**Motivazione**

- `tui/src/feature-plugins/home/tips-view.tsx:279`: tip "Use /connect with OpenCode Zen…" è dentro il blocco commentato (`/* kilocode_change hide the entire list ... */`, righe ~168-289) — verificare lo stato reale del blocco: se l'intera lista è commentata, la riga è inerte e si può rimuovere dalla lista commented per igiene (o lasciare: impatto zero). Decisione: rimuovere la riga dal blocco commentato.
- `tui/src/theme/assets/*.json` (~30 file) e `kilo-ui/src/theme/themes/kilo*.json`: `"$schema": "https://opencode.ai/theme.json"` — annotation JSON inerte, mai fetchata. Lasciare (rimuoverla da 30+ file ha diff enorme e zero beneficio; documentare come accettata).
- `kilo-indexing/src/indexing/model-registry.ts:5-6`: commento "fetched from Cloud" stantio (già previsto nello Step 4; se lo Step 4 non l'ha fatto, farlo qui).
- `packages/opencode/src/kilocode/cli/setup.ts:22`: commento che menziona `@kilocode/kilo-gateway` (package rimosso): aggiornare il commento.
- `PRUNE-NOTES.md`: aggiornare la sezione "Residui volutamente online" aggiungendo la riga WellKnown (`kilo login <url>` fetch di `/.well-known/opencode` + remote config, user-declared host) e aggiornare la matrice per riflettere: (a) il fix network-wait (ora: con probe list vuota non ci sono outbound probes e gli errori di connessione degradano al retry normale — il punto "Network probe" va riscritto), (b) i residui cosmetici documentati come accettati (link openExternal webview, MDC client_uri, installation URLs, $schema theme JSON, doc-link in prompt/help).
- `packages/kilo-vscode/CHANGELOG.md`: appendere l'entry di chiusura (fix offline network-wait, rimozioni dead code CSS/share/codex/balance, pulizia TUI) nello stile delle entry esistenti.

**File da leggere**

- `packages/tui/src/feature-plugins/home/tips-view.tsx` (:160-295 per il blocco commentato)
- `packages/kilo-indexing/src/indexing/model-registry.ts`
- `packages/opencode/src/kilocode/cli/setup.ts` (:15-30)
- `PRUNE-NOTES.md` (sezione matrice, :78-122)
- `packages/kilo-vscode/CHANGELOG.md` (testa, per lo stile)

**File da modificare**

- `tips-view.tsx`: rimuovere la riga 279 dal blocco commentato.
- `setup.ts`: aggiornare il commento gateway.
- `model-registry.ts`: commento (se non fatto nello Step 4).
- `PRUNE-NOTES.md`: aggiornamenti sopra.
- `CHANGELOG.md`: entry.

**Attività**

1. Applicare le micro-rimozioni/comment fixes.
2. Riscrivere il paragrafo "Network probe" della matrice PRUNE-NOTES per riflettere il nuovo comportamento (probe list vuota ⇒ nessun probe outbound; errori di connessione del provider gestiti dal retry normale; i network-wait restano come meccanismo per chi re-introduce probe host, con UI TUI e drain/rifiuto automatico nell'estensione).
3. Aggiungere alla matrice la riga WellKnown e la categoria "Cosmetici accettati" (link openExternal, client_uri MCP, installation URLs, $schema theme, doc links).
4. Entry CHANGELOG.

**Output atteno**

Documento di chiusura coerente col codice; nessun riferimento a package/features rimossi nei commenti attivi.

**Verifiche**

- Grep: zero hit per "OpenCode Zen" in `packages/tui/src` (almeno fuori commenti storici intenzionali), zero hit per `@kilocode/kilo-gateway` in commenti attivi di `setup.ts`.
- Markdown table check: `bun run script/check-md-table-padding.ts` da root (le tabelle PRUNE-NOTES devono restare compatte).
- Typecheck non necessario (solo commenti/doc), ma eseguire `bun turbo typecheck` se si tocca `tips-view.tsx` (è TSX: la riga è in un commento quindi il typecheck non cambia, verificare comunque).

**Compilazione**

- `bun turbo typecheck` da root (sicurezza per il tsx); risolvere errori introdotti (attesi: nessuno).

**Rischi**

- Nulli/ bassissimi: solo commenti e doc.

**Istruzioni per il subagente**

- Non introdurre modifiche comportamentali in questo step.
- Nella matrice PRUNE-NOTES mantiene il formato a liste esistenti (markdown tables non paddate per la regola del repo).
- Se scopri altri commenti attivi che citano package rimossi (oltre setup.ts), eliminali qui (scope: commenti, non codice).

---

### Step 9 — Anti-OOM per `bun test`: parallelismo calibrato su RAM in entrambi i package

**Obiettivo**

Garantire che l'esecuzione delle suite (`bun test` in `packages/kilo-vscode`, `bun run test`/`test-runner.ts` in `packages/opencode`) non esaurisca la memoria della macchina e venga killata dal kernel (OOM), restando al contempo veloce. La strategia è usare `--parallel=N` con `N` derivato dalla RAM disponibile, così ogni file gira in un worker process separato (fresh global → la memoria si ricicla a fine file invece di accumularsi) ma il numero di processi contemporanei resta bounded.

**Motivazione**

- `packages/kilo-vscode` (`package.json:1110`): `"test:unit": "bun test tests/unit/ --dots"` gira oggi in **default seriale single-process**: tutti i 312 file in un unico global Bun. Un solo processo accumula l'intero module graph + i mock del webview (vscode, happy-dom, solid) senza mai rilasciare memoria tra i file → picco di RSS monotono → rischio OOM reale, ed è anche lentissimo. È il punto debole principale.
- `packages/opencode` (`script/test-runner.ts`): già più protetto (concurrency default `min(4, cpus)` = 4, env `KILO_TEST_CONCURRENCY`, per-file timeout 300s + retry, fast-tier che condivide processi sui file isolabili), ma il cap è fisso a 4 indipendentemente dalla RAM: su una macchina piccola (es. 8 GB) 4 worker × ~1–1.5 GB possono comunque avvicinarsi al limite. Serve una guardia RAM-based.
- Doc Bun (https://bun.com/docs/test, /docs/test/parallel): `--parallel[=N]` spartisce i **file** su N worker process (default: n° core) e implica `--isolate` (ogni file in un fresh global, come Jest/Vitest); `--no-isolate` fa valutare gli import una volta per worker (più veloce per molti file piccoli, a costo di possibile leak di stato tra file). I worker partono lazily (il primo subito, gli altri solo quando tutti i attivi sono occupati da qualche ms), quindi una suite di file piccoli può restare su un singolo worker. `--shard=i/n` + `--timings`/`--update-timings` bilanciano per durata su più macchine.

Decisione presa col utente: applicare a **entrambi** i package.

**File da leggere**

- https://bun.com/docs/test e https://bun.com/docs/test/parallel (via WebFetch/MCP: semantica di `--parallel`, `--no-isolate`, `--shard`, `--timings`, worker lazy, `BUN_TEST_WORKER_ID`)
- `packages/kilo-vscode/package.json` (:1108-1116 script test; :1110 `test:unit`)
- `packages/kilo-vscode/bunfig.toml` se esiste (verificare se c'è una sezione `[test]`; altrimenti va creata solo se necessario)
- `packages/opencode/script/test-runner.ts` (:83-94 calcolo concurrency, :704-728 pool worker)
- `packages/opencode/package.json` (:10 `"test"`)
- `tests/unit/` di kilo-vscode (campione di 3-4 file pesanti per capire i mock: vscode mock, happy-dom) — solo per confermare che i file siano isolation-safe

**File da modificare**

- `packages/kilo-vscode/package.json`: sostituire lo script `test:unit`.
- `packages/opencode/script/test-runner.ts`: estendere il calcolo di `concurrency` con un cap RAM-based (non rimuovere `KILO_TEST_CONCURRENCY` né `--concurrency`, che devono continuare a vincere).
- Eventuale `packages/kilo-vscode/bunfig.toml`: solo se serve a documentare/impostare il comportamento di `--parallel` (preferire il flag esplicito nello script per chiarezza; creare il file solo se il subagente decide che una sezione `[test]` è più mantenibile).

**Attività**

1. **kilo-vscode** — nuove varianti dello script (mantenere `test:unit` come alias della variante memory-safe):
   - `"test:unit": "bun test tests/unit/ --parallel=4 --dots"` (valore di默认; su 32 core / 30 GB è conservativo: 4 worker × ~1–1.5 GB ≈ ≤ 6 GB di picco, ben sotto il limite; i worker lazy evitano spawned inutili sui file piccoli).
   - `"test:unit:fast": "bun test tests/unit/ --parallel --no-isolate --dots"` (tutti i core, shared-global per worker: il caso più veloce secondo i benchmark Bun; usarlo solo dopo aver verificato l'assenza di leak di stato tra file — vedi Rischi).
   - Rationale da commentare nel commit: `--parallel` isola ogni file in un fresh global (memoria riciclata a fine file, nessun accumulo monotono → niente OOM) e resta veloce grazie ai worker; `--no-isolate` è l'opzione speed-only.
2. **opencode** — in `test-runner.ts`, dopo il blocco `concurrencyEnv` (:83-94), inserire un cap RAM-based che stringa il default (ma non le override esplicite):
   - Leggere `MemAvailable` da `/proc/meminfo` (Linux; fallback: se non disponibile o valore anomalo, mantenere il comportamento attuale `min(4, cpus)`).
   - Regola proposta (da calibrare sul passo di verifica): `ramCap = max(1, floor(MemAvailable_MB / 2048))` (assume ~2 GB di budget per worker process, margin incluso), poi `effectiveDefault = min(concurrencyDefault, ramCap)`. L'override esplicito `--concurrency` e `KILO_TEST_CONCURRENCY` continuano a bypassare il cap (comportamento esistente, da preservare).
   - Aggiornare il testo `--help` (:32) per documentare il cap RAM-based.
3. Verifica empirica (vedi Verifiche) per fissare il valore di `--parallel` di kilo-vscode e la costante del cap di opencode: partire dai valori sopra e, se il picco misurato è molto sotto il budget, il subagente può alzare `--parallel` di kilo-vscode (es. a 8) purché il picco resti < ~70% di `MemAvailable`.

**Output atteso**

- `bun run test:unit` da `packages/kilo-vscode` corre in parallelo bounded, completa verde (~4093+ test) e il picco di memoria del processo coordinatore + worker resta ampiamente sotto la RAM totale (nessun OOM kill).
- `bun run test` da `packages/opencode` mantiene il comportamento attuale sulle macchine grandi e si auto-stringe su quelle piccole (cap RAM-based); `KILO_TEST_CONCURRENCY`/`--concurrency` ancora rispettate.

**Verifiche**

- Da `packages/kilo-vscode`: `bun run test:unit` completo verde. Misurare il picco: eseguire la suite monitorando la memoria (es. wrap con un comando che campiona `/proc/<pid>/status` VmRSS del coordinator e dei worker, oppure `bun run test:unit & watch -n1 'ps -o rss= -p $(pgrep -f "bun test")'`); il picco aggregato deve restare < ~70% di `MemAvailable`. Se il default 4 è troppo lento e il picco lo consente, alzare a 8 e ri-verificare.
- Testare anche la variante speed: `bun test tests/unit/ --parallel --no-isolate --dots` su un sottoinsiema rappresentativo (es. `bun test tests/unit/agent-manager-*.test.ts --parallel --no-isolate`) per verificare che non emergano failure da leak di stato; se emergono, `test:unit:fast` resta documentata come "solo se isolation-safe" e il default rimane `--parallel=4`.
- Da `packages/opencode`: simulare poca RAM forzando l'env (se il cap legge `MemAvailable`, mockare/iniettare via un env di test es. `KILO_TEST_MEM_AVAILABLE_MB` se il subagente introduce tale knob per testabilità) e verificare che la concurrency effettiva scenda; poi `bun run test` (o uno shard) confermato funzionante.
- `bun turbo typecheck` da root verde (il cambio in `test-runner.ts` è TS).

**Compilazione**

- `bun turbo typecheck` da root (copre `test-runner.ts`). Risolvere eventuali errori introdotti. Le modifiche agli script di `package.json` non richiedono typecheck ma vanno validate eseguendo le suite come in Verifiche.

**Rischi**

- **Leak di stato con `--no-isolate`**: il default scelto è `--parallel` (isolato, sicuro); `--no-isolate` è offerto solo come variante opt-in speed. Se i test dell'estensione dipendono da global state condiviso tra file (raro, ma possibile con mock di `vscode`), `--no-isolate` potrebbe fallire dove il seriale passava: per questo il default resta isolato.
- **Costo di spawn/isolamento**: ogni file ri-valuta gli import in un fresh global; per i 312 file l'overhead è ammortizzato dal parallelismo (benchmark Bun: `--parallel` 6.8 s vs 2.4 s seriale su suite dominate da per-file overhead — qui i file sono più pesanti, quindi il guadagno netto è positivo grazie ai worker).
- **Calibrazione RAM**: la costante `2048 MB/worker` è una stima prudente; il passo di verifica impone di misurare il picco reale e aggiustare. Se la macchina ha poca RAM il cap scende da solo.
- Non toccare la logica di shard/fast-tier/retry di `test-runner.ts`: aggiungere solo il cap RAM-based sul default.

**Istruzioni per il subagente**

- Consulta la doc Bun (WebFetch/MCP) prima di scrivere, per usare i flag con la semantica corretta (`--parallel` vs `--no-isolate`, worker lazy).
- In `test-runner.ts` modifica SOLO il calcolo del default concurrency e il testo help; non alterare `KILO_TEST_CONCURRENCY`, `--concurrency`, deadline, retries, fast-tier, shard.
- Per kilo-vscode, se introduci uno knob per testare il cap (es. env per finte MemAvailable), rendilo opzionale e inerte di default.
- Esegui le suite complete almeno una volta per package per conferma anti-OOM e verde; riporta il picco di memoria misurato.
- Se `--parallel --no-isolate` mostra leak di stato, non forzarlo: lascia `test:unit` su `--parallel=4` e annota la variante fast come sperimentale.

---

### Step 10 — Verifica finale end-to-end e guardie CI

**Obiettivo**

Confermare che l'intero insieme di step (incluso l'anti-OOM dello Step 9) lasci il repo verde su tutte le guardie e che il comportamento offline sia integro.

**Motivazione**

Ogni step ha verificato sé stesso; questo step chiude il cerchio con le guardie complete e lo smoke test offline documentato nei commit precedenti.

**File da leggere**

- Nessuno in particolare; usare i comandi sotto.

**Attività (sequenziali)**

1. Da root: `bun run lint`
2. Da root: `bun turbo typecheck`
3. Da root: `bun run script/check-workflows.ts`, `bun run script/check-md-table-padding.ts`, `bun run script/check-forbidden-strings.ts`, `bun run script/check-kilo-generated-artifacts.ts`
4. Da `packages/opencode/`: `bun run typecheck` + `bun test` (suite completa via test-runner; verificare che i failure residui siano solo i pre-esistenti documentati: 4 test cassette/API-key session.llm + flaky timeout/env — confermare con stash A/B se emergono novità). Confermare che il cap RAM-based dello Step 9 non abbia cambiato l'esito su questa macchina.
5. Da `packages/kilo-vscode/`: `bun run typecheck`, `bun run lint`, `bun run knip`, `bun run check-kilocode-change`, `bun run test:unit` (attesa: tutti verdi, ~4093+ test, ora in `--parallel` bounded; nessun OOM kill).
6. Smoke offline (ripetizione del pattern dei commit precedenti): da `packages/opencode/` `bun dev serve` con un dummy local provider (es. `LMSTUDIO_API_BASE=http://127.0.0.1:9999/v1` + `OPENCODE_API_KEY=dummy`), verificare con `curl` che `GET /provider` esponga solo i provider locali/dichiarati (nessun `kilo`, `openrouter`, `anthropic`, ecc.), che `/kilo/*`, `/telemetry/*`, `/experimental/console` restino 404, e che nessun'uscita verso host pubblici parta (eventualmente con proxy logging). Verificare inoltre che un `ECONNREFUSED` sul provider produca status `retry` (non `offline` stall) — esito dello Step 1.

**Output atteso**

Tutte le guardie verdi; smoke conforme; suite eseguite senza OOM kill e con picco di memoria sotto il budget (esito Step 9).

**Verifiche**

- Comandi 1-6 completati senza failure non pre-esistenti.
- Smoke test con evidenze (output curl) riportate.
- Picco di memoria delle due suite confermato entro budget (nessun OOM).

**Compilazione**

- Implicita nei passi 2/4/5. Se qualcosa non compila, il passo non è superato: tornare allo step che ha introdotto la regression.

**Rischi**

- Failure di test pre-esistenti potrebbero mascherare regressioni: usare stash A/B per discriminare.

**Istruzioni per il subagente**

- Eseguire i comandi nell'ordine dato; non saltare le guardie.
- Se una guardia fallisce per cause pre-esistenti, documentarlo esattamente (quale comando, quale failure, prova A/B) e procedere solo se la failure non è causata dagli step 1-9.
- Non modificare codice in questo step, salvo fix immediati di regressioni introdotte dagli step precedenti (segnalare qual step).

## Criteri di completamento

- Gli step 1-9 sono stati completati e approvati dall'utente uno alla volta.
- Lo Step 10 riporta tutte le guardie verdi (lint, typecheck 20/20, guardie CI, suite opencode con soli failure pre-esistenti, suite estensione completa, knip, check-kilocode-change) e lo smoke offline conforme.
- Le suite `bun test` (entrambi i package) corrono in parallelismo bounded su RAM e completano senza OOM kill, restando rapide; `KILO_TEST_CONCURRENCY`/`--concurrency` restano efficaci sull'runner opencode.
- Nessun nuovo servizio online è stato introdotto; i percorsi online rimasti coincidono con la matrice PRUNE-NOTES aggiornata (tutti user-gated).
- Il buco "offline stall" è chiuso: errori di connessione al provider locale degradano al retry normale; TUI ed estensione offrono azione (Esc/Cancel) in ogni stato residuo.
- Dead code rimosso: `balance-refresh`, `codex-refresh`+error case, `OAUTH_DUMMY_KEY` export, fork/fetch models-dev ambientali, `base()` cloud, literal bedrock, embedder `kilo`, `loadThemeFromUrl`, CSS speech/provider-usage, controllo Share mode + key + i18n, special-case pricing TUI.
- Documentazione aggiornata: PRUNE-NOTES matrice + CHANGELOG.