# Sync `origin/main` → `leocode` — estensione VS Code offline

## Obiettivo

Integrare in `leocode` i 478 commit di `origin/main` (da `5e02825c8c` a `a486831623`, v7.5.6 → v7.5.13, 2026-08-20 → 2026-09-04) mantenendo il fork **interamente offline** e ridotto alla sola estensione VS Code + dipendenze transitive. Ogni step è eseguito da un subagente diverso, in sequenza, con compilazione obbligatoria a fine step e revisione umana prima dello step successivo.

## Analisi

### Stato attuale

- `leocode` = `11e0171659`: 10 commit locali su `main` locale (`5e02825c8c`) — prune del repo + isolamento offline.
- Upstream unico: `origin/main` (github.com/Kilo-Org/kilocode). Nessun altro remote.
- Il delta tocca: `kilo-vscode` (226 commit / ~350 file), `opencode` (106 commit / ~172 file), shared packages, CI/tooling. I prodotti pruned (jetbrains 308 file, docs 37, console 7, gateway 13, …) generano rumore add/delete che si risolve accettando la nostra cancellazione.

### Invarianti offline da preservare (verificate nel codice)

| # | Invariante | Dove |
|---|---|---|
| I1 | `KILO_DISABLE_MODELS_FETCH=true` iniettata allo spawn; flag dichiarata in `core/src/flag/flag.ts`; gate in `core/src/models-dev.ts` (`return {}`) | `kilo-vscode/src/services/cli-backend/server-manager.ts` (`resolveManagedServerEnv`) |
| I2 | Probe azzerate: `const urls = []` + `hasProbes()` in `session/network.ts`; early-return `"retry"` in `handleOffline` (`kilocode/session/processor.ts`) | senza questa coppia una ECONNREFUSED parcheggia la sessione in offline permanente |
| I3 | Catalog cut: `LOCAL_PROVIDER_IDS` (lmstudio, atomic-chat, privatemode-ai, anaconda-desktop) + `inLocalSurface(id, configuredIds)` chiamata in `provider/provider.ts`, `handlers/provider.ts`, `cli/cmd/providers.ts` (3×), `github.handler.ts`; snapshot commitato `packages/opencode/models-dev.local.json` preferito dal fetch in `packages/opencode/script/generate.ts` | il gateway non deve ricomparire nel model picker |
| I4 | Route `/media-local/*` registrate: import `MediaLocalApi` + `.addHttpApi(MediaLocalApi)` in `server/routes/instance/httpapi/api.ts`; group/handler sotto `src/kilocode/media-local/` e `src/kilocode/server/httpapi/handlers/media-local.ts` | speech-to-text e image generation verso endpoint locali |
| I5 | Env sanificate: strip prefissi `OTEL_`, `BUN_`, `NODE_OPTIONS`, 8 proxy keys, 16 provider API-key, prefissi `AWS_`/`VERTEX_`; nessun marker in questo file ⇒ re-applicazione manuale se upstream lo tocca | `server-manager.ts` |
| I6 | Workspace list **esplicita** a 22 voci nel root `package.json` (mai globs); 8 `patchedDependencies`; `test` script rifiuta l'execution da root | mai adottare il glob `packages/*` di upstream |
| I7 | Dir assenti: `kilo-gateway`, `kilo-telemetry` (+ jetbrains, docs, console, web-ui, sdk-next, session-ui, storybook, client, httpapi-codegen); zero import live di `@kilocode/kilo-gateway` in `*.ts` | upstream ha aggiunto `kilo-gateway/src/claw/*` e `src/event-service/client.ts` (dedup lint `a29fc822e8`) da respingere come cancellazioni |
| I8 | Superfici rimosse dall'estensione: `src/kiloclaw/**`, `RemoteStatusService.ts`, `MarketplacePanelProvider.ts`, `services/autocomplete/**` (gateway FIM), device-flow auth, cloud sessions, notifications | keep-deleted anche se upstream le modifica |
| I9 | Locale i18n: 4 alberi (kilo-i18n 21, webview src 21+fa+cloud-provider, agent-manager 21, ui 29) tagliati sulle chiavi online | take-ours + audit chiavi nuove upstream |
| I10 | Guard CI: 9 workflow (`beta, check-forbidden-strings, check-kilo-generated-artifacts, check-md-table-padding, codeql, test, test-vscode, typecheck, visual-regression`); allowlist hardcoded in `script/check-workflows.ts` valida (upstream NON ha aggiunto/rimosso workflow, solo modificato contenuti) | portare `script/check-kilocode-duplication.ts` + allowlist + wiring CI di upstream |

### Zone di conflitto (dal dry-run `git merge-tree`; upper bound via symmetric diff: 1015 path)

