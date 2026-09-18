# Upstream sync — procedura completa (`origin/main` → `leocode`)

Procedura di riferimento per ogni sync del fork offline verso upstream. È la fonte operativa usata da tutti gli step del piano (`.kilo/plans/…-leocode-upstream-sync-plan.md`) e dalla skill `.kilo/skills/upstream-sync/SKILL.md`; i vincoli strutturali sono in `PRUNE-NOTES.md`.

## Pre-condizioni

| Condizione | Verifica |
|---|---|
| Branch corrente | `git branch --show-current` deve restituire `leocode` (o essere su un worktree di `leocode`). Il ramo `main` locale esiste già nel repo. |
| Remote | Solo `origin` = https://github.com/Kilo-Org/kilocode/ (`git remote -v`). Nessun altro remote: non c'è più un `upstream` separato. |
| Bun | System bun (`~/.bun/bin/bun`). Se `command -v bun` non trova nulla, eseguire prima `source ~/.bashrc` nello stesso shell. Mai usare podman/contenitori per il tooling. |
| Albero pulito | `git status` senza modifiche non committate (il merge si fa su HEAD). I file di lavoro vanno in `/tmp`, non committati. |
| Postinstall | `bun install` esegue `script/setup-git.ts` che imposta `merge.conflictStyle=zdiff3` a livello repo (conflitti con sezione base `|||||||` leggibile); se hai sovrascritto `merge.conflictStyle` nella config utente, quella di repo ha comunque precedenza. |

## Comandi esatti

```bash
# 1. Aggiornare main locale da origin
git fetch origin
git switch main && git pull --ff-only origin main && git switch leocode

# 2. Tag di backup sul HEAD pre-merge di leocode
git tag -f pre-sync-$(date +%Y%m%d)

# 3. Dry-run: elenco ESATTO dei conflitti senza toccare l'albero
#    (può richiedere esecuzione fuori sandbox; salvare output + tree OID)
git merge-tree --write-tree --name-only $(git rev-parse main) leocode > /tmp/conflicts.txt   # riga 1 = OID della tree risultante, resto = path in conflitto (unici)

# 4. Merge reale
git merge main

# 5. Riconciliazione dipendenze (lockfile take-theirs ridotto alla workspace list esplicita)
bun install

# 6. Risolvere i conflitti secondo la matrice qui sotto (marker kilocode_change vincenti)

# 7. Rigenerazione SDK/OpenAPI + snapshot modelli (solo se la superficie server è cambiata;
#    script/generate.ts rigenera packages/sdk/js e packages/sdk/openapi.json, e preferisce lo
#    snapshot committo models-dev.local.json rispetto al fetch da models.dev)
bun run script/generate.ts

# 8. Check (da root)
bun turbo typecheck
bun run lint
bun run script/check-workflows.ts
bun test packages/script/tests/check-kilocode-duplication.test.ts   # se presente post-merge (nuovo guard portato dal merge)

# 9. Test estensione (MAI `bun test` da root: lo script di root esce con codice 1)
cd packages/kilo-vscode && bun run test:unit
```

Il gate finale di packaging resta `bun run compile` da `packages/kilo-vscode/` (prepare:cli-binary + prepare:sdk + bundle), da eseguire quando il sync tocca SDK o bundle.

Approccio alla risoluzione: risolvere conflitto per conflitto seguendo la matrice take-ours/take-theirs; dove la matrice tace, la porzione marcata `kilocode_change` vince e, in assenza di marker, preferire la versione che mantiene l'applicazione offline. Non fare refactoring extra durante la risoluzione.

### Matrice invarianti I1–I10 e verifica post-merge

Ogni invariante va ri-verificata con grep dopo il merge (i path sono relativi a root):

