# Piano: eliminare definitivamente "Kilo Gateway" dal model picker (fix hard-cut + dati)

## Obiettivo

Il model picker dell'estensione mostra ancora il gruppo **"Kilo Gateway"** con decine di modelli online (AionLabs, Amazon Nova, Anthropic Claude …). Il piano precedente aveva esteso il filtro whitelist ai provider connessi, ma nel runtime reale del VS Code extension host `kilo` rientra comunque in `connected` e passa in `all`. Questo piano chiude il buco per sempre con un **hard cut** del catalogo grezzo a livello server, più la pulizia dei dati (snapshot/cache) e la rebuild del binario.

## Analisi

### Perché il bug resta nonostante gli step 1-5

Pipeline verificata (fonti):

| Fonte | Contenuto | Effetto |
|---|---|---|
| Binario `packages/kilo-vscode/bin/kilo` | snapshot `KILO_MODELS_DEV` embedded alla build (`build.ts:362` via `script/generate.ts`, che fetcha `models.dev/api.json`) | contiene `kilo` + tutti i built-in online finché models.dev li espone |
| Cache utente `~/.local/share/kilo/cache/models.json` | scritta dal fetch live; oggi **non esiste** ma viene creata al primo avvio | stesso contenuto dello snapshot |
| Fetch live da `https://models.dev/api.json` | `Flag.KILO_DISABLE_MODELS_FETCH` **non è impostato** dallo spawner (`server-manager.ts:122-164`) né dal binario | TTL 5 min, poi refetch ogni 60 min (`core/src/models-dev.ts:176,268-271`) → reintroduce `kilo` anche dopo aver pulito la cache |
| `auth.json` | `{}` (verificato) | nessun credential per `kilo`; l'auto-connect avviene perché `kilo` ha modelli a costo zero e nessun requisito di credenziale |

Catena causale esatta:

1. `GET /provider` → handler `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts`:
   - riga 50: `const all = overlayAnacondaDesktop(yield* ModelsDev.Service.use((s) => s.get()))` — catalogo **grezzo** (snapshot embedded o cache/fetch live), include `kilo` con ~367 modelli.
   - riga 61 (Step 1): `catalog = pickBy(all, (_item, id) => inLocalSurface(id, ids))` con `ids = config.provider ∪ creds ∪ connectedIds`.
   - righe 69-76: `providers = Object.assign(mapValues(filtered, fromModelsDevProvider), connected)` — **i provider connessi vengono fusi sopra il catalogo filtrato**, bypassando il filtro.
   - righe 83-86: `validProviders` tiene chi ha modelli > 0 oppure è in `connected`.
   - `kilo` è in `connected` (auto-connesso) → compare in `all` con tutta la sua lista di modelli → gruppo "Kilo Gateway" nel picker.
2. `inLocalSurface` (`src/kilocode/local-providers.ts`): `LOCAL_PROVIDER_IDS = {lmstudio, atomic-chat, privatemode-ai}` ∪ configuredIds. `kilo` non è in nessuna delle tre fonti, ma basta essere in `connected` per passare.

Nota: `llamacpp`/`ninfer4090` apparsi nei test smoke sono provider configurati dall'utente (sono in `config.provider`); restano legittimamente in superficie.

### Il fix definitivo: hard cut lato server

`Provider.Service.list()` (il provider di `connected`) deriva da `InstanceState.state` costruito in `packages/opencode/src/provider/provider.ts:572-576`:

```ts
const modelsDev = yield* modelsDevSvc.get()
const filteredCatalog = pickBy(modelsDev, (_item, id) => inLocalSurface(id, new Set(Object.keys(cfg.provider ?? {}))))
const catalog = mapValues(filteredCatalog, fromModelsDevProvider)
```

Quindi **ogni provider che entra in `connected` è già in `whitelist ∪ config.provider`**: se applichiamo lo stesso hard cut al catalogo grezzo dell'handler HTTP (`all`), allora `kilo` (e ogni altro built-in online fuori-superficie) è assente sia da `catalog` sia da `connected` → impossibile in `all`. I provider legittimi non sono toccati:

