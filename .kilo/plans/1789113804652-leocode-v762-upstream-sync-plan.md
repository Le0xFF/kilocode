# Piano sync upstream v7.6.2 → leocode (fork offline VS Code)

## Obiettivo

Integrare i 213 commit di `origin/main` (v7.5.16 → v7.6.2) nel branch `leocode`, mantenendo l'estensione VS Code **interamente offline** (requisito fondamentale), in batch incrementali approvati dall'utente. In parallelo, completare il tooling del processo di sync: subagente dedicato, fix AGENTS.md, verifica offline automatizzata, doc aggiornate.

## Analisi

### Stato attuale

| | |
|---|---|
| `leocode` HEAD | `71dee9ee62` — "sync upstream v7.5.16 into offline leocode fork" (è anche merge-base con main) |
| `origin/main` HEAD | `3d04228b6a` — "release: v7.6.2" |
| Delta | 213 commit / 4479 file divergenti; ~3500 in package già pruned dal fork (da ignorare); **~979 file nella superficie offline attiva** |
| Superficie attiva | `packages/opencode` (src+test incl. `src/kilocode`), `packages/kilo-vscode` (src/webview-ui/tests/script/package.json/knip.json), `packages/sdk/js`, `packages/kilo-ui`, `packages/kilo-i18n`, + root config (`package.json`, `turbo.json`, `bun.lock`, `script/check-workflows.ts`, `.github/workflows/`) |

### Batch cronologici identificati (ordine di esecuzione)

