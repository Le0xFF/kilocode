# Piano: rimuovere la selezione dei modelli "Kilo Gateway" rimasta nel model picker

## Obiettivo

Dopo il piano precedente (whitelist-only), il model picker dell'estensione mostra ancora un gruppo **"Kilo Gateway"** con decine di modelli online (AionLabs, Amazon Nova, Anthropic Claude …). Questo deve sparire completamente: il picker deve mostrare solo i provider locali in superficie (whitelist ∪ configurati ∪ connessi-legittimi) e i custom BYOK dell'utente.

## Analisi

### Perché il bug resta nonostante il taglio degli step precedenti

Pipeline dati verificata:

1. Il webview popola il model picker da `KiloProvider.ts:2303`: `providers: indexProvidersById(response.all)` dove `response` è il payload di `GET /provider`.
2. Nel backend (`packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts`):
   - riga 48: `const all = overlayAnacondaDesktop(yield* ModelsDev.Service.use(s => s.get()))` — catalogo grezzo.
   - riga 53 (Step 4): `const catalog = pickBy(all, (_item, id) => inLocalSurface(id, new Set(Object.keys(config.provider ?? {}))))` — filtra solo per **whitelist ∪ config.provider**.
   - righe 61-70: `const connected = yield* provider.list()` poi `providers = Object.assign(mapValues(filtered, ...), connected)` — i provider **connessi** vengono fusi sopra il catalogo filtrato.
   - riga 76-79: `validProviders = pickBy(providers, item => models>0 || id in connected || failedSet.has(id))`.
   - riga 81: `all: Object.values(validProviders).map(...)` → spedito al webview.

**Gap**: `inLocalSurface` non conosce i provider *connessi*. Se un provider entra in `connected` pur essendo fuori dalla whitelist (es. `kilo`, che si auto-carica dallo snapshot/cache locale perché ha un modello a costo zero e nessun requisito di credenziale), passa comunque in `all` con la sua lista completa di modelli → il gruppo "Kilo Gateway" compare nel picker.

La fonte dei dati del backend in dev è `KILO_MODELS_DEV` (snapshot bundled, generato da `script/generate.ts` da models.dev, contiene `kilo` + tutti i built-in online) oppure la cache utente `~/.local/share/kilo/cache/models.json` (stesso contenuto). Con `KILO_DISABLE_MODELS_FETCH=true` (forzato da `server-manager.ts:40`) non si fetcha, ma snapshot/cache contengono comunque `kilo`.

### Dove vive il residuo "Kilo Gateway"

- **Runtime (causa diretta)**: `kilo` entra in `connected` (auto-load) e quindi in `all` → picker. Fix: estendere il filtro whitelist ai connessi.
- **Stringhe UI residue** (non più raggiungibili una volta tolto `kilo` dal dato, ma vanno pulite):
  - `packages/opencode/src/kilocode/components/kilo-error-display.tsx:44` — "Run /connect or `kilo auth login` to connect to Kilo Gateway"
  - `packages/opencode/src/kilocode/cli/cmd/tui/feature-plugins/home/tips.ts:170` — tip "/connect with Kilo Gateway"
  - `packages/opencode/src/kilocode/cli/cmd/tui/app.tsx:191,202` — commenti "Registers Kilo Gateway commands"
- **Logica `kilo-auto/*`** (funziona solo per sessioni esistenti su `kilo`; con `kilo` tolto dal dato è dead code ma inoffensiva):
  - `packages/opencode/src/kilocode/session/routed-model.ts:49-50`
  - `packages/opencode/src/kilocode/cli/cmd/tui/routes/session/routed-model-meta.tsx:45`
- **Test/story con fixture `kilo`/`Kilo Gateway`** (da ri-puntare o rimuovere):
  - `packages/kilo-vscode/tests/unit/session-model-store.test.ts:20,23`
  - `packages/kilo-vscode/tests/unit/model-usage.test.ts:25,50`
  - `packages/kilo-vscode/tests/unit/provider-actions-save.test.ts:479,481`
  - `packages/kilo-vscode/webview-ui/src/stories/StoryProviders.tsx:70`
  - `packages/kilo-vscode/webview-ui/src/stories/chat.stories.tsx:1303`
