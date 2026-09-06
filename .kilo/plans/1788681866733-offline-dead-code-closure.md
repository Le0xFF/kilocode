# Piano — Chiusura offline: dead code e residui online rimasti nel fork VS Code

## Obiettivo

Chiusura definitiva dell'audit iniziato dai commit `1673a9f`, `cfacab5`, `969f948`, `5d613a0` di Le0xFF. Questo piano elenca ciò che è **sfuggito** alle passate implementazioni: codice morto, moduli ancora online, dipendenze orfane e residui di superficie non locali. Ogni step è autonomo, assegnato a un subagente diverso, sequenziale, e termina con compilazione + revisione utente.

## Analisi (cosa hanno trovato gli audit)

Il fronte offline principale è solido: provider tagliati da `inLocalSurface`, LSP/sharing/auto-update/probe rimossi, telemetria assente, env del child sanificata in parte. Restano invece le seguenti categorie di residuo:

| Categoria | Esempi principali | Dove |
|---|---|---|
| Moduli cloud mai rimossi | KiloClaw (client chat cloud), device-flow account, `cloud-session.ts` (no-op offline), fetch tree-sitter wasm da GitHub | `opencode/src/kilocode/{claw/,console/}`, `opencode/src/account/`, `kilocode/cloud-session.ts`, `tui/parsers-config.ts` |
| File/mappature morte post-cut | 6 provider files in `llm/src/providers/` non raggiungibili per la gate native, rami `model()` morti in `native-request.ts`, export morti in `cloud-auth.ts`, tabella `sdkKey()` con 20+ provider fuori superficie, `metadata.ts` notes/order, model-cache fetch machinery | `packages/llm/src/providers/*`, `opencode/src/session/llm/native-request.ts`, `kilocode/provider/cloud-auth.ts`, `provider/transform.ts` |
| Dipendenze orfane estensione | 9 deps + 1 devDep mai importati (`@kilocode/plugin`, `@vscode/codicons`, `diff`, `fastest-levenshtein`, `lru-cache`, `quick-lru`, `uri-js`, `web-tree-sitter`, `yaml`, `@vscode/vsce`) — invisibili a knip perché `knip.json` esclude `dependencies` | `kilo-vscode/package.json`, `knip.json` |
| Build residue | `out/` con `kiloclaw/` + `MarketplacePanelProvider.js` di feature rimosse; 9 dir package orfane su disco (`client`, `containers`, `extensions`, `httpapi-codegen`, `kilo-console`, `kilo-docs`, `kilo-jetbrains`, `kilo-web-ui`, `session-ui`) | repo |
| Residui UI webview | i18n orphan ×21 locale (`session.tab.cloud`, `notifications.action.*`), CSS `[data-component="remote-settings"]` senza consumer, key `remote_control` senza component, copy `settings.webTools.description` errata | `webview-ui/src/i18n/*`, `styles/prompt-input.css`, `types/messages/config.ts`, `settings-io.ts` |
| Env spawn incompleta | mancata strip di `NODE_OPTIONS` e `BUN_*`; `buildProxyEnv` non gestisce `ALL_PROXY`/`all_proxy` quando `proxySupport === "off"` | `kilo-vscode/src/services/cli-backend/server-manager.ts` |
| Doc/guard stantie | `PRUNE-NOTES.md` §Future work ancora "full offline is a separate follow-up"; `AGENTS.md` cita `check-opencode-annotations` rimosso; skill file bundled con URL app.kilo.ai; commenti `@aws-sdk` in esbuild.js; `vsc-extension-quickstart.md` in .vscodeignore | root |
| Costi gateway morti | `providerCost()` legge `metadata["openrouter"]`, `cost_details.upstream_inference_cost`, `metadata["gateway"].marketCost` | `opencode/src/kilocode/session/index.ts:213-237` |

Punti verificati **puliti** (da non toccare): schema/protocol/SDK rigenerati correttamente, route server (nessun `/kilo/*` né `/telemetry/*`), `groups/anaconda-desktop.ts` è LIVE (bridge estensione → HTTP → service), `agent/` e `control-plane/` live, embedder hosted dell'indexing già gated dalla UI, `ki.../account/` e `cloud-session.ts` sono GATED-online (decisione di prodotto, non cleanup).

## Assunzioni