- locali autodetect/whitelist (`lmstudio`, `atomic-chat`, `privatemode-ai`): in `LOCAL_PROVIDER_IDS`;
- custom BYOK e locali configurati (`llamacpp`, `ninfer4090`, …): in `config.provider` → passano sia il cut del service (che li estende in `database` alle righe 660-665) sia quello dell'handler;
- il merge `Object.assign(…, connected)` resta come safety net per provider/plugin che entrano in `connected` senza passare dal catalogo (es. plugin auth type come openai/Codex): per costoro il cut dell'handler ammette gli id connessi, quindi non regrediscono.

Con questo cut il gruppo "Kilo Gateway" scompare **indipendentemente da** snapshot, cache, fetch live e versione del binario embedded: il dato grezzo può contenere `kilo`, il server non lo espone.

La parte "dati" (snapshot/cache) resta utile per coerenza (test opencode, TUI `kilo models`, meno memoria occupata nello snapshot) ed elimina il rischio che altre code path leggano il catalogo grezzo.

## Assunzioni

- [A1] Applicare `inLocalSurface(id, config.provider ∪ connectedIds)` nell'handler è sufficiente e corretto: un provider connesso legittimo (locale autodetect, custom BYOK, plugin-auth) resta visibile; i built-in online fuori-superficie (kilo, openrouter, anthropic, …) sono esclusi da `all`.
- [A2] `Provider.Service` mantiene il suo cut esistente (`provider.ts:574`) invariato: con l'hard cut nell'handler, i due filtri coincidono e si rafforzano a vicenda.
- [A3] In dev, finché il binario embeddato contiene `kilo` nello snapshot, il fetch live da models.dev continua a ri-popolare la cache: l'hard cut rende tutto ciò irrilevante per il picker; la pulizia di snapshot/cache resta solo per igiene.
- [A4] Ricalibrare le asserzioni dei test sull'output di `/provider` è accettabile: riflettono il nuovo contratto (solo superficie locale), non un comportamento gateway.
- [A5] La rebuild di `bin/kilo` può fallire in ambiente; in tal caso il fallback source-wrapper di `local-bin.ts` (riga 358, `writeSourceWrapper`) esegue `bun src/index.ts` e il fix è comunque attivo perché vive nella fonte.

## Piano di implementazione

Ogni step è eseguito da un subagente distinto, sequenziale, e termina con compilazione + revisione utente. Ordine: prima il fix strutturale (Step 1), poi dati/test (Step 2), infine chiusura (Step 3).

---

### Step 1 — Hard cut del catalogo grezzo nell'handler `GET /provider`

**Obiettivo**

Garantire che `GET /provider.all` contenga **solo** provider in superficie (`LOCAL_PROVIDER_IDS ∪ config.provider ∪ connectedIds`), indipendentemente dal contenuto dello snapshot/cache/fetch. È il fix strutturale che fa sparire "Kilo Gateway" dal picker per sempre.

**Motivazione**

Chiude il gap residuo: oggi i provider in `connected` bypassano il filtro (merge `Object.assign` a `handlers/provider.ts:69-76`). Con il cut applicato al catalogo grezzo, i connessi fuori-superficie (kilo) non possono più entrare in `all` da nessuna delle due strade (catalog né connected, grazie al cut pre-giusto di `Provider.Service`).

**File da leggere**

- `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts` (righe 40-97: costruzione di `all`/`credentials`/`connected`/`ids`/`catalog`/`filtered`/`providers`/`validProviders`)
- `packages/opencode/src/kilocode/local-providers.ts` (`inLocalSurface`, `LOCAL_PROVIDER_IDS`)
- `packages/opencode/src/provider/provider.ts` (righe 568-577: il cut identico già presente a livello service, per coerenza)

**File da modificare**

