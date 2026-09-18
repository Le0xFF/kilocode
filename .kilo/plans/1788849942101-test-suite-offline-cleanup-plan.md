# Piano — Ottimizzazione e pulizia dei test post-isolamento offline

## Obiettivo

Dopo i commit di Le0xFF che hanno isolato l'estensione VS Code e reso il prodotto completamente offline, portare la suite di test dello stato attuale a un livello minimo utile:

1. Rimuovere i test orfani (che verificano funzionalità rimosse: cloud sessions/KiloSessions, remote notifications, FIM/autocomplete, OTel-by-default).
2. Ottimizzare l'esecuzione per evitare OOM-kill del kernel su macchine a 4 vCPU / RAM limitata, seguendo la documentazione ufficiale di `bun test` (https://bun.com/docs/test e https://bun.com/docs/test/parallel): parallelismo limitato da RAM, isolamento per file, schedulazione basata su durate registrate (`--timings`), sharding deterministico (`--shard`).
3. Riparare le connessioni CI mancanti (package `schema` con 7 test senza script; job `httpapi` che punta al package `client` rimosso dal prune) evitando che CI continui a fallire o a eseguire lavoro inutile.

Non è obiettivo del piano: rifattorizzare i test funzionanti, consolidare harness duplicati, o ridurre la copertura delle feature vive.

## Analisi

### Stato attuale della codebase

- Branch `leocode`: repo ripulito a `packages/kilo-vscode` + dipendenze transitive di `@kilocode/cli` (`opencode`, `core`, `tui`, `llm`, `kilo-indexing`, `kilo-memory`, `kilo-sandbox`, `kilo-i18n`, `kilo-ui`, `ui`, `plugin`, `protocol`, `schema`, `codemode`, `sdk/js`, `script`, `http-recorder`, `effect-*`, `plugin-atomic-chat`). Documentato in `PRUNE-NOTES.md`.
- Commit offline (vecchio→nuovo): `1673a9fbf1` rimozione servizi Kilo online, `cfacab50d3` hard-cut provider fuori superficie, `969f948140` residui online, `5d613a008b` LSP/sharing/auto-update/probe, `6f749c2b85` dead code cloud/provider, `75561b6d1f` chiusura finale.
- Feature rimosse (da PRUNE-NOTES "Residui volutamente online"): Kilo Gateway (auth/profile/balance), marketplace, KiloClaw, cloud sessions, remote notifications, PostHog/OTel telemetry, gateway autocomplete (FIM/next-edit), provider `kilo`, route `/kilo/*` e `/telemetry/*`, session share/export/presence, LSP, auto-update, network probe (lista host azzerata), models.dev fetch (snapshot committed), tool `generate-image` e `websearch-kilo-exa`.

### Inventario test (file tracciati da git)

| Package | File test | Runner/script | Note |
|---|---|---|---|
| opencode | 582 | `test:ci` = `script/test-runner.ts --ci` (runner custom: processo isolato per file, cap RAM ~2GB/worker, fast-tier batch, sharding durate LPT, retry, JUnit merge) | Il runner è già l'implementazione locale delle raccomandazioni bun docs (isolation + timings + shard). |
| kilo-vscode | 348 (~299 unit in `tests/unit/`, 16 playwright `*.spec.ts`, 2 in-source) | `test:unit` = `bun test tests/unit/ --parallel=4 --dots` (parallelo fisso, nessuna isolation per file, nessun heap cap); `test:integration` = runner electron su Codium system (suite mocha placeholder); `test:visual` = playwright + Storybook | I driver principali di OOM sono qui: 4 worker fissi × preloads pesanti (vscode-mock, SDK, SolidJS, happy-dom) + scans repo-wide degli i18n test + ~25 file che spawnano child `git`/`bun` + allocazioni multi-MiB (17 MiB in `agent-manager-worktree-diffs.test.ts`, 8 MiB in `agent-manager-terminal-replay.test.ts`). `test:unit:fast` usa `--no-isolate`: crescita monotona del runtime unico, path classico leak→OOM. |
| core | 141 | `bun test --timeout 30000 --reporter=junit` | OK |
| tui | 55 | `bun test` pattern standard | OK |
| kilo-indexing | 30 | idem | OK |
| llm | 25 | idem | OK |
| ui | 19 | `bun test src` (co-located) | OK |
| kilo-ui | 10 | solo `test:visual` (playwright) | i 10 file non entrano in nessuna suite bun test |
| kilo-memory | 9 | idem | OK |
| kilo-sandbox | 8 | idem | OK |
| schema | 7 | **nessuno** (nessun script `test`) | suite mai eseguita in CI |
| codemode | 7 | idem | OK |
| sdk/js | 2 | `bun test` | utili (coprono codice hand-written, non `src/gen/`) |
| plugin-atomic-chat | 2 | vitest | unico uso di vitest nel repo |
| script, protocol, http-recorder, effect-drizzle-sqlite | 1 ciascuno | vari | OK |

### Test orfani identificati (verificati sul sorgente)