- Il TUI resta nel fork come CLI opzionale (`kilo run`); si pulisce ma non si rimuove il package.
- I percorsi GATED-online già documentati in PRUNE-NOTES restano tali (webfetch, skills.urls, MCP remote/OAuth, browser automation via npx, embedders hosted, gh CLI, download on-demand, `kilo upgrade` manuale, link openExternal).
- Le mappature legacy-migration verso `kilo`/`openrouter` restano (wizard live, scelta di prodotto).
- `KILO_CLIENT`/`KILOCODE_FEATURE`/`KILO_MACHINE_ID` passati al child restano (placeholder innocui, nessun sink di telemetria nel CLI dopo il cut).
- Convenzione test: la macchina ha 32 core ma solo ~30GB di RAM. `bun test --parallel=N` avvia N worker isolati che caricano l'intero grafo moduli: parallelismo alto → OOM kill del kernel (verificato ripetutamente). Usare SEMPRE `--parallel=4` (mai sopra 4; scendere a 2 se ancora OOM). Comandi verificati stabili (~25GB available): da `packages/opencode/` → `bun test --parallel=4 --timeout 30000`; da `packages/kilo-vscode/` → `bun test tests/unit/ --parallel=4 --timeout 30000`. ATTENZIONE: NON usare `bun run test:unit` — il suo script è `bun test tests/unit/ --dots` senza cap di parallelismo e su 32 core parte ~32 worker → OOM; invocare bun direttamente come sopra. Verificare `free -m` tra comandi pesanti (available > 5GB prima del successivo).

## Piano di implementazione

### Step 1 — Rimuovere la superficie cloud del CLI: KiloClaw, account/device-flow, cloud-session no-op

**Obiettivo**: eliminare `opencode/src/kilocode/claw/` (9 file), `opencode/src/kilocode/console/`, `opencode/src/account/`, `opencode/src/kilocode/cloud-session.ts` e tutti i loro call site (TUI kiloclaw route + shim, CLI `--cloud-fork`, `kilo account*` comandi, route `/experimental/console*`).

**Motivazione**: è il più grande blocco di codice online sopravvissuto: client WS/HTTP verso backend cloud, login device-code, org switching. L'estensione non li usa mai.