| Zona | Rischio | Strategia |
|---|---|---|
| `opencode/src/provider/**` + `kilocode/local-providers.ts` | Alto | marker vincenti (I3); integrare hunks ortogonali (request headers `2f4bc4c206`, nuovo `catalog.ts` adattato) |
| `opencode/src/session/**` (llm, prompt, processor, network, status, compaction) | Alto | marker per I2/I3; integrare drain/fork/status nuovi da upstream |
| `opencode/src/server/routes/instance/httpapi/**` + groups/handlers `kilocode/**` | Alto | API cambiata ⇒ SDK regen; respingere `groups/kilo-gateway.ts` + handler; mantenere `media-local` (I4) |
| `opencode/src/kilo-sessions/**` (instance-advertisement, remote-protocol) | Alto | keep-deleted: reintroduce superficie mobile/remote (I7) |
| `opencode/src/kilocode/{claw,event-service}/**` | Med-alto | keep-deleted (già rimossi); pulire import residui in `tool/registry.ts` |
| `opencode/src/kilocode/board/**` + tool `board.ts` (Kilo Swarm) | Med | prendere ma disaccoppiare da claw/gateway; se troppo intrecciato ⇒ rifiuto documentato |
| `kilo-vscode/src/agent-manager/**` (~32 file) | Med-alto | integrare feature nuove (base-update, PR comments, terminal activity, intro screen); unione manuale dove entrambi riscrivono |
| `kilo-vscode/webview-ui/**` (~100 file logici) | Med-alto | integrare; settings tabs riapplicare tagli offline (BrowserTab vs ExperimentalTab renaming upstream) |
| `kilo-vscode/src/services/{cli-backend,browser-automation,autocomplete}` | Alto | I1/I5 re-applicati a mano; browser automation = take theirs (setting sperimentale off di default); autocomplete keep-deleted |
| Locale (4 alberi, ~92 file) | Meccanico | take-ours + audit chiavi nuove referenziate dal codice integrato |
| `sdk/js` gen + openapi.json, core migration/schema gen | Meccanico | take theirs provvisorio → rigenerati nello step SDK |
| Root: `package.json`, `bun.lock`, `AGENTS.md`, workflow, `script/check-*` | Meccanico | unione: workspace list esplicita nostra; lockfile via `bun install` |

### Feature upstream adottabili (dentro il delta, offline-compatible)

update-worktree-from-base (`kilo-code.new.agentManager.updateFromBase`), PR conversation comments + refresh button + unresolved badges, worktree delete actions ripristinati, @ menu ranking + past-chats search, background agents (open-all toolbar, keep-running-when-main-stops, minimizable task bar), terminal activity indicator + parallel cleanup, AM intro/welcome screen, indexing race fixes, TUI About dialog + last-commit diff view, CLI run-stdin bound, session-resume import endpoint (Claude Code/Codex transcripts, letture locali), Windows worktree lock fix, browser automation panel (setting sperimentale off di default; deps `playwright-core@1.57.0`, `chromium-bidi@0.8.0`, `ws@8.21.0`).

Da rifiutare in questo ciclo (dipendono da gateway/cloud): org-level default model selection (API gateway), task-scoped shared boards se intrecciate a KiloClaw (valutazione a vista nello step merge), marketplace publishing retry (solo `script/publish.ts`, opzionale).

## Assunzioni

- L'utente approva l'integrazione "full" del delta con i rifiuti motivati sopra.
- Merge diretto su `leocode` dopo un tag di backup; nessun ramo intermedio.
- `git merge-tree --write-tree` viene eseguito fuori sandbox per confermare l'esatto set di conflitti (il dry-run disponibile usa il symmetric diff come upper bound).
- Gate di compilazione: `bun turbo typecheck` + `bun run lint` da root; `bun run test:unit` da `packages/kilo-vscode/`; `bun run compile` (prepare:cli-binary + prepare:sdk + bundle) come gate finale degli step che toccano SDK/bundle. System bun (`~/.bun/bin/bun`).
- La revisione umana dell'utente avviene tra ogni step; lo step N+1 parte solo dopo approvazione.

## Piano di implementazione

Ogni step: un subagente dedicato, autosufficiente, con contesto minimo indicato. Al termine di ogni step il subagente compila, risolve gli errori introdotti dallo step e produce un report da sottoporre all'utente.

---

### Step 0 — Documentazione della procedura di sync e skill dedicata

**Obiettivo**

Creare la base documentale usata da tutti gli step: `docs/upstream-sync.md`, skill `.kilo/skills/upstream-sync/SKILL.md`, aggiornamento di `AGENTS.md` (root) e `PRUNE-NOTES.md`.

**Motivazione**

Il processo va ripetuto a ogni update futuro; centralizzare regole/comandi/invarianti rende ogni subagente autosufficiente e il processo riproducibile.

**File da leggere**

- `AGENTS.md`, `PRUNE-NOTES.md`, `packages/kilo-vscode/AGENTS.md`
- `.kilo/skills/gh-issues/SKILL.md` (pattern strutturale di una skill)
- `package.json` (root), `script/setup-git.ts`, `script/generate.ts`, `script/check-workflows.ts`
- Le sezioni "Invarianti offline" e "Zone di conflitto" di questo piano

**File da modificare / creare**