- `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts`:
  - Riordinare: calcolare `credentials` + `connected` (+ `ids`) **prima** di `const all = …` (oggi `all` è a riga 50, `connected` a riga 59).
  - Applicare il cut al momento della costruzione di `all`:
    `const all = overlayAnacondaDesktop(pickBy(yield* ModelsDev.Service.use((s) => s.get()), (_item, id) => inLocalSurface(id, ids)))`
    (l'overlay anaconda-desktop resta applicato DOPO il cut, come oggi).
  - Mantenere il `pickBy` su `catalog` (ridondante ma difensivo) oppure rimuoverlo se ridondante — decisione del subagente, documentata.
  - Aggiornare il blocco `kilocode_change start/end` circostante e i commenti per descrivere il nuovo comportamento ("hard cut: out-of-surface providers are excluded from the raw catalog before any merge with connected").
  - Preservare i marker `kilocode_change` esistenti nel file.

**Attività**

- Leggere la funzione completa e verificare dove `connected` diventa disponibile senza ciclismi (è `yield* provider.list()`, già usato a riga 59).
- Applicare il riordino + cut.
- Non toccare `failed`/`validProviders`/`default` (semantica invariata).

**Output atteso**

`GET /provider.all` non contiene mai provider fuori-superficie, anche se presenti nello snapshot/cache/fetch e auto-connessi. In dev con binario vecchio: `kilo` presente nel dato grezzo ma assente da `all`.

**Verifiche**

- Smoke: da `packages/opencode/`, `bun run --conditions=browser ./src/index.ts serve --port <libero>` (senza `KILO_MODELS_PATH`, con fetch live abilitato o con cache popolata); `curl -s localhost:<porta>/provider` → `all` contiene solo `lmstudio`, `atomic-chat`, `privatemode-ai` + i custom configurati dall'utente (es. `llamacpp`, `ninfer4090`); **`kilo` assente**; `connected` senza `kilo` (il cut del service impedisce l'auto-connect). Kill del processo a fine check.
- `bun turbo typecheck` verde dalla root.
- Da `packages/opencode/`: `bun test ./test/kilocode/provider-model-refresh.test.ts` (toccato dal refresh del catalogo) — se fallisce per asserzioni sul contenuto del catalogo, riportarlo (ri-calibrato nello Step 2).

**Compilazione**

- `bun turbo typecheck`; risolvere eventuali errori introdotti.

**Rischi**

- Riordino: `connected` dipende da `Provider.Service` il cui stato usa a sua volta `ModelsDev.Service.get()` (stesso cached effect, no re-entrancy problem — `Effect.cachedInvalidateWithTTL` a `core/src/models-dev.ts:244`). Verificare che non si crei un ciclo: `list()` → state init → `modelsDevSvc.get()` ≠ `provider.list()`.
- Plugin-auth provider assenti dalla whitelist (es. openai Codex OAuth): restano visibili grazie al termine `connectedIds` nel cut (sono in `connected` via plugin loader, `provider.ts:804-822`).

**Istruzioni per il subagente**

- Solo questo step. Non toccare UI, stringhe, fixture, test.
- Preserva i marker `kilocode_change`.
- Compila e fai smoke prima di terminare.
- Se hai dubbi sul punto esatto in cui `connected` è disponibile o sul riordino, leggi attentamente l'handler e `provider.ts:568-577`; usa WebFetch/MCP se serve documentazione Effect (cached effects).

---

### Step 2 — Rigenerare snapshot/dati senza `kilo`, pulire cache, ricalibrare test

**Obiettivo**

Portare i dati di dev/test in coerenza col nuovo contratto (nessun `kilo` nel catalogo), così TUI `kilo models`, suite opencode e future rigenerazioni partono pulite.

**Motivazione**

Con lo Step 1 il picker è già protetto; questo step evita che altre code path (CLI, test, snapshot embedded alla prossima build) continuino a distribuire `kilo`.

**File da leggere**