| File | Riferimento | Verdetto |
|---|---|---|
| `packages/kilo-vscode/tests/history-accessibility.spec.ts` (linee ~77-96) | Tab "Cloud" delle cloud sessions (KiloSessions) | trim: test singolo orfano; `HistoryView` espone solo `local`/`worktree` |
| `packages/kilo-vscode/webview-ui/src/stories/history.stories.tsx` (linea 178) | story "Local and cloud sources" | rinominare/aggiornare (è il backdrop dello spec sopra; non è un test ma lo supporta) |
| `packages/kilo-vscode/tests/unit/kilo-provider-followup.test.ts` (righe 27, 298, 357) | stub `fetchAndSendNotifications` | trim: metodo assente in `src/` (verificato: esiste solo `sendNotificationSettings` in `KiloProvider.ts`); se il tipo `Internals` è dichiarato nel test la riga diventa dead code |
| `packages/kilo-vscode/tests/unit/kilo-provider-indexing-refresh.test.ts` (righe 26, 168) | idem | trim come sopra |
| `packages/kilo-vscode/tests/unit/kilo-provider-load-messages.test.ts` (riga 181), `kilo-provider-session-refresh.test.ts` (riga 73), `kilo-provider-route-integration.test.ts` (riga 54) | stub `notifications: async () => ({ data: [] })` sull'SDK client | verificare se la route SDK `/notification*` esiste ancora dopo la regen post-rimozione; se assente → rimuovere lo stub |
| `packages/kilo-vscode/tests/setup/vscode-mock.ts` | classe `InlineCompletionItem` (FIM rimosso) | verificare consumi in `src/`; se zero → rimuovere |
| `packages/opencode/test/kilocode/config/opentelemetry-default.test.ts` | default `experimental.openTelemetry=true`; consumer (bridge PostHog) rimosso | eliminare il test (o il flag, out of scope qui) |
| `packages/opencode/test/kilocode/config/console-ui.test.ts` | config prefs console | verificare se la superficie config console è viva; se no → eliminare |
| `packages/opencode/test/kilocode/runner-{pipe,start-order,signal,abrupt}-983452-*.test.ts` (4 file) | micro-test timestamped da debug di un bug runner | eliminare (verificare prima che non siano referenziati da profili/shard) |
| `packages/opencode/script/kilocode/test-durations.json` | voci per file eliminati (es. `kilocode/session-share.test.ts`) | pulire voci stanche (inerte oggi, ma altera i pesi LPT) |
| `packages/opencode/test/kilocode/project-id.test.ts` | `git remote add origin https://github.com/Kilo-Org/handbook.git` (~12 call) | unica vera dipendenza di rete della suite CLI: sostituire con remotes scheme-only (`git@example.com:org/repo`) |

Confermato NON orfano (da non toccare): test di regression post-removal (`session/network.test.ts` "empty host list", `event-manifest.test.ts` count 89, `server-manager-utils.test.ts` strip `OTEL_*` + `KILO_DISABLE_MODELS_FETCH`, `remote.test.ts` stub intenzionale, `upgrade.test.ts` per il comando manuale `kilo upgrade`), `legacy-migration/` (14 file, tutto keep), `permission-description.test.ts` (commento documentante), `skills-settings-responsive.spec.ts` (skills.urls è gated e kept), tutti gli altri 15 spec playwright.

### Ottimizzazione OOM — sintesi dalla doc bun

Da https://bun.com/docs/test e https://bun.com/docs/test/parallel:

- `--parallel=N`: N worker process, uno file alla volta; ogni file ha global fresh (default sicuro).
- `--no-isolate`: i worker valutano imports/preload una sola volta → win più grande per suite di file piccoli; da usare solo se i file non si contaminano (già passano sotto `bun test` mono-global). Qui i file usano `mock.module` (process-wide) e preload condivisi → rischio di contaminazione: mantenere l'isolation per-file su `test:unit`, usare `--no-isolate` solo su `test:unit:fast` (come già fatto).
- `--timings <file>`: JSON `{relPath: ms}`; il coordinatore cutta i chunk dei worker per tempo e ogni worker parte dal file più lento. È il meccanismo che impedisce a 4 worker di accaparrarsi i file pesanti insieme (picco RSS simultaneo).
- `--update-timings`: ogni run scrive/mergea le durate misurate; senza `--shard` fa merge in quello letto.
- `--shard=i/n`: split deterministico per macchina/job, combinabile con `--parallel` locale.
- Bun assume tempo mediano per i file senza entry e li avvia per primi sotto `--parallel`.

Gap attuali rispetto a queste leve (tutti in `packages/kilo-vscode`):
1. `test:unit` fissa `--parallel=4` indipendentemente da RAM/CPU → su runner 4-vCPU a 4-8 GB quattro runtime Bun concorrenti (ciascuno con vscode-mock + SDK + SolidJS + happy-dom precaricati) saturano la RAM → OOM-kill del kernel a metà suite.
2. Nessuna schedulazione per durate: i file pesanti (i18n scan repo-wide, worktree-manager con `Bun.spawnSync` git, load-messages 59KB, allocazioni 8-17 MiB) possono finire concentrati sugli stessi worker.
3. `test:unit:fast` (`--no-isolate`) non ha alcun guardrail: crescita monotona → OOM garantita su run lunghi.
4. Nessun timeout globale per file: un hang blocca un worker per sempre.
5. CI `test-vscode.yml` non applica il pattern già usato da `test.yml` (cap concurrency via env, `timeout-minutes`).

Il runner CLI (`packages/opencode/script/test-runner.ts`) dimostra il modello target: cap RAM (~2GB/worker da `/proc/meminfo`), `KILO_TEST_CONCURRENCY`, `KILO_TEST_FILE_TIMEOUT`, retry, timings LPT, fast-tier. Per l'estensione proponiamo un runner analogo ma compatto (non un clone completo: niente fast-tier batch, niente build del binary, niente JUnit merge complesso — manteniamo `--reporter=junit` semplice se serve).

### Vincoli architetturali

- `bunfig.toml` di `kilo-vscode` ha `[test] preload = [vscode-mock.ts, worker-url.ts]`: qualsiasi invocazione `bun test` in quel package carica i preload; il runner deve invocare `bun test` con cwd `packages/kilo-vscode`.
- I test unitari sono ermetici (vscode mockato): il runner può spaware processi `bun test` in parallelo senza IDE.
- `test:integration` usa `VSCODE_EXEC_PATH=/usr/bin/codium` e stato confinato in `.kilo-dev/vscode-test/`; resta com'è (suite mocha placeholder), ma il suo costo dominante è la boot dell'IDE: va eseguito separatamente dai unit, mai in parallelo con essi.
- Knip gira in CI su `kilo-vscode`: rimuovere export/mock non usati è coerente; aggiungere file nuovi è ok.
- `check-workflows.ts`: l'allowlist dei workflow è hardcoded; non aggiungiamoworkflow nuovi, quindi nessun aggiornamento necessario (verificare comunque).
- Stile repo: nomi single-word, `const`, early-return, `Bun.file()`, `windowsHide` nei spawn, avoid try/catch dove possibile.