- Creare `docs/upstream-sync.md`: pre-condizioni; comandi esatti (fetch, `git switch main && git pull --ff-only && git switch leocode`, dry-run `git merge-tree --write-tree --name-only $(git rev-parse main) leocode`, merge, `bun install`, resolve, `bun run script/generate.ts`, check, test); matrice delle invarianti I1–I10 con i comandi grep di verifica post-merge; tabella take-ours/take-theirs per categoria (locale, gen, lockfile, dirs pruned, surface online); gestione casi limite (delete/modify su legacy-migration e browser-automation-service, add/add su file nuovi under dir pruned, rename+modify); rollback (tag `pre-sync-*`); definizione di sync completo.
- Creare `.kilo/skills/upstream-sync/SKILL.md`: quando usare, input/output, checklist operativa in 10 punti, riferimenti incrociati, regole di marcatura `kilocode_change` durante la risoluzione, verifica finale (smoke GET /provider + suite).
- Modificare `AGENTS.md` (root): sezione "Sync Flow" aggiornata (aggiungere dry-run merge-tree, riferimento a `docs/upstream-sync.md` e alla skill, nota sul guard `check:duplication` da portare); eliminare la riga duplicata "kilocode_change check" (righe 18–19 identiche); "Quality Checks": aggiungere riga per il guard duplication.
- Modificare `PRUNE-NOTES.md`: nella sezione "Sync flow (the ONLY sync path)" aggiungere riferimento incrociato a `docs/upstream-sync.md` e la nota che `script/check-kilocode-duplication.ts` + allowlist vanno portati dal merge.

**Attività**

Redigere i contenuti usando i dati reali del fork (workspace list 22 voci, comandi validi dalla tabella PRUNE-NOTES, matrice residuali online già presente in PRUNE-NOTES). Verificare che ogni comando citato esista nei `package.json`.

**Output atteso**

Tre documenti coerenti; nessun file `.ts` toccato.

**Verifiche**

- `bun run script/check-md-table-padding.ts` passa sui markdown modificati.
- Nessuna parola-chiave inventata: ogni comando presente in un `package.json` o in uno script esistente.

**Compilazione**

N/A (solo markdown); eseguire comunque `bun run script/check-md-table-padding.ts` da root.

**Rischi**

Disallineamento fra i tre documenti se scritti in modo indipendente ⇒ scriverli nello stesso step come fatto qui.

**Istruzioni per il subagente**

Implementa solo questo step; non toccare codice sorgente né `package.json`. Non anticipare gli step successivi. Se hai dubbi sulla struttura di una skill, leggi quella gh-issues. Compila/verifica come indicato. Segnala nel report eventuali comandi citati che non esistono.

---

### Step 1 — Fetch, aggiornamento `main`, tag di backup, dry-run esatto, baseline verde

**Obiettivo**

Portare `main` locale su `origin/main`, congelare un tag di backup di `leocode`, produrre l'elenco ESATTO dei file in conflitto con `git merge-tree`, e registrare una baseline di compilazione/test di `leocode` pre-merge.

**Motivazione**

Tutti gli step seguenti operano sull'esatto set di conflitti; il tag protegge il rollback; la baseline distingue fallimenti preesistenti da regressioni del merge.

**File da leggere**

`docs/upstream-sync.md` (step 0), `AGENTS.md` (Sync Flow).

**File da modificare**

Nessuno (stati git + report di lavoro in `/tmp`, non committato).

**Attività**

1. `git fetch origin`
2. `git switch main && git pull --ff-only origin main && git switch leocode`
3. `git tag -f pre-sync-$(date +%Y%m%d)` su HEAD di leocode
4. `git merge-tree --write-tree --name-only $(git rev-parse main) leocode > /tmp/conflicts.txt` (fuori sandbox se necessario); salvare tree OID + elenco completo in un note file di lavoro; confrontare con la mappa zone di questo piano e annotare sorprese (rinominati, file aggiuntivi).
5. Baseline: da root `bun install --frozen-lockfile`, `bun turbo typecheck`, `bun run lint`; da `packages/kilo-vscode/` `bun run test:unit`. Registrare pass/fail per comando.

**Output atteso**

Report contenente: sha di `origin/main` integrata, nome tag, numero totale di conflitti + lista completa per area, esito baseline (eventuali fallimenti preesistenti elencati nominalmente).

**Verifiche**

`git rev-parse main` == `git rev-parse origin/main`; `git tag -l 'pre-sync-*'` non vuoto; baseline come registrato.

**Compilazione**

`bun install --frozen-lockfile` + `bun turbo typecheck` da root devono passare (passavano prima; qui è conferma). Eventuali errori di install vanno risolti prima di procedere.

**Rischi**

`bun install` può richiedere rete per dipendenze mancanti (usare system bun + cache HOME). Fallimenti test:unit preesistenti vanno dichiarati, non "risolti", in questo step.

**Istruzioni per il subagente**

Solo questo step; NON iniziare il merge. Usa system bun (`source ~/.bashrc` se `command -v bun` trova nulla). Comandi bloccati dalla sandbox: segnalarli nel report invece di deviare. Restituisci il report completo.

---

### Step 2 — Execuzione del merge e risoluzione di tutti i conflitti

**Obiettivo**

Eseguire `git merge main` su `leocode` e risolvere TUTTI i conflitti secondo la matrice di categoria, lasciando l'albero risolto (`git status` pulito dai conflict marker) ma non ancora riconciliato funzionalmente (avviene negli step 3–7). Commit del merge a fine step.

**Motivazione**

Separare la risoluzione deliberativa/meccanica dalla riconciliazione funzionale mantiene step piccoli e reviewable; le regole sono deterministiche grazie a marker + matrice.