| # | Invariante | Verifica post-merge |
|---|---|---|
| I1 | `KILO_DISABLE_MODELS_FETCH=true` iniettata allo spawn del backend; flag dichiarata in `packages/core/src/flag/flag.ts` e gate in `core/src/models-dev.ts` | `grep -n 'KILO_DISABLE_MODELS_FETCH' packages/kilo-vscode/src/services/cli-backend/server-manager.ts` — deve mostrare l'iniezione in `resolveManagedServerEnv` |
| I2 | Probe azzerate: `const urls = []` in `session/network.ts` + early-return `"retry"` in `handleOffline` (`kilocode/session/processor.ts`) — senza questa coppia una ECONNREFUSED parcheggia la sessione in offline permanente | `grep -n 'const urls = \[\]' packages/opencode/src/session/network.ts` e `grep -n '"retry"' packages/opencode/src/kilocode/session/processor.ts` |
| I3 | Catalog cut: `LOCAL_PROVIDER_IDS` (lmstudio, atomic-chat, privatemode-ai, anaconda-desktop) via `inLocalSurface(id, configuredIds)`; snapshot committo `packages/opencode/models-dev.local.json` preferito dal fetch (`local-providers.ts` vive in `src/kilocode/` dopo il rename upstream v7.7.4 — stesso path usato dal guard `check-offline-invariants.ts`) | `grep -rn 'LOCAL_PROVIDER_IDS\|inLocalSurface' packages/opencode/src/kilocode/local-providers.ts packages/opencode/src/provider/provider.ts packages/opencode/src/provider/models.ts packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts packages/opencode/src/cli/cmd/providers.ts packages/opencode/src/cli/cmd/github.handler.ts` e `grep -n 'models-dev.local.json' packages/opencode/script/generate.ts` |
| I4 | Route `/media-local/*` registrate: import `MediaLocalApi` + `.addHttpApi(MediaLocalApi)` in `server/routes/instance/httpapi/api.ts`; group/handler sotto `src/kilocode/media-local/` e `src/kilocode/server/httpapi/handlers/media-local.ts` | `grep -n 'MediaLocalApi' packages/opencode/src/server/routes/instance/httpapi/api.ts` (due hit attese: import + registrazione) |
| I5 | Env sanificate allo spawn: strip prefissi `OTEL_`, `BUN_`, `NODE_OPTIONS`, proxy keys, provider API-key, prefissi `AWS_`/`VERTEX_`; nessun marker in quel file ⇒ re-applicazione manuale se upstream tocca `server-manager.ts` | `grep -n "startsWith(\"OTEL_\")\|startsWith(\"BUN_\")\|\"NODE_OPTIONS\"" packages/kilo-vscode/src/services/cli-backend/server-manager.ts` |
| I6 | Workspace list **esplicita** a 22 voci nel root `package.json` (mai globs); 8 `patchedDependencies`; `test` rifiuta l'execution da root | `bun -e 'console.log(require("./package.json").workspaces.packages.length)'` deve stampare `22`; `grep -c '"packages/\*"' package.json` deve dare `0` |
| I7 | Dir assenti: `kilo-gateway`, `kilo-telemetry` (+ jetbrains, docs, console, web-ui, sdk-next, session-ui, storybook, client, httpapi-codegen); zero import live di `@kilocode/kilo-gateway` in `*.ts` | `ls packages/kilo-gateway packages/kilo-telemetry` deve fallire; `grep -rln '@kilocode/kilo-gateway' packages --include='*.ts'` deve restituire solo commenti/stringhe, mai import operativi |
| I8 | Superfici rimosse dall'estensione: `src/kiloclaw/**`, `RemoteStatusService.ts`, `MarketplacePanelProvider.ts`, `services/autocomplete/**` (gateway FIM), device-flow auth, cloud sessions, notifications | `ls packages/kilo-vscode/src/kiloclaw packages/kilo-vscode/src/RemoteStatusService.ts packages/kilo-vscode/src/MarketplacePanelProvider.ts packages/kilo-vscode/src/services/autocomplete` deve fallire (keep-deleted anche se upstream li modifica) |
| I9 | Locale i18n: 4 alberi (kilo-i18n, webview src, agent-manager, ui) tagliati sulle chiavi online | `bun test tests/unit/i18n-unused-keys.test.ts` da `packages/kilo-vscode/`; audit delle chiavi nuove upstream referenziate dal codice integrato. Il guard `check-offline-invariants.ts` verifica l'insieme automatizzabile più forte (esistenza degli alberi + di ogni `en.ts` e della test); il taglio per-chiave resta delegato alla test stessa |
| I10 | Guard CI: 10 workflow allowlistati in `script/check-workflows.ts`; guard duplication `script/check-kilocode-duplication.ts` + allowlist portati dal merge | `bun run script/check-workflows.ts` da root (exit 0); presenza di `script/check-kilocode-duplication.ts` e della sua allowlist post-merge |

