# Piano — Chiusura residui offline + hardening runner di test (anti-OOM e budget 5 min)

## Obiettivo

Completare l'isolamento offline dell'estensione VS Code: rimuovere gli ultimi residui online
sfuggiti ai commit di Le0xFF (`1673a9fbf1`…`38a3301708`) e rendere il runner di unit test
robusto contro OOM kernel-driven e vincolato a una durata massima di 5 minuti, usando la
documentazione ufficiale di `bun test` (https://bun.com/docs/test, https://bun.com/docs/test/parallel).

L'audit ha confermato che la superficie online principale è chiusa: `GET /provider` è
hard-cut alla locale surface (`inLocalSurface` in `packages/opencode/src/kilocode/local-providers.ts`),
il child `kilo serve` riceve un env sanificato (`resolveManagedServerEnv`, 16 API-key + prefissi
`AWS_`/`VERTEX_` + `OTEL_*`), models.dev è doppiamente gated (`KILO_DISABLE_MODELS_FETCH=true`
forzato dall'estensione + snapshot embedded `KILO_MODELS_DEV`), network probe azzerato, mDNS stub,
niente PostHog/Sentry/auto-update/LSP/sharing/FIM. Restano i soli leak elencaati di seguito.

## Analisi

**Stato attuale**: fork `leocode` ridotto a estensione + dipendenze transitive; estensione fully
functional offline su provider OpenAI-compatibili locali (lmstudio, atomic-chat, privatemode-ai,
anaconda-desktop, custom BYOK via `config.provider`). I residui trovati sono tutti a basso rischio
di traffico automatico: dead code, stringhe UI, default inconsistenti, mappe TUI non tagliate.

**Componenti coinvolti**:
- `packages/opencode/src/kilocode/cli/cmd/tui/component/dialog-provider.tsx` (mappe TUI vive)
- `packages/opencode/src/cli/cmd/providers.ts` (blocchi login vestigiali)
- `packages/opencode/src/provider/error.ts` (messaggio Codex/ChatGPT)
- `packages/tui/src/parsers-config.ts` (URL `.scm` tree-sitter)
- `packages/kilo-indexing/src/config.ts` (default embedder hosted)
- `packages/core/src/v1/config/config.ts` + i18n (placeholder "Auto Router")
- `packages/opencode/src/kilocode/{indexing-auth.ts,components/dialog-indexing.tsx}` (dead kilo auth)
- `packages/kilo-vscode/webview-ui/.../MigrationWizard.tsx` (link `<a>` nativi)
- `packages/kilo-vscode/script/run-unit-tests.ts` (+ workflow CI, docs)

**Vincoli architetturali**:
- File sotto path contenente `kilocode` non richiedono marker `kilocode_change`; file upstream
  condivisi (`tui/src/**`, `core/src/**`, `opencode/src/provider/**`, `cli/cmd/providers.ts`) sì.
- Il runner custom usa N processi `bun test <file>` separati (NON `--parallel` nativo): va
  mantenuto perché isola gli OOM per-file, mentre `--parallel` aborte l'intera run su fatal signal
  (docs bun: "A crash from a fatal signal aborts the whole run").
- Bun ignora `NODE_OPTIONS=--max-old-space-size` (JSC, non V8): il guardrail anti-OOM deve essere
  process-based (cap concurrency + watchdog), non heap-based.
- Ogni step termina con compilazione verde (`bun turbo typecheck` dalla root; per package
  `bun run typecheck`/`lint` dove esistono).

## Assunzioni

- A1: il dialog provider del TUI è vivo (verificato: `packages/tui/src/component/dialog-provider.tsx`
  importa le mappe dal mirror kilocode e le usa in `providerOptions()`); quindi le voci
  `github-copilot`/`google` e i titoli/descrizioni online mostrati sono bug visibili.
- A2: l'exit code di un OOM kill sotto `Bun.spawn` è 137 o `signal === "SIGKILL"` (convenzione
  POSIX 128+9). Da confermare empiricamente al primo passo di hardening con un micro-test a memoria
  forzata (vedi Step 6, verifica V4).
- A3: il flusso `bun run extension` (dev) definisce lo snapshot `KILO_MODELS_DEV` tramite
  `script/generate.ts`/`local-bin.ts`; se non fosse true, `KILO_DISABLE_MODELS_FETCH=true` resta
  il gate difensivo (già impostato dall'estensione).
- A4: i provider "ibridi" openai/anthropic restano configurabili come endpoint openai-compatible
  con `baseURL` custom (BYOK); non vanno rimossi, solo puliti dai riferimenti ChatGPT/Codex.
- A5: il budget globale di 5 minuti si applica alla suite unit dell'estensione sia localmente
  (default) sia in CI (env `KILO_TEST_GLOBAL_TIMEOUT=300000`). I file non ancora partiti alla
  scadenza falliscono come budget-exceeded (exit != 0) così il problema resta visibile.
- A6: per la macchina strettamente offline i download on-demand (ripgrep, LanceDB, plugin npm,
  @ai-sdk non bundled) restano accettati come cold-cache-on-demand (matrice PRUNE-NOTES); questo
  piano li documenta ma non li elimina.

## Piano di implementazione

### Step 1 — Pulizia dead code CLI providers + messaggio errore

**Obiettivo**: rimuovere i residui online vestigiali nel comando `providers login` e nel mapping
degli errori provider.

**Motivazione**: i blocchi `amazon-bedrock`/`vercel`/`cloudflare` e l'alias `codex` puntano a
flow OAuth/provider fuori-superficie già rimossi; il messaggio `usage_not_included` cita Codex/
ChatGPT. Sono zero traffico di rete ma confondono l'utente e sporcano la superficie dichiarata.

**File da leggere**:
- `packages/opencode/src/cli/cmd/providers.ts` (righe ~430-500: alias codex, blocchi bedrock/vercel/cloudflare)
- `packages/opencode/src/provider/error.ts` (righe ~140-160: blocco `usage_not_included`)
- `PRUNE-NOTES.md` (sezione matrice residui, per coerenza della documentazione)

**File da modificare**:
- `packages/opencode/src/cli/cmd/providers.ts`
- `packages/opencode/src/provider/error.ts`
- `PRUNE-NOTES.md` (aggiungere i residui rimossi alla sezione "Done"/chiusura audit)

**Attività**:
1. In `providers.ts`: eliminare la variabile `alias` e il `?? alias` nel match (righe ~438-441);
   eliminare i tre blocchi `if (provider === "amazon-bedrock")`, `if (provider === "vercel")`,
   `if (["cloudflare","cloudflare-ai-gateway"].includes(provider))` (~righe 481-499). Verificare
   che nessun altro ramo del switch dipenda dalle costanti usate nei blocchi eliminati.
2. In `error.ts`: riformulare il message di `usage_not_included` senza "Codex"/"ChatGPT plan" né
   URL `chatgpt.com/explore/plus` (es. `"Usage not included in your plan. Check your provider's
   billing page."`), mantenendo l'id dell'errore e il resto del mapping invariato.
3. Aggiornare `PRUNE-NOTES.md`: spostare questi residui dalla lista dei residui (se presente) alla
   sezione di chiusura, citando lo step.

**Dipendenze**: nessuna.

**Output atteso**: `kilo providers login` non offre più alias/blocchi per provider fuori
superficie; il messaggio d'errore non cita più prodotti cloud; PRUNE-NOTES coerente.

**Verifiche**:
- grep in `packages/opencode/src` per `codex` (case-insensitive), `amazon-bedrock`, `vercel.link`,
  `cloudflare-ai-gateway`, `chatgpt.com`: nessun match rimanente nei file modificati.
- Se esiste un test che asserisce i vecchi messaggi (es. in `packages/opencode/test/**`), aggiornarlo
  allineandolo al nuovo copy; non creare nuovi test.

**Compilazione**:
- Dalla root: `bun run typecheck` (turbo). Risolvere ogni errore introdotto.
- Da `packages/opencode/`: `bun run typecheck`.

**Rischi**: il blocco vercel/cloudflare potrebbe contenere anche hint utili per chi configura
manualmente quei gateway via `config.provider` (BYOK avanzato). Decisione: rimuoverli comunque
(fuori superficie dichiarata); chi li vuole li dichiara in config e legge la doc.

**Istruzioni per il subagente**: implementa solo questo step; non toccare le mappe del TUI
(step 2); mantieni i marker `kilocode_change` esistenti nelle zone modificate; compila prima di
terminare; usa webfetch/MCP in caso di dubbio su API interne invece di supporre.

---

### Step 2 — Taglio delle mappe del dialog provider TUI alla superficie locale

**Obiettivo**: allineare `PROVIDER_PRIORITY`/`PROVIDER_DESCRIPTIONS`/`PROVIDER_TITLES` del mirror
Kilo alla superficie locale, eliminando le etichette di provider online nel dialog "Connect a
provider" del TUI.

**Motivazione**: il dialog TUI è vivo (`packages/tui/src/component/dialog-provider.tsx` consuma le
mappe); oggi mostra nella categoria "Popular" `github-copilot` e `google`, descrive `anthropic`
come "(Claude Max or API key)" e intitola `openai` come "OpenAI / Codex". Con l'hard-cut del
catalogo quei provider non appaiono neppure nel picker, ma le mappe restano incoerenti e riemergono
per i provider ibridi (openai/anthropic) configurati via `config.provider`.

**File da leggere**:
- `packages/opencode/src/kilocode/cli/cmd/tui/component/dialog-provider.tsx` (righe 42-101)
- `packages/tui/src/component/dialog-provider.tsx` (uso delle mappe: righe 15, 21, 46-58, 128-136, 364-373)
- `packages/opencode/src/kilocode/local-providers.ts` (fonte della superficie locale)

**File da modificare**:
- `packages/opencode/src/kilocode/cli/cmd/tui/component/dialog-provider.tsx`

**Attività**:
1. Riscrivere `PROVIDER_PRIORITY` con solo i provider locali:
   `{ lmstudio: 0, "atomic-chat": 1, "privatemode-ai": 2, "anaconda-desktop": 3, openai: 4, anthropic: 5 }`
   (rimuovere `github-copilot`, `google`; tenere openai/anthropic in coda come ibridi BYOK).
2. Correggere `PROVIDER_DESCRIPTIONS`: `anthropic` → `"(API key)"` (drop "Claude Max"),
   `openai` resta `"(API key)"`, aggiungere `"atomic-chat": "(Local models)"` se assente,
   `lmstudio`/`privatemode-ai` → `"(Local models)"`.
3. Rimuovere da `PROVIDER_TITLES` la voce `openai: "OpenAI / Codex"` (o rinominare in `"OpenAI"`).
4. Verificare che `LOCAL_OPTIONAL_API_KEY` continui a coprire `atomic-chat`/`lmstudio` (già così).

**Dipendenze**: Step 1 (stesso dominio, ordine consigliato ma indipendente).

**Output atteso**: il dialog TUI elenca solo provider locali/ibridi con etichette corrette;
nessuna menzione Copilot/Google/Codex/Claude-Max.

**Verifiche**:
- grep nel file mirror per `github-copilot|google|Codex|Claude Max`: zero match.
- Se esistono test/snapshot sul dialog provider (cerca `dialog-provider` in `packages/opencode/test/`
  e `packages/tui/`), aggiornarli.
- Smoke manuale opzionale (fuori dal gate di compilazione): avviare il TUI e aprire il dialog
  provider per verificare visivamente la lista.

**Compilazione**:
- Dalla root: `bun run typecheck`. Da `packages/opencode/`: `bun run typecheck`.
- Nota: il file è sotto path `kilocode/` → nessun marker necessario.

**Rischi**: se un utente aveva `github-copilot` in `config.provider` (BYOK), il provider resta
visibile nella categoria "Providers" con priority 99 — comportamento accettabile e coerente.

**Istruzioni per il subagente**: modifica solo le tre mappe e i set correlati nel mirror; non
rifattorizzare `renderGutter`/`selectProvider`; compila; in caso di dubbio sul consumo delle mappe
da parte del TUI, rileggi `packages/tui/src/component/dialog-provider.tsx` (non modificarlo).

---

### Step 3 — Gate offline degli URL query tree-sitter nel TUI

**Obiettivo**: assicurare che i `queries` (URL `.scm` su GitHub raw) di `parsers-config.ts` non
generino fetch automatici quando il TUI gira offline.

**Motivazione**: i wasm sono già gated (`KILO_TREE_SITTER_WASM_DIR` + opt-in
`KILO_TREE_SITTER_DOWNLOAD`), ma le liste `queries` passano URL assoluti a OpenTUI in modo
condizionato; se il loader di OpenTUI risolve gli URL in rete, il TUI farebbe ~30 richieste a
`raw.githubusercontent.com` al launch — un leak non coperto dalla matrice PRUNE-NOTES.

**File da leggere**:
- `packages/tui/src/parsers-config.ts` (righe 163-341: `resolveWasm`, `queries`, export)
- La fonte di `@opentui/core`/`@opentui/solid` in `node_modules` per capire come vengono risolti
  i `queries` (stringa URL vs path locale; cercare i tipi `ParserConfig`/`TreeSitter` e il loader).
  Usare webfetch sulla docs di OpenTUI o leggere il d.ts in `node_modules/@opentui/` se il
  comportamento non è deducibile.

**File da modificare**:
- `packages/tui/src/parsers-config.ts`

**Attività**:
1. Determinare definitivamente (lettura del tipo/loader di OpenTUI) se una stringa `http(s)://`
   in `queries` viene fetchata dal processo del TUI.
2. Caso A (OpenTUI fetcha gli URL): introdurre nello stesso file la stessa logica di `resolveWasm`
   per i query (helper `resolveQuery`): se `downloadEnabled` è falso, sostituire ogni URL con
   path locale cercati in `wasmDir` (convenzione `<lang>/queries/highlights.scm` concordata col
   vendoring esistente) oppure, se il file locale non c'è, usare un sentinella no-op documentato
   (es. path vuoto/`undefined` se il tipo lo consente) così il parser degrada silenziosamente come
   già fa per i wasm mancanti. Mantenere gli URL originali solo con `KILO_TREE_SITTER_DOWNLOAD=1`.
3. Caso B (OpenTUI richiede path locali e ignora/errore sugli URL): garantire che in modalità
   offline gli URL vengano mappings a path locali esistenti o omessi, evitando errori di init.
4. Aggiornare il commento `kilocode_change start/end` esistente (righe 168-172) per coprire anche
   le queries.

**Dipendenze**: nessuna (indipendente dagli altri step).

**Output atteso**: con `KILO_TREE_SITTER_DOWNLOAD` unset, il TUI non effettua fetch verso GitHub
raw per parser né per highlight queries; il comportamento offline resta "highlighting disabilitato
per i linguaggi senza wasm/query locali", coerente con il commentario esistente.

**Verifiche**:
- grep in `packages/tui/src` per `raw.githubusercontent.com`: presente solo nei dati sorgenti
  (fallback), non nei valori passati al runtime in modalità offline.
- Micro-verifica runtime opzionale: avviare `kilo tui` con `strace -e trace=network` (o proxy
  man-in-the-middle) e confermare assenza di connessioni a `raw.githubusercontent.com`.
- `bun run typecheck` in `packages/tui/` (se esiste script) e dalla root.

**Compilazione**:
- Dalla root: `bun run typecheck`. Risolvere eventuali errori di tipo introdotti dal cambio
  shape delle query.

**Rischi**: se il vendoring attuale NON include i file `.scm` (solo i `.wasm`), il fallback locale
  troverà poca roba: in quel caso la scelta progettuale è degradare silenziosamente (opzione
  preferita, minima) e documentare in PRUNE-NOTES che i query vendored sono TODO di packaging
  (out of scope qui). Non scaricare nulla a build time in questo step.

**Istruzioni per il subagente**: prima di scrivere codice, stabilire il caso A/B leggendo il
loader di OpenTUI (node_modules) o la sua documentazione (webfetch ammesso); non inventare
comportamenti; mantenere il diff minimale; compila; aggiorna il commento kilocode_change.

---

### Step 4 — Coerenza embedding/image: default locale, placeholder e dead code

**Obiettivo**: allineare la superficie indexing/embedding e image generation alla sola surface
locale (remozione dei residui "openrouter/auto", "Default (Auto Router)", default embedder hosted,
auth "kilo" morto).

**Motivazione**: quattro residui indipendenti ma affini (trovati nell'audit): il default
`"openai"` in `kilo-indexing/src/config.ts:235`; la description schema `(default: openrouter/auto)`
in `core/src/v1/config/config.ts:287-289`; il placeholder i18n `"Default (Auto Router)"` in tutte
le 21 locale; il modulo `indexing-auth.ts` che risolve ancora `KILO_API_KEY`/`KILO_ORG_ID` per un
provider "kilo" inesistente (usato da `dialog-indexing.tsx`).

**File da leggere**:
- `packages/kilo-indexing/src/config.ts` (righe ~1-30, ~230-245)
- `packages/core/src/v1/config/config.ts` (righe ~280-310)
- `packages/kilo-vscode/webview-ui/src/i18n/en.ts` (riga ~684) e le altre 20 locale
  (`webview-ui/src/i18n/*.ts`) per la chiave `settings.experimental.imageGenerationModel.placeholder`
- `packages/opencode/src/kilocode/indexing-auth.ts` (file intero)
- `packages/opencode/src/kilocode/components/dialog-indexing.tsx` (righe 19, 88-108: uso di
  `hasKiloIndexingAuth` e della lista provider)
- `packages/opencode/src/kilocode/components/dialog-indexing.tsx` PROVIDER_LABELS/PROVIDER_FIELDS
  (righe 40-71)

**File da modificare**:
- `packages/kilo-indexing/src/config.ts`
- `packages/core/src/v1/config/config.ts`
- `packages/kilo-vscode/webview-ui/src/i18n/*.ts` (21 file, stessa chiave)
- `packages/opencode/src/kilocode/components/dialog-indexing.tsx`
- `packages/opencode/src/kilocode/indexing-auth.ts` (solo se la rimozione in dialog-indexing lo rende orfano)

**Attività**:
1. Default embedder: in `config.ts` (kilo-indexing) cambiare `cfg?.provider ?? "openai"` in
   `cfg?.provider ?? "ollama"` (endpoint locale di default, senza apiKey). Verificare che
   `service-factory.ts` tratti `ollama` con `baseUrl` di default sensato (già così: localhost:11434).
2. Schema: aggiornare la description di `image_generation_model` rimuovendo `(default: openrouter/auto)`
   e specificando che il valore è un riferimento `providerID/modelID` risolto dal provider locale
   configurato (campo legacy/deprecato a favore di `image_generation_provider`).
3. i18n: sostituire il placeholder `Default (Auto Router)` con un testo neutro locale
   (es. inglese `Select a model from your configured provider`, poi tradurre nelle altre 20 locale
   seguendo lo stile esistente; se la traduzione automatica non è disponibile, lasciare in inglese
   le locale prive di traduzione dedicata e annotarlo). La chiave protetta da
   `tests/unit/i18n-unused-keys.test.ts` resta usata dal componente, quindi nessun aggiornamento
   della protection list è richiesto.
4. Dead kilo-auth: in `dialog-indexing.tsx` rimuovere `import { hasKiloIndexingAuth }`, le funzioni
   `hasKiloAuth()` e `defaultIndexing()` (che cerca il provider `kilo`, assente per costruzione
   dopo l'hard-cut), e i loro call site; semplificare di conseguenza la lista a
   `[openai, ollama, openai-compatible]` nei punti in cui la lista completa di 9 provider è usata
   SOLO per il ramo kilo (verificare prima: se `PROVIDER_LABELS`/`PROVIDER_FIELDS` espongono i 9
   provider all'utente nel select, deciderne il taglio alla surface locale [ollama, openai-compatible,
   openai] per allinearsi alla webview IndexingTab, e riflettere il taglio nel tipo
   `EmbeddingProvider = Exclude<..., "kilo">` adattandolo ai provider effettivamente esposti).
5. Se dopo il punto 4 `indexing-auth.ts` non ha più consumer, eliminarlo (file nuovo Kilo, path
   `kilocode/` → nessun marker) insieme agli import residui; altrimenti ridurlo al minimo tenendo
   un commento che spiega il passthrough.

**Dipendenze**: Step 2 consigliabile prima (stesse mappe di superficie) ma tecnicamente indipendente.

**Output atteso**: nessun riferimento a openrouter/kilo-provider/Auto-Router nei testi UI, schema,
default e auth; la TUI espone gli stessi embedder della webview; nessun fetch implicito.

**Verifiche**:
- grep repo-wide per `Auto Router`, `openrouter/auto`, `KILO_API_KEY` (nel contesto indexing),
  `hasKiloIndexingAuth`: nessun match residuo (salvo documenti intenzionali).
- `tests/unit/i18n-unused-keys.test.ts` continua a passare (la chiave è ancora usata).
- Typecheck passa (attenzione al tipo `EmbeddingProvider` se il set di provider si restringe).

**Compilazione**:
- Dalla root: `bun run typecheck`. Da `packages/kilo-vscode/`: `bun run typecheck` (webview) e
  `bun run lint`. Da `packages/kilo-indexing/` e `packages/core/`: typecheck di package se disponibili.
- Eventuali snapshot/test che assertano il vecchio placeholder vanno aggiornati.

**Rischi**: tagliare i 9 provider del dialog TUI cambia UX per utenti avanzati che volevano gemini/
bedrock come embedder hosted: accettabile perché coerente con la matrice PRUNE-NOTES (embedders
hosted selezionabili solo se l'utente li configura esplicitamente — resta possibile via
`config.indexing.<provider>` anche se nascosti dal dialog). Documentare in PRUNE-NOTES.

**Istruzioni per il subagente**: esegui i 5 sottopunti come modifiche atomiche ma in un unico step
(autoconsistente); non toccare il service-factory; per le 20 locale applicare lo stesso replacement
meccanico (stessa struttura file); compila tutto prima di terminare; in caso di dubbio sul tipo
SDK `IndexingConfig["provider"]` consulta `packages/sdk/js/src/gen/` (read-only).

---

### Step 5 — Link nativi della MigrationWizard → openExternal

**Obiettivo**: convertire i due `<a href>` nativi verso `blog.kilo.ai`/`kilo.ai/docs` in
`MigrationWizard.tsx` nel pattern standard dell'estensione (`onClick preventDefault + openExternal`),
usato da AboutKiloCodeTab/CustomProviderDialog.

**Motivazione**: in una webview VS Code gli `<a>` nativi possono generare richieste relative o
comportamenti inaspettati; uniformare al resto della superficie. Severità bassa, fix cosmetico.

**File da leggere**:
- `packages/kilo-vscode/webview-ui/src/components/migration/MigrationWizard.tsx` (righe ~640-670)
- `packages/kilo-vscode/webview-ui/src/components/settings/AboutKiloCodeTab.tsx` (pattern di riferimento, righe ~205-220)
- Come viene esposto `openExternal` al webview (controllare il context/hook usato da AboutKiloCodeTab,
  es. `useWebviewMessage`/postMessage `openExternal` in `webview-ui/src/types/messages/`)

**File da modificare**:
- `packages/kilo-vscode/webview-ui/src/components/migration/MigrationWizard.tsx`

**Attività**:
1. Sostituire i due `<a href="https://...">` con elementi che replicano esattamente il pattern di
   AboutKiloCodeTab (stesso hook/message per `openExternal`, stesso styling link esistente nel
   componente).
2. Verificare che il segmento "What's New" della migration wizard resti raggiungibile solo via
   About tab (comportamento invariato).

**Dipendenze**: nessuna.

**Output atteso**: nessun `<a href>` remoto nativo in webview-ui; click apre il browser di sistema.

**Verifiche**:
- grep in `webview-ui/src/components/migration/` per `<a href="http`: zero match.
- Test unitaria/accessibility esistenti su MigrationWizard (ce?ne) continuano a passare.

**Compilazione**:
- Da `packages/kilo-vscode/`: `bun run typecheck` + `bun run lint` + `bun run test:unit`
  (runner, non `bun test` diretto) oppure almeno i test mirati su migration se presenti in
  `tests/unit/`.

**Rischi**: quasi nulli; il pattern è già collaudato in altri componenti.

**Istruzioni per il subagente**: copia il pattern di AboutKiloCodeTab, non reinventare il wiring
del messaggio; diff minimale; compila e linta.

---

### Step 6 — Runner di test: watchdog OOM reattivo + rilevazione exit 137

**Obiettivo**: estendere `packages/kilo-vscode/script/run-unit-tests.ts` con un guardrail anti-OOM
reattivo: quando il kernel uccide un worker (exit 137 / SIGKILL), ridurre dinamicamente la
concurrency e segnalare l'evento distintamente nel report.

**Motivazione**: oggi l'unico guardrail è il cap statico da `/proc/meminfo` calcolato una volta
all'avvio; un OOM a metà run non viene rilevato né compensato (il child muore con 137 ed è
trattato come semplice fail). Secondo la docs bun, con `--parallel` nativo un fatal signal
abortirebbe l'intera run: restare su processi separati + watchdog mantiene l'isolamento per-file.

**File da leggere**:
- `packages/kilo-vscode/script/run-unit-tests.ts` (file intero, in particolare `run()` righe
  309-358, il loop workers righe 420-433, `shutdown()`, `marks`/`legend` righe 228-234)
- https://bun.com/docs/test/parallel (sez. "Worker environment" e crash semantics) — già analizzata
  in audit; riutilizzare i risultati, webfetch solo in caso di dubbio residuo.

**File da modificare**:
- `packages/kilo-vscode/script/run-unit-tests.ts`
- `PRUNE-NOTES.md` (tabella comandi: aggiornare la descrizione di `test:unit` con i nuovi env)

**Attività**:
1. Estendere il type `Result` con `oom: boolean` (true se `code === 137` oppure se il processo
   esce con signal SIGKILL non causato dal nostro `terminate()` — distinguibile perché in
   `run()` il timeout imposta `killed.value` prima del kill: se `!killed.value && code === 137`
   → OOM).
2. Rendere la concurrency dinamica: sostituire la costante `concurrency` usata nel `Array.from({length: ...})`
   con un segnale condiviso `activeConcurrency` (es. oggetto `{value: n}` inizializzato a
   `concurrency`); i worker pescano dalla coda solo se `active.workers < activeConcurrency.value`.
   Implementare il loop come dispatcher singolo (un solo ciclo che avvia fino a N processi
   concorrenti attendendone la liberazione via `Promise.race` sulle proc attive) OPPURE mantenere
   i worker fissi e farli dormire (gate) quando superano il limite corrente — scegliere la forma
   col diff minore compatibile con `shutdown()`/`active`/`finish()` esistenti.
3. Dopo ogni `run(file)`: se `result.oom` → `activeConcurrency.value = Math.max(1, value - 1)`,
   log di riga `console.log(\`[oom] worker killed by kernel while running ${file}; lowering concurrency to ${n}\`)`.
4. Report: aggiungere il mark `O` (OOM) in `marks` + `legend`; in `report()` mostrare
   `(OOM-killed)` accanto al file; in summary contare `oomCount` e stamparlo.
5. Env var: documentare `KILO_TEST_OOM_BACKOFF` (intero ≥1, default 1: quantità decrementata a
   ogni OOM) nel blocco help e nel parsing `intEnv`.
6. Opzionale ma raccomandato (stesso step): watchdog proattivo — timer che ogni 5s rilegge
   `MemAvailable` da `/proc/meminfo`; se scende sotto `activeWorkers*2048 + 512` MB, abbassare
   `activeConcurrency` allo stesso modo (prevenire oltre che reagire). Su piattaforme non-linux
   disattivare il watchdog (meminfo assente) e affidarsi solo al backoff reattivo.
7. Aggiornare l'aiuto `--help` e la riga di banner iniziale (stampare il valore effective di
   OOM_BACKOFF).

**Dipendenze**: nessuna sugli step 1-5.

**Output atteso**: a regime, una run che subisce OOM degrada gradualmente a 1 worker invece di
crollare; il report distingue OOM da fail logico; `PRUNE-NOTES` documenta i nuovi knob.

**Verifiche**:
- V1 (statico): `bun run typecheck` dalla root passa (lo script è TS eseguito da bun, coperto dal
  typecheck di package se incluso nella tsconfig di kilo-vscode; verificare).
- V2 (funzionale, economico): simulare l'OOM con `KILO_TEST_MEM_AVAILABLE_MB=900` (ramCap→0→min 1)
  e un file di test pesante già noto (es. `worktree-manager`) con `--pattern worktree-manager`
  osservando il log `[oom]` o il mark `O` (richiede che il child venga davvero ucciso: se la RAM
  reale è alta forzare anche `KILO_TEST_CONCURRENCY=4` per saturare; se la simulazione non
  riesce sulla macchina, farlo in CI/runner dedicato e registrare l'esito).
- V3 (regressione): run completa `bun run test:unit` — stessa durata/ordering dei file rispetto a
  prima (i timings non cambiano), nessun file perso dalla coda.
- V4 (corredativo, una tantum): confermare l'exit code dell'OOM under Bun.spawn con un micro-script
  throwaway in `/tmp/kilo` (spawn di `bun -e 'const a=[]; setInterval(()=>a.push(new Uint8Array(50e6)),10)'`
  in un cgroup con memoria limitata, oppure semplicemente documentare l'ipotesi 137 nel commento
  del codice se non si dispone di un ambiente con limitazione di RAM). Non committare script di
  verifica temporanei nel repo.

**Compilazione**:
- Dalla root: `bun run typecheck`. Lo script deve restare eseguibile: `bun script/run-unit-tests.ts --help`
  da `packages/kilo-vscode/`.

**Rischi**: il dispatcher dinamico è il punto più delicato del runner; mantenere i comportamenti
  esistenti (bail, retry flaky, sharding, update-timings, shutdown su SIGINT/SIGTERM) invariati.
Se il refactoring del loop introduce regressioni, il rollback dello step è autonomo.

**Istruzioni per il subagente**: leggi per intero il runner prima di modificare qualsiasi cosa; il diff deve
essere additivo dove possibile (nuovi campi/mark/env) e chirurgico sul loop; non cambiare la
strategia spawn (restano N processi `bun test <file>`); non toccare i test; compila e lancia
`--help` a fine step; usa webfetch sulla docs bun solo per dubbi puntuali.

---

### Step 7 — Runner di test: budget globale di 5 minuti + wiring CI

**Obiettivo**: aggiungere al runner un hard deadline globale (default 300000 ms) con soft-budget
basato sui timings, e propagare la configurazione ai workflow CI e alla documentazione.

**Motivazione**: oggi esiste solo il per-file timeout; la suite può superare arbitrariamente i
5 minuti (CI ha `timeout-minutes: 45`). Vincolo richiesto: i test non girano mai più di 5 minuti.

**File da leggere**:
- `packages/kilo-vscode/script/run-unit-tests.ts` (stato post-Step 6: parsing env, `weight()`,
  loop workers, summary finale)
- `packages/kilo-vscode/test-unit-timings.json` (formato pesi)
- `.github/workflows/test-vscode.yml` (job `unit`, env block)
- `.github/workflows/test.yml` (verificare se il job unit del CLI riusa lo stesso runner o uno
  proprio: se propri, valutare se estendere il budget lì — solo se trivial, altrimenti documentare
  come out-of-scope)
- `PRUNE-NOTES.md` (tabella comandi)

**File da modificare**:
- `packages/kilo-vscode/script/run-unit-tests.ts`
- `.github/workflows/test-vscode.yml`
- `PRUNE-NOTES.md`
- eventualmente `script/check-workflows.ts` (solo se il set di workflow cambi — non cambia qui)

**Attività**:
1. Nuovo env `KILO_TEST_GLOBAL_TIMEOUT` (ms, default `300000`) + flag `--global-timeout <ms>`
   (precedenza flag > env > default), parse come `intEnv`/`opt` esistenti; aggiornare `--help`.
2. All'avvio: `deadlineAt = performance.now() + globalTimeout`. Nel loop di schedulazione, prima
   di assegnare un nuovo file, **soft budget**: se `weight(nextFile) > deadlineAt - now` NON
   partire quel file e marcarlo `SKIPPED-BUDGET` (mark `S`) — evita di iniziare file da 90s quando
   ne restano 20. **Hard deadline**: quando `now >= deadlineAt` impostare `stopped.value = true`
   (meccanismo già esistente) → i worker smettono di prendere file; i file in volo finiscono o
   vengono terminati dal per-file timeout.
3. I file saltati dal budget devono comparire nel report con mark `S` e conteggio
   `skippedBudget` nel summary; l'exit code diventa 1 se ci sono skipped (la suite non è
   completata) MA distinguendo nel messaggio: `budget exceeded: N files not started`.
   Eccezione: se la causa dell'incompleteness è SOLO il budget e tutti gli altri file hanno
   passato, l'exit resta 1 (conservativo) — documentare.
4. Interazione con il watchdog OOM (Step 6): le due meccaniche compongono (il budget ferma i file
   nuovi, il backoff riduce i worker attivi); non devono confliggere con `--bail` (bail vince).
5. CI: in `test-vscode.yml` aggiungere nell'env del passo "Run unit tests"
   `KILO_TEST_GLOBAL_TIMEOUT: "300000"` con commento `kilocode_change` che spiega il vincolo;
   abbassare `timeout-minutes` da 45 a 15 (rete di sicurezza: 5 min di suite + install/lint/knip
   margine) — il valore 15 copre anche i passi successivi (lint/format/knip/marker check).
6. `PRUNE-NOTES.md`: aggiornare la riga `bun run test:unit` della tabella comandi citando
   `KILO_TEST_GLOBAL_TIMEOUT` (default 5 min) e `KILO_TEST_OOM_BACKOFF`.
7. Se `test.yml` (CLI) usa un runner diverso senza budget globale, lasciarlo invariato e annotare
   in PRUNE-NOTES che il budget 5 min vale per la suite dell'estensione (scope di questo piano).

**Dipendenze**: Step 6 (il budget compone col watchdog sullo stesso loop).

**Output atteso**: `bun run test:unit` termina entro ~5 min + durata dei file in volo; in CI la
suite è coperta da deadline interna e da `timeout-minutes: 15`.

**Verifiche**:
- V1: `--help` mostra il nuovo flag/env.
- V2 (soft budget): eseguire con `KILO_TEST_GLOBAL_TIMEOUT=20000` (20s) e osservare i mark `S`
  per i file non partiti e il messaggio "budget exceeded"; la run deve fermarsi ben prima dei 5 min.
- V3 (hard deadline): con `KILO_TEST_GLOBAL_TIMEOUT=60000` su run completa, verificare che alla
  scadenza i worker smettano di prendere file e la suite termini con exit 1 + contatore corretto.
- V4 (regressione nominal): run completa con default 300s: stessa copertura di prima (nessun
  skip) se la suite sta in 5 min; se la suite nominale supera 5 min, riportare l'esito (danno
  collaterale atteso del vincolo) e comunicare all'utente l'eventuale bisogno di sharding
  (`--shard`) per restare nel budget — decisione di prodotto, non di questo piano.
