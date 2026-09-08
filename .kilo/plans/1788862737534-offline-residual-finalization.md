# Piani — Chiusura finale superficie offline (audit post 4e1e1b6)

Audit completato il 2026-09-08 su `leocode` (HEAD `4e1e1b6df7`). Obiettivo: individuare ciò che è sfuggito all'isolamento offline dei commit `3864eff..4e1e1b6`, dove gli unici provider utilizzabili devono essere quelli OpenAI-compatibili locali (llama.cpp, vLLM, Ollama, LM Studio, Atomic Chat) più i custom BYOK dell'utente. Nessun provider online deve comparire né auto-attivarsi.

## Verdetto complessivo

L'implementazione è sostanzialmente corretta e completa:

- **Nessun fetch automatico a boot** nel backend (`kilo serve`) per installazioni di default: catena di guardia verificata — l'estensione forza `KILO_DISABLE_MODELS_FETCH=true` nel child env (`packages/kilo-vscode/src/services/cli-backend/server-manager.ts:50`), lo snapshot `models-dev.local.json` è incorporato in `bin/kilo` via define `KILO_MODELS_DEV` (`packages/opencode/script/build.ts:360`), e `packages/core/src/models-dev.ts:230` short-circuita prima del blocco flock/fetch. Su macchina fresca via estensione non esiste alcun percorso che raggiunga `fetchApi()` verso `https://models.dev`.
- Il catalogo GET /provider è hard-cut alla fonte (`handlers/provider.ts:60`, `inLocalSurface` in `packages/opencode/src/kilocode/local-providers.ts:4-8`); la webview renderizza verbatim senza filtro client-side (`webview-ui/src/context/provider.tsx:52-63`), quindi il cut del backend è il guard effettivo — funziona.
- Credenziali stale di provider fuori-superficie (es. `openrouter`/`anthropic` in `auth.json`): rese invisibili dal cut + purge zero-modelli (`provider.ts:879-881`); nessun leak trovato nel walk completo della handler chain. Nessuna migrazione le cancella comunque (voto P1).
- Plugin auth rimasti: solo `anthropic`, `openai-compatible`, `openai`, `dynamic-provider` (`packages/core/src/plugin/provider.ts:9-14`); nessuno si attiva via env var da solo (richiede entry `env:` in config o credenziale salvata).
- Estensione: zero fetch automatici nella webview; host pulito ad activation; dipendenze gateway/posthog/sentry assenti da `package.json`; embedder limitati a ollama/openai-compatible (`IndexingTab.tsx:30-33`).
- MCP mdns stubbed (nessun socket multicast), probe list vuota con short-circuit retry confermato (`session/network.ts:35`, `processor.ts:145-149`).

Rimangono residui classificabili in due gruppi: **superficie online ancora raggiungibile dall'utente** (P1) e **dead code / orfani cosmetici** (P2). Se si ritiene che il prodotto sia già sufficientemente chiuso, è possibile non scrivere nessun piano; qui si descrivono entrambi i livelli perché la scelta spetti all'utente.

---

## Piano A — Residui funzionali (consigliato)

Superficie online ancora attivabile che un utente offline potrebbe incontrare senza volerla. Ogni step è autonomo, sequenziale, con compilazione obbligatoria al termine (`bun run typecheck` dalla root + `cd packages/kilo-vscode && bun run typecheck && bun run lint && bun run knip && bun run check-kilocode-change`; per step che toccano il CLI anche `cd packages/opencode && bun run typecheck` e i test target citati).

### Step A1 — Rimuovere "kilo recommended" da `kilo providers login`

**Obiettivo**: eliminare la priorità `kilo: 0` e l'hint `kilo: "recommended"` così che il picker di login non presenti mai il gateway come opzione consigliata.

**Motivazione**: confermato in `packages/opencode/src/cli/cmd/providers.ts:387-397` (priority map) e `:421-425` (hint). Oggi sono morti fintantoché non esiste credenziale/config `kilo`, ma riattivarono automaticamente per chi ha credenziali legacy → UX ingannevole su un prodotto offline. I blocchi sono già marcati `kilocode_change start/end`, quindi la modifica è isolata.