### Tabella take-ours / take-theirs per categoria

| Categoria | Decisione | Note |
|---|---|---|
| Dir pruned (jetbrains, docs, console, web-ui, sdk-next, session-ui, storybook, client, httpapi-codegen) | take-ours (resteranno cancellate) | Accept our deletion: `git rm` i file aggiunti/modificati da loro sotto quei path |
| Nuovo file upstream sotto `packages/kilo-gateway/**` (es. `src/claw/*`, `src/event-service/client.ts`) | take-ours (cancellare) | Il gateway non può ricomparire |
| `packages/sdk/js/**` gen + `packages/sdk/openapi.json`; `core/src/database/migration.gen.ts` + `schema.gen.ts`; snapshot `test/tool/__snapshots__/*` | take-theirs provvisorio | Vengono rigenerati da `bun run script/generate.ts` dallo stato post-merge |
| Locale i18n (4 alberi, ~92 file) | take-ours | Poi audit: importare SOLO le chiavi nuove upstream realmente referenziate dal codice integrato |
| Root `package.json` | Unione | Workspace list esplicita nostra (22 voci, mai `packages/*`), version bump, script `check:duplication` di upstream; `script/check-kilocode-duplication.ts` + `kilocode-duplication-allowlist.json` vengono presi da theirs |
| `bun.lock` | take-theirs come base | Riconciliato da `bun install` contro la workspace list esplicita |
| `AGENTS.md` root | Unione manuale | Preservare la sezione pruned/offline di leocode |
| `.github/workflows/*.yml` modificati (test.yml, smoke-test.yml, check-opencode-annotations.yml) | take-theirs | Verificare che i path trigger restino validi col set pruned; l'allowlist di `script/check-workflows.ts` non richiede aggiornamenti se l'inventario workflow non cambia |
| `.changeset/*.md` nuovi | Cancellare | La toolchain changeset è rimossa |
| `opencode/src/provider/**` + `local-providers.ts` (dopo v7.7.4 rinominata in `src/kilocode/local-providers.ts`) + `models-dev.local.json` | Marker vincenti (I3) | Integrare gli hunks ortogonali di theirs (fix request headers, eventuale nuovo `catalog.ts` adattato alla superficie locale) |
| `opencode/src/session/**` | Marker vincenti per I2/I3 | Integrare drain/fork/status/compaction/question di theirs |
| `opencode/src/server/routes/instance/httpapi/**` + `kilocode/server/httpapi/**` | Integrare | Gruppi/handler nuovi (migrate, session-resume); keep-deleted `groups/kilo-gateway.ts` + handler correlati; mantenere la registrazione `MediaLocalApi` (I4) |
| `opencode/src/kilo-sessions/**` + test correlati | keep-deleted | Reintrodurrebbe la superficie mobile/remote (I7) |
| `opencode/src/kilocode/{claw,event-service}/**` | keep-deleted | Già rimossi; pulire import residui in `tool/registry.ts` |
| `kilo-vscode/src/services/cli-backend/server-manager.ts` | take-theirs + RE-APPLICARE `resolveManagedServerEnv` (I1/I5) | Copiare la funzione da `git show <tag-pre-sync>:packages/kilo-vscode/src/services/cli-backend/server-manager.ts` |
| `kilo-vscode/src/agent-manager/**` | Integrare | Feature nuove (base-update, PR comments, terminal activity, intro screen); unione manuale dove entrambi riscrivono lo stesso blocco |
| `kilo-vscode/src/kilo-provider/**` + `KiloProvider.ts` + `extension.ts` | Integrare + riapplicare rimozioni offline | Keep-deleted `handlers/cloud-session.ts`, `src/kiloclaw/**`, `RemoteStatusService.ts`, `MarketplacePanelProvider.ts`, `services/autocomplete/**`; pulire union/case/import |
| `kilo-vscode/src/services/browser-automation/**` | take-theirs | Feature nuova, setting sperimentale off di default |
| `kilo-vscode/src/legacy-migration/**` | take-theirs (accept deletion di `migration-service.ts`, `native-mode-defaults.ts`, `provider-mapping.ts` e relativo test) | Adattare i riferimenti residui nostri (`handlers/migration.ts`, `legacy-types.ts`, `MigrationWizard.tsx`) |
| `kilo-vscode/package.json` | Unione | Command `updateFromBase`, setting browserAutomation, flip `terminalButtonDestination`; deps browser (`playwright-core`, `chromium-bidi`, `ws`, `@types/ws`) da theirs; rimuovere ciò che il fork ha tolto |
| `kilo-vscode/esbuild.js` | take-theirs | Bundle browser |
| `kilo-ui/**`, `core/**`, `kilo-indexing/**`, `tui/**`, `schema/**`, altri shared | take-theirs | Salvo i pochi file toccati dai marker offline |