- `packages/opencode/script/generate.ts` (meccanica: env `MODELS_DEV_API_JSON` → testo; `parseModelsSnapshot(raw).data` → `modelsData` embedded in `build.ts:362`)
- `packages/opencode/script/build.ts` (riga 18 `import("./generate.ts")`, riga 362 `KILO_MODELS_DEV: generated.modelsData`, riga 146 `KILO_DISABLE_MODELS_FETCH: "1"` nel smokeEnv)
- `packages/opencode/test/tool/fixtures/models-api.json` (già senza `kilo` dallo step 2 precedente)
- Test che asseriscono sull'output di `/provider` o sul contenuto del catalogo: individuare con `rg "kilo|Kilo Gateway" packages/opencode/test packages/kilo-vscode/tests` e leggere i file coinvolti (es. `test/kilocode/provider-model-refresh.test.ts`, eventuale `test/kilocode/cli/cmd/serve.test.ts`).

**File da modificare**

- Snapshot di generazione: produrre uno snapshot JSON senza `kilo` (e idealmente senza altri built-in online, coerentemente col contratto offline) usando `MODELS_DEV_API_JSON=<file> bun run script/generate.ts` da `packages/opencode/`. Fonte del file: `node_modules/.cache/models-dev-api.json` se presente, altrimenti `fetch https://models.dev/api.json` salvato localmente, poi `jq 'del(.kilo)'` (o equivalenti per i demás online se si sceglie il cut completo). Commit/non-commit del file intermedio: decisione del subagente, ma va documentato dove risiede.
- `packages/kilo-vscode/bin/kilo`: rebuild via `bun script/local-bin.ts --force` da `packages/kilo-vscode/` (rebuilda il binario in `packages/opencode/dist` con lo snapshot nuovo e lo copia). Se la compile fallisce, il wrapper sorgente resta valido (A5) — documentare.
- Cache utente: se `~/.local/share/kilo/cache/models.json` esiste e contiene `"kilo"`, rinominarla in `models.json.bak-hardcut` (una tantum; il fetch live la ricrea ma ora è irrilevante per il picker).
- Test ricalibrati: aggiornare le asserzioni che aspettano provider online o `kilo` nell'output di `/provider`/`kilo models` al nuovo contratto (superficie locale + custom configurati). Mantenere intatte le asserzioni di comportamento (refresh, failed providers, ordering).

**Attività**

- Generare lo snapshot pulito; verificare `jq '.kilo' file` → null.
- Rebuildare il binario (o documentare il fallback wrapper).
- Pulire la cache se presente.
- Individuare e ricalibrare i test; eseguire le suite opencode coinvolte.

**Output atteso**

Nessuna fonte dati contiene `kilo`; `kilo serve` in dev non lo produce in `connected` né in `all`; suite verdi.

**Verifiche**

- `grep -c '"kilo"'` su snapshot generato + fixture → 0.
- Smoke `kilo serve` (vedi Step 1) → `all` senza `kilo`, `connected` senza `kilo`.
- Da `packages/opencode/`: `bun test ./test/kilocode/` (suite singola, non mass-run parallela che dà artifact `ManagedRuntime disposed` noti) per i file toccati; `bun test ./test/tool/` in caso di modifiche alle fixture.
- `bun turbo typecheck` verde.

**Compilazione**

- `bun turbo typecheck`. Risolvere errori.

**Rischi**

- Build del binario lunga/instabile in ambiente: il fallback wrapper copre; segnalarlo.
- Modificare grandi JSON: usare `jq`/script, mai editing manuale; validare con `JSON.parse`.
- Ricalibrazione test: non indebolire le asserzioni, solo re-puntare i provider attesi.

**Istruzioni per il subagente**

- Solo questo step. Non toccare runtime (Step 1) né UI.
- Usa `jq`/script per editare JSON in sicurezza.
- Compila e verifica i test prima di terminare.
- Se `generate.ts` richiede rete e non è disponibile, usa `MODELS_DEV_API_JSON` con un file locale derivato dalla cache o dalla fixture; documenta la scelta.

---