## Assunzioni

- La route SDK `client.notifications` è stata rimossa con le remote notifications: da verificare nello Step 3 (se presente, gli stub restano validi e non si tocca nulla lì).
- Il flag `experimental.openTelemetry` esiste ancora in config: il test che ne asserisce il default è orfano perché il consumer (PostHog bridge) è morto; rimuoviamo il test, non il flag (out of scope).
- `console-ui.test.ts` copre una superficie config morta: da verificare nello Step 4 contro `Config.Info` in `packages/opencode/src/config`.
- I 4 micro-test `runner-*-983452-*` non sono membri di alcun `FAST_TIERS`/profilo: da verificare nello Step 5.
- Il runner proposto per `kilo-vscode` è compatibile con la versione di Bun pincata (`1.3.14`): i flag `--timings`/`--update-timings`/`--shard` esistono; se uno mancasse, il subagente deve verificarlo consultando https://bun.com/docs/test/parallel (WebFetch/MCP) prima di implementare, e in fallback usare solo `--parallel` calcolato + `--timeout`.
- La baseline playwright (LFS) non è toccata da questo piano: rimuovendo il test Cloud da `history-accessibility.spec.ts` non si toccano screenshot.
- Ogni step termina con la codebase compilabile (typecheck del package toccato) e, dove indicato, con la suite interessata verde.

## Piano di implementazione

### Step 1 — Baseline di esecuzione e prime misurazioni

**Obiettivo**

Misurare lo stato attuale: tempi e picchi di memoria di `test:unit` e `test:unit:fast`, e generare la tabella delle durate per-file (input futuro del runner ottimizzato).

**Motivazione**

Senza dati non si può dimostare il beneficio dell'ottimizzazione né calibrare il cap di RAM. `--update-timings` produce il file JSON che il runner userà con `--timings`.

**File da leggere**

- `packages/kilo-vscode/package.json` (script section)
- `packages/kilo-vscode/bunfig.toml`
- `.github/workflows/test-vscode.yml`
- `PRUNE-NOTES.md` (sezioni "Execution rules" e "Valid commands")

**File da modificare**

- `packages/kilo-vscode/package.json`: aggiungere script `test:unit:timings` = `bun test tests/unit/ --parallel=2 --update-timings --timings=test-unit-timings.json` (nome file da confermare col flag esatto della doc bun; se `--update-timings` implica il percorso, adeguare). Non modificare gli script esistenti in questo step.

**Attività**