### Casi limite

| Caso | Gestione |
|---|---|
| Delete/modify su `kilo-vscode/src/legacy-migration/**` | Noi abbiamo cancellato i file, upstream li ha modificati: accettare la cancellazione (`git rm`) e adattare i riferimenti residui nostri |
| Delete/modify su `kilo-vscode/src/services/browser-automation-service*` | Take-theirs: è superficie nuova upstream (setting sperimentale off di default) |
| Add/add su file nuovi under dir pruned (es. `packages/kilo-jetbrains/**`, `packages/docs/**`) | Accettare la nostra cancellazione: `git rm` il file; la dir pruned non rientra nella workspace list |
| Rename+modify (es. rinominati upstream tipo `kilo-sessions` → …) | Verificare `git status` per "deleted by us/them" e decidere nominalmente: keep-deleted se reintroduce superficie online, integrare se ortogonale all'offline |

## Rollback

Il tag `pre-sync-*` congela il HEAD di `leocode` prima del merge:

```bash
# Annulla il merge commit appena creato (lavoro non ancora riconciliato)
git merge --abort          # se il merge è ancora in corso

# Oppure, dopo aver commitato il merge risolto ma prima della riconciliazione funzionale:
git reset --hard pre-sync-YYYYMMDD
git tag -d pre-sync-YYYYMMDD    # opzionale, solo se si vuole ripartire da zero
```

Dopo un rollback completo, ripetere il dry-run `git merge-tree` per ri-verificare l'elenco conflitti prima di ritentare. Il tag non viene mai spinto; è locale.

## Definizione di sync completo

Un sync è completo quando:

- Gli step 0–8 del piano sono completati, ciascuno approvato dall'utente prima dello step successivo.
- Ogni step termina con codebase compilabile, eccetto lo step merge (step 2) la cui riconciliazione è completata nello step 5 — dipendenza esplicita a due step prevista dal piano.
- Le invarianti I1–I10 sono verificate una per una: `bun run check:offline` (guard `script/check-offline-invariants.ts`, traduzione programmatica dei grep della matrice sopra) deve uscire a 0, più lo smoke offline. La matrice resta la fonte; il guard ne automatizza l'assertion post-merge.
- `origin/main` è completamente integrata: `git rev-list --count leocode..origin/main` == 0.
- Nessuna funzionalità online è riattivata: gateway/claw/marketplace/cloud/telemetry assenti da runtime e type surface.
- Test unit, guard CI (`check-workflows`, `check-forbidden-strings`, `check-kilo-generated-artifacts`, `check-md-table-padding`, `check-kilocode-duplication`, `check-offline-invariants`), `compile` e smoke offline sono verdi.
- I baseline visual regression non si mergiano per batch: vengono rigenerati una sola volta alla fine del sync (step di close-out), prima del gate finale di packaging.
- Documentazione coerente: questo file, la skill `.kilo/skills/upstream-sync/SKILL.md`, `AGENTS.md` (root), `PRUNE-NOTES.md`, `packages/kilo-vscode/CHANGELOG.md` aggiornati.