**File da leggere**: `packages/opencode/src/cli/cmd/providers.ts` (sezioni 360-430), `packages/opencode/src/kilocode/local-providers.ts`.
**File da modificare**: solo `packages/opencode/src/cli/cmd/providers.ts`.
**Attività**:
- Ridurre la priority map a sole voci coerenti con la superficie locale: mantenere ordinamento sensato per `lmstudio`, `atomic-chat`, `privatemode-ai`, `anaconda-desktop` (es. anaconda-desktop primo se presente, poi lmstudio, atomic-chat, privatemode-ai) e lasciare `?? 99` per i custom BYOK; rimuovere `kilo`, `github-copilot`, `google`, `openrouter`, `vercel`.
- Nelle hint: rimuovere `kilo: "recommended"`; per `openai` valutare se l'hint "ChatGPT login or API key" resta opportuno (vedi Step A2) — in questo step limitarsi a rimuovere la riga `kilo`.
- Aggiornare i commenti `kilocode_change` per documentare il nuovo contratto.
**Output atteso**: `kilo providers login` su install locale elenca solo provider locali/custom, nessun "recommended".
**Verifiche**: `cd packages/opencode && bun run typecheck`; test target se esistenti per il comando providers (ricerca `providers.test.ts` in `packages/opencode/test/`); smoke manuale: `bun dev serve` dal package opencode con dummy credenziale kilo in auth.json → `GET /provider` e output del comando mostrano kilo assente o almeno non-etichettato recommended.
**Compilazione**: typecheck opencode + root verdi; risolvere ogni errore introdotto.
**Rischi**: basso — codice marcato, nessuna logica a valle dipende dai valori numerici oltre all'ordinamento.

### Step A2 — Neutralizzare il flusso OAuth ChatGPT (auth.openai.com)

**Obiettivo**: impedire che l'UI dell'estensione offra "Sign in with ChatGPT" verso `https://auth.openai.com` quando l'utente usa `@ai-sdk/openai` con baseURL custom (llama.cpp/vLLM), e ridurre la superficie OAuth del plugin openai.

**Motivazione**: confermato che `packages/core/src/plugin/provider/openai.ts` registra incondizionatamente i metodi `chatgpt-browser` (:40) e `chatgpt-headless` (:105) con issuer hardcodato `https://auth.openai.com` (:15), senza alcun controllo sulla baseURL configurata; l'UI dell'estensione espone il pulsante (i18n `settings.providers.action.signInChatGPT` in `webview-ui/src/i18n/en.ts:335`, reso in `ErrorDisplay.tsx:94` e `MessageList.tsx:320-323`, dispatch in `src/provider-actions.ts:307-334`). Per un utente con provider openai-compatible su localhost, il pulsante aprirebbe un flow verso internet.

**Scelte progettuali da fissare in questo step** (una delle due, raccomandata la prima):
1. **(Raccomandato)** Nel plugin `openai.ts`: esporre i metodi OAuth solo quando il provider non dichiara una `baseURL` non-loopback/non-custom (i.e. solo per il provider `openai` "vero" senza override baseURL). Implementare un piccolo guard nell'hook che registra i metodi, leggendo `evt.options.baseURL`: se definita e diversa dall'endpoint OpenAI canonico, saltare la registrazione dei due методи OAuth. Il device-flow headless va mantenuto? No — stesso criterio.
2. Alternativa minima: rimuovere solo la UI ("Sign in with ChatGPT") dalla webview tenendo i metodi CLI-raggiungibili. Meno rischioso ma lascia il buco aperto da TUI/CLI.

