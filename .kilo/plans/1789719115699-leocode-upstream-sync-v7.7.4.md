# Sync upstream v7.6.2 → v7.7.4 in leocode (offline VS Code fork)

## Obiettivo

Portare il branch `leocode` in sync con l'ultima stable tag di upstream — **v7.7.4** (commit release `a3e508f7ac`, punta di `origin/main` = `e0e73218ad`; il tag `v7.7.4` non esiste nel repo, la stable è identificata dal commit `release: v7.7.4`) — senza integrare alcun commit successivo, e preservando l'**hard requirement**: dopo il sync l'estensione VS Code deve restare completamente offline (nessuna capacità di connettersi a internet).

Il punto di partenza è `main` locale = `v7.6.2` (`3d04228b6a`), già integrato nei commit di Le0xFF. Il delta da assorbire è **563 commit / 1115 file** (~+58k/−24k righe), dominato da: `kilo-vscode` (~430 file), `opencode` (~290), UI/i18n (~180), e ~150 file di `kilo-jetbrains` che vanno **scartati** (dir pruned).

Stima conflitti attesi: **~120–150 file** modificati su entrambi i lati (test `opencode/test/kilocode/**` ~50, webview i18n/settings/chat ~35, provider/session/config ~15, sdk gen ~3) + ~30 delete-conflicts unilaterali (kilo-jetbrains, kiloclaw residui, plans/, translations READMEs).

La procedura operativa completa è già codificata in `docs/upstream-sync.md` (matrice take-ours/take-theirs, invarianti I1–I10, rollback) e nella skill `.kilo/skills/upstream-sync/SKILL.md`; lo specializzato subagent `upstream-sync` (`.kilo/agent/upstream-sync.md`) è disponibile ed è l'esecutore designato degli step di merge/riconciliazione. Questo piano declina quelle procedure in step sequenziali, uno per subagente, fino alla stable v7.7.4.

## Analisi

### Stato attuale
- Branch corrente: `leocode` @ `76af80c0fb`, albero pulito. Remote solo `origin` = Kilo-Org/kilocode.
- `main` locale = `v7.6.2` = `3d04228b6a`; `origin/main` = `e0e73218ad` (già fetchato, contiene v7.7.4).
- Gli ultimi commit dell'utente (da `e192034f8d` in su) hanno completato i sync v7.6.0/v7.6.1+v7.6.2, aggiunto il guard `check-offline-invariants.ts` (`bun run check:offline`), il subagent `upstream-sync`, e riparato la build del CLI binary locale. Tutto verde secondo quanto riportato.

### Componenti coinvolti
| Area | Ruolo nel sync |
|---|---|
| `packages/opencode/src/session/network.ts` + `src/kilocode/session/processor.ts` | I2 probe zeroing — prendere theirs e ri-verificare la coppia `const urls = []` + early-return `"retry"` |
| `packages/opencode/src/kilocode/local-providers.ts` + `models-dev.local.json` + `provider/{provider,models}.ts` | I3 catalog cut — marker vincenti; integrare hunks ortogonali di theirs |
| `packages/opencode/src/server/routes/instance/httpapi/api.ts` + middleware/server.ts | I4 `MediaLocalApi` registration — mantenere; attenzione sibling tocati da upstream |
| `packages/kilo-vscode/src/services/cli-backend/server-manager.ts` | I1/I5 env injection/sanitization — **non presente nel diff upstream**, ma `connection-service.ts` è toccato da entrambi: verificare che la wiring resti intatta |
| `packages/kilo-vscode/src/services/marketplace/**`, `MarketplacePanelProvider.ts` | Marketplace migra in CLI API upstream (23ecd42c80) — ri-applicare keep-deleted della superficie panel |
| Swarm board (`board/enabled.ts`, `tool/board.ts`, `SwarmBoard.tsx`) | Upstream abilita il board by default (50fc57db0c, 1c33649f94) — verificare/stripping: nessun file gateway nello swarm set, ma flag on-by-default va forzato off |
| Speech-to-text custom source (`speech-to-text/{catalog,source,transcribe}.ts`) | Nuovo upstream (0480c79e6b) — verificare che la custom source non punti a endpoint remoti |
| Sandbox classifier / gh read-only (`kilocode/sandbox/git.ts`) | Take-theirs, sicuro per offline |
| Mermaid zoom viewer | UI only, take-theirs |
| `packages/sdk/js/**` + `openapi.json` + migration gen | Take-theirs provvisorio, rigenerazione via `script/generate.ts` |
| i18n (4 alberi, ~40 file) | Take-ours + audit chiavi nuove referenziate dal codice integrato |
| `kilo-jetbrains/**`, `kiloclaw/**`, `kilo-sessions/**` (mobile/remote), `kilo-gateway`, `kilo-telemetry` | Keep-deleted — mai riapparire |
| Visual regression baselines | **Non mergiare per batch**: rigenerare una volta sola al close-out |