**File da leggere**

`docs/upstream-sync.md` (matrice categorie), `PRUNE-NOTES.md` (vincoli), elenco conflitti dello step 1. Per ogni file in conflitto: versione ours (marker `kilocode_change`), theirs, sezione base zdiff3.

**File da modificare**

Solo i file in conflicto riportati da `git status`. Regole per categoria:

| Categoria | Decisione |
|---|---|
| Dir pruned (jetbrains, docs, console, web-ui, sdk-next, session-ui, storybook, client, httpapi-codegen) | Accept our deletion (`git rm` i file loro aggiunti/modificati) |
| Nuovo file upstream sotto `packages/kilo-gateway/**` (es. `src/claw/*`, `src/event-service/client.ts`) | Cancellare |
| `packages/sdk/js/**` gen + `openapi.json`; `core/src/database/migration.gen.ts` + `schema.gen.ts`; snapshot `test/tool/__snapshots__/*` | Take theirs provvisorio (rigenerati nello step 4) |
| Locale i18n (4 alberi) | Take ours; poi audit: importare SOLO le chiavi nuove upstream referenziate da codice integrato (lo fa dettagliatamente lo step 6 sui nomi esatti) |
| Root `package.json` | Unione: workspace list esplicita (22 voci) nostra + version bump + script `check:duplication` di upstream (il file `script/check-kilocode-duplication.ts` + `kilocode-duplication-allowlist.json` si prendono da theirs) |
| `bun.lock` | Take theirs come base (riconciliato nello step 3) |
| `AGENTS.md` root | Unione manuale preserving la sezione pruned/offline di leocode |
| `.github/workflows/*.yml` modificati (test.yml, smoke-test.yml, check-opencode-annotations.yml) | Take theirs, verificando che i path di trigger restino validi col set pruned (il guard `check-workflows.ts` non richiede aggiornamenti: upstream non ha cambiato l'inventario workflow) |
| `.changeset/*.md` nuovi | Cancellare (toolchain rimossa) |
| `opencode/src/provider/**` + `local-providers.ts` + `models-dev.local.json` | Marker vincenti (I3); integrare hunks ortogonali di theirs (fix request headers, `catalog.ts` nuovo adattato alla superficie locale) |
| `opencode/src/session/**` | Marker vincenti per I2/I3; integrare drain/fork/status/compaction/question di theirs |
| `opencode/src/server/routes/instance/httpapi/**` + `kilocode/server/httpapi/**` | Integrare gruppi/handler nuovi (migrate, session-resume); keep-deleted `groups/kilo-gateway.ts` + `handlers/kilo-gateway.ts` + `config-console.ts` e pulizia dei riferimenti; mantenere registrazione `MediaLocalApi` (I4) |
| `opencode/src/kilo-sessions/**` + test correlati | Keep-deleted (superficie remote/mobile) |
| `opencode/src/kilocode/{claw,event-service}/**` | Keep-deleted + pulizia import in `tool/registry.ts` e altrove |
| `opencode/src/kilocode/board/**` + `tool/board.ts` | Prendere i file; se importano moduli claw/gateway assenti, stubbare con no-op commentati `// kilocode_change - offline: <modulo> missing`; se lo coupling è troppo profondo, rifiutare board+Swarm interamente e documentarlo (decisione a vista, da segnalare nel report) |
| `opencode/src/kilocode/tool/**` (registry, task, agent-manager, browser-open, model-selection) | Integrare; mantenere overlay Kilo (notebook, agent-manager, repo-overview, repo-clone) |
| `opencode/src/effect/**`, `run-state.ts`, `event-v2-bridge.ts`, `project/vcs.ts`, `question/index.ts`, `cli/cmd/run*`, `agent/agent.ts` | Integrare (ortogonali all'offline) |
| `kilo-vscode/src/services/cli-backend/server-manager.ts` | Take theirs + RE-APPLICARE `resolveManagedServerEnv` completo (I1/I5) copiandolo da `git show <tag-pre-sync>:packages/kilo-vscode/src/services/cli-backend/server-manager.ts` |
| `kilo-vscode/src/agent-manager/**` | Integrare feature nuove; dove entrambi riscrivono lo stesso blocco (host.ts, types.ts, WorktreeManager.ts, AgentManagerProvider.ts, GitOps.ts) unione manuale guidata dai test unitari di theirs presi col merge |
| `kilo-vscode/src/kilo-provider/**` + `KiloProvider.ts` + `extension.ts` | Integrare + riapplicare rimozioni offline: keep-deleted `handlers/cloud-session.ts`, `src/kiloclaw/**`, `RemoteStatusService.ts`, `MarketplacePanelProvider.ts`, `services/autocomplete/**`; pulire union di message/case di switch/import |
| `kilo-vscode/src/services/browser-automation/**` | Take theirs (feature nuova, setting `kilo-code.new.experimental.browserAutomation` off di default) |
| `kilo-vscode/src/legacy-migration/**` | Seguire upstream (accept deletion di `migration-service.ts`, `native-mode-defaults.ts`, `provider-mapping.ts`, `tests/unit/legacy-migration/native-modes.test.ts`); adattare i riferimenti residui nostri (`handlers/migration.ts`, `legacy-types.ts`, `MigrationWizard.tsx`) |
| `kilo-vscode/package.json` | Unione: prendere command `updateFromBase`, setting browserAutomation, flip `terminalButtonDestination`, rimuovendo ciò che il fork ha tolto (deps orfane già tagliate: openai, js-tiktoken, qrcode…); deps browser (`playwright-core`, `chromium-bidi`, `ws`, `@types/ws`) prese da theirs |
| `kilo-vscode/esbuild.js` | Take theirs (bundle browser) |
| `kilo-ui/**`, `core/**`, `kilo-indexing/**`, `tui/**`, `schema/**`, altri shared | Take theirs salvo file toccati dai marker offline (pochi: `core/src/v1/config/constants.ts` comment, stub `provider-usage/cloud.ts`) |

**Output atteso**

Albero merge risolto e committato ("Merge branch 'main' into leocode"); report con: n. conflitti totali, decisioni non banali prese (con motivazione), file in cui serve follow-up (lista per gli step 3–7), eventuale rifiuto di board/Swarm.

**Verifiche**

`git status` senza conflict marker residui (`grep -rn "<<<<<<<" packages/ | wc -l` == 0); `git log -1` mostra il merge commit.

**Compilazione**

A questo step la compilazione PUÒ essere rossa (è previsto: la riconciliazione arriva negli step 3–7). Il subagente deve comunque eseguire `bun turbo typecheck` e allegare l'elenco completo degli errori al report, così gli step successivi partono da una lista nota. È l'unica eccezione alla regola "compilabile a fine step", esplicitamente prevista dal piano.

**Rischi**

Conflitti delete/modify mal risolti (prendere theirs su un file che noi abbiamo cancellato) risuscitano superficie online ⇒ rivedere nominalmente le categorie "keep-deleted". Rinominati (es. `kilo-sessions` → …) possono confondere il merge ⇒ verificare `git status` per "deleted by us/them".

**Istruzioni per il subagente**

Implementa solo questo step. Rispetta la matrice sopra; dove la matrice tace, usa i marker `kilocode_change` (la porzione marcata vince) e in assenza di marker preferisci la versione che mantiene l'applicazione offline. Non fare refactoring extra, non aggiungere feature. Usare WebFetch/MCP per consultare documentazione upstream se il comportamento di una feature integrata non è chiaro dal codice. Compila con `bun turbo typecheck` (attese rosse accettabili, elenco errori nel report). Restituisci il report completo.

---

### Step 3 — `bun install` e riconciliazione lockfile/dipendenze

**Obiettivo**

Riconciliare `bun.lock` e i `package.json` post-merge, portando l'install a verde con la workspace list esplicita intatta.

**Motivazione**

Il lockfile take-theirs dello step 2 conosce pacchetti pruned (kilo-gateway ecc.); `bun install` con la workspace list esplicita lo riduce correttamente e valida gli 8 `patchedDependencies` contro `patches/`.

**File da leggere**

Root `package.json` (workspaces, patchedDependencies), `patches/` (nomi file), `docs/upstream-sync.md`.

**File da modificare**

`bun.lock` (regenerato), eventualmente `packages/*/package.json` se `bun install` segnala dipendenze orfane da rimuovere (es. `@kilocode/kilo-gateway` se reintrodotto da un package.json preso da theirs).

**Attività**

1. Da root: `bun install` (non frozen: il lock va rigenerato).
2. Verificare che `packages/kilo-gateway`/`kilo-telemetry` NON siano state riacquistate come directory (non sono nella workspace list: non dovrebbero).
3. Se errori "patched dependency X not found": controllare che `patches/<nome>` esista per ogni voce di `patchedDependencies`; se upstream ha cambiato versione di un pacchetto patchato, aggiornare la voce `patchedDependencies` alla nuova versione e, se il patch non applica più, ri-crearla (segnalare nel report se succede).
4. Grep per import live di `@kilocode/kilo-gateway` in `packages/**/*.ts`: devono restare zero (solo commenti/stringhe nei test).
5. `bun turbo typecheck` — raccogliere gli errori residui per lo step 4.

**Output atteso**

Install verde; report con: diff riassunto del lockfile (pacchetti entrati/usciti), eventuale fix applied ai patches, lista errori typecheck residui.

**Verifiche**

`bun install --frozen-lockfile` riesegue a verde (lock coerente); workspace list root invariata a 22 voci.

**Compilazione**

`bun turbo typecheck` resta probabilmente rosso (atteso); errori catalogati nel report.

**Rischi**

Patch che non applicano sulle nuove versioni ⇒ decisione da segnalare all'utente (possibile ritocco del file in `patches/`).

**Istruzioni per il subagente**

Solo questo step. Non modificare codice sorgente (solo lockfile/package.json/patches). System bun. Report completo alla fine.

---

### Step 4 — Rigenerazione SDK/OpenAPI e migrazioni DB

**Obiettivo**

Rigenerare `packages/sdk/js` (gen + openapi.json) e i generator `core` (migration.gen.ts, schema.gen.ts) dallo stato post-merge, verificando che la superficie offline (route `/media-local/*`, assenza di namespace `kilo`/`telemetry`/share) sopravviva.

**Motivazione**

Gli step 2–3 hanno preso le versioni generate di theirs; la rigenerazione dalle nostre fonti (con route media-local e gruppi gateway rimossi) le riporta sulla superficie corretta. Le nuove migrazioni DB di upstream (board) vanno validate.

**File da leggere**

`packages/opencode/script/generate.ts` (preferenza snapshot `models-dev.local.json`), `packages/sdk/js/script/build.ts`, `packages/core/src/database/**` (nuove migrazioni upstream tipo `20260828074139_kilocode_board.ts`).

**File da modificare**

`packages/sdk/js/src/gen/**`, `packages/sdk/js/src/v2/gen/**`, `packages/sdk/openapi.json`, `packages/core/src/database/migration.gen.ts`, `schema.gen.ts` (tutti output di generazione).

**Attività**

1. Da root: `bun run script/generate.ts` (shim che chiama `packages/sdk/js/script/build.ts` + `packages/opencode` generate).
2. Verificare nell'OpenAPI generato: presente `/media-local/*`; ASSENTI i gruppi `kilo`, `telemetry`, share/unshare, upgrade, console.
3. Verificare che il client SDK esporra `client.mediaLocal.*` e il getter legacy `client.kilo` (namespace vuoto) per compatibilità dei call site.
4. Ispezionare le nuove migrazioni DB di upstream: se la migrazione `kilocode_board` dipende da moduli claw/gateway assenti, disattivarla/adattarla (marcare `kilocode_change`) oppure rifiutarla se board è stata rifiutata nello step 2.
5. `bun turbo typecheck` — catalogare errori residui.

**Output atteso**

File generati aggiornati e committati; report con: route presenti/assenti nell'OpenAPI, esito sulla migrazione board, lista errori typecheck residui.

**Verifiche**

`grep -c "media-local" packages/sdk/openapi.json` > 0; `grep -c '"kilo"' packages/sdk/openapi.json` coerente con l'assenza del gruppo; typecheck progressivamente meno rosso dello step 3.

**Compilazione**

`bun turbo typecheck` da root; errori residui catalogati (attesi fino allo step 5–6).

**Rischi**

Se il build SDK fallisce per un group rimosso a metà (es. handler migrate che importa tipi gateway), il fix è nel file sorgente corrispondente → segnalare quale file serve ancora pulizia (lo step 5 lo copre).

**Istruzioni per il subagente**

Solo questo step. Non editare a mano i file gen (sono output). Se il generate fallisce, diagnosticare e correggere il MINIMO sorgente necessario (handler/group) marcando con `kilocode_change`, poi ri-eseguire. Report completo.

---

### Step 5 — Pulizia residua della superficie online e riconciliazione logica

**Obiettivo**

Chiusura della riconciliazione: eliminare i residui di superficie online riappariti col merge (import morti di moduli gateway/claw/kilo-sessions, case di switch, route orfane, config keys rimosse) e portare `bun turbo typecheck` + `bun run lint` a verde su tutta la tree.

**Motivazione**

Dopo merge+SDK, restano tipicamente import/case che referenziano moduli cancellati (I7/I8) o flag di config che upstream ha reintrodotto (web_search, lsp, share, EXA/PARALLEL) e che il nostro schema non ha più.

**File da leggere**

Lista errori typecheck dello step 4; `packages/opencode/src/config/config.ts` + `kilocode/config/**` (schema flag); `packages/opencode/src/tool/registry.ts`; `packages/opencode/src/kilocode/bootstrap.ts` + `effect/app-runtime.ts`; `packages/kilo-vscode/src/extension.ts` + `KiloProvider.ts` (message unions).

**File da modificare**

Quelli indicati dagli errori: tipicamente `tool/registry.ts`, `bootstrap.ts`, `app-runtime.ts`, `httpapi/server.ts`, `config.ts`, `plugin/index.ts` + `plugin/provider/*`, `session/llm/native-request.ts`, `provider/transform.ts`, `KiloProvider.ts`, `extension.ts`, handlers orfani.

**Attività**

1. Iterare sugli errori typecheck: per ciascuno, decidere keep-ours (riapplicare il taglio offline marcato) o integrazione (adattare il codice nuovo di theirs alla superficie ridotta). Marcare ogni modifica Kilo in file condivisi con `kilocode_change`.
2. Verificare punto per punto le invarianti I1–I10 con i comandi grep della matrice (report step 0 / docs/upstream-sync.md): flag models-fetch, probe list, LOCAL_PROVIDER_IDS + call sites, MediaLocalApi registration, workspace list, dir assenti, env stripping, guard CI.
3. `bun turbo typecheck` fino a verde; `bun run lint` da root fino a verde.
4. `bun run script/check-workflows.ts` da root (valida l'allowlist workflow).
5. Se upstream ha reintrodotto flag di config (es. `web_search`, `lsp`, `share`) usati da codice nuovo: rimuovere l'uso o re-includerli come no-op gated, a seconda del caso, con marker.

**Output atteso**

Tree con typecheck + lint verdi; report con: n. file toccati, invarianti I1–I10 verificate una per una (pass/fail con evidenza grep), flag/config re-introdotti e come sono stati trattati.

**Verifiche**

`bun turbo typecheck` exit 0; `bun run lint` exit 0; `bun run script/check-workflows.ts` exit 0; checklist invarianti completa nel report.

**Compilazione**

Typecheck + lint verdi obbligatori a fine step (eccezione della doppia-step conclusa).

**Rischi**

Un hunk di theirs che assume un servizio gateway attivo in runtime (non solo tipo) può passare typecheck e fallire a runtime ⇒ lo step 7 lo copre con test + smoke.

**Istruzioni per il subagente**

Solo questo step. Minimizzare i fix: preferire tagli/no-op rispetto a refactor. Ogni modifica in file condiviso opencode porta marker `kilocode_change`. Non introdurre dipendenze nuove. Se un errore richiede una decisione di prodotto (feature gateway necessaria?), fermati e segnalala nel report invece di inventare. Verifica FINALE: typecheck + lint + check-workflows verdi.

---

### Step 6 — Audit locale i18n e chiavi orfane

**Obiettivo**

Riconciliare i 4 alberi locale (take-ours dello step 2) aggiungendo le chiavi NUOVE upstream realmente referenziate dal codice integrato e rimuovendo le chiavi divenute orfane; portare a verde i test di protezione i18n.

**Motivazione**

Le translate sono chiamate staticamente dal codice: chiavi nuove senza traduzione rompono i test `i18n-unused-keys` / completeness; chiavi orfane residue (profile.*, deviceAuth.*, session.cloud*, topBar marketplace/claw) violano la chiusura offline.

**File da leggere**

`packages/kilo-vscode/tests/unit/i18n-unused-keys.test.ts` (protection list), `packages/kilo-i18n/src/**` (21 locale), `packages/kilo-vscode/webview-ui/src/i18n/**`, `packages/kilo-vscode/webview-ui/agent-manager/i18n/**`, `packages/ui/src/i18n/**` (se presente nel workspace).

**File da modificare**

I file locale in conflitto/non ancora riconciliati + la protection list del test se le famiglie di chiavi orfane sono cambiate.

**Attività**

1. Eseguire da `packages/kilo-vscode/`: `bun test tests/unit/i18n-unused-keys.test.ts` (e equivalenti in `packages/kilo-i18n` se presente) per ottenere la lista esatta di chiavi mancanti/orfane.
2. Per ogni chiave mancante: prendere la traduzione dall'EN di upstream e propagare alle altre lingue usando l'EN come fallback consentito (pattern esistente nei file locale).
3. Per ogni famiglia orfana confermata (nessun reference nel codice post-merge): rimuovere da tutti e 21 i file, aggiornando la protection list del test.
4. Verificare che nessuna chiave referencing gateway/claw/marketplace/cloud sia tornata viva.

**Output atteso**

Test i18n verdi; report con: chiavi aggiunte (n.), famiglie rimosse (n.), locale EN di riferimento usato.

**Verifiche**

`bun test tests/unit/i18n-unused-keys.test.ts` verde da `packages/kilo-vscode/`; `bun turbo typecheck` resta verde (le chiavi sono stringhe, ma alcuni componenti fanno lookup tipizzato).

**Compilazione**

`bun turbo typecheck` da root a fine step (deve restare verde).

**Rischi**

Traduzioni parziali upstream (alcune lingue incomplete) ⇒ usare EN-fallback come già fatto nelle chiusure offline precedenti.

**Istruzioni per il subagente**

Solo questo step. Non toccare componenti (solo file locale + protection list del test). Se una chiave manca perché un componente nuovo di upstream non è ancora integrato (es. browser panel), aggiungere comunque la chiave (costo zero) per tenere i test verdi. Report completo.

---

### Step 7 — Suite test completa, guard CI, smoke offline e gate finale

**Obiettivo**

Validazione completa: test unit extension, typecheck/lint/knip/format, guard CI, e uno smoke test offline che dimostra l'assenza del gateway nel modello picker e il funzionamento contro un provider OpenAI-compatibile locale.

**Motivazione**

È il gate che dichiara il sync completo: tutto ciò che gli step precedenti hanno assemblato deve funzionare insieme, offline.

**File da leggere**

`docs/upstream-sync.md` (sezione verifica finale), `packages/kilo-vscode/package.json` (script), `PRUNE-NOTES.md` (matrice residuali online).

**File da modificare**

Eventuali fix minori emersi dai test (limitati a bug di integrazione introdotti dal merge, marcati `kilocode_change` se in file condivisi). Nessun refactoring.

**Attività**

1. Da `packages/kilo-vscode/`: `bun run test:unit` (runner anti-OOM; timeout globali già configurati).
2. Da `packages/kilo-vscode/`: `bun run lint`, `bun run format:check`, `bun run knip`, `bun run check-kilocode-change`.
3. Da root: `bun run script/check-md-table-padding.ts`, `bun run script/check-forbidden-strings.ts`, `bun run script/check-kilo-generated-artifacts.ts`, `bun run script/check-workflows.ts`, `bun run script/check-opencode-promise-facades.ts`, `bun run script/check-kilocode-duplication.ts` (nuovo guard portato dal merge) + `bun test packages/script/tests/check-kilocode-duplication.test.ts` se presente.
4. Smoke offline: avviare il backend con `bun dev serve` da `packages/opencode/`; con `curl` autenticato: `GET /provider` deve mostrare SOLO provider locali/configurati (niente `kilo`, niente gateway); verificare presenza delle route `/media-local/*` (404→ok se endpoint non configurato, ma la route esiste); verificare che `GET /config` non esponga flag online rimossi.
5. Da `packages/kilo-vscode/`: `bun run compile` (prepare:cli-binary + prepare:sdk + bundle) come gate finale di packaging.
6. Se test falliscono: fix minimo, ri-esecuzione del singolo test (`bun test ./path/file.test.ts`), poi suite completa.

**Output atteso**

Report finale del sync: esito di ogni comando (verde/rosso+fix), risultato dello smoke (output curl di /provider), eventuale lista di follow-up non bloccanti.

**Verifiche**

Tutti i comandi della lista verdi; smoke: `kilo` assente da `GET /provider`; compile produce `dist/extension.js` + `dist/webview.js` + `dist/agent-manager.js`.

**Compilazione**

`bun run compile` da `packages/kilo-vscode/` verde (gate definitivo).

**Rischi**

Test flaky noti del runner (backoff OOM reattivo) ⇒ affidarsi al meccanismo built-in; fallimenti di test integration (richiedono Codium) NON bloccano questo step (restano a `test:integration` manuale).

**Istruzioni per il subagente**

Solo questo step. I fix permessi sono limitati a far passare i comandi sopra senza cambiare comportamento di prodotto; ogni fix in file condiviso opencode porta marker. Se emerge un problema di prodotto (non di build), NON rifattorizzare: documentalo nel report come follow-up. Restituisci il report finale completo.

---

### Step 8 — Changelog, note di rilascio e chiusura documentale del sync

**Obiettivo**

Registrare l'evento di sync: entry in `packages/kilo-vscode/CHANGELOG.md`, aggiornamento `PRUNE-NOTES.md` (eventuali nuove dead-code note, updated residual matrix se cambia qualcosa), eventuale aggiornamento della version dell'estensione coerente con upstream (v7.5.13), e commit di chiusura.

**Motivazione**

Chiude il ciclo documentale: il changelog user-facing, le note tecniche per futuri sync, e la coerenza di versione.

**File da leggere**

`packages/kilo-vscode/CHANGELOG.md` (formato entry esistente), `PRUNE-NOTES.md`, `docs/upstream-sync.md`, report degli step 2 e 7 (decisioni di rifiuto/adoption da documentare).

**File da modificare**

`packages/kilo-vscode/CHANGELOG.md` (nuova entry: feature adottate da upstream v7.5.7→v7.5.13, note offline invariate), `PRUNE-NOTES.md` (sezione "Done" aggiornata con questo sync + eventuali nuove voci dead-code/kept-with-reason emerse negli step 2/5), `packages/kilo-vscode/package.json` + root `package.json` version field SE il merge li ha già aggiornati a 7.5.13 (verificare coerenza, non forzare).

**Attività**

1. Redigere l'entry CHANGELOG seguendo il formato esistente (sezioni Features/Fixes), elencando le feature upstream adottate (AM base-update, PR comments, background agents, browser panel sperimentale, @ menu ranking, TUI about/last-commit, session-resume import).
2. Aggiornare PRUNE-NOTES: data dello sync, sha upstream integrato, liste aggiornate (board/Swarm adottati o rifiutati, eventuale stato della migrazione DB board).
3. Coerenza versioni: verificare che root `package.json` e `packages/kilo-vscode/package.json` riportino la stessa versione (quella portata dal merge).
4. Commit di chiusura: `chore(vscode): sync upstream v7.5.13 into offline leocode fork`.

**Output atteso**

Commit di chiusura; report: hash commit, riepilogo 1 pagina dello stato finale del fork.

**Verifiche**

`bun run script/check-md-table-padding.ts` sui md modificati; `git log -3` mostra merge + closure; versione coerente tra i due package.json.

**Compilazione**

N/A (markdown/versioni); esecuzione veloce `bun turbo typecheck` per sicurezza dato il cambio di versione (di solito inerte).

**Rischi**

Version mismatch tra root e vscode se il merge ha aggiornato solo uno ⇒ allineare nel commit di chiusura.

**Istruzioni per il subagente**

Solo questo step. Non toccare codice sorgente. Le entry changelog devono descrivere cosa cambia per l'utente finale, non il processo di merge. Report finale conciso.

---

## Criteri di completamento

- Tutti gli step 0–8 completati, ciascuno approvato dall'utente prima dello step successivo.
- Ogni step termina con codebase compilabile, eccetto lo step 2 (merge) la cui riconciliazione è completata nello step 5 — dipendenza esplicita a due step prevista dal piano.
- Invarianti I1–I10 verificate con evidenza (report step 5 + smoke step 7).
- `origin/main` completamente integrato: `git rev-list --count leocode..origin/main` == 0.
- Nessuna funzionalità online riattivata: gateway/claw/marketplace/cloud/telemetry assenti da runtime e type surface.
- Test unit, guard CI, compile e smoke offline verdi (step 7).
- Documentazione (docs/upstream-sync.md, skill, AGENTS.md, PRUNE-NOTES, CHANGELOG) aggiornata e coerente.