**File da leggere**: `packages/core/src/plugin/provider/openai.ts` (intero), `packages/kilo-vscode/src/provider-actions.ts:307-334`, `packages/kilo-vscode/webview-ui/src/components/chat/ErrorDisplay.tsx`, `MessageList.tsx:320`, `ProvidersTab.tsx:77`, i18n `en.ts` + le altre 20 locale per le chiavi `settings.providers.action.signInChatGPT` e `error.providerAuth.chatgpt.*`.
**File da modificare**: `packages/core/src/plugin/provider/openai.ts` (guard) +, solo per l'opzione 2, i file webview/i18n sopra.
**Attività**: implementare il guard; se opzione 2, rimuovere pulsanti e chiavi i18n orfane aggiornando la protezione unused-keys (`packages/kilo-vscode/tests/unit/i18n-unused-keys.test.ts`). Marcare `kilocode_change` nelle zone modificate di file condivisi (core).
**Output atteso**: con baseURL custom, nessun metodo OAuth openai registrato; il pulsante ChatGPT non appare (opzione 1: scompare perché `oauth()` è vuoto; opzione 2: rimosso).
**Verifiche**: typecheck core+opencode+kilo-vscode; `cd packages/kilo-vscode && bun run test:unit` (suite completa, ~16s bounded-parallel); test unitari del plugin se presenti in `packages/core/test/` (ricerca `openai`); verifica manuale: provider openai-compatible con baseURL localhost → GET /provider + attempt authorize → nessun reference a auth.openai.com.
**Compilazione**: verde su tutti i tre package; risolvere errori introdotti.
**Rischi**: medio — il guard tocca un file condiviso (core) usato anche dal CLI/TUI; assicurarsi che il TUI `dialog-provider` non rompa il rendering per l'id `openai`. Test obbligatori.

### Step A3 — Sanificare le variabili d'ambiente dei provider online ereditate

**Obiettivo**: estendere `resolveManagedServerEnv` per strip-pare anche le classiche API-key dei provider online, eliminando il caso limite in cui una `config.provider.<id>.env` di un'installazione legacy si auto-alimenta da env shell ereditate.

**Motivazione**: oggi vengono strip-pati solo prefissi `OTEL_`/`BUN_`, `NODE_OPTIONS` e le proxy keys (`server-manager.ts:32-52`); tutte le `*_API_KEY` passano al child. Nessuna si attiva da sola (verificato: nessun plugin legge direttamente le env), ma per un utente che migrava da una setup online con `ANTHROPIC_API_KEY` nel profilo shell e vecchie entry `provider.anthropic.env: ["ANTHROPIC_API_KEY"]` in config, il provider tornerebbe vivo. Costo quasi nullo, chiude il buco.

**File da leggere**: `packages/kilo-vscode/src/services/cli-backend/server-manager.ts:32-52`, `packages/kilo-vscode/tests/unit/server-manager-utils.test.ts` (test esistente da estendere).
**File da modificare**: `server-manager.ts` (+ test).
**Attività**: aggiungere alla lista di strip un set esplicito di nomi esatti: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `TOGETHER_API_KEY`, `PERPLEXITY_API_KEY`, `CLOUDFLARE_API_KEY`, `COHERE_API_KEY`, `DEEPSEEK_API_KEY`, `ZAI_API_KEY`, `HUGGINGFACE_API_KEY`, `MINIMAX_API_KEY`, `GITHUB_TOKEN`, `COPILOT_GITHUB_DEVICE_ID`, più i prefissi `AWS_` e `VERTEX_` (attenzione: `VERTEX_CREDENTIALS` ecc.). Nota di progetto: chi usa davvero quelle chiavi con un provider BYOK le dichiarerà in `config.provider.<id>.env` e dovrà invece passare la chiave via quel meccanismo — documentare nel commento.
**Output atteso**: il child `kilo serve` non riceve più quelle variabili; test aggiornato.
**Verifiche**: `cd packages/kilo-vscode && bun run typecheck && bun run test:unit`; in particolare `tests/unit/server-manager-utils.test.ts` verde.
**Compilazione**: verde; risolvere errori introdotti.
**Rischi**: basso-medio — possibili falsi positivi per utenti che usano `OPENAI_API_KEY` come chiave di un endpoint openai-compatible: mitiga il fatto che la chiave va comunque dichiarata in `env` della config; documentare chiaramente nel messaggio/changelog.

### Step A4 — Rimuovere i dipendende orfani dei provider eliminati

**Obiettivo**: depurare i package.json dai pacchetti dichiarati mai importati dopo la rimozione di bedrock/cloudflare/openrouter.