- V5: `bun run typecheck` dalla root; workflow YAML valido (lint YAML se disponibile, altrimenti
  lettura attenta).

**Compilazione**:
- Dalla root: `bun run typecheck`. Da `packages/kilo-vscode/`: `bun run lint` (il runner è TS).

**Rischi**: se la suite nominale non sta in 5 min a concurrency 2-3, molti file verranno saltati
in CI e la copertura apparentemente cala: mitigazione prevista = sharding futuro (out of scope)
o `--update-timings` per ri-bilanciare. Il vincolo è esplicitamente richiesto dall'utente.

**Istruzioni per il subagente**: costruisci sopra il loop già reso dinamico dallo Step 6 (non
rifare quel lavoro); i mark `S`/`O` convivono nella stessa legenda; mantieni `--bail` dominante;
compila; valida i due scenari V2/V3 prima di considerare lo step fatto; aggiorna help+docs+CI
nell'ordine.

---

### Step 8 — Documentazione finale della superficie offline

**Obiettivo**: consolidare in `PRUNE-NOTES.md` (e CHANGELOG se user-facing) l'esito completo
dell'audit: residui rimossi in questo piano, conferma dei residui volutamente online, note sui
due nuovi guardrail del runner.

**Motivazione**: la matrice "Residui volutamente online" e la sezione "Online-services removal"
devono riflettere lo stato post-piano, altrimenti i prossimi sync/audit ripartiranno da premesse
vecchie.