### Vincoli architetturali
- Workspace list esplicita a 22 voci nel root `package.json` (mai glob): blocca la resurrezione dei package pruned (I6).
- `patchedDependencies` devono continuare ad applicarsi post `bun install`.
- Guard `script/check-offline-invariants.ts` (`bun run check:offline`) traduce I1–I10 in assert programmatici; deve uscire 0 a fine sync. In questo range **no** modifiche a `.github/workflows/*.yml` né a root `bun.lock`, quindi `check-workflows.ts` resta stabile.
- Mai `bun test` da root (esce con codice 1); test unit da `packages/kilo-vscode/` con `bun run test:unit`.

## Assunzioni
1. L'ultima stable tag è **v7.7.4**, identificata dal commit `a3e508f7ac` ("release: v7.7.4") che è ancestor di `origin/main` (`e0e73218ad`). Se esistono commit post-v7.7.4 su `origin/main`, verranno comunque assorbiti dal merge su `origin/main` perché la sync procedure opera sul ramo e non sui singoli commit; l'hard gate "niente oltre la stable" si verifica confrontando il risultato con `git rev-list --count <stable-sha>..origin/main` (atteso: 0 o trascurabile, da confermare allo step 0).
2. Il subagente `upstream-sync` ha permessi di eseguire comandi mutanti (merge, bun install, generate) e network per fetch/install; gli altri subagenti sono read-only.
3. Lo stato pre-sync è compilabile e verde (verificato allo step 0 come gate d'ingresso).
4. I baseline visual regression vengono rigenerati una sola volta al close-out, non per step.

## Piano di implementazione

Ogni step è eseguito da **un subagente diverso**, sequenzialmente, e termina solo dopo approvazione utente. Regola comune a tutti gli step:

**Istruzioni per ogni subagente**
- Implementa/esegui esclusivamente questo step; non anticipare gli step successivi.
- Non introdurre refactoring non richiesti; non aggiungere funzionalità extra; modifiche minime.
- Al termine compila/verifica secondo le verifiche dello step e risolvi qualsiasi errore introdotto dallo step.
- Unica eccezione consentita: lo step 2 (merge) può terminare con codebase temporaneamente non compilabile perché la riconciliazione è completata nello step 3 (dipendenza a due step prevista dalla procedura).
- Se hai dubbi su API, librerie esterne o comportamenti non deducibili dalla codebase, usa WebFetch/MCP prima di fare supposizioni.
- Non ripetere lo stesso comando/tool call più di 2 volte sullo stesso target; se un comando fallisce, cambia approccio invece di ritentare.
- Posteggia su board un RESULT sintetico a fine step (e un HOLD/VETO se blocchi).

---

### Step 0 — Pre-flight: stato base, fetch, determinazione della stable, backup

**Obiettivo**
Verificare che il punto di partenza sia sano e congelarlo; aggiornare `main` locale; fissare con evidenza quale sia l'ultima stable tag da raggiungere.

**Motivazione**
Gate d'ingresso della procedura: albero pulito, remote corretto, bun disponibile, main allineato a origin/main, tag di backup come punta di rollback. Senza questo step ogni passo successivo è su sabbia.

**File da leggere**
- `docs/upstream-sync.md` (sezione Pre-condizioni)
- `.kilo/skills/upstream-sync/SKILL.md` (punto 1–2)
- `PRUNE-NOTES.md` (vincoli strutturali)

**File da modificare**
- Nessuno (solo git refs locali: fetch, ff di main, tag).

**Attività**
1. `git branch --show-current` == `leocode`; `git remote -v` mostra solo `origin`; `git status` pulito.
2. Verificare bun: `command -v bun` (altrimenti `source ~/.bashrc` nello stesso shell).
3. `git fetch origin && git switch main && git pull --ff-only origin main && git switch leocode`; poi `git rev-parse main` deve equalizzare `git rev-parse origin/main` (= `e0e73218ad`).
4. Determinare la stable: `git log --oneline origin/main -20 | rg 'release:'` → attendersi `a3e508f7ac release: v7.7.4`. Confermare che non ci siano commit `release:` più recenti; annotare il SHA della stable (`STABLE=a3e508f7ac`).
5. Tag di backup: `git tag -f pre-sync-$(date +%Y%m%d)` sul HEAD di leocode (locale, mai pushato).
6. Gate verde pre-sync: da root `bun turbo typecheck`, `bun run lint`, `bun run script/check-workflows.ts`; da `packages/kilo-vscode/` `bun run test:unit`; `bun run check:offline`. Tutto deve essere verde PRIMA di partire.
7. Dry-run: `git merge-tree --write-tree --name-only $(git rev-parse main) leocode > /tmp/conflicts.txt` (riga 1 = OID tree, resto = path in conflitto). Salvare anche `git diff --stat main origin/main | tail -5` come riferimento dimensione.

**Dipendenze**
- Nessuna (primo step).

**Output atteso**
Report: state checks OK, SHA main==origin/main, SHA stable identificata, nome tag backup, risultati gate verdi, conteggio conflitti attesi dal dry-run e prime sorprese rispetto alla matrice.

**Verifiche**
- Ogni comando di verifica ha prodotto l'output atteso (elencarli nel report).
- Il file `/tmp/conflicts.txt` esiste e il suo contenuto è compatibile con le categorie della matrice (rinominati, add/add sotto dir pruned → annotare).

**Compilazione**
- La suite typecheck/lint/test dello stato esistente eseguita al punto 6 conferma la compilabilità pre-sync. Nessun codice viene modificato in questo step.

**Rischi**
- `git pull --ff-only` su main potrebbe fallire se main locale ha diverguto: in quel caso NON force-reset; riportare HOLD con lo stato di main.
- Gate pre-sync rosso: bloccare qui (HOLD), non proseguire col merge.

**Istruzioni specifiche**
- Esegui solo questo step; non iniziare il merge.
- Compila/verifica come indicato; reporta su board con RESULT.

---

### Step 1 — Merge `main` (v7.7.4) in `leocode`: risoluzione conflitti secondo matrice

**Obiettivo**
Eseguire il merge reale di `main` in `leocode` e risolvere **tutti** i conflitti secondo la matrice take-ours/take-theirs di `docs/upstream-sync.md`, con i marker `kilocode_change` vincenti dove presenti.

**Motivazione**
È l'unico passo che porta il contenuto upstream. Va isolato in un subagente dedicato (subagent `upstream-sync`) perché richiede permessi mutanti e judgment sulla matrice. La riconciliazione dipendenze/rigenerazione avviene nello step successivo (dipendenza a due step ammessa).

**File da leggere**
- `docs/upstream-sync.md` (matrice complete + casi limite) — fonte obbligatoria per ogni decisione.
- `PRUNE-NOTES.md` (residual-online matrix).
- `/tmp/conflicts.txt` prodotto allo step 0.

**File da modificare**
- Tutti i file in conflitto (risolti, non ristrutturati).

**Attività**
1. `git merge main` (crea il merge commit con conflitti).
2. Risolvere conflitto per conflitto seguendo la matrice; dove la matrice tace: porzione marcata `kilocode_change` vince; in assenza di marker preferire la versione che mantiene offline.
   Punti caldi attesi da gestire esplicitamente:
   - `kilo-jetbrains/**` (~150 file re-add): **keep-deleted** (`git rm`), la dir non è nella workspace list.
   - Residui `kiloclaw/**` / `event-service/client.ts` / `kilo-sessions/**` mobile-remote: keep-deleted; pulire import residui in `tool/registry.ts`.
   - `groups/kilo-gateway.ts` + handler correlati: keep-deleted.
   - `server-manager.ts`: non in conflitto atteso, ma se `connection-service.ts` porta wiring nuovo verificare che `resolveManagedServerEnv` resti invocato (I1/I5).
   - Swarm board: prendere theirs MAI con flag default-on; forzare disabled (vedi step 4).
   - i18n (4 alberi): take-ours; l'audit delle chiavi nuove è delegato allo step 4.
   - `kilo-vscode/package.json` + `esbuild.js`: unione/take-theirs come da matrice, rimuovendo ciò che il fork ha tolto.
   - Root `package.json`: unione manuale preservando la workspace list esplicita a 22 voci.
   - Generated (sdk/openapi/migrations/snapshots): take-theirs provvisorio (si rigenera allo step 3).
3. Commit del merge risolto (messaggio convenzionale, es. `chore(vscode): sync upstream v7.7.4 into offline leocode fork`).

**Dipendenze**
- Step 0 completato e approvato.

**Output atteso**
Merge commit creato; elenco decisionale: per ogni categoria di conflitto, quanti file, quale lato scelto, note sulle sorprese.

**Verifiche**
- `git status` dopo risoluzione: nessun file unmerged rimanente.
- Spot-check: `ls packages/kilo-gateway packages/kilo-telemetry packages/kilo-jetbrains` fallisce; `grep -rln '@kilocode/kilo-gateway' packages --include='*.ts'` restituisce solo commenti/stringhe.

**Compilazione**
- **Eccezione ammessa**: questo step può terminare con codebase non compilabile (lockfile storto, SDK stale, i18n incomplete). La riconciliazione è completata nello step 3. Non tentare fix di build qui oltre alle risoluzioni di conflitto.

**Rischi**
- Conflitto full-file su `server-manager.ts` (in questo range non atteso ma possibile via connection-service): in tal caso re-copiare `resolveManagedServerEnv` da `git show <tag-pre-sync>:packages/kilo-vscode/src/services/cli-backend/server-manager.ts`.
- Delete/modify su `legacy-migration/**` e `browser-automation*`: seguire la tabella casi limite.

**Istruzioni specifiche**
- Usa il subagent `upstream-sync` con la skill caricata.
- Segui la matrice parola per parola; dove la matrice tace, marker vincenti, altrimenti offline-wins.
- Non fare refactoring durante la risoluzione.

---

### Step 2 — Riconciliazione dipendenze e rigenerazione artefatti

**Obiettivo**
Riconciliare `bun.lock` contro la workspace list esplicita, verificare `patchedDependencies`, e rigenerare SDK/OpenAPI + snapshot modelli dallo stato post-merge.

**Motivazione**
Completa la dipendenza a due step iniziata nello step 1: rende la codebase di nuovo compilabile prima di qualsiasi verifica formale.

**File da leggere**
- `package.json` (root, sezione workspaces + patchedDependencies).
- `script/generate.ts` (comportamento, preferenza snapshot `models-dev.local.json`).

**File da modificare**
- `bun.lock` (via `bun install`).
- `packages/sdk/js/**`, `packages/sdk/openapi.json`, `core/src/database/*.gen.ts` (via generate).

**Attività**
1. Da root: `bun install` (non frozen). Verificare che `patchedDependencies` si applichi e che `packages/kilo-gateway`/`kilo-telemetry` **non** siano riacquistate.
2. Verificare I6: `bun -e 'console.log(require("./package.json").workspaces.packages.length)'` == 22; `grep -c '"packages/\*"' package.json` == 0.
3. `bun run script/generate.ts` da root (rigenera `packages/sdk/js` + `openapi.json`, preferendo lo snapshot committo).
4. Smoke rapido di compilazione: `bun turbo typecheck` da root.

**Dipendenze**
- Step 1 completato.

**Output atteso**
Lockfile riconciliato, workspace list intatta, artefatti rigenerati, typecheck verde.

**Verifiche**
- `bun install` esce 0 senza errori patch.
- Typecheck verde; eventuali errori residui da rigenerazione vanno risolti in questo step.
- `ls packages/kilo-gateway` fallisce ancora.

**Compilazione**
- `bun turbo typecheck` deve uscire verde a fine step: qui si chiude la parentesi aperta dallo step 1. Qualsiasi errore introdotto da install/rigenerazione va risolto in questo step.

**Rischi**
- `bun install` potrebbe voler reintrodurre package pruned se la workspace list è stata corrotta dal merge: verificare il punto 2 PRIMA di fidarsi del lockfile.
- Generate potrebbe richiedere network per models.dev: lo script preferisce lo snapshot committo; se tenta il fetch e manca la rete, verificare che il fallback allo snapshot funzioni.

**Istruzioni specifiche**
- Solo riconciliazione e rigenerazione; nessuna modifica logica.
- Se typecheck resta rosso per cause non legate a install/generate, riporta HOLD con l'elenco errori.

---

### Step 3 — Verifica invarianti I1–I10 e guard CI

**Obiettivo**
Verificare una per una le invarianti offline e far girare tutti i guard CI, chiudendo eventuali gap emersi.

**Motivazione**
È il cuore dell'hard requirement: dimostra, con evidenza, che dopo il sync nulla di online è riattivato.

**File da leggere**
- `docs/upstream-sync.md` (tabella I1–I10 con i grep esatti).
- `script/check-offline-invariants.ts`.

**File da modificare**
- Eventuali file necessari a ristabilire un'invariante violata dal merge (es. riapplicare `resolveManagedServerEnv` in `server-manager.ts` se il wiring è cambiato; re-marcare blocchi persi; ri-registrare `MediaLocalApi`).

**Attività**
1. Da root: `bun run check:offline` (guard programmatico I1–I10).
2. Ripetere manualmente i grep della matrice per I1–I5 e I7–I10 (sono la fonte; il guard ne automatizza il sottoinsieme).
3. Guard CI da root: `bun turbo typecheck`, `bun run lint`, `bun run script/check-workflows.ts`, `bun run script/check-md-table-padding.ts`, `bun run script/check-kilocode-duplication.ts` (+ allowlist portata dal merge).
4. Per ogni invariante rossa: applicare la minima correzione (re-application dalla matrice/tag pre-sync) e ri-eseguire finché tutte verdi.

**Dipendenze**
- Step 2 completato (codebase compilabile).

**Output atteso**
Tabella I1–I10 con esito (verde/rosso→fix) ed evidenza (output grep/comando); guard CI tutti exit 0.

**Verifiche**
- `bun run check:offline` exit 0.
- Tutti i guard elencati exit 0.
- `grep -n 'KILO_DISABLE_MODELS_FETCH' packages/kilo-vscode/src/services/cli-backend/server-manager.ts` mostra l'iniezione.

**Compilazione**
- Typecheck/lint già eseguiti qui come parte dei guard; lo step termina con codebase compilabile e guard verdi.

**Rischi**
- Il guard regex-based è brittle: se upstream ha rinominato una struttura monitorata, o si ripristina la sintassi attesa o si aggiorna il guard (decisione da documentare nel report).
- I9 (i18n per-chiave) non è coperto dal guard: la verifica per-chiave avviene nello step 4.

**Istruzioni specifiche**
- Correzioni minimali, solo per ristabilire invarianti; niente refactoring.
- Documenta ogni fix applicato con il file e il motivo.

---

### Step 4 — Stripping superficie online riemersa + audit i18n

**Obiettivo**
Eliminare definitivamente dalla superficie runtime/type qualsiasi funzione online riemersa col merge (swarm default-on, marketplace panel, STT custom source remota, cloud sessions residue) e tagliare le chiavi i18n alle sole chiavi offline referenziate.

**Motivazione**
Alcune feature upstream sono "online-lite" o gated: il merge le porta dentro; questo step le spegne/taglia in modo che l'estensione non possa connettersi. È la traduzione pratica dell'hard requirement sui contenuti nuovi.

**File da leggere**
- File swarm: `board/enabled.ts`, `tool/board.ts`, `SwarmBoard.tsx` + config schema per il flag.
- `packages/kilo-vscode/src/services/marketplace/**` e site di registrazione del panel.
- `packages/kilo-vscode/src/speech-to-text/{catalog,source,transcribe}.ts`.
- Alberi i18n (kilo-i18n, webview src, agent-manager, ui).

**File da modificare**
- Flag swarm → disabled (valore default off; se il flag diventa top-level setting, assicurarsi che il default sia off e che nessun client remoto venga contattato).
- Rimozione registrazione `MarketplacePanelProvider` / superfici marketplace riapparse.
- STT: se la custom source punta a endpoint remoto, renderla inoperosa/offline-safe (default locale/disabled) — **se incerto sull'endpoint, usare WebFetch/docs prima di decidere**.
- Chiavi i18n: importare SOLO le chiavi nuove upstream realmente referenziate dal codice integrato; tagliare il resto.

**Dipendenze**
- Step 3 completato.

**Output atteso**
Elenco delle superfici spente/tagliate con file e commit; test i18n verde.

**Verifiche**
- Da `packages/kilo-vscode/`: `bun test tests/unit/i18n-unused-keys.test.ts` verde.
- Grep: nessun riferimento operativo a gateway/claw/marketplace/cloud-session/telemetry nel runtime path dell'estensione.
- `bun turbo typecheck` resta verde dopo le rimozioni.

**Compilazione**
- Typecheck + test i18n verdi a fine step; codebase compilabile.

**Rischi**
- Spegnere swarm potrebbe rompere test che aspettano il board attivo: aggiornare i soli test correlati, non la feature.
- STT custom source: rischio di interpretare male l'intento upstream; quando serve documentazione esterna, usarla (WebFetch/MCP) invece di supporre.

**Istruzioni specifiche**
- Modifiche mirate alla sola disattivazione/rimozione di superficie online; niente feature new.
- Se una scelta non è determinabile dalla codebase, consulta la documentazione prima di agire.

---

### Step 5 — Test unit estensione + guard finali + smoke offline

**Obiettivo**
Esecuzione completa della suite unit dell'estensione, dei guard, e dello smoke offline che dimostra l'impossibilità di connettersi.

**Motivazione**
Prova funzionale finale che il fork sincronizzato compila, passa i test e resta offline a runtime.

**File da leggere**
- `docs/upstream-sync.md` (Definizione di sync completo, punto smoke).

**File da modificare**
- Eventuali test che falliscono per effetto del sync (adattare assertion, non logic).

**Attività**
1. Da `packages/kilo-vscode/`: `bun run test:unit` (MAI `bun test` da root).
2. Fix dei fallimenti introdotti dal sync (minimi).
3. Guard root già verdi dallo step 3: rieseguire `check:offline` + workflow/duplication/padding per conferma.
4. **Smoke offline**: da `packages/opencode/` avviare `bun dev serve` e con `curl GET /provider` verificare che appaiano SOLO provider locali/configurati — nessun `kilo`, nessun gateway namespace.

**Dipendenze**
- Step 4 completato.

**Output atteso**
Suite unit verde, guard verdi, output curl `/provider` che mostra solo surface locale.

**Verifiche**
- `bun run test:unit` exit 0.
- `curl` evidenzia assenza totale di provider/gateway online.

**Compilazione**
- Implicita (typecheck già verde); lo step termina con codebase compilabile e testabili.

**Rischi**
- Test flaky noti (diff-panel scroll, ecc.): se ricompaiono, quarantenare come fa upstream, non "aggiustare" la feature.
- `bun dev serve` potrebbe richiedere setup locale: usare il system bun.

**Istruzioni specifiche**
- Solo fix di test/guard derivati dal sync; non toccare feature.
- Lo smoke è il gate definitivo prima del packaging.

---

### Step 6 — Rigenerazione baseline visual regression (una tantum)

**Obiettivo**
Rigenerare i baseline visual regression di `kilo-vscode` una sola volta sullo stato finale post-sync.

**Motivazione**
La procedura vieta di mergiare i baseline per batch: vengono rigenerati una volta sola al close-out, prima del gate di packaging, per evitare rumore visivo cumulativo.

**File da leggere**
- Skill `vscode-visual-regression` (come rigenerare i baseline).

**File da modificare**
- Snapshot/baseline dei visual regression test.

**Attività**
1. Rigenerare i baseline secondo la skill dedicata.
2. Eseguire i visual regression test per confermare coerenza.

**Dipendenze**
- Step 5 completato (suite unit + smoke verdi).

**Output atteso**
Baseline aggiornati e visual regression verdi.

**Verifiche**
- Visual regression test exit 0.

**Compilazione**
- Codebase compilabile invarata (solo asset di test).

**Rischi**
- Cambiamenti legittimi di layout upstream producono diff reali: accettarli solo se coerenti con l'UI offline (niente banner online).

**Istruzioni specifiche**
- Operazione meccanica; non modificare componenti.

---

### Step 7 — Packaging finale: compile + verifica hard requirement + update docs/changelog

**Obiettivo**
Build completa dell'estensione (`compile`), verifica conclusiva dell'hard requirement offline, aggiornamento di CHANGELOG e documenti di sync, e dichiarazione di sync completo.

**Motivazione**
Chiude il ciclo: artifact confezionato, documentazione coerente, criterio "sync completo" soddisfatto.

**File da leggere**
- `docs/upstream-sync.md` (Definizione di sync completo).
- `packages/kilo-vscode/CHANGELOG.md`.
- `AGENTS.md` (root), `PRUNE-NOTES.md`, skill upstream-sync.

**File da modificare**
- `packages/kilo-vscode/CHANGELOG.md` (voce v7.7.4 sync).
- Eventuali doc desync (es. riferimenti al duplication guard) se il merge li ha alterati.

**Attività**
1. Da `packages/kilo-vscode/`: `bun run compile` (prepare:cli-binary + prepare:sdk + bundle).
2. Verifica hard requirement finale: rievidenziare `check:offline` exit 0 + smoke `/provider` solo-locale + assenza di `kilo`/gateway/claw/marketplace/telemetry nel bundle (grep sul dist).
3. Aggiornare CHANGELOG e doc (procedura, AGENTS, PRUNE-NOTES) mantenendoli coerenti.
4. Dichiarazione di sync completo con checklist di `docs/upstream-sync.md`:
   - `git rev-list --count leocode..origin/main` == 0 (entro la stable v7.7.4).
   - Invarianti I1–I10 verificate; guard CI verdi; test unit verdi; compile ok; smoke offline ok.
   - Nessuna funzionalità online riattivata.

**Dipendenze**
- Step 6 completato.

**Output atteso**
VSX/artifact compilato, report finale con evidenze, doc aggiornati.

**Verifiche**
- `bun run compile` exit 0.
- Grep sul bundle: zero simboli online operativi.
- Checklist sync-completa tutta spuntata.

**Compilazione**
- `compile` è il gate di build definitivo; deve uscire verde.

**Rischi**
- `prepare:cli-binary` potrebbe richiedere toolchain/locale specifica: usare system bun e seguire lo script.
- Se il bundle mostra un simbolo online residuo, tornare indietro allo step 4/5 (HOLD) invece di forzare.

**Istruzioni specifiche**
- Step di chiusura: niente nuove feature, solo build + doc + evidenze.
- Posteggia il report finale su board con RESULT.

---

## Criteri di completamento
- Tutti gli step 0–7 completati, ciascuno approvato dall'utente prima del successivo.
- Ogni step termina con codebase compilabile, tranne lo step 1 (merge) la cui riconciliazione è completata nello step 2 (dipendenza a due step prevista).
- `leocode` è in sync con l'ultima stable tag v7.7.4: `git rev-list --count leocode..origin/main` == 0 (nel range della stable); nessun commit oltre la stable integrato.
- Hard requirement soddisfatta e dimostrata: `bun run check:offline` exit 0, smoke `GET /provider` solo provider locali, zero capacità di connessione a internet nel runtime/bundle.
- Invarianti I1–I10 verificate una per una; guard CI (`check-workflows`, `check-forbidden-strings`, `kilo-generated-artifacts`, `md-table-padding`, `kilocode-duplication`, `offline-invariants`) verdi.
- Test unit estensione verdi; visual regression rigenerate una volta; `compile` verde.
- Documentazione coerente: `docs/upstream-sync.md`, skill, `AGENTS.md`, `PRUNE-NOTES.md`, `CHANGELOG.md`.
- Nessun refactoring extra né funzionalità nuova introdotta; tag `pre-sync-*` conservato localmente come rollback.