**Motivazione** (tutto confermato da grep cross-package):
- `packages/opencode/package.json`: `@openauthjs/openauth` (orphaned, nessun import in `src/`).
- `packages/llm/package.json`: `aws4fetch`, `@smithy/eventstream-codec`, `@smithy/util-utf8` (zero import in `packages/llm/src`, `packages/core/src`, `packages/opencode/src` — residue dei protocolli bedrock eliminati in `6f749c2`).
- `packages/opencode/src/kilocode/provider-options.ts:4`: import type-only da `@openrouter/ai-sdk-provider` usato solo per un cast strutturale (`:8`, poi campi `reasoning`/`verbosity` propagati ai rami openai/anthropic/openaiCompatible, `:11-27`).

**File da leggere**: i tre `package.json`, `packages/opencode/src/kilocode/provider-options.ts` (intero, è corto).
**File da modificare**: `packages/opencode/package.json`, `packages/llm/package.json`, `packages/opencode/src/kilocode/provider-options.ts`, `bun.lock` (rigenerato da `bun install`), e se knip segnala export orfani conseguenti rimuoverli.
**Attività**:
- In `provider-options.ts`: sostituire il cast `as OpenRouterProviderOptions & {...}` con un tipo strutturale inline (es. `{ reasoning?: unknown; verbosity?: ... }` dedotto dagli usi nei rami) e rimuovere l'import; verificare che i campi usati nei rami restino tipati.
- Rimuovere i quattro dipendende dai due package.json; `bun install` dalla root per rigenerare il lockfile.
- Eseguire knip in `packages/kilo-vscode` (già attivo sulle dependencies) e pulire eventuali orfani residui segnalati.
**Output attesto**: build completa senza quei pacchetti; lockfile coerente.
**Verifiche**: `bun install --frozen-lockfile` dopo commit del lock; `bun run typecheck` root (20/20); `bun run lint` root; `cd packages/kilo-vscode && bun run knip && bun run check-kilocode-change && bun run compile`; `cd packages/opencode && bun run typecheck`.
**Compilazione**: tutto verde; risolvere errori introdotti.
**Rischi**: basso — i tipi coinvolti sono opzionali e puramente dichiarativi; knip può richiedere ignora mirati già previsti dal pattern esistente.

### Step A5 — Pulizia dead-code del gateway rimosso

**Obiettivo**: eliminare i moduli che servivano esclusivamente ai servizi online rimossi.

**Motivazione** (importatori verificati repo-wide):
- `packages/opencode/src/kilocode/event-service/client.ts`: `EventServiceClient` (WS ticket + ping `setInterval:343`) — unico importer è il suo test `packages/opencode/test/kilocode/event-service/client.test.ts`; il servizio eventi del gateway non esiste più. Eliminare modulo + test + la riga in `script/kilocode/test-durations.json` (`:110`).
- `packages/opencode/src/control-plane/dev/debug-workspace-plugin.ts`: adapter dev-only che fa polling `http://127.0.0.1:<port>/global/health`; riferito solo da docs/scripts di sviluppo (commentato in `script/run-workspace-server`). Valutare con attenzione: se il flusso dev workspace-sync lo richiede tenerlo (è loopback, non online); se no, eliminarlo. Decisione da prendere durante lo step leggendo `control-plane/dev/README.md`.
- `packages/opencode/src/kilocode/session/processor.ts:107`: hook telemetry no-op + tipo `ReviewTelemetry` associato — rimuovere il no-op e il tipo se non importati altrove.
- `packages/opencode/src/kilocode/indexing.ts:81-84`: `trackTelemetry` no-op — rimuovere insieme alla variante `"telemetry"` del protocollo worker in `indexing-worker-protocol.ts:41` (verificare prima i consumer del protocollo nel worker).
- `packages/opencode/src/cli/cmd/github.handler.ts:391,484-488,547,565,1325`: `shareBaseUrl`/`shareId` sempre `undefined` dopo la rimozione del session-sharing — rimuovere il blocco vestigiale (tenere il resto del handler github, che è gated da azione esplicita).