**File da leggere**: `opencode/src/kilocode/claw/` (tutti), `opencode/src/kilocode/console/`, `opencode/src/account/`, `opencode/src/kilocode/cloud-session.ts`, `opencode/src/kilocode/cli/cmd/tui/app.tsx` (riga 30, 157), `tui/src/app.tsx` (~1063), `tui/src/plugin/adapters.tsx` (:70), `tui/src/context/route.tsx`, `cli/cmd/{account.ts,tui.ts,attach.ts,run.ts}`, `server/routes/instance/httpapi/handlers/experimental.ts` + group `groups/experimental.ts` (solo le parti console/org), `kilocode/server/httpapi/groups/config-console.ts` se esiste e chi lo importa, `sdk/js/src/v2/gen/*` (verificare che i metodi console spariscano o siano usati dall'estensione).

**File da modificare**: quelli sopra + eventuali test che li coprono (`opencode/test/**` riferimenti a claw/account/cloud-session/console).

**Attività**:
- Cancellare i tre dir + `cloud-session.ts`; rimuovere re-export e route Match dal TUI; togliere i flag/comandi CLI (`--cloud-fork`, `kilo account login/list/logout/switch`) e le route `/experimental/console*` solo se nessun caller vive nell'estensione (verificare con grep `console` in `kilo-vscode/src`).
- Se `config-console.ts` serve all'estensione (Agent Manager), separare: tenere il handler, togliere la dipendenza da `account/`.
- Rigenerare SDK se le route cambiano (`bun run script/generate.ts` da root).

**Output atteso**: zero referenze a `claw`, `account/`, `console.opencode.ai`, `--cloud-fork` in `opencode/src` e `tui/src`; SDK rigenerato coerente.

**Verifiche**: grep `kiloclaw|KiloClaw|console\.opencode|device.?flow|cloud-session` in entrambi i package → solo marker/commenti intenzionali; typecheck verde.

**Compilazione**: `bun turbo typecheck` da root; risolvere ogni errore introdotto.

**Rischi**: il TUI perde una vista; se l'utente usa `kilo tui` accetterà la perdita (documentare nel commit). Attenzione a non spezzare `config-console` usato dall'estensione.

**Istruzioni per il subagente**: implementa solo questo step; non anticipare gli altri; modifiche minime; compila alla fine; in caso di dubbio su un'API usa WebFetch/MCP prima di supporre.

---

### Step 2 — Pulizia del layer provider: provider files morti, rami native, cloud-auth, sdkKey, metadata, model-cache, providerCost

**Obiettivo**: rimuovere il codice morto del layer LLM/provider emerso dagli audit.

**Motivazione**: file e branch irraggiungibili a causa delle gate `inLocalSurface` / native-runtime; peso morto e fonte di confusione nei merge futuri.

**File da leggere**: `packages/llm/src/providers/{amazon-bedrock,cloudflare,github-copilot,google,openrouter,xai}.ts` + `providers/index.ts` + relativi test; `opencode/src/session/llm/native-request.ts` (:140-200) e `native-runtime.ts` (:40-70); `opencode/src/kilocode/provider/cloud-auth.ts`; `opencode/src/provider/transform.ts` (:44-98, :1450-1508); `opencode/src/kilocode/provider/metadata.ts`; `opencode/src/provider/model-cache.ts`; `opencode/src/kilocode/session/index.ts` (:213-237 `providerCost`).

**Attività**:
- In `llm/src/providers/`: verificare ogni file con grep di importatori reali (fuori test e `native-request.ts`); rimuovere i sei files se confermati morti + righe in `index.ts` + test associati.
- `native-request.ts`: cancellare i rami `@ai-sdk/azure`, `@ai-sdk/google`, `@ai-sdk/amazon-bedrock`, `@openrouter/ai-sdk-provider` (gate consente solo openai/openai-compatible/anthropic) e gli import ora inutilizzati.
- `cloud-auth.ts`: tenere solo `providerKey`; eliminare `bedrockAuth`, `vertexAuth`, `vertexOptions`, `vertexCredentials`.
- `transform.ts`: ridurre la switch di `sdkKey()` ai soli npm rilevabili nella superficie (openai, anthropic, openai-compatible + dynamic BYOK fallback generico); togliere le special-case `store:false`/usage/thinkingConfig dei provider fuori superficie mantenendo quelle di openai/anthropic/openai-compatible.
- `metadata.ts`: ridimensionare tabelle notes/order ai provider della superficie (mantenere lookup difensivo per id sconosciuti).
- `model-cache.ts`: rimuovere la machinery fetch/refresh/get cellulare; mantenere `failedProviders()`/`clear()`.
- `providerCost()`: togliere letture di `metadata["openrouter"]`, `upstream_inference_cost`, `metadata["gateway"].marketCost`; mantenere cost diretto/OpenAI-compat.

**Output atteso**: layer provider senza rami morti; comportamento identico per provider locali/BYOK.

**Verifiche**: typecheck; test targetizzati `packages/opencode/test` sui file toccati; grep che nessun id provider rimosso compaia più in codice live.

**Compilazione**: `bun turbo typecheck` da root + `bun test --parallel=30` da `packages/opencode/` (suite touchate).

**Rischi**: BYOP via `model.api.npm` arbitrario potrebbe aver dipeso da un ramo rimosso — la fallback generica deve restare; test di regressione sui custom provider.

**Istruzioni per il subagente**: solo questo step; niente refactoring extra; compila e testa alla fine; dubbi → WebFetch/MCP.

---

### Step 3 — Dependency pruning dell'estensione + riattivare knip sulle dependencies

**Obiettivo**: rimuovere da `packages/kilo-vscode/package.json` le 9 deps orfane (`@kilocode/plugin`, `@vscode/codicons`, `diff`, `fastest-levenshtein`, `lru-cache`, `quick-lru`, `uri-js`, `web-tree-sitter`, `yaml`) + devDep `@vscode/vsce`, e far sì che knip sorvegli le dependencies così non ricapita.

**Motivazione**: dipendenze mai importate sopravvissute a tutti i knip run perché `knip.json` esclude `dependencies`; ingrandiscono install e superficie attacco.

**File da leggere**: `packages/kilo-vscode/package.json`, `packages/kilo-vscode/knip.json`, `esbuild.js` (commento @aws-sdk :256), `.vscodeignore` (riga quickstart).

**Attività**:
- Verificare per ciascuna dep candidate con un grep `from "pkg"`/`require("pkg")` in `src/` + `webview-ui/src/` + `script/` + tests; togliere dalla `dependencies`/`devDependencies` quelle confermate orfane (`web-tree-sitter` va tolta: è runtime del child CLI via `bin/`, non dell'host).
- Aggiornare `knip.json`: rimuovere `dependencies` (e `optionalPeerDependencies` se inutile) dall'elenco ignorato, così CI blocca future orfane; se knip segnala falsi positivi (import dinamici/alias) configurare `include` mirati invece di re-escludere tutto.
- Aggiornare `bun.lock` (`bun install` da root).
- Opzionale nello stesso step: rimuovere il commento stale @aws-sdk in `esbuild.js` e la riga quickstart in `.vscodeignore`.

**Output atteso**: `package.json` snellito, lock coerente, knip verde con dependencies sotto sorveglianza.

**Verifiche**: `bun install --frozen-lockfile` da root; `bun run knip` da `packages/kilo-vscode`; `bun run compile` da `packages/kilo-vscode`.

**Compilazione**: bundle esbuild completo (compile) + typecheck estensione.

**Rischi**: import dinamici non staticamente visibili (es. plugin loading a runtime) — controllare `Npm.add`/dynamic imports prima di tagliare; knip può chiedere allowlist mirate.

**Istruzioni per il subagente**: solo questo step; mantenere modifiche minime; compila e lancia knip alla fine; dubbi → WebFetch/MCP.

---

### Step 4 — Residui UI webview: i18n orphan ×21, CSS remote-settings, key remote_control, copy webTools

**Obiettivo**: pulizia completa del webview dei residui delle feature rimosse.

**Motivazione**: stringhe/stili/contract entry orfane replicati in 21 locale = rumore nei merge e costi i18n perpetui.

**File da leggere**: `webview-ui/src/i18n/*.ts` (solo i blocchi da tagliare: `session.tab.cloud`, `notifications.action.next/close/tryModel/tryModelGeneric`), `webview-ui/src/styles/prompt-input.css` (:532-590), `webview-ui/src/types/messages/config.ts` (:143 `remote_control`), `webview-ui/src/components/settings/settings-io.ts` (:28 known-keys), `webview-ui/src/components/settings/BrowserTab.tsx` (titolo/descrizione), `tests/unit/i18n-unused-keys.test.ts` (lista protetta da aggiornare).

**Attività**:
- Rimuovere le 4 famiglie di chiavi orfane da tutti i 21 file locale (stesso pattern di taglio già fatto in 969f948) e aggiornare la protection list del test unused-keys.
- Cancellare i blocchi CSS `[data-component="remote-settings"]` (zero riferimenti TSX).
- Rimuovere `"remote_control"` dai known-keys di settings-io e la voce `Config.remote_control` da types (niente component la legge); se `config.ts` ha altre voci orfane analoghe verificate negli audit precedenti, tagliarle pure con evidenza.
- Correggere la descrizione i18n `settings.webTools.description` (non menziona più "web search").
- Non toccare `settings.experimental.share.*` (usate da ExperimentalTab) né `migration.select.autocomplete` (live).

**Output atteso**: webview senza strings/stili/contract di feature rimosse; test i18n aggiornato e verde.

**Verifiche**: `bun run test:unit -- --parallel=30` da `packages/kilo-vscode` (suite i18n + settings); typecheck estensione.

**Compilazione**: typecheck + unit suite; nessun error introdotto.

**Rischi**: tagliare una chiave usata da un componente non mappato → il test unused-keys e il lint storybook devono restare verdi.

**Istruzioni per il subagente**: solo questo step; usare Edit con replaceAll per i blocchi ripetuti tra locale; compila e testa alla fine.

---

### Step 5 — Completare la sanitization env dello spawn (`server-manager.ts`)

**Obiettivo**: chiudere i buchi identificati in `resolveManagedServerEnv`/`buildProxyEnv`.

**Motivazione**: oggi `NODE_OPTIONS` e le var `BUN_*` ereditate dal processo VS Code entrano nel child `kilo serve`; con `proxySupport === "off"` una `ALL_PROXY`/`all_proxy` ambientale sopravvive e instrada anche il loopback dietro proxy.

**File da leggere**: `packages/kilo-vscode/src/services/cli-backend/server-manager.ts` (funzioni `resolveManagedServerEnv`, `buildProxyEnv`, `resolveIndexingEnv`), `test/unit/server-manager-utils.test.ts` (pattern dei test esistenti).

**Attività**:
- In `resolveManagedServerEnv`: aggiungere alla strip la prefix family `BUN_` e la singola var `NODE_OPTIONS`.
- In `buildProxyEnv`: nel ramo `proxySupport === "off"` cancellare anche `ALL_PROXY`/`all_proxy` (oggi si azzerano solo le 6 già trattate). Nel ramo con proxy mantenere il comportamento attuale (re-add intenzionale) ma assicurarsi che `NO_PROXY/no_proxy` includa sempre `127.0.0.1,localhost` quando l'utente non ne specifica uno, così il loopback bypassa il proxy.
- Estendere `server-manager-utils.test.ts` con casi: `NODE_OPTIONS`/`BUN_INSTALL` in input spariscono dall'env result; `ALL_PROXY` ambientale con `off` non compare; con proxy attivo `NO_PROXY` contiene il loopback.

**Output atteso**: env del child deterministicamente offline salvo proxy esplicitamente configurato dall'utente.

**Verifiche**: `bun run test:unit -- -t server-manager --parallel=30` da `packages/kilo-vscode`; typecheck.

**Compilazione**: typecheck estensione + test unit.

**Rischi**: utenti con setup corporate che si affidavano a `NODE_OPTIONS` nel child — accettato e documentato nel commit message.

**Istruzioni per il subagente**: solo questo step; niente refactoring della struttura delle funzioni; compila e lancia i test alla fine.

---

### Step 6 — TUI offline: stop download tree-sitter wasm, tips stale, PluginManager npm-gated

**Obiettivo**: rendere la TUI (`kilo run`) funzionante offline: niente fetch runtime da GitHub releases, niente tip che invitano a comandi online rimossi.

**Motivazione**: `parsers-config.ts` scarica `.wasm` da GitHub release al runtime (fallimento silenzioso offline); `HomeTips` cita `opencode github install`, `/connect with OpenCode Zen`, `opencode auth list`; il PluginManager installa plugin via npm registry.

**File da leggere**: `packages/tui/src/parsers-config.ts`, `packages/tui/src/feature-plugins/home/tips-view.tsx` (:247, :250, :279), `packages/tui/src/feature-plugins/builtins.ts` (PluginManager wiring).

**Attività**:
- `parsers-config.ts`: se il wasm è già vendored in `bin/tree-sitter/` (l'estensione lo shippa via `KILO_TREE_SITTER_WASM_DIR`), preferire sempre il percorso locale e scaricare da GitHub solo come fallback esplicito (flag opt-in, default off) oppure rimuovere del tutto il download con messaggio chiaro.
- `tips-view.tsx`: sostituire le tre tip stale con tip valide offline (modelli local, MCP, worktree/agent manager).
- PluginManager: etichettare in UI che l'install richiede npm registry (già gated: azione utente); nessuna change comportamentale forzata.

**Output atteso**: `kilo tui` avviabile e navigabile senza rete; zero fetch automatici.

**Verifiche**: typecheck root; test TUI touchati; grep `github.com/` in `tui/src` → solo link cosmetici.

**Compilazione**: `bun turbo typecheck` da root.

**Rischi**: utenti con parser tree-sitter non vendored perdono la syntax highlighting fino a reinstall — documentare.

**Istruzioni per il subagente**: solo questo step; mantenere il TUI compilabile; compila alla fine; dubbi → WebFetch/MCP.

---

### Step 7 — Repo hygiene: dir package orfane, `out/` stale, doc guard stantie

**Obiettivo**: allineare disco e documentazione allo stato reale del fork.

**Motivazione**: 9 dir package prunte ma ancora su disco; `kilo-vscode/out/` contiene build output di feature rimosse (kiloclaw, MarketplacePanelProvider); PRUNE-NOTES/AGENTS.md contengono affermazioni ormai false.

**File da leggere**: `PRUNE-NOTES.md` (§ Future work + § Surviving package set), `AGENTS.md` (riferimento a `check-opencode-annotations`), `packages/opencode/src/kilocode/skills/kilo-config.md` (:225 URL app.kilo.ai), `.gitignore`/.vscodeignore per `out/`.

**Attività**:
- Cancellare le 9 dir orfane: `packages/{client,containers,extensions,httpapi-codegen,kilo-console,kilo-docs,kilo-jetbrains,kilo-web-ui,session-ui}` (verificare prima che `script/check-kilo-generated-artifacts.ts` e `opencode/script/build.ts` non leggano qualcosa dentro di esse oltre i guard esistenti).
- Cancellare `packages/kilo-vscode/out/` (gitignored, rigenerabile da compile/test).
- PRUNE-NOTES.md: muovere "Full offline operation" da Future work a done (citando i 4 commit), aggiornare la lista dead-code che non include più gateway/telemetry come dirs (sono già andate), confermare la matrice finale.
- AGENTS.md: correggere la sezione opencode annotation check (script rimosso con la fork-sync toolchain; i marker restano validi manualmente) — speculare quanto già fatto in PRUNE-NOTES.
- `kilo-config.md` skill: aggiornare l'URL di esempio `https://app.kilo.ai/config.json` a un riferimento locale/neutro.

**Output atteso**: repo con solo i 22 workspace dichiarati + `opencode` load-bearing; doc coerenti.

**Verifiche**: `ls packages/` mostra solo i package del workspace; `bun install --frozen-lockfile` OK; `bun run script/check-workflows.ts` + `check-md-table-padding.ts` + `check-forbidden-strings.ts` da root.

**Compilazione**: install + guards; typecheck non impattato ma eseguirlo per sicurezza.

**Rischi**: qualche script potrebbe path-referenziare un dir orfano — i guards in verifica lo catchano.

**Istruzioni per il subagente**: solo questo step; cancellazioni verificate da grep prima di eseguire; compila/guards alla fine.

---

### Step 8 — Chiusura: verifica finale end-to-end e note di rilascio

**Obiettivo**: prova finale che il sistema è chiuso e documentazione del risultato.

**Motivazione**: ogni step precedente ha verificazioni parziali; serve una verifica integra pre-rilascio.

**File da leggere**: `PRUNE-NOTES.md` (matrice gated vs absent), CHANGELOG dell'estensione.

**Attività**:
- Da root: `bun run lint`, `bun turbo typecheck`, guards (`check-workflows`, `check-md-table-padding`, `check-forbidden-strings`, `check-kilo-generated-artifacts`).
- Da `packages/opencode/`: `bun run typecheck` + `bun test --parallel=30` (notare failure baseline pre-esistenti confermati via A/B se presenti).
- Da `packages/kilo-vscode/`: `bun run typecheck && bun run lint && bun run knip && bun run check-kilocode-change && bun run test:unit -- --parallel=30 && bun run compile`.
- Smoke offline: avviare `kilo serve` con `OPENCODE_API_KEY` dummy e provider openai-compatible locale; verificare (curl) che GET /provider esponga solo provider locali/dichiarati, che non ci siano connessioni outbound (es. `ss -tnp` durante una sessione con provider down), e che nessuna route `/kilo/*`, `/telemetry/*`, `/experimental/console` risponda.
- Appendere a `packages/kilo-vscode/CHANGELOG.md` l'entry di chiusura offline; aggiornare la matrice PRUNE-NOTES con l'esito.

**Output atteso**: tutte le verifiche verdi; changelog aggiornato; dichiarazione finale di chiusura.

**Verifiche**: come elenco attività.

**Compilazione**: implicita nelle verifiche; nessun error nuovo tollerato.

**Rischi**: failure di test pre-esistenti (baseline) — distinguere con stash A/B come già fatto in 5d613a0.

**Istruzioni per il subagente**: solo verifiche e doc; non modificare codice sorgente salvo fix minimi di errori scoperti (in tal caso riportarli nel report); compila tutto alla fine.

## Criteri di completamento

- Tutti gli 8 step completati, ciascuno con compilazione verde e revisione utente approvata.
- Zero referenze live a KiloClaw, account device-flow, cloud-session, console routes, provider fuori superficie, deps orfane.
- Knip sorveglia le dependencies dell'estensione.
- Smoke test offline: solo provider locali nel catalogo, zero connessioni outbound non gated.
- PRUNE-NOTES/AGENTS.md/CHANGELOG coerenti con lo stato finale.
- Nessuna funzionalità extra introdotta; i percorsi gated-online restano documented invariati.