**File da leggere**:
- `PRUNE-NOTES.md` (sezioni: matrice residui, cosmetici, Online-services removal, tabella comandi)
- `packages/kilo-vscode/CHANGELOG.md` (ultimo entry, stile)

**File da modificare**:
- `PRUNE-NOTES.md`
- `packages/kilo-vscode/CHANGELOG.md` (solo per i item user-facing: dialog TUI, placeholder
  image model, default embedder; il runner è tooling interno → solo PRUNE-NOTES)

**Attività**:
1. Nella matrice: annotare i nuovi residui voluti confermati (es. URL tree-sitter gated da
   `KILO_TREE_SITTER_DOWNLOAD` — se lo Step 3 li ha fatti degni di menzione; i default embedder
   ora locali).
2. In "Online-services removal"/chiusura audit: elencare i residui eliminati (blocchi login
   bedrock/vercel/cloudflare, alias codex, messaggio Codex, mappe TUI, Auto Router, kilo
   indexing auth, link MigrationWizard).
3. Tabella comandi: riga `test:unit` aggiornata con `KILO_TEST_GLOBAL_TIMEOUT` (default 300000)
   e `KILO_TEST_OOM_BACKOFF`.
4. CHANGELOG: entry breve in cima (stile esistente) per i cambiamenti visibili all'utente.