- **Fixture models.dev** contenente `kilo` + `kilo-auto/*` (usate dai test opencode; va rimosso l'id `kilo` così i test riflettono il nuovo comportamento):
  - `packages/opencode/test/tool/fixtures/models-api.json` (blocco `"kilo"` ~riga 107950)
  - Eventuali altre fixture `models-dev.json` in `packages/core/test/plugin/fixtures/`.

### Vincoli

- Marker `kilocode_change` nei file ereditati (`core/src/models-dev.ts`, `opencode/src/provider/provider.ts`, `handlers/provider.ts`). I file sotto `src/kilocode/` non richiedono marker.
- Fork isolation: logica Kilo in mirror file sotto `src/kilocode/`.
- Knip/Ci: export rimossi devono essere importati o tolti; `check-kilocode-change`, typecheck, lint, unit test corrono in CI.
- L'estensione usa solo `kilo serve`; TUI rompibile accettabile.

## Assunzioni

- [A1] Estendere il filtro a `LOCAL_PROVIDER_IDS ∪ config.provider ∪ connected` è sufficiente e corretto: un provider connesso legittimo (locale autodetect come `llamacpp`, o un custom BYOK dell'utente) deve restare; `kilo` smette di connettersi perché il suo id non è in nessuna delle tre fonti (dopo aver rimosso `kilo` dalle fixture/snapshot usate in dev).
- [A2] Per far sì che `kilo` non rientri più in `connected`, si rimuove l'id `kilo` (+ suoi modelli `kilo-auto/*`) dalle **fixture** models.dev usate dai test e si prevede che lo snapshot bundled di build venga rigenerato senza `kilo` (la generazione usa models.dev; se models.dev non espone più `kilo` dopo la removal del gateway, lo snapshot successivo non lo conterrà). In dev, finché lo snapshot bundled corrente contiene `kilo`, il filtro esteso da solo non basta a nasconderlo dal picker **se** `kilo` resta in `connected`; quindi questo piano include anche la rimozione di `kilo` dalla fonte dati di dev (fixture + istruzione per rigenerare/cleanare la cache utente).
- [A3] Le stringhe "Kilo Gateway" nei componenti TUI/error-display sono cosmetiche e vanno rimosse/sostituite (il gateway non esiste più).
- [A4] I test/story che usano `kilo`/`Kilo Gateway` come fixture vanno ri-puntati a un provider locale neutro (es. `lmstudio`) o rimossi se testavano comportamento gateway-specifico.

## Piano di implementazione

Ogni step è eseguito da un subagente distinto, sequenziale, e termina con compilazione (typecheck verde) e revisione utente. Ordine: prima la fix del dato (così il picker si svuota subito), poi la pulizia di stringhe/test/fixture.

---

### Step 1 — Estendere il filtro whitelist ai provider connessi (fix del dato)

**Obiettivo**

Far sì che `GET /provider.all` (e quindi il model picker) mostri solo i provider in superficie, dove superficie = `LOCAL_PROVIDER_IDS ∪ {id ∈ config.provider} ∪ {id ∈ connected}`. I provider connessi legittimi restano; quelli non in superficie ma forzatamente connessi (come `kilo` nello snapshot stantio) vengono esclusi.

**Motivazione**

Chiude il gap identificato: oggi `connected` viene fuso in `all` senza passare dal filtro whitelist, quindi qualsiasi provider connesso fuori-superficie (kilo) appare nel picker.

**File da leggere**

- `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts` (righe 40-89, costruzione di `all`/`catalog`/`filtered`/`connected`/`validProviders`)
- `packages/opencode/src/kilocode/local-providers.ts` (`inLocalSurface`, `LOCAL_PROVIDER_IDS`)
- `packages/opencode/src/provider/provider.ts` (righe 1385-1395, il taglio già presente a livello Provider service, per coerenza)

**File da modificare**

- `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts`:
  - Calcolare `const connectedIds = new Set((yield* provider.list()) ? Object.keys(...) : [])` **prima** di applicare il filtro (attualmente `connected` si legge alla riga 61; anticipare la lettura o riusarla).
  - Sostituire il filtro a riga 53 con una versione che ammette anche i connessi:
    `const catalog = pickBy(all, (_item, id) => inLocalSurface(id, new Set([...Object.keys(config.provider ?? {}), ...connectedIds])))`
    (passando l'unione config.provider + connected come `configuredIds`).
  - Aggiungere/markare il blocco con `kilocode_change` (preservando i marker esistenti).

**Attività**

- Leggere la funzione, individuare il punto esatto in cui `connected` diventa disponibile.
- Applicare il filtro esteso.
- Verificare che i provider locali autodetect (llamacpp/ninfer) e i custom BYOK restino in `all`.

**Output atteso**

`GET /provider.all` non contiene provider fuori-superficie nemmeno se fossero in `connected` nello snapshot stantio. In dev, se `kilo` è ancora nello snapshot e si auto-connette, ora viene escluso dal dato → il gruppo "Kilo Gateway" scompare dal picker.

**Verifiche**

- Smoke: `bun run --conditions=browser ./src/index.ts serve --port 0` da `packages/opencode/` con `KILO_DISABLE_MODELS_FETCH=1`; `curl /provider` → `all` contiene solo whitelist/configurati/connessi-legittimi; `kilo` assente.
- `bun turbo typecheck` verde.

**Compilazione**

- `bun turbo typecheck`. Risolvere errori.

**Rischi**

- Se `connected` viene letto dopo il filtro nel codice attuale, occorre riordinare: calcolare `connectedIds` prima del `pickBy`. Attenzione a non cambiare l'ordine semantico di `failed`/`validProviders`.
- Un custom BYOK connesso deve restare visibile: garantito perché è in `config.provider`.

**Istruzioni per il subagente**

- Solo questo step. Non toccare UI né stringhe.
- Preserva i marker `kilocode_change`.
- Compila e fai smoke prima di terminare.
- Se hai dubbi sul punto esatto in cui `connected` è disponibile, leggi attentamente `handler` e usa WebFetch/MCP se serve.

---

### Step 2 — Rimuovere `kilo` dalla fonte dati di dev (fixture + snapshot) e dalla cache

**Obiettivo**

Togliere l'id `kilo` (+ modelli `kilo-auto/*`) dalla fonte dati models.dev usata in dev/test, così `kilo` non si auto-collega più in `connected` nemmeno con lo snapshot stantio. Indirizza la rigenerazione dello snapshot bundled e la pulizia della cache utente.

**Motivazione**

Con Step 1 il filtro esteso nasconde `kilo` dal picker anche se connesso; ma per coerenza del dato (e per i test opencode che usano la fixture) `kilo` va rimosso alla fonte. Senza questo, i test opencode che presuppongono l'assenza di `kilo` potrebbero fallire e lo snapshot bundled continuerebbe a portarlo.

**File da leggere**

- `packages/opencode/test/tool/fixtures/models-api.json` (blocco `"kilo"` ~riga 107950)
- `packages/core/test/plugin/fixtures/models-dev.json` (se contiene `kilo`)
- `packages/opencode/script/generate.ts` (come si genera `KILO_MODELS_DEV`)
- `packages/opencode/script/build.ts:362` (iniezione `KILO_MODELS_DEV`)

**File da modificare**

- `packages/opencode/test/tool/fixtures/models-api.json` — rimuovere l'intera entry `"kilo": {...}` (tutti i modelli `kilo-auto/*`).
- Eventuale `packages/core/test/plugin/fixtures/models-dev.json` — rimuovere `kilo` se presente.
- (Opzionale, se fattibile in ambiente) Rigenerare lo snapshot bundled: `bun run script/generate.ts` dalla root, oppure documentare che serve una rebuild. Pulire la cache utente `~/.local/share/kilo/cache/models.json` (o rinominare) affinché il dev ripartisca dallo snapshot aggiornato.

**Attività**

- Rimuovere l'entry `kilo` dalle fixture JSON (mantenendo JSON valido).
- Verificare che nessun test opencode dipenda da `kilo` nella fixture (gli step precedenti hanno già re-pointato le fixture sui provider locali; controllare eventuali residui).
- Se possibile, rigenerare/cleanare la cache+snapshot così il backend di dev non vede più `kilo`.

**Output atteso**

Nessuna fonte dati di dev contiene `kilo`; `kilo serve` in dev non lo produce in `connected`.

**Verifiche**

- `grep '"kilo"'` nelle fixture → assente.
- Smoke `kilo serve` → `connected` senza `kilo`.
- `bun test` (opencode, suite provider) verde.
- `bun turbo typecheck` verde.

**Compilazione**

- `bun turbo typecheck`. Risolvere errori.

**Rischi**

- Modificare un grande JSON a mano: usare un tool (es. `jq 'del(.["kilo"])'`) per non corrompere la sintassi.
- Se la cache utente non è pulita, il dev potrebbe continuare a vedere `kilo`; in quel caso Step 1 da solo garantisce l'assenza dal picker.

**Istruzioni per il subagente**

- Solo questo step. Non toccare UI/stringhe (Step 3).
- Usa `jq` o uno script per editare il JSON in sicurezza.
- Compila e verifica i test provider prima di terminare.

---

### Step 3 — Pulizia stringhe "Kilo Gateway" e logica `kilo-auto/*` residua

**Obiettivo**

Rimuovere le stringhe UI/commenti "Kilo Gateway" e snellire la logica `kilo-auto/*` divenuta dead code, così non resta alcun riferimento al gateway morto.

**Motivazione**

Chiusura cosmetica: il gateway non esiste più; le menzioni residue sono fuorvianti.

**File da leggere / modificare**

- `packages/opencode/src/kilocode/components/kilo-error-display.tsx:44` — sostituire/rimuovere "…connect to Kilo Gateway".
- `packages/opencode/src/kilocode/cli/cmd/tui/feature-plugins/home/tips.ts:170` — rimuovere/aggiornare la tip.
- `packages/opencode/src/kilocode/cli/cmd/tui/app.tsx:191,202` — aggiornare i commenti.
- `packages/opencode/src/kilocode/session/routed-model.ts:49-50` — valutare se il ramo `kilo-auto/`/`openrouter/`/`fable` è ancora utile; se serve solo per `kilo`, semplificare (tenere i rami per altri id se usati altrove).
- `packages/opencode/src/kilocode/cli/cmd/tui/routes/session/routed-model-meta.tsx:45` — stesso trattamento.

**Attività**

- Grep globale `kilo-auto|Kilo Gateway|Kilo gateway` in `packages/opencode/src` e `packages/kilo-vscode` per trovare ogni residuo.
- Rimuovere/sostituire le stringhe (file `kilocode/` non richiedono marker).
- Semplificare la logica `kilo-auto/*` solo se confermata dead (verificare gli altri usi di `readAuto`/`routed-model-meta`).

**Output atteso**

Nessuna stringa "Kilo Gateway" residua nella UI/TUI; logica `kilo-auto` snellita.

**Verifiche**

- `rg -i "kilo gateway|kilo-auto" packages/opencode/src packages/kilo-vscode` → solo riferimenti voluti/assenti.
- `bun turbo typecheck` verde.

**Compilazione**

- `bun turbo typecheck`. Risolvere errori.

**Rischi**

- `routed-model.ts`/`routed-model-meta.tsx` potrebbero servire ancora per modelli `openrouter/*` o `fable` in sessioni esistenti: rimuovere solo il ramo `kilo-auto/` se isolabile, altrimenti lasciare (è inoffensivo).

**Istruzioni per il subagente**

- Solo questo step. Non toccare test/story (Step 4).
- File `kilocode/` non richiedono marker; file ereditati sì.
- Compila prima di terminare.

---

### Step 4 — Ri-puntare test e story con fixture `kilo`/`Kilo Gateway`

**Obiettivo**

Aggiornare i test unit e le story del webview che usano `kilo`/`Kilo Gateway` come fixture, ri-puntandoli a un provider locale neutro o rimuovendoli se testavano comportamento gateway-specifico.

**Motivazione**

Con `kilo` rimosso dal dato, queste fixture sono anacronistiche; i test devono riflettere la superficie offline.

**File da modificare**

- `packages/kilo-vscode/tests/unit/session-model-store.test.ts:20,23` — `KILO_AUTO`/`kilo` → provider locale (es. `lmstudio` + modello esistente).
- `packages/kilo-vscode/tests/unit/model-usage.test.ts:25,50` — fixture `Kilo Gateway` → locale; adeguare l'assert sul nome gruppo se necessario.
- `packages/kilo-vscode/tests/unit/provider-actions-save.test.ts:479,481` — `all: [{id:"kilo", name:"Kilo Gateway",...}]` e `default: {kilo:"kilo-auto/frontier"}` → locale.
- `packages/kilo-vscode/webview-ui/src/stories/StoryProviders.tsx:70` — mock "pre-loaded Kilo Gateway model" → locale.
- `packages/kilo-vscode/webview-ui/src/stories/chat.stories.tsx:1303` — `name: "Kilo Gateway"` → locale.

**Attività**

- Per ogni file: sostituire l'id/nome `kilo`/`Kilo Gateway` con un provider locale coerente (es. `lmstudio`/`LMStudio` + un modello presente nella fixture) mantenendo intatte le asserzioni di comportamento.
- Se un test verifica specificamente il routing `kilo-auto/*`, valutarne la rimozione (comportamento gateway morto).

**Output atteso**

Nessun test/story fa riferimento a `kilo`/`Kilo Gateway`; tutti passano.

**Verifiche**

- Da `packages/kilo-vscode/`: `bun run test:unit` verde; `bun run typecheck` + `bun run lint` verdi.
- `rg "kilo|Kilo Gateway" packages/kilo-vscode/tests packages/kilo-vscode/webview-ui/src/stories` → pulito.

**Compilazione**

- Da `packages/kilo-vscode/`: `bun run typecheck` + `bun run lint`. Risolvere errori.

**Rischi**

- Adeguare le asserzioni senza indebolirle: mantenere lo stesso comportamento testato, solo su un altro provider.

**Istruzioni per il subagente**

- Solo questo step. Non toccare runtime (Step 1-3).
- Mantieni le modifiche minime.
- Compila (typecheck+lint) ed esegui i test unit prima di terminare.

---

### Step 5 — Guard finali e validazione end-to-end

**Obiettivo**

Eseguire tutte le guard CI e validare che il model picker non mostri più "Kilo Gateway" né alcun built-in online.

**Motivazione**

Chiusura: tutto verde e bug risolto visivamente.

**Attività**

- Da `packages/kilo-vscode/`: `bun run knip`, `bun run check-kilocode-change`, `bun run typecheck`, `bun run lint`, `bun run test:unit`.
- Dalla root: `bun run script/check-workflows.ts`, `bun run script/check-md-table-padding.ts`, `bun turbo typecheck`.
- Smoke visiva: `bun run extension` (o `extension:isolated`) → Aprire Impostazioni → tab Models → verificare che il picker non elenchi "Kilo Gateway" né built-in online; solo locali/custom.
- `rg -i "kilo gateway|kilo-auto" packages/` → solo riferimenti voluti.

**Output atteso**

Guard verdi; picker senza "Kilo Gateway".

**Compilazione**

- Tutte le guard passano; risolvere ciò che le modifiche introducono.

**Rischi**

- Se la cache utente locale contiene ancora `kilo`, lo snapshot di dev potrebbe mostrarlo: in quel caso pulire la cache (`rm ~/.local/share/kilo/cache/models.json`) e rilanciare, oppure affidarsi a Step 1 (filtro esteso) che lo nasconde comunque dal picker.

**Istruzioni per il subagente**

- Solo questo step (chiusura).
- Eseguire TUTTE le guard e farle passare.
- Validare visivamente il picker prima di terminare.

---

## Criteri di completamento

- Tutti gli step (1-5) completati, ciascuno verificabile in modo indipendente.
- Ogni step termina con codebase compilabile (typecheck verde).
- Il model picker **non** mostra più il gruppo "Kilo Gateway" né alcun built-in online: solo provider locali in superficie (whitelist ∪ configurati ∪ connessi-legittimi) + custom BYOK.
- `kilo serve` avvia; `GET /provider.all` contiene solo provider in superficie.
- Nessuna stringa "Kilo Gateway" residua in UI/TUI; logica `kilo-auto/*` snellita.
- Test e story ri-puntati a provider locali; tutti passanti.
- Guard CI verdi: `knip`, `check-kilocode-change`, `check-workflows`, `check-md-table-padding`, typecheck, lint, unit test.

## Domande aperte / out of scope

- [Q1] **Snapshot bundled**: si mantiene il meccanismo `KILO_MODELS_DEV`; `kilo` esce dallo snapshot alla prossima rigenerazione da models.dev (che non lo espone più post-gateway). Out of scope riscrivere lo snapshot a mano oltre alle fixture di test.
- [Q2] **Sessioni esistenti** su `kilo`/`kilo-auto/*`: restano valide a livello dati (out of scope la migrazione), coerente col piano precedente.
- [Q3] **Cache utente** `~/.local/share/kilo/cache/models.json`: se contiene `kilo`, va pulita una tantum in dev; il filtro esteso (Step 1) garantisce comunque l'assenza dal picker.