**File da leggere**: i file sopra + `packages/opencode/test/kilocode/event-service/` + `script/kilocode/test-durations.json` + `packages/opencode/src/kilocode/indexing-worker-protocol.ts`.
**File da modificare**: quelli risultati morti (decide lo step dopo verifica degli importatori con grep repo-wide, incluso `packages/tui` e `packages/core`).
**Attività**: per ciascun candidato: grep repo-wide degli importatori → se zero (fuori test del modulo stesso) eliminare file/test/riferenze (duration table, barrel exports, registrazioni di service node); se qualcuno è vivo, annotarlo e lasciarlo. Aggiornare `PRUNE-NOTES.md` (sezione "Dead code that remains in the workspace") e l'entry CHANGELOG di `packages/kilo-vscode/CHANGELOG.md`.
**Output atteso**: meno moduli morti; doc allineate.
**Verifiche**: `bun run typecheck` root; `cd packages/opencode && bun run typecheck && bun test ./test/kilocode/...` per le aree toccate (i test eliminati non vanno più eseguiti); `cd packages/kilo-vscode && bun run test:unit`.
**Compilazione**: tutto verde; risolvere errori introdotti.
**Rischi**: medio — `debug-workspace-plugin` e il protocollo indexing-worker hanno消费者 dev/test nascosti; la regola è: elimina solo se il grep dimostra zero importatori, altrimenti lascia e documenta.

---

## Piano B — Residui cosmetici (facoltativo, batch singolo)

Solo se si vuole chiudere anche la polvere non-funzionale. Un unico step, in coda a Piano A.

1. **i18n orfani**: rimuovere dalle 21 locale le chiavi `settings.providers.action.signInChatGPT` e `error.providerAuth.chatgpt.*` (se lo step A2 sceglie l'opzione 1 e i metodi restano, valutare invece di tenerle; decidere in A2), più eventuali chiavi `profile`/marketplace ormai senza componente (verifica con `tests/unit/i18n-unused-keys.test.ts` aggiornando la protection list).
2. **Tipi TS residuali**: `"openrouter"` nelle union di `packages/kilo-vscode/src/shared/provider-model.ts:12` e `webview-ui/src/types/messages/config.ts:86,103` — rimuovere dall'unione (verificare prima i consumer).
3. **Test fixture stale**: `packages/opencode/test/kilocode/session-title-generation.test.ts:16` (fixture modello `npm: "@kilocode/kilo-gateway"` → puntare a un modello locale dello snapshot), `test/kilocode/server/httpapi-exercise-scenarios.ts:442` (probe `/kilo/cloud-sessions` → attendersi 404 anziché 401 se la route è sparita, da confermare), snapshot `websearch` in `test/tool/__snapshots__/parameters.test.ts.snap:469` (da rigenerare se il tool è assente).
4. **Stringhe cosmetiche**: `client_uri: "https://kilo.ai"` in `packages/opencode/src/mcp/oauth-provider.ts:47` (stringa dichiarativa inviata all'AS dell'utente: accettabile, eventualmente commentare), URL install in `kilocode/installation/*` (usati solo da `kilo upgrade` manuale: tenere, già documentati in PRUNE-NOTES).
5. **Aggiornare** la matrice di `PRUNE-NOTES.md` con quanto cambia (es. strip API-key, ChatGPT-OAuth gate) e appendere l'entry CHANGELOG.

**Verifiche**: suite completa extension + typecheck root + guards (`knip`, `check-kilocode-change`, `check-forbidden-strings`, `check-md-table-padding`, `check-workflows`).

---

## Criteri di completamento

- Tutti gli step scelti completati e approvati dall'utente uno alla volta.
- Ogni step termina con codebase compilabile (typecheck root + package toccati) e suite unitaria dell'estensione verde.
- Smoke finale: `kilo serve` con provider locale dummy e credenziali legacy (kilo/anthropic/openrouter) in auth.json → GET /provider espone solo superficie locale/declared; nessun "recommended" kilo; nessun riferimento a auth.openai.com con baseURL custom; zero connessioni outbound verso host pubblici in assenza di user-action.
- Nessuna funzionalità extra introdotta; refactoring limitato agli step descritti.

## Domande aperte per l'utente

1. **A2**: si preferisce il guard nel plugin (opzione 1, rimuove il pulsante in automatico quando c'è una baseURL custom) oppure la rimozione pura della UI (opzione 2)? Raccomandata: opzione 1.
2. **A3**: accettabile strip-pare `OPENAI_API_KEY` dal child env (chiave che molti usano anche per endpoint compatibili, ma in quel caso va dichiarata in `config.provider.<id>.env`)? Raccomandato: sì, con documentazione.
3. **Piano B**: si esegue o si lascia come follow-up separato?