### Step 3 — Guard finali, rebuild verificata e validazione end-to-end nel VS Code

**Obiettivo**

Chiusura: tutte le guard CI verdi, binario rebuilt, e verifica **visiva nel VS Code** che il picker non mostri più "Kilo Gateway".

**Motivazione**

Gli step precedenti hanno validato con `curl` da shell; qui si valida nel prodotto reale (extension host → `bin/kilo serve` → webview).

**Attività**

- Da `packages/kilo-vscode/`: `bun run knip`, `bun run check-kilocode-change`, `bun run typecheck`, `bun run lint`, `bun run test:unit`.
- Dalla root: `bun run script/check-workflows.ts`, `bun run script/check-md-table-padding.ts`, `bun turbo typecheck`.
- Verifica binario: `ls -la packages/kilo-vscode/bin/kilo`; se è un wrapper sorgente (bash) e la compile era riuscita, rilanciare `bun script/local-bin.ts --force` preferendo il binario compilato.
- Validazione visiva: `bun run extension:isolated` (da root o da `packages/kilo-vscode/`) → attendere l'avvio del backend → apri Kilo Settings → tab **Models** → verificare che il picker elenchi solo provider locali/custom (**LM Studio**, atomic-chat, privatemode-ai, llamacpp/ninfer4090 se configurati) e che il gruppo **"Kilo Gateway"** e i built-in online (AionLabs, Amazon Nova, Anthropic Claude…) siano assenti. Controllare anche i dropdown "Default Model"/"Small Model" dello screenshot.
- Sweep finale: `rg -i "kilo gateway|kilo-auto" packages/` → solo riferimenti voluti (docs storiche/CHANGELOG, indexing subsystem, env var `KILO_AUTO_*`).

**Output atteso**

Guard verdi; picker senza "Kilo Gateway"; `GET /provider.all` (dal log o curl sul backend isolato) contenente solo superficie locale.

**Compilazione**

- Tutte le guard passano; risolvere ciò che le modifiche introducono.

**Rischi**

- Se la cache utente contiene ancora `kilo`, il dato grezzo lo porta: irrilevante per il picker grazie allo Step 1, ma pulirla comunque per igiene.
- Lancement VS Code non eseguibile in ambiente headless: in quel caso la validazione visiva resta compito umano, segnalato esplicitamente.

**Istruzioni per il subagente**

- Solo questo step (chiusura).
- Eseguire TUTTE le guard e farle passare.
- Validare visivamente il picker prima di terminare (o dichiarare esplicitamente che serve review umana).

---

## Criteri di completamento

- Tutti gli step (1-3) completati, ciascuno verificabile in modo indipendente.
- Ogni step termina con codebase compilabile (typecheck verde).
- `GET /provider.all` contiene solo `LOCAL_PROVIDER_IDS ∪ config.provider ∪ connected-legittimi`, **per qualsiasi** contenuto di snapshot/cache/fetch: nessuno built-in online (niente "Kilo Gateway", AionLabs, Amazon Nova, Anthropic Claude…).
- Binario `bin/kilo` rebuilt con snapshot senza `kilo` (o wrapper sorgente documentato).
- Test ricalibrati e verdi; guard CI verdi: `knip`, `check-kilocode-change`, `check-workflows`, `check-md-table-padding`, typecheck, lint, unit test.
- Verifica visiva nel VS Code confermata (picker solo locali/custom).

## Domande aperte / out of scope

- [Q1] **Sessioni esistenti** su `kilo`/`kilo-auto/*`: restano valide a livello dati (out of scope la migrazione), coerente coi piani precedenti.
- [Q2] **Upstream models.dev**: continuerà a esporre `kilo` finché Kilo non lo toglie; con l'hard cut lato server è irrilevante per il picker. Out of scope negoziare upstream.
- [Q3] **Cut completo degli altri built-in online** (anthropic, openrouter, …) dallo snapshot: opzionale in questo piano (l'hard cut li nasconde già); se si vuole uno snapshot minimale va deciso nello Step 2.