1. Da `packages/kilo-vscode`: eseguire `bun run test:unit` e registrare: durata totale, numero di pass/fail, eventuale OOM-kill (controllare `dmesg | grep -i kill` o l'exit code 137) in questa macchina.
2. Eseguire il nuovo `test:unit:timings` (parallel=2 per ridurre il rischio OOM durante la misura) e verificare che il file timings venga scritto con le durate per-file.
3. Eseguire `bun run test:unit:fast` e registrare il comportamento (passa? OOM? quanto dura?).
4. Se la macchina ha poca RAM e anche parallel=2 OOMa, ripetere con `--parallel=1` solo per la generazione dei timings.

**Output atteso**

- Un report (salvato in chat, non in repo) con: risultati delle tre esecuzioni, exit codes, eventuali OOM, contenuto top-20 del file timings (file più lenti).
- Script `test:unit:timings` presente in `package.json`.

**Verifiche**

- `bun run test:unit` completa (o fallisce in modo identico allo stato pre-step, senza nuove failure).
- Il file timings esiste e contiene entries per la maggior parte dei file di `tests/unit/`.
- `bun run typecheck` da root passa.

**Compilazione**

- `bun typecheck` da root (turbo su tutti i package). Risolvere errori introdotti (attesi: nessuno, cambia solo `package.json`).

**Rischi**

- Run lunghi (la suite è ~300 file): usare timeout generosi sul comando shell.
- Se `--update-timings`/`--timings` non fossero supportati dalla Bun 1.3.14, verificare la sintassi sulla doc (MCP/WebFetch su https://bun.com/docs/test/parallel) e adattare lo script; nel caso peggiore lo step produce solo i dati empirici e il runner successivo userà un JSON gestito a mano.

**Istruzioni per il subagente**

- Implementa esclusivamente questo step; non toccare altri file.
- Non anticipare la creazione del runner (Step 2).
- Non modificare `test:unit`/`test:unit:fast` esistenti.
- Mantieni le modifiche minime (uno script in package.json).
- Compila/typechecka al termine; risolvì eventuali errori.
- Se hai dubbi sui flag bun, consulta https://bun.com/docs/test e https://bun.com/docs/test/parallel prima di supporre.
- Regola anti-loop: se ripeti lo stesso comando/tool 3 volte sullo stesso argomento senza progresso, cambia approccio (es. riduci parallelismo, leggi la doc).

---

### Step 2 — Runner di test unitari per kilo-vscode con cap-RAM, timings e shard

**Obiettivo**

Sostituire il `--parallel=4` fisso di `test:unit` con un runner (modello `packages/opencode/script/test-runner.ts` semplificato) che: limita il parallelismo in base alla RAM disponibile (~2GB/worker), schedula i file per durata usando il JSON dello Step 1, applica un timeout per-file, ritenta i flaky, e supporta `--shard` per CI.

**Motivazione**

È il cuore anti-OOM: (a) su una macchina da 8GB il cap porta i worker da 4 a 4, su 4GB a 2, su 2GB a 1 — nessun picco oltre la RAM; (b) il weight-based ordering (più lento prima) evita che i file pesanti cadano tutti sugli stessi worker; (c) il timeout per-file impedisce a un hang di bloccare un worker all'infinito; (d) `--shard` permette di dividere la suite su più job CI se in futuro il tempo diventasse problema.

**File da leggere**

- `packages/opencode/script/test-runner.ts` (modello di riferimento: parsing CLI, memCap da `/proc/meminfo`, pool di worker, terminate tree, report)
- `packages/opencode/script/kilocode/test-shard.ts` e `test-profile.ts` (solo se il runner riusa questi moduli; altrimenti reimplementare in locale ~40 righe per non creare dipendenze cross-package)
- `packages/kilo-vscode/package.json`, `packages/kilo-vscode/bunfig.toml`
- `packages/kilo-vscode/tests/setup/vscode-mock.ts` e `worker-url.ts` (per confermare che i preload restino attivi: il runner invoca `bun test` con cwd package, quindi bunfig si applica)
- Il file timings prodotto dallo Step 1

**File da modificare**

- Nuovo: `packages/kilo-vscode/script/run-unit-tests.ts`
- `packages/kilo-vscode/package.json`:
  - `test:unit` → `bun script/run-unit-tests.ts` (mantenere lo stesso nome/semantica: full suite)
  - `test:unit:fast` → `bun test tests/unit/ --parallel --no-isolate --dots --timeout 60000` (aggiungere solo il timeout, resta il profilo veloce locale)
  - `test:unit:timings` → `bun script/run-unit-tests.ts --update-timings`
  - Nuovi optional: `test:unit:shard` non serve come script; il runner accetta `--shard i/n` e env `KILO_TEST_SHARD`/`KILO_TEST_CONCURRENCY`/`KILO_TEST_FILE_TIMEOUT` come nel runner CLI

**Attività**

1. Scrivere `script/run-unit-tests.ts`:
   - Discovery: `new Bun.Glob("**/*.test.{ts,tsx}")` sotto `tests/unit/` (stesso criterio di `bun test tests/unit/`), ordinati; esclusione esplicita dei `*.spec.ts` (restano dominio playwright).
   - Concurrency: default = `min(4, cpus, floor(MemAvailableMB/2048))` leggendo `/proc/meminfo` su Linux (fallback `min(4, cpus)` su macOS/Windows); override con `--concurrency N` o `KILO_TEST_CONCURRENCY`. Stampare la cap applicata quando attiva (come fa il runner CLI).
   - Weight: `timings[file] ?? size(file)`; ordering longest-first per i worker (work-stealing semplice: coda comune, ogni worker prende il next).
   - Execution: per ogni file un `Bun.spawn(["bun","test",path,"--timeout",String(timeout)])` con `cwd` = package root, `windowsHide: true`, detached su POSIX; timeout per-file default 300000ms (env `KILO_TEST_FILE_TIMEOUT`); kill tree (SIGTERM→SIGKILL) al deadline, come nel modello.
   - Retry: 1 attempt extra per file fallito (non per timeout), stesso criterio del runner CLI.
   - Sharding: `--shard i/n` o `KILO_TEST_SHARD` → partizione LPT pesata (riuso o reimplementazione di `TestShard.split/order`).
   - `--update-timings`: dopo una run full (senza pattern/shard/profile), merge delle durate misurate nel JSON (stesso formato bun: relative paths → ms).
   - Report: dots + summary (passed/failed/flaky/duration) + sezione failures con output; exit code 1 se ci sono failure.
   - Flag bonus: `--verbose`, `--bail`, `--pattern <substr>...` per filtri locali.
2. Cablare gli script `package.json` come sopra.
3. Verificare che `bun run test:unit` su questa macchina completi senza OOM (con la RAM reale) e produca lo stesso verdict (pass/fail) della suite precedente.

**Output atteso**

- Runner funzionante; `test:unit` ora RAM-aware; `test:unit:timings` aggiorna il JSON; `test:unit:fast` guadagna il timeout.

**Verifiche**

- `bun run test:unit` completa; confrontare il set di failure con lo Step 1 (deve essere identico).
- Simulare poca RAM: `KILO_TEST_MEM_AVAILABLE_MB=2500 bun run test:unit` → deve loggare "RAM-based cap ... limits default concurrency to 1" e completare.
- `KILO_TEST_SHARD=1/2 bun run test:unit` e `2/2` → union dei due shard = full suite, nessun file doppio.
- `bun typecheck` da root.

**Compilazione**

- `bun typecheck` da root; risolvere errori (il nuovo script è TS, deve passare).

**Rischi**

- Flag `--timings`/`--update-timings` della Bun 1.3.14: se assenti, il runner legge/scrive il JSON manualmente (già previsto nel design: weight da file, merge self-made) e passa `--parallel` calcolato a `bun test` per file; verificare sulla doc prima di scegliere.
- I preload di bunfig restano efficaci perché cwd = package: confermare con una run minima (`--pattern vscode-mock` o un file piccolo) che il mock vscode sia attivo nei figli.
- Kill tree su POSIX: riusare la logica `ps -axo pid=,ppid=` del runner CLI (i bambini spawnati dai test, es. `git`, vanno uccisi col gruppo: `detached: true` + kill del pgid).

**Istruzioni per il subagente**

- Solo questo step: crea il runner e ricabla gli script; non toccare test, CI, o altri package.
- Modellare sul runner CLI esistente ma restare compatti: niente fast-tier batch, niente junit merge (se serve junit in futuro si aggiunge), niente TestCli build.
- Nomi single-word, `const`, early return, `Bun.file()`, `windowsHide` nei spawn.
- Non anticipare gli step di cleanup (3-8).
- Al termine: typecheck root + la verifica RAM simulata.
- Anti-loop: max 3 ripetizioni dello stesso comando sul medesimo file/argomento, poi cambiare strategia.

---

### Step 3 — Pulizia test orfani dell'estensione (cloud/notifications/FIM)

**Obiettivo**

Rimuovere dall'estensione i test e gli stub che verificano funzionalità offline-eliminate: tab Cloud (KiloSessions), remote notifications, FIM/inline-completion.

**Motivazione**

Questi test o falliscono contro la UI corrente (tab Cloud inesistente) o portano dead code (stub di metodi inesistenti) nei file più grandi della suite. La rimozione riduce anche il peso dei worker (meno import di SDK surface morta).

**File da leggere**

- `packages/kilo-vscode/tests/history-accessibility.spec.ts`
- `packages/kilo-vscode/webview-ui/src/stories/history.stories.tsx` (story "Local and cloud sources", linea ~178) e `webview-ui/src/styles/history.css` (commenti "Cloud Session List" se presenti)
- `packages/kilo-vscode/tests/unit/kilo-provider-followup.test.ts`
- `packages/kilo-vscode/tests/unit/kilo-provider-indexing-refresh.test.ts`
- `packages/kilo-vscode/tests/unit/kilo-provider-load-messages.test.ts` (zona riga 181 + test "native notification disabled state" ~riga 647)
- `packages/kilo-vscode/tests/unit/kilo-provider-session-refresh.test.ts` (riga 73)
- `packages/kilo-vscode/tests/unit/kilo-provider-route-integration.test.ts` (riga 54)
- `packages/kilo-vscode/tests/setup/vscode-mock.ts`
- `packages/kilo-vscode/src/KiloProvider.ts` (verifica `sendNotificationSettings` vs `fetchAndSendNotifications`) e il client SDK (`packages/sdk/js/src/...` route notification) per stabilire se `client.notifications` esiste ancora

**File da modificare**

- `tests/history-accessibility.spec.ts`: rimuovere il test "exposes Local and Cloud as keyboard navigable selected tabs" (blocco ~righe 77-96); gli altri 5 test restano.
- `webview-ui/src/stories/history.stories.tsx`: aggiornare/rinominare la story "Local and cloud sources" in coerenza con la UI (solo local/worktree); rimuovere riferimenti cloud dal seed della story; pulire commenti "Cloud" in `history.css` se presenti.
- I 5 file `kilo-provider-*.test.ts`: rimuovere gli stub `fetchAndSendNotifications` dal tipo `Internals` e dagli assignment; rimuovere gli stub `notifications: async () => ({ data: [] })` SOLO se la route SDK è confermata assente; valutare il test "native notification disabled state": se esercita il path di fetch remoto rimosso → eliminarlo, se è solo desktop-notification locale → tenerlo.
- `tests/setup/vscode-mock.ts`: rimuovere la classe `InlineCompletionItem` se nessun consumo in `src/` (verificare con grep `InlineCompletionItem` in `src/` e `webview-ui/`).

**Attività**

1. Grep di conferma (uno per pattern): `fetchAndSendNotifications` in `src/` (atteso: assente), `InlineCompletionItem` in `src/`+`webview-ui/` (atteso: assente), `notifications` nel SDK gen (presente/assente).
2. Applicare le rimozioni puntuali sopra.
3. Non fare refactoring: nessun cambio di struttura degli harness, nessuna unificazione dei 3 harness (fuori scope).

**Output atteso**

- Suite unit senza riferimenti a feature rimosse; spec history senza test Cloud; story coerente.

**Verifiche**

- `bun run test:unit` (dal runner dello Step 2) verde come prima dello step (stesso set di pass; i test rimossi erano o rossi o inert).
- `bun run lint` da `packages/kilo-vscode`.
- `bun run typecheck` da root (i tipi `Internals` modificati devono compiliare).
- Playwright: `history-accessibility.spec.ts` non viene eseguito da `test:unit`; se disponibile in ambiente, `bun run test:a11y`-style run mirata non è richiesta in questo step (la spec è del dominio visual/accessibility; verrà coperta dal flusso visual se abilitato).

**Compilazione**

- `bun typecheck` da root; risolvere errori.

**Rischi**

- Se `client.notifications` fosse ancora presente nella SDK regen, lo stub resta valido: in tal caso non rimuoverlo (documentare nella réponse).
- La rinomina della story potrebbe richiedere un update delle baseline LFS: verificare se `history.stories.tsx` alimenta `visual-regression.spec.ts`; se sì, segnalare (non risolvere qui) che servirà una baseline update tramite `test:visual:update` con accesso LFS.

**Istruzioni per il subagente**

- Solo rimozioni/stubs morti; zero refactor.
- Prima di ogni rimozione, il grep di conferma corrispondente (mai su base supposizione).
- Mantieni i commenti documentanti (es. "LSP removed" in permission-description) intatti.
- Typecheck al termine; anti-loop: max 3 ripetizioni dello stesso tool/file.

---

### Step 4 — Pulizia test orfani del CLI (opencode)

**Obiettivo**

Rimuovere da `packages/opencode` i test che asseriscono superfici morte (OTel default, console-ui se confermato morto) e gli artefatti residui (micro-test runner timestamped, voci stanche del duration table, ultima dipendenza di rete in project-id).

**Motivazione**

Sono i candidati di trim a basso rischio emersi dall'audit: test piccoli che proteggono code rimosso, rumore nel sharding (pesi stanchi), e l'unica chiamata DNS reale della suite CLI.

**File da leggere**

- `packages/opencode/test/kilocode/config/opentelemetry-default.test.ts`
- `packages/opencode/test/kilocode/config/console-ui.test.ts` + la definizione `Config.Info` in `packages/opencode/src/config/config.ts` (verificare se le prefs console sopravvivono)
- `packages/opencode/test/kilocode/runner-{pipe,start-order,signal,abrupt}-983452-*.test.ts` (4 file)
- `packages/opencode/script/kilocode/test-durations.json`
- `packages/opencode/script/kilocode/test-profile.ts` e `test-runner.ts` (per verificare che i 4 file non siano in profili/fast-tier)
- `packages/opencode/test/kilocode/project-id.test.ts`

**File da modificare**

- Eliminare `opentelemetry-default.test.ts` (intero file).
- Eliminare `console-ui.test.ts` SOLO se la superficie config console è confermata assente da `Config.Info`; altrimenti tenere.
- Eliminare i 4 file `runner-*-983452-*.test.ts` (verificati non referenziati).
- `script/kilocode/test-durations.json`: rimuovere le entries i cui file non esistono più (script inline o `--update-durations` dopo le eliminazioni).
- `project-id.test.ts`: sostituire i remotes `https://github.com/...` con forma scheme-only `git@example.com:org/repo` (o `ssh://git@...`) nelle ~12 occorrenze, conservando i nomi che i test asseriscono (branch/name derivati dal remote name, non dall'URL: verificare cosa assertta il test).

**Attività**

1. Verifiche di premessa (grep/read come sopra).
2. Eliminazioni + fix di `project-id.test.ts`.
3. Rigenerare/pulire `test-durations.json`.

**Output atteso**

- Suite CLI senza test per superfici morte, senza file fantasma nella duration table, e senza chiamate di rete reali.

**Verifiche**

- Da `packages/opencode`: `bun run test:ci` con pattern mirati sui file toccati (es. `bun run script/test-runner.ts project-id`) → pass.
- Full: `bun run test:ci` (oppure almeno lo shard linux 1/2 se il tempo è critico) → stesso verdict di prima.
- `bun typecheck` da root.

**Compilazione**

- `bun typecheck` da root; risolvere errori.

**Rischi**

- `project-id.test.ts` potrebbe asserire dettagli dell'URL (host/path): in tal caso mantenere un URL fittizio ma plausibile invece di scheme-only, purché senza triggerare resolve di rete (il rischio è solo DNS se git prova a contattare il remote: `git remote add` non fa rete, ma alcuni sotto-test potrebbero fare `git ls-remote` — verificare e, se presente, puntarlo a un path locale `file://`).
- I 4 micro-test potrebbero essere unici garanti di un behavior del runner (pipe/signal): leggere il contenuto (4 righe l'uno) prima di eliminare; se testano un behavior ancora vivo del test-runner, tenere e segnalarlo.

**Istruzioni per il subagente**

- Solo questo step; non toccare l'estensione né la CI.
- Ogni eliminazione preceduta dalla verifica di premessa documentata.
- Anti-loop: max 3 ripetizioni dello stesso tool/file.

---

### Step 5 — Ripristino wiring: package `schema` e job `httpapi`

**Obiettivo**

Portare in CI la suite di `packages/schema` (7 test mai eseguiti) e sanare il job `httpapi` di `test.yml` che punta a `packages/client` (rimosso dal prune).

**Motivazione**

Oggi `bun turbo test:ci --filter='!@kilocode/cli'` ignora silenziosamente `schema` (nessun task `test:ci`): la sua copertura non esiste di fatto. E lo step "Check generated client" del job httpapi fallisce su un directory assente, rendendo il job inutilizzabile (eppure è richiesto dal gate `required`).

**File da leggere**

- `packages/schema/package.json` + `packages/schema/test/**` (7 file: capire cosa testano e se richiedono dipendenze speciali)
- `script/check-test-ci.ts` (valida il scheduling dei task test:ci dei package)
- `turbo.json` (task `test:ci`)
- `.github/workflows/test.yml` (job `httpapi`, soprattutto step "Check generated client" con `working-directory: packages/client`)
- `packages/opencode/script/build.ts` (pattern guardia per package assenti, già introdotto dal prune)

**File da modificare**

- `packages/schema/package.json`: aggiungere `"test": "bun test"` (o `--timeout 30000` in coerenza coi fratelli) e `"test:ci": "bun test --timeout 30000 --reporter=junit --reporter-outfile=.artifacts/unit/junit.xml"` (allineare al pattern usato da core/tui/llm — copiare lo stile esatto da un package fratello, es. `packages/core/package.json`).
- `.github/workflows/test.yml`: nel job `httpapi`, rendere lo step "Check generated client" condizionale/guardato sull'esistenza di `packages/client` (es. `if: runner.os == 'Linux'` + check directory, o spostare il filter su `@kilocode/cli` verificando che l'exerciser non richieda il client); se l'exerciser `test:httpapi` funziona senza `packages/client`, basta disattivare lo step di check. Decisione guidata da ciò che trova il subagente leggendo lo step e il task.
- `script/check-test-ci.ts`: se valida l'elenco dei package con task `test:ci`, aggiornare l'aspettativa per includere `schema` (verificare come dichiara la lista).

**Attività**

1. Leggere i 7 test di schema: se richiedono un build o fixture esterna non disponibile, segnalarlo e comunque cablare lo script (la suite girerà in CI e mostrerà l'eventuale gap).
2. Aggiungere gli script a `packages/schema/package.json`.
3. Correggere il job httpapi.
4. Verificare `script/check-test-ci.ts` e aggiornare se necessario.

**Output atteso**

- `bun turbo test:ci --filter='!@kilocode/cli'` include schema; il job `httpapi` non fallisce più per `packages/client` assente.

**Verifiche**

- Da root: `bun turbo test:ci --filter=@kilocode/schema` (o il nome package corretto) → esegue i 7 test.
- `bun run script/check-test-ci.ts` → pass.
- `bun typecheck` da root.
- Review visiva del diff di `test.yml`: solo il job httpapi cambia.

**Compilazione**

- `bun typecheck` da root; risolvere errori.

**Rischi**

- I test di schema potrebbero fallire in CI per motivi pre-esistenti (mai girati!): in quel caso lo step deve comunque cablare lo script ma il subagente deve riportare quali test falliscono perché la decisione "fix vs skip" spetta all'utente nella revisione.
- Il filter `--filter='!@kilocode/cli'` di turbo: confermare che il nome package di schema nel lockfile sia quello atteso dal turbo filter.

**Istruzioni per il subagente**

- Solo wiring: script + workflow + guard script. Non scrivere nuovi test.
- Se il job httpapi risulta interamente privo di senso senza `packages/client` (tutti i suoi step la richiedono), segnalarlo come domanda aperta nella risposta invece di eliminarlo.
- Anti-loop: max 3 ripetizioni dello stesso tool/file.

---

### Step 6 — CI extension: timeout, cap e coerenza con il runner

**Obiettivo**

Allineare `.github/workflows/test-vscode.yml` al nuovo runner: aggiungere `timeout-minutes`, esporre gli env var di tuning (`KILO_TEST_CONCURRENCY`, `KILO_TEST_FILE_TIMEOUT`) con valori sensati per il runner blacksmith 4-vCPU, e documentare il comportamento.

**Motivazione**

Il runner ora accetta env di throttling (come il runner CLI); il workflow deve usarli per proteggere il runner 4-vCPU a RAM modesta (stesso motivo per cui `test.yml` imposta `KILO_TEST_CONCURRENCY=2` su Windows e `KILO_TEST_FILE_TIMEOUT=600000`). Senza `timeout-minutes`, un hang del runner consuma l'intera quota del job GitHub Actions (360 min default).

**File da leggere**

- `.github/workflows/test-vscode.yml`
- `.github/workflows/test.yml` (pattern env da imitare: `KILO_TEST_CONCURRENCY`, `KILO_TEST_FILE_TIMEOUT`, `timeout-minutes: 45`)
- `packages/kilo-vscode/script/run-unit-tests.ts` (dello Step 2: conferma nomi env e default)
- `script/check-workflows.ts` (confermare che non serva aggiornamento: non aggiungiamo workflow)

**File da modificare**

- `.github/workflows/test-vscode.yml`:
  - `timeout-minutes: 45` sul job `unit`
  - Sullo step "Run unit tests": env `KILO_TEST_FILE_TIMEOUT: "600000"` e, se la RAM del runner blacksmith 4-vCPU è ≤ 8GB, `KILO_TEST_CONCURRENCY: "2"` (altrimenti lasciare il cap automatico del runner); commentare la scelta come fanno i kilocode_change in `test.yml`.
  - Aggiungere marker `kilocode_change` sulle righe modificate (file condiviso con upstream? È un file Kilo-new: verificare l'intestazione `kilocode_change - new file` già presente — se il file è interamente Kilo, i marker non servono; seguire la regola AGENTS.md).

**Attività**

1. Applicare le modifiche al workflow.
2. Verificare `bun run script/check-workflows.ts` da root (l'allowlist non cambia: nessun workflow aggiunto/rimosso).

**Output atteso**

- Workflow test-vscode resiliente: timeout bounded, concurrency adattiva, file-timeout generoso come in test.yml.

**Verifiche**

- YAML valido (lint workflow se disponibile, altrimenti review).
- `bun run script/check-workflows.ts` → pass.
- `bun typecheck` da root (non tocca TS, ma costi nulli).

**Compilazione**

- Nessun impatto TS; eseguire comunque `bun typecheck` da root per completezza.

**Rischi**

- Scegliere `KILO_TEST_CONCURRENCY=2` quando il runner ha 16GB sarebbe conservativo ma sicuro; preferire il cap automatico (nessun env) se la RAM del runner è incerta: documentare nel commento.
- Il runner blacksmith non è raggiungibile da fork: su fork il job gira su ubuntu-latest (4 vCPU, RAM variabile) — il cap automatico del runner copre entrambi i casi.

**Istruzioni per il subagente**

- Solo il workflow (e al massimo un commento in PRUNE-NOTES.md se riterne utile: facoltativo).
- Non modificare altri workflow.
- Anti-loop: max 3 ripetizioni dello stesso tool/file.

---

### Step 7 — Hardening memory: cap heap e deduplica dei pesi

**Obiettivo**

Ultimi due guardrail anti-OOM: (a) limitare l'heap dei processi `bun test` figli lanciati dal runner via `NODE_OPTIONS`/`--max-old-space-size` (o equivalente Bun) così che un leak singolo uccida un worker invece della macchina; (b) rimuovere le due allocazioni multi-MiB fisse nei test agent-manager che sono picchi transitori evitabili.

**Motivazione**

Senza cap, il failure mode su container stretti è l'OOM-kill del kernel a metà suite (tutto perso). Con un cap per-worker, il failure mode diventa "un file fallisce per heap" e la suite continua. Le stringhe da 17/8 MiB replicate nei test rappresentano picchi simultanei quando quei file cadono sullo stesso worker: ridurcirle a dimensioni ragionevoli (es. 256KB-1MB, sufficienti a stressare la gate logic) abbassa il picco mantenendo la copertura.

**File da leggere**

- `packages/kilo-vscode/script/run-unit-tests.ts` (punto dove si costruisce l'env del child)
- `packages/kilo-vscode/tests/unit/agent-manager-worktree-diffs.test.ts` (riga ~116: `"x".repeat(17 * 1024 * 1024)`)
- `packages/kilo-vscode/tests/unit/agent-manager-terminal-replay.test.ts` (riga ~162: `"x".repeat(8 * 1024 * 1024 + 1)`)
- Doc bun per il flag heap corretto (https://bun.com/docs/runtime/configuration o `bun --help`): verificare se `--max-old-space-size` (via NODE_OPTIONS) vale per il JS heap di Bun; se no, usare solo il cap di RAM del runner come guardrail principale e saltare la parte (a)

**File da modificare**

- `script/run-unit-tests.ts`: aggiungere all'env del child `NODE_OPTIONS: "--max-old-space-size=2048"` (valore = budget per worker, coerente col cap di RAM) SE confermato supportato; altrimenti documentare che il guardrail è il cap di concurrency.
- I due test: ridurre le costanti a dimensioni che mantengono la semantica (leggere i test per capire cosa stressano: se la gate conta byte/char, 1MiB è più che sufficiente; se asseriscono valori assoluti legati a 17MiB, adeguare le asserzioni in modo proporzionale).

**Attività**

1. Verificare supporto heap cap nella Bun pinzata (run minimale: `bun -e 'console.log(1)'` con `NODE_OPTIONS=--max-old-space-size=512` per vedere se è onorato/silenziato).
2. Aplicare il cap nel runner (se supportato) e ridurre le allocazioni nei due test con asserzioni coerenti.

**Output atteso**

- Worker con heap bounded; picchi multi-MiB eliminati.

**Verifiche**

- `bun run test:unit` full: i due file ridotti passano; nessun nuovo failure.
- Stress: `KILO_TEST_CONCURRENCY=4 KILO_TEST_MEM_AVAILABLE_MB=4096 bun run test:unit` (simula 4 worker su 4GB) → completa senza kill del kernel (su questa macchina, se la RAM lo permette; altrimenti accettare il risultato del cap automatico).
- `bun typecheck` da root.

**Compilazione**

- `bun typecheck` da root; risolvere errori.

**Rischi**

- Se `NODE_OPTIONS` non è onorato da Bun, non forzare: il cap di concurrency resta il guardrail (come nel runner CLI che non usa heap cap).
- Riducendo le allocazioni, assicurarsi che il test continui a verificare il comportamento target (es. truncation gate, backpressure): leggere il corpo del test prima di toccare le costanti.

**Istruzioni per il subagente**

- Solo runner + 2 file test.
- Se il cap heap non è supportato, lo step degenera nella sola riduzione delle allocazioni: accettabile, documentarlo.
- Anti-loop: max 3 ripetizioni dello stesso tool/file.

---

### Step 8 — Verifica finale end-to-end e report

**Obiettivo**

Esecuzione pulita completa di tutte le suite toccate dal piano, confronto before/after (tempo, picchi, file eseguiti) e redazione del report finale.

**Motivazione**

Chiude il cerchio: dimostra che (a) i test orfani sono spariti senza perdita di copertura, (b) la suite è stabile e OOM-free sulla macchina, (c) le connessioni CI sono sane.

**File da leggere**

- Tutti i file modificati negli step precedenti (review del diff complessivo: `git diff --stat` + `git diff` per area)
- `PRUNE-NOTES.md` (sezioni "Valid commands" e "Residui volutamente online") per aggiornare la documentazione se i comandi sono cambiati (es. semantica di `test:unit`)

**File da modificare**

- `PRUNE-NOTES.md`: aggiornare la tabella "Valid commands after the prune" se `test:unit`/`test:unit:fast` hanno cambiato comando (sono ancora gli stessi nomi, quindi probabilmente basterà una nota sul runner RAM-aware); aggiungere una riga nella sezione test che descrive env `KILO_TEST_CONCURRENCY`/`KILO_TEST_FILE_TIMEOUT`/`KILO_TEST_SHARD` per l'estensione.
- Eventuali fix minori emersi dalle run finali.

**Attività**

1. Da root: `bun install --frozen-lockfile` (sanity), `bun run lint`, `bun typecheck`.
2. Da `packages/kilo-vscode`: `bun run test:unit` (full, runner nuovo) → registrare tempo tot, pass/fail, eventuale cap RAM applicato.
3. Da `packages/kilo-vscode`: `bun run compile` (prepare:cli-binary + prepare:sdk + check-types + bundle) → deve passare: garantisce che la rimozione di mock/story non abbia rotto i build.
4. Da root: `bun turbo test:ci --filter='!@kilocode/cli'` → tutti i package non-CLI (incluso schema ora wired) verdi.
5. Da `packages/opencode`: `bun run test:ci` (full o shard 1/2 + 2/2 se il tempo lo richiede) → verde; verificare che `project-id` passi senza rete.
6. Diff before/after: conteggio file test prima (baseline dello Step 1/report audit) vs dopo; elenco esatto dei file rimossi; tempi delle suite.
7. Report finale in chat: tabella riepilogo + note aperte (es. baseline LFS da rigenerare se la story history è cambiata, test schema eventualmente rotti pre-esistenti).

**Output atteso**

- Repo con suite ottimizzata, pulita e documentata; report comparativo.

**Verifiche**

- Tutti i comandi sopra escono 0 (tranne i fallimenti pre-esistenti dichiarati nel report).
- `bun run knip` da `packages/kilo-vscode` → pass (nessun export morto lasciato dalle rimozioni).
- `bun run check-kilocode-change` da `packages/kilo-vscode` → pass.

**Compilazione**

- `bun typecheck` da root come ultimo gate; risolvere eventuali errori residui.

**Rischi**

- Tempi: full CLI + full extension + turbo non-CLI possono richiedere molto; sequenziare (mai in parallelo) e usare i profili/shard dove disponibili.
- Fallimenti pre-esistenti nei test di schema (mai girati in CI): non bloccare lo step, riportarli.

**Istruzioni per il subagente**

- Questo step è quasi solo esecuzione + doc: minimizzare le modifiche di codice.
- Non introdurre fix non necessari: se qualcosa falliva già prima del piano (baseline Step 1), classificarlo come pre-esistente.
- Anti-loop: max 3 ripetizioni dello stesso tool/file; se una suite entra in loop di flake, usare il retry del runner e procedere.

## Criteri di completamento

- Tutti gli 8 step completati nell'ordine, ciascuno approvato dall'utente prima del successivo.
- Nessun test per feature rimossa (cloud/KiloSessions, remote notifications, FIM, OTel-default, console-ui se confermato) rimane in `kilo-vscode` o `opencode`.
- `test:unit` dell'estensione usa il runner RAM-aware con timings e shard; `test:unit:fast` ha un timeout; il workflow `test-vscode` ha `timeout-minutes` ed env di tuning.
- `schema` è wired in CI (`test:ci` presente ed eseguito da turbo); il job `httpapi` non fallisce più per `packages/client` assente.
- La suite CLI non ha più chiamate di rete reali (`project-id` scheme-only) e la duration table non ha voci per file eliminati.
- Ogni step termina con typecheck verde; lo Step 8 termina con lint + knip + check-kilocode-change + compile dell'estensione verdi.
- Nessuna functionality extra introdotta; nessun refactoring oltre le rimozioni puntuali previste.