| # | Range SHA | Contenuto principale | Aree superficie | Rischio |
|---|---|---|---|---|
| B1 | `cdbb9265…7f934750` (fino a release v7.6.1) | Swarm board/goals, avatars tema, snapshot init fix, CLI links, PR sidebar timeline+merge controls, notification nav (#13932), multi-project revert, opentui 0.5.11, 37 workflow yml | opencode kilocode (board/store/goal), httpapi groups→SDK regen, agent-manager, webview, kilo-ui, i18n, root config | ALTO (hard-cut provider vs +17 ai-sdk deps; probe azzerate vs bonjour/mdns; claw/cloud/console rimessi da loro) |
| B2 | `b41b3d2f…492a2ffa` | Claude Code migration sperimentale (off by default), rejection MCP dynamic values, reviewer avatars PR sidebar, approval/conflict actions, goal send bad-request fix | opencode kilocode (claude-migration config, local-providers), vscode (handlers/migration, permission-handler, RemoteStatusService), webview, i18n | MEDIO/ALTO (collisione zone kiloclaw/provider rimossi; dipendenze openai/js-tiktoken/qrcode da scartare se si scarta la parte online) |
| B3 | `8a544966…b41b3d2f` (tra i merge #1396x e #13991) | Swarm agent-lifecycle research, board_post warning su subagent stopped, wroktree animation fix, thinking-indicator scroll, PR open-on-click | delta piccolo: board/presence già parzialmente nel sync v7.5.16 | BASSO/MEDIO |
| B4 | `5326d169…d12a1392bb` | Permission prompt races, encrypted reasoning settle, auto-merge split button, plan persistence on worktree switch, speech cursor revert, baselines | opencode core (session/processor, provider), vscode (permission-handler, KiloProvider), webview, i18n | MEDIO (permission-handler è zona toccata dal fork) |
| B5 | `27aeae54…3d04228b` (fino a release v7.6.2) | Streaming cadence perf (bash/todo/diff cards lazy, frame cadence, flush on slow cadence), inline @model references (#14006), question dialog keybindings, swarm env flag KILO_SWARM (#14013), exclude-permission-wait, release tags v7.6.x | opencode core (prompt.ts, streaming), vscode (KiloProvider model refs), webview (~40 file tool cards), sdk-gen rigenerazione finale, check-workflows | MEDIO (additive ma tocca session core modificato dal fork) |

*Nota: i range esatti vanno ricompattati col dry-run `git merge-tree` nello Step 0; qui sono indicativi.*

### Vincoli di offline (invarianti I1–I10 di `docs/upstream-sync.md`)

Ogni batch deve preservare: I1 `KILO_DISABLE_MODELS_FETCH` allo spawn; I2 probe azzerate in `session/network.ts` + retry in processor; I3 hard-cut provider `inLocalSurface` + `models-dev.local.json`; I4 route `/media-local/*`; I5 env sanificate in `server-manager.ts`; I6 workspace list esplicita a 22 voci (mai glob); I7 dir assenti `kilo-gateway`/`kilo-telemetry` (+ altre pruned), zero import live gateway; I8 superfici rimosse estensione (kiloclaw, RemoteStatusService, MarketplacePanelProvider, autocomplete, cloud sessions); I9 i18n tagliato sulle chiavi online; I10 guard CI coerenti.

### Lacune di tooling identificate (da coprire nel piano)

1. `AGENTS.md` root: 9 punti obsoleti (jetbrains typecheck Java 21, source-links `kilo-docs`, annotation check duplicato e script assente `check-opencode-annotations.ts`, promise-facades script assente, tabella monorepo elenca gateway/telemetry, lineage "anomalyco/opencode", changesets, `script/upstream/`, mirror cloud schema).
2. Workflow `check-opencode-annotations.yml` presente nell'allowlist ma chiama 4 script assenti → CI rossa.
3. Skill `upstream-sync` esiste a disco (`.kilo/skills/upstream-sync/SKILL.md`) ma non è dichiarata in `available_skills` del modello.
4. Nessun subagente dedicato al sync (nessun file in `.kilo/agent/`).
5. Nessun guard che verifichi automaticamente la superficie offline post-merge (oggi solo grep manuali della matrice I1–I10).

## Assunzioni

- Il remote `origin` = github.com/Kilo-Org/kilocode è l'unico upstream; `git pull --ff-only origin main` funziona.
- Le feature online introdotte da main (swarm/claw/cloud/gateway/telemetry/event-service/session-export/indexing-worker) vanno **rifiutate o disabilitate**, mai riadottate: il requisito offline è vincolante e prevale sull'allineamento feature.
- Le feature nuove *offline-compatible* (PR sidebar UI pure, permission race fixes, streaming render perf, avatars, goal runner se locale, inline @model parsing locale) vanno adottate.
- La classificazione offline/online per feature ambigua viene fatta **durante** ogni batch dallo step di risoluzione conflitti, usando la matrice take-ours/take-theirs di `docs/upstream-sync.md` e le invarianti come tiebreaker; ogni decisione va riportata nel report dello step per approvazione utente.
- `bun install` e `script/generate.ts` richiedono rete (solo per npm/models.dev snapshot fallback già committato): ammessi.
- Il gate di ogni batch include: typecheck root, lint, guard root, `test:unit` da `packages/kilo-vscode/`, e lo smoke `bun dev serve` + `curl GET /provider` (solo provider locali).
- I baseline visual regression PNG spalmati sui batch non si mergiano: si rigenerano una sola volta alla fine (Step finale).

## Piano di implementazione

Struttura: ogni step è eseguito da un **subagente diverso**, sequenzialmente, con compilazione obbligatoria e revisione umana dell'utente prima dello step successivo. Gli step S1–S5 sono i batch di code; S0 prepara il terreno; S6–S8 completano il tooling; S9 chiude con verifica finale e doc.

### Step 0 — Preparazione terreno e dry-run completo

**Obiettivo**: portare il repo nelle pre-condizioni di sync, generare l'elenco esatto dei conflitti e la lista files sentinella per tutto il delta, congelare i dati che gli step successivi consumeranno.

**Motivazione**: evita di scoprire conflitti a sorpresa nei batch; il dry-run unico sul delta completo dà la mappa definitiva (i conflitti per-batch sono sottoinsiemi di questa).

**File da leggere**: `docs/upstream-sync.md` (pre-condizioni + comandi), `PRUNE-NOTES.md` (matrice residui), `script/check-workflows.ts`, `.kilo/skills/upstream-sync/SKILL.md`.

**Attività**:
1. Verificare pre-condizioni: branch `leocode`, tree pulito, `origin` unico remote, system bun disponibile.
2. `git fetch origin && git switch main && git pull --ff-only origin main && git switch leocode`; confermare `main == origin/main == 3d04228b6a`.
3. Creare tag backup: `git tag -f pre-sync-$(date +%Y%m%d)`.
4. Dry-run: `git merge-tree --write-tree --name-only $(git rev-parse main) leocode > /tmp/kilo/conflicts-full.txt` (riga 1 = OID tree).
5. Produrre `/tmp/kilo/sync-analysis.md`: (a) elenco conflitti raggruppati per area (opencode-kilocode / opencode-core / vscode-services / agent-manager / webview / sdk-gen / kilo-ui / i18n / root-config / workflows); (b) per ogni path in conflitto, annotare la categoria secondo la matrice di `docs/upstream-sync.md` (take-ours / take-theirs / integrare / keep-deleted); (c) lista dei 5 range SHA dei batch validata contro `git log` (correggere i confini indicativi del §Analisi); (d) lista dipendenze nuove per package (`git diff --name-only leocode main -- '**/package.json'` filtrato sulla superficie) con classificazione accettabile/rifiutabile per offline.
6. Verificare che i 11 workflow del working tree coincidano con l'allowlist (`bun run script/check-workflows.ts` da root) — drift atteso: no (già allineati a v7.5.16), ma i 37 workflow di main vanno anticipati qui per dimensionare S1.

**Output atteso**: `/tmp/kilo/conflicts-full.txt` + `/tmp/kilo/sync-analysis.md` (quest'ultimo va salvato anche in `.kilo/plans/` come allegato di lavoro? No: resta in /tmp, citato per path negli step successivi).

**Verifiche**: `git rev-list --count leocode..origin/main` == 213 prima del merge; tag creato; dry-run completato senza errori; analisi contiene tutti i path di `conflicts-full.txt` classificati.

**Compilazione**: n/a (nessuna modifica al codice).

**Rischi**: sandbox potrebbe bloccare `git fetch`/`merge-tree` → eseguire fuori sandbox se necessario (come previsto dalla skill).

**Istruzioni per il subagente**: esegui SOLO questo step; non fare il merge; non modificare file del repo (gli output vanno in /tmp); usa WebFetch/MCP se hai dubbi sui comandi git moderni (`merge-tree --write-tree`); completa il report prima di terminare.

---

### Step 1 — Batch B1: swarm board/goals, avatars, PR sidebar foundations, root config

**Obiettivo**: integrare il primo blocco cronologico di main (range validato in S0), risolvendo i conflitti secondo la matrice e riapplicando le invarianti offline.

**Motivazione**: è il fondamento (board store, goals, dipendenze, opentui bump, SDK regen) su cui si appoggiano B2–B5.

**File da leggere**: `/tmp/kilo/sync-analysis.md` (sezione B1), `docs/upstream-sync.md` (matrice + invarianti), `PRUNE-NOTES.md`.

**File da modificare**: quelli in conflitto del range B1 (lista esatta da `sync-analysis.md`), tipicamente: `packages/opencode/src/kilocode/{board/**,goal/**}`, `packages/opencode/src/server/routes/instance/httpapi/**` (gruppi/handler nuovi → poi SDK), `packages/opencode/src/session/**` (fix snapshot init), `packages/kilo-vscode/src/agent-manager/**` (avatars, notification nav, restricted overlay), `packages/kilo-vscode/webview-ui/**` (board-message, icon-button, PR timeline/merge), `packages/kilo-ui/**` (board-route, message-part), `packages/kilo-i18n/**` + alberi i18n webview (approval/conflict keys), `packages/sdk/js/**` (gen), root `package.json` (version bump, opentui 0.5.11, patchedDeps — MAI lavorare col glob `packages/*` di theirs), `turbo.json`, `bun.lock`, `script/check-workflows.ts` + `.github/workflows/*.yml` (aggiungere all'allowlist SOLO i workflow rilevanti per la superficie offline: test/test-vscode/typecheck/lint-guard/visual-regression/smoke; rifiutare quelli di pacchetti pruned), `AGENTS.md` root (porzione B1 se toccata).

**Attività**:
1. `git merge <sha-fine-B1>` (merge del range, non del main completo).
2. Risolvere conflitti uno a uno secondo la matrice: dirs pruned → keep-deleted (`git rm`); `kilo-gateway`/`kilo-telemetry` reintrodotti → cancellare; `packages/sdk/js/**` gen + `models-dev.local.json` → take-theirs provvisorio (si rigenera dopo); `server-manager.ts` → take-theirs + RE-APPLICARE `resolveManagedServerEnv` (I1/I5) copiando la funzione dal tag `pre-sync-*`; `provider.ts`/`local-providers` → marker `kilocode_change` vincenti (I3), integrare hunks ortogonali; `session/network.ts` → mantenere `const urls = []` (I2); i18n → take-ours poi audit chiavi nuove referenziate dal codice integrato (I9); `package.json` root → unione manuale (workspace list esplicita nostra, version bump, dipendenze online rifiutate: ai-sdk extra per provider cloud, `bonjour-service` se legato a mdns probe, `@aws-sdk/credential-providers`, sst/changesets/actions-artifact).
3. Rifiutare/neutralizzare le feature online del batch: claw/event-service/cloud-session/session-export/indexing-worker (keep-deleted + pulizia import residui in registri), caffeinate cmd se cloud-backed (valutare: è un cmd locale? se solo locale → adottare), kilo-console fixes (skip).
4. `bun install` da root; verificare `patchedDependencies` applicate e assenza di `@kilocode/kilo-gateway` dai lockfile/workspace.
5. `bun run script/generate.ts` (il batch tocca httpapi → SDK regen obbligatoria; preferisce lo snapshot `models-dev.local.json`).
6. Ri-verificare I1–I10 con i comandi grep della matrice (evidenza nel report).
7. Guard: `bun turbo typecheck`, `bun run lint`, `bun run script/check-workflows.ts`, `bun run script/check-forbidden-strings.ts`, `bun run script/check-md-table-padding.ts`, `bun run script/check-kilo-generated-artifacts.ts` da root.
8. Da `packages/kilo-vscode/`: `bun run test:unit` (runner anti-OOM). Se il batch tocca bundle/SDK: `bun run compile`.
9. Smoke: da `packages/opencode/` `bun dev serve` in background + `curl localhost:PORT/provider` → solo provider locali/configurati, nessun `kilo`/gateway; poi kill del processo.
10. Report: conflitti risolti (conteggio + decisioni non ovvie), dipendenze aggiunte/rifiutate, evidenze invarianti, risultati guard/test/smoke.

**Output atteso**: merge B1 committo su `leocode` (commit di merge risolto), codebase compilabile, suite verde, report per approvazione utente.

**Verifiche**: `git rev-list --count <fine-B1>..origin/main` diminuito di N1; typecheck+lint+guard verdi; `test:unit` verde; smoke mostra solo provider locali; grep invarianti I1–I10 passanti.

**Compilazione**: `bun turbo typecheck` + `bun run lint` da root devono passare; risolvere qualsiasi errore introdotto prima di terminare.

**Rischi**: il più pesante (root config + SDK regen + provider hard-cut). Conflitti su `turbo.json`/`bun.lock` quasi certi → policy: turbo take-ours ridotto (rimuovere task di pacchetti pruned), lock rigenerato da `bun install`. Possibili fallimenti test su aree integrate male → debug entro questo step, non delegare a B2.

**Istruzioni per il subagente**: implementa SOLO B1; non anticipare B2–B5; no refactoring extra; dove la matrice tace, vince la porzione marcata `kilocode_change` e in sua assenza la versione che mantiene offline; se una dipendenza nuova di theirs serve a una feature online, rifiutarla e annotarlo nel report; compila e testa prima di terminare; usa WebFetch/MCP per dubbi su API/bun; lascia un report completo per la review utente.

---

### Step 2 — Batch B2: Claude Code migration (offline-safe subset) + reviewer avatars + approval/conflict actions

**Obiettivo**: integrare il secondo blocco; adottare la migration Claude solo nella misura in cui resta offline (flag sperimentale off; scartare client claw/event-service e dipendenze online).

**Motivazione**: la collisione diretta con le zone rimosse dal fork (kiloclaw, provider options, permission handler) va gestita in un passo isolato e revisionato.

**File da leggere**: `/tmp/kilo/sync-analysis.md` (sezione B2), matrice `docs/upstream-sync.md`, stato post-B1 di `packages/opencode/src/kilocode/{config/claude-migration.ts,modes-migrator,local-providers,provider-options}` (se esistiti in main), `packages/kilo-vscode/src/services/{handlers/migration.ts,permission-handler.ts}`, `RemoteStatusService` (verificare resti assente, I8).

**File da modificare**: conflitti del range B2 (lista da analysis): opencode kilocode (migration config, local-providers delta, modes-migrator), vscode services (handler migration adattato senza cloud, permission-handler fix iniziali), webview (agent-avatar, PR panel reviewer avatars), i18n (PR merge locale strings), `packages/kilo-vscode/package.json` (rifiutare `openai`, `js-tiktoken`, `qrcode`, `uri-js`, `lru-cache` se legati alla parte online; accettare solo dipendenze usate dalla parte offline adottata).

**Attività**:
1. Merge del range B2.
2. Classificare la Claude migration: adottare la struttura (wizard UI, legacy-types, mapping locale) se non richiede gateway/OAuth online; il flag experimental resta **off by default**; reject di MCP dynamic values (fix) si adotta sempre.
3. Keep-deleted: `kiloclaw/**` clients reintroducti, `RemoteStatusService.ts`, `MarketplacePanelProvider.ts`, `services/autocomplete/**` (FIM gateway), event-service; pulire import/case/union residui.
4. Re-applicare `resolveManagedServerEnv` se `server-manager.ts` è in conflitto (I1/I5).
5. `bun install` + `script/generate.ts` (solo se httpapi cambiato in questo range).
6. Guard + `test:unit` + smoke come in S1 (sezioni 6–9).
7. Report con evidenza delle scelte feature-online-rifiutate.

**Output atteso**: merge B2 committo, compilabile, verde, report.

**Verifiche**: come S1 + verifica I8 (ls dei path rimossi deve fallire) + flag claudeMigration off di default nel code integrato.

**Compilazione**: typecheck+lint root verdi prima di terminare.

**Rischi**: la tentazione di adottare i client claw "perché ci sono in main" → vietato (requisito offline); se un componente webview importa un client claw, sostituire con stub locale o rimuovere il percorso UI.

**Istruzioni per il subagente**: solo B2; il requisito offline prevale sull'allineamento feature; documenta ogni feature online scartata; compila e testa prima di terminare.

---

### Step 3 — Batch B3: swarm lifecycle delta + piccoli fix UI

**Obiettivo**: integrare il delta swarm contenuto (board presence/policy, board_post warning, wroktree animation, thinking-indicator scroll, PR open-on-click).

**Motivazione**: basso rischio; sblocca il resto senza conflitti pesanti; il fork ha già adottato l'infra board nel sync v7.5.16.

**File da leggere**: `/tmp/kilo/sync-analysis.md` (sezione B3), stato post-B2 di `packages/opencode/src/kilocode/board/**` e `packages/kilo-vscode/src/agent-manager/**`.

**File da modificare**: conflitti del range B3 (tipicamente pochi file: board/context, board store, agent-manager PRStatusPoller/pr-status-bridge, webview icon-button/reasoning-heading).

**Attività**:
1. Merge del range B3.
2. Risoluzione per matrice (aspettarsi pochi conflitti: sovrapposizione con v7.5.16).
3. Verificare che `board/enabled.ts` non attivi di default una modalità che richieda gateway (se il flag swarm implica cloud → mantenerlo off/disattivato; il flag env `KILO_SWARM` arriva in B5).
4. Guard + `test:unit` + smoke (sezione standard).
5. Report breve.

**Output atteso**: merge B3 committo, compilabile, verde.

**Verifiche**: come S1.

**Compilazione**: typecheck+lint verdi.

**Rischi**: basso; attenzione a non riattivare presence/policy che telefonino a endpoint cloud.

**Istruzioni per il subagente**: solo B3; modifiche minime; compila e testa prima di terminare.

---

### Step 4 — Batch B4: permission race fixes + encrypted reasoning + auto-merge/plan UI

**Obiettivo**: integrare i fix di correttezza (race su permission prompt, settle encrypted reasoning, auto-merge split button, plan persistence su worktree switch, speech cursor revert).

**Motivazione**: sono fix di stabilità richiesti dagli utenti; toccano `permission-handler.ts` (zona sensibile del fork) e vanno fatti dopo B2 che ha già aggiornato quel file.

**File da leggere**: `/tmp/kilo/sync-analysis.md` (sezione B4), post-B3 state di `packages/kilo-vscode/src/services/permission-handler.ts`, `packages/opencode/src/kilocode/session/processor.ts` (mantenere I2!), `packages/kilo-vscode/src/services/KiloProvider.ts`.

**File da modificare**: conflitti del range B4 (session/processor, provider, permission-handler, KiloProvider, webview message-part/basic-tool, i18n approval keys retain, test selectors).

**Attività**:
1. Merge del range B4.
2. Risoluzione per matrice; in `processor.ts` INTEGRARE i fix di theirs MA preservare l'early-return `"retry"` di `handleOffline` (I2) e le hunk marcate offline.
3. `setting pushFixes` (default true in main): valutare — se è solo UI locale → adottare; se fa chiamate remote → rifiutare. Decisione nel report.
4. Baseline visual regression di questo range: NON mergiare i PNG; annotare per la rigenerazione finale (S9).
5. Guard + `test:unit` + smoke.
6. Report.

**Output atteso**: merge B4 committo, compilabile, verde.

**Verifiche**: come S1 + grep I2 (`const urls = []` + `"retry"`) ancora presenti.

**Compilazione**: typecheck+lint verdi.

**Rischi**: conflict in `processor.ts` tra fix streaming di theirs e short-circuit offline di ours → la coppia I2 è inviolabile; se irreconciliabile, prendere theirs e riapplicare la hunk offline manualmente (marker).

**Istruzioni per il subagente**: solo B4; I2 è vincolante; compila e testa prima di terminare.

---

### Step 5 — Batch B5: streaming perf + inline @model + swarm env flag + close-out releases

**Obiettivo**: integrare l'ultimo blocco fino a v7.6.2 (HEAD di main) e portare `leocode` a pari commit-wise con `origin/main`.

**Motivazione**: chiude il debito; include rigenerazione SDK finale e update allowlist workflow definitivo.

**File da leggere**: `/tmp/kilo/sync-analysis.md` (sezione B5), stato post-B4 di `packages/opencode/src/session/prompt.ts`, `packages/kilo-vscode/src/services/KiloProvider.ts`, `packages/kilo-vscode/webview-ui/components/**` (tool cards).

**File da modificare**: conflitti del range B5: prompt.ts (@mention parsing — adottare, è parsing locale), llm streaming cadence, permission-wait exclusion, KiloProvider model refs + early-message attachments fix, webview tool cards lazy/diff defer/todo no-Kobalte/bash speed-up, `board/enabled.ts` env flag `KILO_SWARM` (adottare solo se il board resta funzionante offline; altrimenti mantenere disabilitato), `script/check-workflows.ts` (allowlist definitiva), release version bumps, `bun.lock` finale.

**Attività**:
1. Merge di `main` completo (a questo punto equivale al range residuo: `git merge main`).
2. Verifica: `git rev-list --count leocode..origin/main` deve diventare 0 dopo il merge committo.
3. Risoluzione per matrice; feature online residue (veil-intelligence, profile worktree-deletion telemetry-style) → rifiutare/neutralizzare.
4. `bun install` + `bun run script/generate.ts` (rigenerazione finale SDK/OpenAPI).
5. Guard root completi + `test:unit` + `bun run compile` da `packages/kilo-vscode/` (il sync ha toccato SDK/bundle).
6. Smoke offline completo: `GET /provider` solo locali; route `/kilo/*`, `/telemetry/*`, `/experimental/console` → 404; nessuna connessione outbound con provider locale configurato (osservare lo spawn: nessun OTEL_*, nessun proxy).
7. Report finale del code-sync: riepilogo dei 5 batch, dipendenze nette aggiunte, feature online rifiutate (lista chiusa), evidenze I1–I10 complete.

**Output atteso**: `leocode` integra completamente `origin/main`, compilabile, suite verde, offline verificato, report.

**Verifiche**: rev-list count == 0; tutti i guard verdi; test:unit verde; compile ok; smoke 404 + provider locali.

**Compilazione**: typecheck+lint+compile verdi prima di terminare.

**Rischi**: ultimo accumulo di conflitti; il `KILO_SWARM` board se abilitato by-default in main potrebbe riaccendere superficie cloud → verificare il default in `board/enabled.ts` post-merge.

**Istruzioni per il subagente**: solo B5/close-out; non toccare nulla al di fuori del delta; compila, testa, smoke, report completo.

---

### Step 6 — Tooling A: subagente dedicato al sync + dichiarazione skill

**Obiettivo**: creare un subagente riusabile che incapsula il processo di sync (rule-based, parametrico sul delta corrente) e rendere la skill `upstream-sync` accessibile al modello.

**Motivazione**: oggi il processo dipende dalla disciplina dell'agente generico; un subagente dedicato con regole esplicite (solo-il-batch-corrente, no-refactor, marker vincenti, invarianti, report) rende i sync futuri ripetibili.

**File da leggere**: `.kilo/skills/upstream-sync/SKILL.md`, `docs/upstream-sync.md`, `PRUNE-NOTES.md`, `.kilo/command/*.md` (pattern esistenti se presenti — verificarne l'esistenza), eventuali `kilo.json`/config che dichiarano skills/agents (usare la skill `kilo-config` se serve capire dove dichiarare).

**File da modificare**:
- NUOVO: `.kilo/agent/upstream-sync.md` — definizione del subagente: nome `upstream-sync-scope`, descrizione ("Esegue UNO step del sync origin/main→leocode: merge del range assegnato, risoluzione conflitti per matrice, riapplicazione invarianti I1–I10, guard+test+smoke, report"), istruzioni operative che puntano a `docs/upstream-sync.md` + `PRUNE-NOTES.md` come fonte, regole di sicurezza (implementa solo il batch indicato nel prompt; mai anticipare; no refactoring; marker `kilocode_change` vincenti; offline prevale; compila e testa prima di terminare; report strutturato: conflitti/decisioni/dipendenze/evidenze invarianti/esito guard-test-smoke), input atteso nel prompt (range SHA o batch id, path di `sync-analysis.md`).
- Config Kilo per dichiarare la skill `upstream-sync` (dove il progetto dichiara skills disponibili — verificare con la skill `kilo-config` quale file: es. `kilo.json`/`.kilo/kilo.jsonc`); se la dichiarazione non è supportata dalla versione corrente, documentare nel README del subagente il caricamento manuale via `skill` tool.

**Attività**: scrivere il file subagente seguendo la struttura degli agent esistenti nel repo (leggerne almeno uno come template); verificare sintassi/naming conforme alle convenzioni `.kilo/agent/`; aggiornare la sezione "Fork Merge Process" di `AGENTS.md` root per citare il nuovo subagente (piccolo edit, parte del fix generale fatto in S7 ma qui solo l'aggiunta del riferimento).

**Output atteso**: `.kilo/agent/upstream-sync.md` presente e coerente; skill dichiarata (o nota di fallback documentata).

**Verifiche**: il file è leggibile e cita correttamente i documenti operativi; (se supportato) la skill compare in available_skills in una sessione successiva.

**Compilazione**: n/a (solo doc/config markdown).

**Rischi**: formato agent non noto → usare il pattern dei file esistenti in `.kilo/` come riferimento; se non esistono esempi, seguire la struttura minimista (frontmatter name/description + corpo istruzioni).

**Istruzioni per il subagente**: crea SOLO il subagente e la dichiarazione skill; non toccare codice sorgente; non eseguire comandi mutanti oltre alla creazione dei file indicati; se il meccanismo di dichiarazione skills è incerto, usarne la skill `kilo-config` invece di supporre.

---

### Step 7 — Tooling B: fix AGENTS.md root + workflow orfano

**Obiettivo**: eliminare i 9 punti obsoleti di `AGENTS.md` root e sanare il workflow `check-opencode-annotations.yml` che chiama script assenti.

**Motivazione**: istruzioni obsolete portano azioni errate nei futuri sync (es. eseguire script rimossi, cercare package pruned).

**File da leggere**: `AGENTS.md` (root), `script/check-workflows.ts`, `.github/workflows/check-opencode-annotations.yml`, elenco `script/*.ts` attuali (verificare quali guard esistono davvero: `check-workflows.ts`, `check-forbidden-strings.ts`, `check-kilocode-duplication.ts`, `check-md-table-padding.ts`, `check-kilo-generated-artifacts.ts`, `setup-git.ts`, `generate.ts`, `beta.ts`).

**File da modificare**:
- `AGENTS.md` (root): rimuovere/aggiornare (a) menzione JetBrains typecheck Java 21; (b) source-links `kilo-docs` + `extract-source-links.ts` (script assente); (c) righe duplicate e riferimenti a `check-opencode-annotations.ts` e `check-opencode-promise-facades.ts` (assenti) — decidere: se il workflow corrispondente resta, reimplementare? No: semantica del fork è rimuovere i riferimenti a ciò che non c'è; (d) tabella monorepo: togliere `kilo-gateway`, `kilo-telemetry` e qualsiasi package pruned; (e) lineage "anomalyco/opencode" → "Kilo-Org/kilocode"; (f)Changesets: `.changeset/` rimosso → rimuovere la sezione o annotare "non applicabile nel fork"; (g) `script/upstream/` + mergiraf → rimuovere; (h) mirror cloud schema → rimuovere; (i) Package Instructions jetbrains → rimuovere. Aggiungere invece: riferimento al subagente `upstream-sync` (creato in S6), al runner anti-OOM, alla lista guard reali.
- `.github/workflows/check-opencode-annotations.yml`: due opzioni — (A) rimuoverlo dal working tree E toglierlo dall'allowlist di `check-workflows.ts` (consistente: lo script non esiste nel fork); (B) ridurne il job agli script esistenti. Scegliere (A) per coerenza col principio "il fork non esegue guard upstream incompleti"; aggiornare `script/check-workflows.ts` (rimuovere la voce `check-opencode-annotations.yml` dalla lista `active` e aggiungere un commento `kilocode_change` che spiega perché).

**Attività**: edit puntuali; eseguire `bun run script/check-workflows.ts` dopo l'aggiornamento dell'allowlist per confermare drift zero; `bun run script/check-md-table-padding.ts` (AGENTS.md contiene tabelle — verificare formato compatto non paddato).

**Output atteso**: `AGENTS.md` root coerente con il fork; workflow orfano rimosso; allowlist aggiornata; guard verdi.

**Verifiche**: `check-workflows` exit 0; `check-md-table-padding` exit 0; nessuna menzione residua di package/script pruned in AGENTS.md (grep).

**Compilazione**: n/a (markdown + workflow yml); ma i guard root vanno eseguiti e verdi.

**Rischi**: rimuovere il workflow cambia il set CI → l'allowlist aggiornata lo legittima; attenzione a non rompere gli altri 10 workflow.

**Istruzioni per il subagente**: solo questi edit; non toccare altro; esegui i guard dopo; usa WebFetch/MCP se dubiti del formato frontmatter dei workflow.

---

### Step 8 — Tooling C: guard di verifica offline + doc aggiornate

**Obiettivo**: automatizzare la verifica delle invarianti I1–I10 (oggi grep manuali) e aggiornare `PRUNE-NOTES.md` e `docs/upstream-sync.md` con l'esito del sync v7.6.2.

**Motivazione**: un guard eseguibile in CI locale/post-merge impedisce che un futuro sync riattivi silenziosamente superficie online.

**File da leggere**: matrice invarianti in `docs/upstream-sync.md` (comandi grep già scritti lì — riproporli in forma di script), `script/check-forbidden-strings.ts` (pattern da estendere), `PRUNE-NOTES.md` (sezione matrice residui).

**File da modificare**:
- NUOVO: `script/check-offline-invariants.ts` — esegue le 10 verifiche della matrice (I1–I10) come assertion programmatiche: grep/fisici (`fs.existsSync` negativi per `packages/kilo-gateway`, `packages/kilo-telemetry`, `kiloclaw/`, `RemoteStatusService.ts`, `MarketplacePanelProvider.ts`, `services/autocomplete/`), positivi per `const urls = []`, `KILO_DISABLE_MODELS_FETCH`, `LOCAL_PROVIDER_IDS`/`inLocalSurface`, registrazione `MediaLocalApi`, strip env in `server-manager.ts`, conta workspace == 22 e assenza glob `packages/*`, grep negativo import live `@kilocode/kilo-gateway`. Exit non-zero su violazione con messaggio per invariante. Stile coerente con gli altri guard `script/*.ts` (uso `Bun.file`, niente try/catch superflui).
- `PRUNE-NOTES.md`: aggiornare il record sync (data, da v7.5.16 a v7.6.2), eventuale aggiornamento della matrice "residui volutamente online" se in B1–B5 sono cambiate classi (es. `KILO_SWARM` flag: gated/off), dipendenze aggiunte nette.
- `docs/upstream-sync.md`: aggiornare (a) numero workflow allowlist se cambiato per S7 (11→10), (b) riferimento al guard `check-offline-invariants.ts` nella definizione di sync completo, (c) nota che i baseline visual si rigenerano a fine sync, non per batch.
- Root `package.json`: aggiungere lo script `check:offline` → `bun run script/check-offline-invariants.ts` (nome da allineare allo stile degli altri `check:*`).

**Attività**: implementare lo script (i comandi grep della matrice sono già pronti in `docs/upstream-sync.md` — tradurli in codice, read-only); eseguirelo e verificare che passi sullo stato post-S5; aggiornare i due documenti; wire dello script.

**Output atteso**: guard nuovo funzionante e verde; doc aggiornate; script wired.

**Verifiche**: `bun run script/check-offline-invariants.ts` exit 0; `check-md-table-padding` ok sui md toccati; `check-workflows` ancora ok.

**Compilazione**: typecheck root verde (lo script è TypeScript nel workspace tooling).

**Rischi**: falsi positivi del guard su comment/string (es. menzioni di `kilo-gateway` in doc) → limitare gli import-live grep a `packages/**/*.ts` esclusi i path doc, come fa già `check-forbidden-strings.ts`.

**Istruzioni per il subagente**: solo guard+doc; non modificare codice applicativo; lo script deve essere executable e deterministico; se un'invariante non è traducibile in automatico, lasciarla come TODO commentato e segnalarlo nel report.

---

### Step 9 — Close-out: rigenerazione baseline, verify definitiva, changelog

**Obiettivo**: rigenerare i baseline visual regression accumulati durante i batch, eseguire il gate packaging completo, produrre il changelog del sync e chiudere il processo.

**Motivazione**: i PNG non erano mergiabili per-batch; il packaging finale è il gate definitivo che l'estensione si builda.

**File da leggere**: skill `vscode-visual-regression` (procedura rigenerazione baseline), `packages/kilo-vscode/CHANGELOG.md` (formato esistente), report dei batch S1–S5.

**File da modificare**: baseline PNG rigenerati (via comando dedicato dell'estensione, non a mano); `packages/kilo-vscode/CHANGELOG.md` (voce del sync: "Sync upstream v7.6.2 into offline fork" con elenco feature adottate/rifiutate a livello utente); eventuali residuali emersi dai test visivi.

**Attività**:
1. Rigenerare baseline: seguire la procedura della skill `vscode-visual-regression` (build storybook/webview + rigenerazione screenshot) — se richiede environment grafico non disponibile, segnalarlo come limite e affidarsi a `test:unit` + `compile`.
2. `cd packages/kilo-vscode && bun run compile` (prepare:cli-binary + prepare:sdk + bundle) — gate definitivo.
3. Smoke finale completo (come S5 sez. 6) su build compilata se fattibile, altrimenti sul `bun dev serve`.
4. Esecuzione finale di TUTTI i guard root + `test:unit` + `check-offline-invariants`.
5. Verifica `git rev-list --count leocode..origin/main` == 0.
6. Changelog + report di chiusura (tabella batch: cosa adottato/rifiutato; invarianti; guard; note残余).

**Output atteso**: estensione compilata, baseline rigenerati (o nota), changelog aggiornato, report finale per approvazione.

**Verifiche**: compile exit 0; tutti i guard exit 0; test:unit verde; rev-list 0; smoke green.

**Compilazione**: `bun run compile` deve riuscire; risolvere eventuali problemi di bundle prima di terminare.

**Rischi**: rigenerazione baseline può richiedere dipendenze native/grafiche non disponibili in ambiente → fallback documentato.

**Istruzioni per il subagente**: solo close-out; non fare modifiche funzionali (solo baseline/changelog/fix di build); esegui l'intera batteria di verifiche e riporta esiti uno a uno.

## Criteri di completamento

- Tutti gli step S0–S9 completati, ciascuno approvato dall'utente prima dello step successivo.
- `git rev-list --count leocode..origin/main` == 0 (main interamente integrata).
- Ogni step termina con codebase compilabile; l'unica eccezione prevista è assente (ogni batch è self-contained grazie al merge per range).
- Invarianti I1–I10 verificate con evidenza (grep + smoke) dopo S5 e re-verificate in S9.
- Estensione interamente offline: nessun package gateway/telemetry, nessun import live, route cloud 404, nessun fetch models.dev (snapshot), probe azzerate, env sanificate.
- Guard root verdi: typecheck, lint, check-workflows, check-forbidden-strings, check-md-table-padding, check-kilo-generated-artifacts, check-kilocode-duplication, check-offline-invariants.
- `test:unit` (runner anti-OOM) e `compile` verdi da `packages/kilo-vscode/`.
- Tooling: subagente `upstream-sync` presente, skill dichiarata (o fallback documentato), AGENTS.md de-staled, workflow orfano sanato, PRUNE-NOTES/upstream-sync aggiornati.
- Nessuna funzionalità extra introdotta; le feature online di main sono state rifiutate/neutralizzate, non reimplementate in modo parziale.