**Dipendenze**: Steps 1-7 completati (serve l'esito definitivo per scrivere).

**Output atteso**: PRUNE-NOTES e CHANGELOG coerenti con il codice; nessun documento contraddice
il comportamento reale.

**Verifiche**:
- Lettura incrociata: ogni claim del doc corrisponde a codice (spot-check 3-4 righe).
- `bun run script/check-md-table-padding.ts` dalla root (i table markdown non devono avere cell
  paddate).
- `bun run script/check-forbidden-strings.ts` dalla root (se il guard prevede stringhe vietate,
  verificare che i nuovi testi non violino regole, es. menzioni "gateway").

**Compilazione**: nessun codice; eseguire i guard di cui sopra. Se un guard fallisce per effetto
del nuovo testo, correggere il testo (non il guard).

**Rischi**: bassi; il rischio principale è divergenza doc/codice se uno step precedente è stato
parziale — rivedere i diff reali prima di scrivere.

**Istruzioni per il subagente**: scrivi solo dopo aver letto i diff dei passi 1-7 (git diff HEAD~8..HEAD
o equivalente se i passi sono già committati); mantieni il tono/esistente del file; tabelle
compatte senza padding; non introdurre nuove sezioni grandi.

## Criteri di completamento

- Steps 1-8 completati in ordine, ciascuno con revisione utente e compilazione verde.
- Nessun fetch automatico verso host pubblici nel boot/runtime dell'estensione al di fuori della
  matrice di residui volutamente online (gated da utente) in PRUNE-NOTES.
- `bun run test:unit` termina entro 5 minuti (default) senza OOM kill non gestiti (watchdog
  attivo) e il report distingue pass/fail/OOM/timeout/skipped-budget.
- `bun turbo typecheck` (root) verde; lint e guard (`knip`, `check-kilocode-change`,
  `check-md-table-padding`, `check-forbidden-strings`, `check-workflows`) verdi dove applicabili.
- Nessuna funzionalità extra introdotta; i provider online restano configurabili solo via
  `config.provider` (BYOK) e mai attivabili automaticamente.