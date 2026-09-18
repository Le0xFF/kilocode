# Piano: rimozione dei servizi online — estensione VS Code 100% offline (provider locali OpenAI-compatibili)

## Obiettivo

Rimuovere da questo branch **tutta** la superficie di codice legata ai servizi online Kilo, in modo che l'estensione VS Code (`packages/kilo-vscode/`) e il suo backend `kilo serve` (`packages/opencode/`, `@kilocode/cli`) funzionino interamente offline con provider locali OpenAI-compatibili (llama.cpp, vLLM, Ollama). L'estensione resta pienamente funzionante per chat/agent, Agent Manager, autocomplete-inline (solo come infrastruttura), indexing locale, snapshot/worktree, MCP, ecc.

### Decisioni di scope (confermate dall'utente)

| # | Decisione | Scelta |
|---|---|---|
| D1 | Autocomplete inline (FIM / next-edit via gateway, provider kilo/mistral/inception) | **Rimuovi completamente** |
| D2 | Superficie UI online nel webview (marketplace, profilo/balance/org, KiloClaw, cloud sessions, notifiche remote, provider-usage/KiloPass, feedback thumbs, cataloghi image-models, link openExternal a siti Kilo) | **Rimuovi tutto** |
| D3 | Backend CLI: ripulire anche i servizi online dal CLI (gruppi HTTP `/kilo/*` e `/telemetry/*`, PostHog, provider `kilo`, KiloSessions ingest/share, presence, session-export, tool `generate-image` e `websearch-kilo-exa`) | **Sì, rimuovi anche dalla CLI** |
| D4 | Dipendenze orfane nei package.json (`openai`, `@anthropic-ai/sdk`, `@kilocode/kilo-gateway`, `@kilocode/kilo-telemetry` dove possibile) | **Sì, pulisci** |
| D5 | Speech-to-text e image generation (oggi su cataloghi/route del gateway) | **Adatta a endpoint locali** OpenAI-compatibili configurati dall'utente (es. `/v1/audio/transcriptions`, `/v1/images/generations` di vLLM/llama.cpp) |

### Cosa NON si tocca (invariante architetturale)

- Il trasporto estensione↔backend: `KiloConnectionService`, `ServerManager`, `HttpClient`, SSE adapter (`src/services/cli-backend/*`) — è il child process `kilo serve --port 0` locale, non un servizio online.
- I gruppi HTTP upstream del server CLI (config, session, provider, mcp, project, pty, question, permission, workspace, ...) e i gruppi kilocode **locali**: agent-builder, background-process, branch-name, commit-message, config-console, enhance-prompt, indexing, instance-reload, interactive-terminal, memory, network, remote, sandbox, session-import, suggestion, anaconda-desktop.
- I tool dell'agente che usano la rete ma non sono "servizi online Kilo": `webfetch` (GET verso URL forniti dall'utente), shell/sandboxing locale, MCP, repo_clone.
- L'indexing con embedder **locali** (`openai-compatible` verso baseURL arbitrario, `ollama`).
- Il fetch del catalogo `models.dev`: va solo **disabilitato** (flag `KILO_DISABLE_MODELS_FETCH=1` passato all'spawn), non rimosso dal CLI.
- Provider builtin restanti (openai, anthropic, gemini, openrouter, apertis, anaconda-desktop): restano nel registro; senza API key non vengono autoloader. Gli utenti useranno provider custom OpenAI-compatibili.

---

## Analisi (dalla ricognizione con subagenti)

### A. Lato host estensione (`packages/kilo-vscode/src/`)

**Gateway/auth/profile** (parlano al backend locale che proxy verso il cloud):
- `src/kilo-provider/handlers/auth.ts` — device-flow login/logout/setOrganization/refreshProfile (`client.provider.oauth.*`, `client.kilo.profile()`), interfaccia `AuthContext`.
- `src/provider-actions.ts` — `authorizeProviderOAuth`/`completeProviderOAuth` (incl. providerID `kilo`), `disconnectProvider`, `fetchProviderData` (`client.kilo.authStatus`), `computeDefaultSelection` (fallback `kilo-auto/free`), `createKiloFallbackProvider` da `src/shared/provider-model.ts` (`KILO_PROVIDER_ID="kilo"`, `KILO_AUTO`, `PROVIDER_PRIORITY`).
- `src/KiloProvider.ts` — case messaggi `login/logout/setOrganization/...`, `syncWebviewState` (fetch profile), `fetchAndSendProviderUsage` (`client.kilocode.providerUsage`), `fetchAndSendKiloEmbeddingModels` (**unico fetch diretto fuori SDK**: `fetchKiloEmbeddingModelCatalog` importato da `@kilocode/kilo-gateway`, L173/L2898), `fetchAndSendImageModels`/`fetchAndSendSpeechToTextModels`, `disposeGlobal`, broadcast `notifyProfileChanged`.
- `src/services/cli-backend/connection-service.ts` — bus `onProfileChanged`/`notifyProfileChanged` (L16, 105, 450–463).
- `src/services/cli-backend/types.ts` — tipi `KilocodeProfile/Balance/Organization`, `ProfileData`, `CloudSessionInfo/Message/Data`.
- `src/SettingsEditorProvider.ts` — pannello "Kilo Profile" (apre un KiloProvider dedicato); comandi `profileButtonClicked` in `extension.ts`.
- `src/kilo-provider/notifications.ts` — `fetchAndSendNotifications` (`client.kilo.notifications()`), dismiss/reset.
- `src/kilo-provider/handlers/cloud-session.ts` — cloud sessions (`client.kilo.cloudSessions`, `cloud.session.get/import`).
- `src/kiloclaw/` — intero modulo (token-manager, KiloClawProvider, types): chat cloud con token mintato dal gateway.
- `src/image-generation/models.ts` — `fetchImageModels` (GET `/kilo/models/images` sul server locale).
- `src/speech-to-text/catalog.ts` + `models.ts` — catalogo gateway + fallback statico.
- `src/legacy-migration/*` — migrazione credenziali Kilo legacy (token → OAuth).

**Telemetria host** (`src/services/telemetry/`): `TelemetryProxy` (POST `{baseUrl}/telemetry/capture` al backend), `types.ts` (~45 nomi evento), `webview-state.ts`. Importatori: `extension.ts` (ciclo di vita), `KiloProvider.ts` (implements `TelemetryPropertiesProvider`, relay `case "telemetry"`), `MarketplacePanelProvider.ts`, `agent-manager/vscode-host.ts`, `agent-manager/fork-session.ts`, `services/autocomplete/AutocompleteServiceManager.ts` + `AutocompleteTelemetry.ts`. Env spawn `KILO_TELEMETRY_LEVEL` in `server-manager.ts:147`.

**Marketplace** (`src/services/marketplace/`): `api.ts` (fetch `https://api.kilo.ai/api/marketplace/{mcps,agents,skills}`), `index.ts` (`MarketplaceService`), `actions.ts`, `installer.ts` (download tarball skill da URL remoto), `paths.ts`, `detection.ts`, `relevance.ts`, `notifier.ts`, `notify.ts`; pannello `src/MarketplacePanelProvider.ts`; wiring in `extension.ts` (comandi `marketplaceButtonClicked`, notifier a startup).

**Autocomplete** (`src/services/autocomplete/`): `fim.ts` (`generateFim` → `client.kilo.fim`), `next-edit/MercuryEditProvider.ts` (`client.kilo.edit`), `shared/autocomplete-models.ts` (re-export `AUTOCOMPLETE_MODELS` da `@kilocode/kilo-gateway/autocomplete`), `AutocompleteInlineCompletionProvider.ts` (probe balance `client.kilo.profile()`, circuit breaker 402), `ErrorBackoff.ts`, `ChatTextAreaAutocomplete.ts`, settings (`autocomplete.model/provider`), `migrate-default.ts`.

**Altri**: `src/shared/fetch-models.ts` (`fetchOpenAIModels` GET `{baseURL}/models` — generico, usato per provider OpenAI custom: **da valutare**), `src/shared/provider-model.ts` (costanti kilo), `package.json` (command `kiloClawOpen`, `marketplaceButtonClicked`, `profileButtonClicked`, keybinding `showIncompatibilityExtensionPopup`, setting `autocomplete.model/provider`, dipendenze `openai`, `@anthropic-ai/sdk`, `@kilocode/kilo-gateway`).

**Esbuild builds** (`esbuild.js`): tre entrypoint webview: `webview-ui/src/index.tsx` → `dist/webview.js`, `webview-ui/agent-manager/index.tsx` → `dist/agent-manager.js`, `webview-ui/marketplace/index.tsx` → `dist/marketplace.js` (+ marketplace.css), più `webview-ui/kiloclaw/index.tsx` → dist kiloclaw (verificare in esbuild.js). CSP in `webview-html-utils.ts` limita già `connect-src` a localhost.

### B. Lato webview (`packages/kilo-vscode/webview-ui/`)

- **Auth/profile**: `context/server.tsx` (segnali `profileData`, `deviceAuth`, `providerUsage*`; `startLogin()`, `goToLogin()`), `components/profile/ProfileView.tsx`, `DeviceAuthCard.tsx`, `ProviderUsageCards.tsx`, `components/shared/AccountSwitcher.tsx`, `BalanceChip.tsx`, `components/chat/KiloNotifications.tsx` (+ `context/notifications.tsx`), punti in `App.tsx` (view "profile"), `MessageList.tsx`, `ProvidersTab.tsx` (card "Kilo Gateway" + `goToLogin`), `ProviderSelectDialog.tsx`, `IndexingTab.tsx` (`kiloAvailable` da `profileData`), `SidebarTopBar.tsx` (pulsanti profile/marketplace/kiloclaw). Tipi: `types/messages/profile.ts`, `connection.ts` (`DeviceAuthState`), union `extension-messages.ts`/`webview-messages.ts`. I18n: chiavi `deviceAuth.*`, `profile.*`, `sidebar.topBar.*` (16 file).
- **Marketplace**: `marketplace/` (entry + `MarketplaceApp.tsx`), `src/context/marketplace-session.tsx`, `src/components/marketplace/*` (8 componenti), `src/types/marketplace.ts`, storybook `stories/marketplace.stories.tsx`.
- **KiloClaw**: bundle separato `webview-ui/kiloclaw/` (app, context `claw.tsx`, components, `lib/types.ts`, i18n proprio, css) + agganci: `hooks/useSlashCommand.ts` (~L193 `/kiloclaw`), `SidebarTopBar.tsx` (L54), `OpenKiloClawRequest` nelle union.
- **Cloud sessions**: `components/history/HistoryView.tsx` (tab `cloud`), `CloudSessionList.tsx`, `CloudImportDialog.tsx`, `context/session.tsx` (`selectCloudSession`, handler `cloudSession*`), `context/local-tabs.tsx`, routing in `App.tsx`.
- **Feedback**: `context/feedback.tsx` + `feedback-payload.ts` (emette messaggio `telemetry` con `FEEDBACK_SUBMITTED`), `TranscriptRow.tsx`/`AssistantMessage.tsx` (prop `feedback`, thumb in `@kilocode/kilo-ui/message-part`), mount in `provider-shell.tsx`.
- **Autocomplete UI**: `settings/AutocompleteTab.tsx`, `settings/ModelsTab.tsx` (row "Autocomplete model", `handleAutocompleteModelSelect`), `settings/autocomplete-model-selector.ts` (re-export host), `hooks/useGhostText.ts`.
- **Image/Speech**: `context/image-models.tsx` (`ExperimentalTab.tsx`), `context/speech-to-text-models.tsx` + `components/speech-to-text/*` (mic button in `PromptInput.tsx`).
- **Link openExternal a siti Kilo**: `ProfileView`, `DeviceAuthCard`, `FeedbackDialog` (discord/support/github), `KiloNotifications` (actionURL dinamiche), `CustomProviderDialog` (docs), `ProviderConnectDialog` (blog gateway), `AboutKiloCodeTab`, `MarketplaceListView/InstallModal/Contribute`, `useSlashCommand` (docs), `MigrationWizard`.

### C. Lato CLI (`packages/opencode/`)

- **Gruppi/handler HTTP**: `src/kilocode/server/httpapi/groups/kilo-gateway.ts` (`KiloGatewayApi`, root `/kilo`, tutti gli schema) + `handlers/kilo-gateway.ts` (`kiloGatewayHandlers`, fetch verso `KILO_API_BASE`); `groups/telemetry.ts` + `handlers/telemetry.ts`. Registrazione: `src/server/routes/instance/httpapi/api.ts` (import L39/L46, addHttpApi L109/L116, blocco marker `kilocode_change` L29–48 e L99–118) e `src/kilocode/server/httpapi/server.ts` (provide L44/L52). Trasform post-spec dipendenti dai paths `/kilo/*`: `src/kilocode/server/httpapi/public.ts` (`matchLegacyKiloOpenApi`: nullable `/kilo/profile`, `/kilo/cloud-sessions`, `/kilo/claw/status`, override SSE `/kilo/fim`) e `QueryParameterSchemas` `"GET /kilo/cloud-sessions cursor|limit"` in `src/server/routes/instance/httpapi/public.ts` (L69–70).
- **Provider `kilo`**: blocco in `src/provider/models.ts:45–99` (ri-inserimento con `npm:"@kilocode/kilo-gateway"`, modelli da `ModelCache.fetch("kilo")`, gate enabled/disabled_providers), `src/provider/model-cache.ts` (intero file, solo kilo+apertis), `src/kilocode/provider/provider.ts` (`KILO_BUNDLED_PROVIDERS` L30–32, custom loader `kilo` L182–214, `patchKiloProviderPrivacy` L1681, `kiloSmallModelPriority` L276–279, fallback small-model L2062–2065 in `src/provider/provider.ts`), merge in `BUNDLED_SDK` (`src/provider/provider.ts:152`), case `"@kilocode/kilo-gateway"` ×~10 in `session/llm/transform.ts`, header in `session/llm/request.ts:181–255`, `kilocode/tool/agent-manager.ts:238` (rank), `acp/service.ts:789–791` (preferenza default), `KiloAuthPlugin` registrato in `src/plugin/index.ts:71` (hook auth providerID `kilo`), auth tracking in `src/provider/auth.ts:234–245` e `src/auth/index.ts:91–96`.
- **Config**: `src/kilocode/config/config.ts` `loadOrganizationModes` (L418–439, chiamata cloud a ogni load config, invocata L506), overlay `indexing.kilo.{apiKey,baseUrl,organizationId}` in `src/kilocode/config/overlay.ts:107–109`, import `PROMPTS, AI_SDK_PROVIDERS` da `@kilocode/kilo-gateway` in `packages/core/src/v1/config/provider.ts:4` (usato dai campi `Model.prompt/isFree/ai_sdk_provider` — **attenzione cross-package**, vedi Assunzioni).
- **Telemetria**: `src/kilocode/cli/setup.ts` (`bootstrap()` L70+: `Telemetry.init` L96–101, `updateIdentity` L125, `trackCliStart` L128, `flushInBackground` L131; `shutdown()` L135–161 con `trackCliExit`, `Telemetry.shutdown(2000)`), chiamate da `src/index.ts:89` (middleware yargs) e `:163` (finally). Emissioni: `kilocode/session/processor.ts:110–133` (`trackStep`→`trackLlmCompletion`, chiamato da `session/processor.ts:636`), `kilo-sessions/kilo-sessions.ts:861`, `kilocode/indexing.ts`, `kilocode/plan-followup.ts`, `kilocode/suggestion/index.ts`, `kilocode/tool/chart.ts:70`, `kilocode/cli/cmd/tui/feedback.ts:52`. Flag env `KILO_TELEMETRY_LEVEL` letto in `packages/kilo-telemetry/src/telemetry.ts:89`.
- **KiloSessions/presence/export**: `src/kilo-sessions/*` (auth `${KILO_API_BASE}/api/user`, ingest WSS `ingest.kilosessions.ai`, share `app.kilo.ai/s/<token>`; kill-switch env esistenti `KILO_DISABLE_SESSION_INGEST`/`KILO_DISABLE_SHARE`), wired in `kilocode/bootstrap.ts:39,49`, `cli/cmd/serve.ts:33`, `tool/registry.ts:65`, `cli/tui/worker.ts:17`, hook GlobalBus su `Session.Event.Created`; `kilocode/presence/service.ts` (`KILO_EVENT_SERVICE_URL`, kill-switch `KILO_DISABLE_PRESENCE`); `kilocode/session-export/*` (upload batch, eligibility `model.api.npm !== "@kilocode/kilo-gateway"` in `eligibility.ts:20`).
- **Tool online**: `kilocode/tool/generate-image.ts` (`GenerateImageTool`, richiede token kilo o OPENROUTER_API_KEY, URL fissi) e `kilocode/tool/websearch-kilo-exa.ts` (trasporto `kilo-rest` in `tool/websearch.ts:151–201`; altri trasporti Byok Exa/Parallel restano); registrazione in `tool/registry.ts:267`.
- **Cloud area**: `src/kilocode/cloud/*` (auth.ts, commands.ts, catalog.ts, transport.*, origin.ts `cloud-agent-next.kilosessions.ai`).
- **Embedding gateway**: `src/kilocode/indexing.ts` (`kiloAuth` L86, `enrichKilo` L91, `models()` L543 con `fetchKiloEmbeddingModelCatalog`, `resolveKiloGatewayBaseUrl`) + `packages/kilo-indexing/src/indexing/embedders/kilo.ts` + `service-factory.ts:86–92` + schema `KiloEmbeddingModel(Catalog)` in `groups/indexing.ts:14–26`. Embedder locali `openai-compatible.ts`/`ollama` vanno tenuti.
- **Fetch esterni residui**: `session/network.ts` (probe HEAD periodichi ogni 3s solo durante retry offline: `kilo.ai`, `example.com`, `cloudflare.com` — reattivi al fallimento, non periodici a vuoto), `cli/cmd/github.handler.ts` (installazione app GitHub + `api.github.com/installation/token` — feature opzionale `kiloconnect`), `installation/index.ts:248–299` (solo comando `upgrade`), `share/share-next.ts` (legacy upstream), `cli/cmd/account.ts` (console disabilitato).
- **Dipendenze** `packages/opencode/package.json:99–106`: `@kilocode/kilo-gateway`, `kilo-indexing`, `kilo-memory`, `kilo-telemetry`, `plugin`, `plugin-atomic-chat`, `sandbox`, `sdk`.

### D. Pipeline SDK

- `script/generate.ts` → `packages/sdk/js/script/build.ts`: esegue `bun dev generate` in `packages/opencode` (`GenerateCommand` → `Server.openapi()` → `OpenApi.fromApi(PublicApi)`) e genera **solo** `packages/sdk/js/src/v2/gen/` con `@hey-api/openapi-ts` (istanza `KiloClient`), poi patch manuali + tsc. La spec deriva dalle route registrate: se i gruppi `kilo`/`telemetry` spariscono da `api.ts`, lo SDK rigenerato non avrà più `client.kilo.*`/`client.telemetry.*` (getter in `src/v2/gen/sdk.gen.ts` L11847/L11881).
- `packages/kilo-vscode/script/prepare-sdk.ts`: fingerprint input, early exit se invariato, altrimenti `bun run build` nello SDK. È il gradino `prepare:sdk` di `compile`/`pretest`. Dopo aver toccato `packages/opencode`, il fingerprint cambia e la rigenerazione avviene automaticamente alla prima `compile`.

---

## Assunzioni

1. **A1 — Branch prunable**: questo branch può divergere liberamente da `main`; i marcatori `kilocode_change` nei file condivisi `packages/opencode/` vanno mantenuti aggiornati (bloccare le porzioni modificate con `kilocode_change start/end`) perché il repo usa ancora la procedura di sync da `origin/main`. Nei file sotto `packages/opencode/src/kilocode/` i marcatori non servono. In `packages/kilo-vscode/` non servono mai.
2. **A2 — `packages/core` condiviso**: `packages/core/src/v1/config/provider.ts:4` importa `PROMPTS`/`AI_SDK_PROVIDERS` da `@kilocode/kilo-gateway`. Se il package gateway viene rimosso dal monorepo, `core` deve essere adattato (definire localmente costanti equivalenti o rimuovere i campi `Model.prompt/isFree/ai_sdk_provider`). **Da verificare prima dello step 13**: se `PROMPTS`/`AI_SDK_PROVIDERS` sono usati altrove in core/opencode, copiare le definizioni in `packages/opencode/src/kilocode/` (o `packages/core`) invece di eliminare il campo dallo schema. In alternativa (opzione conservativa) si può *non* rimuovere fisicamente il package `packages/kilo-gateway/` dal workspace e toglierne solo gli usi: il package resta come dead code. **Il piano assume l'opzione conservativa**: si rimuovono tutti gli *usi*, il package directory resta nel workspace fino a verifica che `core` non ne dipenda più; la rimozione fisica è un passo finale opzionale.
3. **A3 — TUI**: il CLI include la TUI. Con il provider `kilo` rimosso, i dialog/onboarding della TUI che menzionano "kilo" (`dialog-provider.tsx` L101/134, `routed-model-meta.tsx` L44, `home-onboarding.tsx` L18, `sidebar-footer.tsx` L76, `home-footer.tsx` L75, `dialog-kilo-*`, `kilo-news.tsx`, `notification-banner.tsx`) vanno puliti in uno step dedicato (sono Kilo-specifici: vivono in `src/kilocode/`). Le feature TUI che richiedono auth kilo (team select, org dialogs, news) vengono rimosse.
4. **A4 — Default model**: dopo la rimozione, la selezione del modello predefinito cade su `cfg.model` se impostato, altrimenti sul primo modello del primo provider attivo; senza alcun provider con modelli si alza `NoProvidersError`. Non si introduce nuovo comportamento: ci si limita a rimuovere i riferimenti a `kilo` dai percorsi di fallback (`getSmallModel` L2062–2065, `acp/service.ts:789–791`, `kiloSmallModelPriority`). Documentare nella validazione che l'utente deve avere ≥1 provider locale con modelli in config.
5. **A5 — models.dev**: non si rimuove la macchina del fetch del catalogo; si forza `KILO_DISABLE_MODELS_FETCH=1` nell'spawn dell'estensione così il CLI parte senza rete (popula da snapshot/disk → `{}`).
6. **A6 — `fetchOpenAIModels`** (`src/shared/fetch-models.ts`): GET `{baseURL}/models` verso un endpoint dichiarato dall'utente (es. localhost). Non è un servizio online Kilo: **si tiene**. Stesso criterio per i test visual/a11y Playwright (dev-only).
7. **A7 — Feedback thumbs**: il context `feedback.tsx` emette *solo* il messaggio `telemetry` (nessun altro effetto collaterale oltre allo stato rating in memoria). Con la telemetria rimossa i thumb non hanno più senso: si rimuove il context e la prop `feedback` da `TranscriptRow`/`AssistantMessage` (componente `@kilocode/kilo-ui` non modificato: la prop è opzionale).
8. **A8 — Speech/image locali (D5)**: l'adattamento a endpoint locali passa per provider custom OpenAI-compatibili: il catalogo modelli diventa una lista di modelli dichiarati in config (campo `experimental.speech_to_text_model` / `experimental.image_generation_model` che puntano su `{providerID}/{modelID}` di un provider locale), e le route REST del backend diventano proxy verso il `baseURL` del provider selezionato (nuovi handler leggeri che riusano il provider loader esistente). I vecchi endpoint `/kilo/models/images`, `/kilo/models/transcriptions`, `/kilo/audio/transcriptions` spariscono con il gruppo `kilo`.
9. **A9 — Legacy migration**: il wizard migra profili *legacy* Roo/Kilo (API keys Anthropic/OpenAI/Gemini, etc.) — non è un servizio online in sé (legge file locali). Si **tiene**; solo i riferimenti al token Kilo organization (`kilocodeOrganizationId`, mapping `vercel-ai-gateway` no, mapping `kilo`) vengono assottigliati nei passi dedicati.
10. **A10 — Test**: la suite unitaria `packages/kilo-vscode/tests/unit/` contiene test che mockano `AutocompleteTelemetry`, `@roo-code/telemetry` (stale), provider kilo, ecc. Ogni step che tocca un'area aggiorna i test affetti; la compilazione (`bun run typecheck` = tsgo host+webview) è il gate minimo obbligatorio a fine step; `bun test tests/unit/` quando l'area ha test unitari.

---

## Piano di implementazione

> Convenzione per ogni step: il subagente compila con i comandi indicati, risolve ogni errore introdotto, e termina con il progetto compilabile. File in modifica = minimi. Non anticipare step successivi.

### Step 1 — CLI: rimuovere init/shutdown telemetry PostHog e le route `/telemetry/*`

**Obiettivo**: il processo `kilo serve` non inizializza più nulla di PostHog/OTel e non espone `/telemetry/capture` né `/telemetry/setEnabled`.

**Motivazione**: elimina il canale di uscita dati verso `us.i.posthog.com` alla radice; l'estensione smetterà di alimentare la route (step successivi).

**File da leggere**:
- `packages/opencode/src/kilocode/cli/setup.ts` (bootstrap/shutdown)
- `packages/opencode/src/index.ts` (chiamate a L89, L163)
- `packages/opencode/src/kilocode/server/httpapi/groups/telemetry.ts`, `handlers/telemetry.ts`
- `packages/opencode/src/server/routes/instance/httpapi/api.ts` (L46, L116)
- `packages/opencode/src/kilocode/server/httpapi/server.ts` (L31, L52)
- `packages/kilo-telemetry/src/telemetry.ts` (per capire cosa si perde)
- Call-site: `packages/opencode/src/kilocode/session/processor.ts` (L110–133 `trackStep`), `packages/opencode/src/session/processor.ts` (L636), `packages/opencode/src/provider/auth.ts` (L234–245), `packages/opencode/src/auth/index.ts` (L91–96), `packages/opencode/src/kilo-sessions/kilo-sessions.ts` (L861), `packages/opencode/src/kilocode/indexing.ts`, `packages/opencode/src/kilocode/plan-followup.ts`, `packages/opencode/src/kilocode/suggestion/index.ts`, `packages/opencode/src/kilocode/tool/chart.ts` (L70), `packages/opencode/src/kilocode/cli/cmd/tui/feedback.ts` (L52)

**File da modificare**:
- `packages/opencode/src/kilocode/cli/setup.ts`: rimuovere import di `@kilocode/kilo-telemetry`, le chiamate `Telemetry.init/updateIdentity/trackCliStart/flushInBackground` in `bootstrap()` e `trackCliExit/Telemetry.shutdown` in `shutdown()` (mantenere `SessionExport.shutdown()` e `KiloShutdown.run()`).
- `packages/opencode/src/kilocode/server/httpapi/groups/telemetry.ts` e `handlers/telemetry.ts`: **rimuovere i file** (sono sotto `src/kilocode/`, no marker).
- `packages/opencode/src/server/routes/instance/httpapi/api.ts`: rimuovere import `TelemetryApi` (L46) e `.addHttpApi(TelemetryApi)` (L116) — aggiornare i commenti `kilocode_change` del blocco.
- `packages/opencode/src/kilocode/server/httpapi/server.ts`: rimuovere import e voce `telemetryHandlers` dal `provide` (L31, L52).
- Tutti i call-site `Telemetry.track*/track*` elencati sopra: rimuovere le chiamate (funzioni wrapper interne tipo `trackStep` possono restare come no-op o essere rimosse se private).
- `packages/opencode/package.json`: rimuovere `"@kilocode/kilo-telemetry"` dalle dependencies (verificare che nessun altro import resti in `src/` — se ce n'è uno, portarlo a questo step).

**Attività**: eseguire le modifiche; verificare che `grep -rn "kilo-telemetry\|PostHog\|posthog" packages/opencode/src` restituisca zero match (salvo commenti); mantenere compilabile la TUI (feedback.ts potrebbe perdere `trackFeedback`: rimuovere la funzione se privata).

**Output atteso**: CLI senza alcuna telemetria; serve senza le due route.

**Verifiche**:
- `bun run check-types` da `packages/opencode/` (tsgo) oppure dal root `bun turbo typecheck`.
- Test targettizzati se presenti: `bun test ./test/kilocode/` in `packages/opencode/` (verificare quali test toccano telemetry: es. `test/kilocode/...` che assertano eventi → aggiornamenti minimi).

**Compilazione**: obbligatoria; risolvere tutti gli errori introdotti.

**Rischi**: qualche test in `packages/opencode/test/` asserisce su `Telemetry.track` spy → aggiustare i test minimamente (rimuovere l'assertion, non riscrivere il test).

**Istruzioni per il subagente**: implementa solo questo step; non toccare il gruppo `kilo`; non rimuovere `@kilocode/kilo-gateway`; mantieni i marker `kilocode_change` coerenti in `api.ts`; compila; usa WebFetch/MCP solo se dubiti di un'API Effect.

---

### Step 2 — CLI: rimuovere il provider `kilo` dal registro e dai flussi LLM

**Obiettivo**: il provider `kilo` (Kilo Gateway) non esiste più: nessun modello `kilo-auto/*`, nessun loader `kilo`, nessun `KiloAuthPlugin`, nessun fallback `kilo-auto/small`. Restano intatti tutti gli altri provider incluso `@ai-sdk/openai-compatible`.

**Motivazione**: cuore della richiesta — solo provider locali OpenAI-compatibili.

**File da leggere**:
- `packages/opencode/src/provider/models.ts` (L45–99)
- `packages/opencode/src/provider/model-cache.ts` (intero file)
- `packages/opencode/src/kilocode/provider/provider.ts` (`KILO_BUNDLED_PROVIDERS` L30–32, loader L182–214, `patchKiloProviderPrivacy` L1681, `kiloSmallModelPriority` L276–279, `KILO_MODEL_SCHEMA_EXTENSIONS` L38–56)
- `packages/opencode/src/provider/provider.ts` (merge `BUNDLED_SDK` L152, `getSmallModel` fallback L2062–2065, autoload/env gate L1602–1604, custom loader dispatch L1647)
- `packages/opencode/src/plugin/index.ts` (L30, L71 — `KiloAuthPlugin`)
- `packages/opencode/src/session/llm/request.ts` (L181–255 header `isKilo`)
- `packages/opencode/src/session/llm/transform.ts` (case `"@kilocode/kilo-gateway"` ×~10)
- `packages/opencode/src/provider/auth.ts` (L234–245 ramo `providerID==="kilo"`)
- `packages/opencode/src/auth/index.ts` (L91–96 ramo kilo)
- `packages/opencode/src/acp/service.ts` (L789–791)
- `packages/opencode/src/kilocode/tool/agent-manager.ts` (L238 rank)
- `packages/opencode/src/kilocode/provider/model-filter.ts` (`filterPromptTrainingModels`), `metadata.ts`
- Test: `packages/opencode/test/provider/provider.test.ts`, `test/provider/models*.test.ts` (se esistono)

**File da modificare**:
- `provider/models.ts`: rimuovere il blocco che ri-inserisce `providers.kilo` (L47–96) ma **conservare** `addApertis` e il resto.
- `provider/model-cache.ts`: rimuovere il file (gestisce solo kilo+apertis: se apertis usa `ModelCache`, valutare — verificare prima; se apertis ne dipende, ridurre il file a solo apertis invece di cancellarlo).
- `kilocode/provider/provider.ts`: rimuovere `KILO_BUNDLED_PROVIDERS`, il loader `kilo`, `patchKiloProviderPrivacy`, `kiloSmallModelPriority`; in `kilocode/provider/provider.ts` togliere `createKilo`/`AI_SDK_PROVIDERS`/`PROMPTS` dagli import (verificare se `PROMPTS`/`AI_SDK_PROVIDERS` servono ancora ad altre funzioni del file — `KILO_MODEL_SCHEMA_EXTENSIONS` li usa: se le estensioni schema servono solo a modelli gateway, rimuovere anche le estensioni; **verifica preventiva** in `packages/core/src/v1/config/provider.ts`).
- `provider/provider.ts`: rimuovere il merge `...KILO_BUNDLED_PROVIDERS` (L152), il fallback `s.providers["kilo"]?.models["kilo-auto/small"]` (L2062–2065), il riferimento in `kiloSmallModelPriority` (L2019).
- `plugin/index.ts`: rimuovere l'uso di `KiloAuthPlugin` (import + registrazione hook auth per `kilo`).
- `session/llm/request.ts`: rimuovere il blocco header task/project/machine condizionato a `isKilo` (L181–255) e gli import gateway (`HEADER_*`, `ENV_FEATURE/VERSION`, `buildKiloHeaders`).
- `session/llm/transform.ts`: rimuovere tutti i case `"@kilocode/kilo-gateway"`.
- `provider/auth.ts` + `auth/index.ts`: rimuovere i rami `providerID === "kilo"` (inclusi i call telemetry già morti dopo step 1).
- `acp/service.ts`: rimuovere la preferenza `providers["kilo"]` (L789–791).
- `kilocode/tool/agent-manager.ts`: rimuovere la riga rank `if (providerID === "kilo") return 1`.
- `kilocode/provider/model-filter.ts`, `metadata.ts`: rimuovere i riferimenti `kilo-auto/*`.
- `packages/opencode/package.json`: se dopo questo step nessun import resta, rimuovere `@kilocode/kilo-gateway` dalle deps (probabilmente **no**: restano gli usi in indexing/cloud/config → mantenerla finché quegli step non passano).

**Attività**: eseguire le modifiche; poi `grep -rn '"kilo"' packages/opencode/src/provider packages/opencode/src/session packages/opencode/src/plugin packages/opencode/src/acp` per trovare riferimenti residui (stringhe providerID) e pulirli; aggiornare i test che asseriscono sul provider kilo (es. `provider.test.ts` blocchi che aspettano `kilo-auto` nel list).

**Output atteso**: `kilo serve` avvia senza provider kilo; i provider custom OpenAI-compatibili in config funzionano (già coperto dai test upstream `local-llm`).

**Verifiche**:
- Typecheck CLI.
- Da `packages/opencode/`: `bun test ./test/provider/` (aggiornando i casi che usano provider kilo).
- Smoke manuale (facoltativo, se l'ambiente lo permette): config con provider `mylocal` (`npm:"@ai-sdk/openai-compatible"`, `env:[]`, `options.baseURL` localhost) → `bun dev run "ping"` non fallisce per provider mancante.

**Compilazione**: obbligatoria.

**Rischi**: `model-cache.ts` condiviso con apertis (risolto con riduzione mirata); `PROMPTS`/`AI_SDK_PROVIDERS` usati da `packages/core` (Assunzione A2 — se qui si rompe core, fermarsi e segnalare: in tal caso portare le costanti in un modulo locale di opencode e farci puntare `core`).

**Istruzioni per il subagente**: solo questo step; non toccare i gruppi HTTP `/kilo/*` (passano agli step 3–4); non rimuovere i pacchetti dal workspace; compila e corri i test provider; in caso di dipendenza incerta su `PROMPTS`/`AI_SDK_PROVIDERS` consulta la doc/usa grep esteso in `packages/core` prima di decidere.

---

### Step 3 — CLI: rimuovere i gruppi HTTP `/kilo/*` e gli handler

**Obiettivo**: il server HTTP non espone più nessun path `/kilo/*`.

**Motivazione**: chiude il proxy estensione→cloud; prepara la rigenerazione SDK (step 6).

**File da leggere**:
- `packages/opencode/src/kilocode/server/httpapi/groups/kilo-gateway.ts`, `handlers/kilo-gateway.ts`
- `packages/opencode/src/kilocode/server/httpapi/public.ts` (`matchLegacyKiloOpenApi`)
- `packages/opencode/src/server/routes/instance/httpapi/public.ts` (L69–70)
- `packages/opencode/src/server/routes/instance/httpapi/api.ts` (L39, L109)
- `packages/opencode/src/kilocode/server/httpapi/server.ts` (L23, L44)
- Consumatori CLI interni delle route (verificare): `kilocode/cloud/catalog.ts`, `kilocode/components/indexing-dialog-state.ts`, `kilocode/indexing.ts` (fetch diretti, non via HTTP locale)
- `packages/opencode/src/kilocode/indexing.ts` (`kiloAuth`/`enrichKilo`/`models()` L543), `packages/kilo-indexing/src/indexing/embedders/kilo.ts`, `service-factory.ts` (L86–92), `groups/indexing.ts` (schema `KiloEmbeddingModel(Catalog)` L14–26)

**File da modificare**:
- Rimuovere i file `groups/kilo-gateway.ts` e `handlers/kilo-gateway.ts`.
- `api.ts`: rimuovere import `KiloGatewayApi` (L39) e `.addHttpApi(KiloGatewayApi)` (L109) + marker.
- `server.ts` (kilocode httpapi): rimuovere import e voce `kiloGatewayHandlers` (L23, L44).
- `kilocode/server/httpapi/public.ts`: rimuovere `matchLegacyKiloOpenApi` e la sua invocazione; `public.ts` (route instance): rimuovere le entry `QueryParameterSchemas` per `/kilo/cloud-sessions`.
- `kilocode/indexing.ts`: rimuovere `kiloAuth`/`enrichKilo` e il ramo embedding-model "kilo" (mantenendo i rami `openai-compatible`/`ollama`); rimuovere `fetchKiloEmbeddingModelCatalog`/`resolveKiloGatewayBaseUrl` dagli import.
- `packages/kilo-indexing/src/indexing/embedders/kilo.ts`: rimuovere il file; `service-factory.ts`: rimuovere il ramo embedder "kilo" (restano `openai-compatible` e `ollama`); `groups/indexing.ts`: rimuovere gli schema `KiloEmbeddingModel(Catalog)` dall'endpoint `embedding-models` (l'endpoint resta, elenca solo embedder locali).
- `kilocode/components/indexing-dialog-state.ts`: rimuovere import da gateway (verificare uso).

**Output atteso**: nessun path `/kilo/*` nella OpenAPI generata; l'indexing offre solo embedder locali.

**Verifiche**: typecheck CLI; `bun test ./test/kilocode/config/` e `./test/kilocode/indexing*` in `packages/opencode/` (aggiornare i casi che aspettano l'embedder kilo); smoke: `bun dev generate > /tmp/openapi.json` da `packages/opencode/` e `grep -c '"/kilo/' /tmp/openapi.json` == 0.

**Compilazione**: obbligatoria.

**Rischi**: l'endpoint `embedding-models` dell'indexing cambia shape → l'estensione (step 8) e lo SDK (step 6) devono seguirlo; sequenza rispettata.

**Istruzioni per il subagente**: solo questo step; non toccare `kilo-sessions`/`presence` (step 5); compila; verifica la OpenAPI come indicato.

---

### Step 4 — CLI: rimuovere KiloSessions ingest/share, presence, session-export, area cloud

**Obiettivo**: nessun fetch verso `ingest.kilosessions.ai`, `app.kilo.ai`, `cloud-agent-next.kilosessions.ai`, `supermassive-black-hole.kiloapps.io`, `KILO_EVENT_SERVICE_URL`.

**Motivazione**: sessioni solo locali; nessuna sincronizzazione/condivisione cloud.

**File da leggere**:
- `packages/opencode/src/kilo-sessions/` (intero dir: `kilo-sessions.ts`, `remote-sender.ts`, `remote-command.ts`, `ingest-queue.ts`, `repository.ts`)
- `packages/opencode/src/kilocode/presence/service.ts`
- `packages/opencode/src/kilocode/session-export/` (`worker/endpoint.ts`, `eligibility.ts`, `org-sources.ts`)
- `packages/opencode/src/kilocode/cloud/` (`auth.ts`, `commands.ts`, `catalog.ts`, `transport.*`, `stream-ticket.ts`, `repository.ts`, `origin.ts`)
- Wiring: `kilocode/bootstrap.ts` (L39, L49), `cli/cmd/serve.ts` (L33 drain), `tool/registry.ts` (L65), `cli/tui/worker.ts` (L17), hook GlobalBus su `Session.Event.Created`
- `packages/opencode/src/kilo-sessions/kilo-sessions.ts` (validazione token `${KILO_API_BASE}/api/user` L144)
- `packages/opencode/src/cli/cmd/import.ts` (parse share URL L29, L163, L168)

**File da modificare**:
- Rimuovere i directory/file sopra (tutti sotto `src/kilocode/` o `src/kilo-sessions/` → no marker); nei file *non* kilocode (`bootstrap.ts` è kilocode; `cli/cmd/serve.ts`, `tool/registry.ts`, `cli/tui/worker.ts`, `cli/cmd/import.ts` sono **upstream** → usare marker `kilocode_change start/end` attorno alle porzioni rimosse se restano altri chunk kilocode, altrimenti rimuovere le righe direttamente).
- `cli/cmd/import.ts`: rimuovere il supporto "import da URL share cloud"; il comando può continuare a supportare import da file locale se presente (verificare).
- Verificare i riferimenti in `src/kilocode/cli/cmd/*` (es. `cmd/profile.ts` che importa tipi gateway) → rimuovere quei comandi Kilo (`profile`, team-select) — sono TUI-only e gateway-only.

**Output atteso**: nessun fetch verso domini Kilo/sessioni-cloud; i comandi TUI rimasti funzionano.

**Verifiche**: typecheck CLI; `grep -rn "kilosessions\|kiloapps.io\|EVENT_SERVICE" packages/opencode/src` → zero; test `./test/kilocode/` relativi (import, bootstrap).

**Compilazione**: obbligatoria.

**Rischi**: hook GlobalBus rimossi → assicurarsi che `Session.Event.Created` resti emesso normalmente (gli hook erano listener, non producer).

**Istruzioni per il subagente**: solo questo step; mantieni i marker corretti nei file upstream; compila.

---

### Step 5 — CLI: rimuovere tool online (`generate-image`, websearch `kilo-exa`) e fetch residuali

**Obiettivo**: il tool `generate_image` scompare; `web_search` mantiene solo i trasporti Byok (Exa/Parallel MCP) — che restano opt-in con chiave dell'utente — oppure, se ritenuto fuori scope, si disabilita il tool. I probe `session/network.ts` e `github.handler.ts` restano (feature agente/opzionali, non servizi Kilo) ma i probe non puntano più a `kilo.ai`.

**Motivazione**: completa la pulizia lato tool.

**File da leggere/modificare**:
- `packages/opencode/src/kilocode/tool/generate-image.ts` — rimuovere il file + la sua registrazione in `tool/registry.ts` (riga relativa, verificare esatta).
- `packages/opencode/src/kilocode/tool/websearch-kilo-exa.ts` — rimuovere il file; in `tool/websearch.ts` (L151–201) rimuovere il trasporto `kilo-rest` (mantenere `mcp-exa-byok`, `mcp-exa-unauth`, `mcp-parallel`).
- `packages/opencode/src/session/network.ts` — sostituire `https://kilo.ai` con un altro dominio neutro (es. `https://www.google.com`) nella lista `urls` (L35); il resto del meccanismo (reattivo ai retry offline) resta.
- `packages/opencode/src/cli/cmd/github.handler.ts` — verificare: se il flusso installa un'app GitHub *di Kilo* (agent cloud), rimuovere quel flusso; se è solo integrazione gh generica, tenere. (Il subagente deciderà leggendo il file; default: rimuovere solo i riferimenti a `KILO_API_BASE`/gateway url default L327, L711.)
- `packages/opencode/src/kilocode/cli/cmd/tui/*`: pulire i dialog `dialog-kilo-*`, `kilo-news.tsx`, `news.ts`, `notification-banner.tsx`, `sidebar-footer.tsx` (L76), `home-footer.tsx` (L75), `home-onboarding.tsx` (L18), `dialog-provider.tsx` (L101/134), `routed-model-meta.tsx` (L44) — rimuovere sezioni "Kilo Gateway"/login/kilo-pass/news cloud (Assunzione A3).
- `packages/opencode/src/kilocode/config/config.ts`: rimuovere `loadOrganizationModes` (L418–439) e la chiamata (L506); in `overlay.ts` rimuovere `indexing.kilo.*` (L107–109) tenendo `indexing.openai/ollama/openai-compatible`.
- Rimozione dipendenza: a questo punto verificare `grep -rn "@kilocode/kilo-gateway" packages/opencode/src` → se zero, rimuovere da `packages/opencode/package.json`.

**Output atteso**: CLI senza tool gateway; TUI senza sezioni account; config senza org modes cloud.

**Verifiche**: typecheck CLI; grep sui domini (`api.kilo.ai`, `KILO_API_BASE`, `KILO_OPENROUTER_BASE`) → zero in `packages/opencode/src`; test `./test/kilocode/config/`.

**Compilazione**: obbligatoria.

**Rischi**: `packages/core` dipende ancora dal gateway (A2) → se la rimozione della dep da `opencode` fa partire lint/workspace error, lasciare la dep finché non si adatta `core` (step 13).

**Istruzioni per il subagente**: solo questo step; per i file TUI fare removal chirurgica (sezioni), non riscrittura; compila.

---

### Step 6 — Rigenerare lo SDK e preparare l'estensione

**Obiettivo**: `@kilocode/sdk` rigenerato senza namespace `kilo`/`telemetry`; l'estensione compila dopo adeguamento minimale dei call-site (che verranno rifiniti negli step 7–12).

**Motivazione**: separa la rottura tipica (SDK) dai refactoring funzionali.

**File da leggere**:
- `packages/sdk/js/script/build.ts`, `script/generate.ts`
- `packages/kilo-vscode/script/prepare-sdk.ts`
- `packages/kilo-vscode/src/services/cli-backend/connection-service.ts` (uso `client.kilo.*`/`client.telemetry.*`? l'SDK client esposto)
- `packages/kilo-vscode/src/services/cli-backend/types.ts`

**File da modificare**:
- Eseguire `bun run script/generate.ts` dal root (rigenera `packages/sdk/js/src/v2/gen/` + build). Se il fingerprint di `prepare-sdk.ts` include `packages/opencode` (lo fa), la rigenerazione avviene comunque alla prossima `compile` dell'estensione.
- Correggere eventuali post-patch in `build.ts` che si agganciano a paths `/kilo/*` (verificare L74–95: i patch attuali sono limit/after su session history — dovrebbero restare validi; verificare `clean:true` non lasci garbage).
- Nell'estensione: per far compilare, i call-site `client.kilo.*`/`client.telemetry.*` non esistono più → in questo step si sostituisce **solo** con TODO-commentati? **No**: si fanno i tagli veri nei file più piccoli (`types.ts`: rimuovere `KilocodeProfile/Balance/Organization`, `CloudSession*`) e si correggono i file che importano quei tipi (`kilo-provider-utils.ts` L4, `kilo-provider/handlers/cloud-session.ts` L9) rendendo i loro handler no-op temporanei **entro questo step** (rimuoveremo poi gli handler interi negli step successivi). In pratica: questo step rende compilabile l'estensione con SDK nuovo; i refactoring funzionali seguono.

**Output atteso**: `bun run typecheck` in `packages/kilo-vscode/` verde (host + webview) con SDK rigenerato.

**Verifiche**: `bun run prepare:sdk && bun run typecheck` da `packages/kilo-vscode/`; `grep -c "client.kilo" packages/kilo-vscode/src -r` → conteggio ridotto ai soli call-site ancora da tagliare (elenco noto).

**Compilazione**: obbligatoria (typecheck). Se il typecheck webview fallisce per motivi indipendenti pre-esistenti, documentarli ma non peggiorare.

**Rischi**: la rigenerazione può cambiare forme di tipi usati dall'estensione al di fuori di `kilo` (es. `ProviderUsageData` da `types/messages/provider-usage.ts` che importava da SDK) → correggere in loco.

**Istruzioni per il subagente**: esegui la rigenerazione davvero (comando reale), poi porta l'estensione in compilazione con i tagli minimi descritti; non rifare il refactoring funzionale degli step 7–12.

---

### Step 7 — Estensione: rimuovere telemetria host + webview feedback

**Obiettivo**: nessun invio di eventi analitici; nessun context feedback.

**File da leggere/modificare** (host):
- Rimuovere il directory `packages/kilo-vscode/src/services/telemetry/` (5 file).
- `extension.ts`: L57 `TelemetryProxy.getInstance()`, L81–92 configure/setEnabled on connect, L109–113 `onDidChangeTelemetryEnabled`, L376–406 wrapper title-button (rimuovere solo il `capture`, tenere i command), L650 `shutdown()` in deactivate.
- `KiloProvider.ts`: L495 `setProvider(this)`, L596–606 `getTelemetryProperties()`, L1509–1511 `case "telemetry"`, L699 `pushTelemetryState`, L1028–1029 + L5485 `watchTelemetryState`/dispose, L1433 `chatAutocomplete.telemetry.captureAcceptSuggestion` (rimuovere la chiamata, tenere il resto del flow).
- `MarketplacePanelProvider.ts`: `case "telemetry"` (L230–231) — (il file verrà rimosso integralmente nello step 9; qui si taglia solo la case).
- `agent-manager/vscode-host.ts`: metodo `capture` (L320–322) — rimuovere dal contratto host.
- `agent-manager/fork-session.ts`: `capture(AGENT_MANAGER_SESSION_ERROR)` (L54) →换成 log locale (o rimuovere).
- `services/autocomplete/AutocompleteServiceManager.ts` (L147–163, L276, L343, L116 `AutocompleteTelemetry`) e `classic-auto-complete/AutocompleteTelemetry.ts` (rimuovere il file + i hook in `ChatTextAreaAutocomplete.ts`, `NextEditInlineCompletionProvider.ts`) — attenzione: l'autocomplete sarà rimosso integralmente a step 10; qui si taglia solo la telemetria per non bloccare la compilazione.
- `server-manager.ts` L147: rimuovere `KILO_TELEMETRY_LEVEL` (e `KILO_MACHINE_ID`? no — `machineId` è usato anche per storage locale: **tenere** `KILO_MACHINE_ID`; rimuovere solo `KILO_TELEMETRY_LEVEL`).

**File da modificare** (webview):
- Rimuovere `webview-ui/src/context/feedback.tsx` e `feedback-payload.ts`; smontare `FeedbackProvider` in `provider-shell.tsx`; rimuovere `transcriptRow`/`AssistantMessage` prop `feedback` in `TranscriptRow.tsx` (il componente kilo-ui accetta `feedback` opzionale → basta non passarla).
- Union messaggi: rimuovere `telemetry` da `webview-messages.ts` e `telemetryState` da `extension-messages.ts`; rimuovere i relativi case in `KiloProvider.ts` message handling e in `vscode-host.ts`.
- Test: `tests/unit/...` che mockano telemetry (es. `AutocompleteServiceManager.spec.ts` con mock stale `@roo-code/telemetry`) → aggiornare/rimuovere i mock.

**Verifiche**: `bun run typecheck` (host+webview); `bun test tests/unit/` per i file toccati; `grep -rn "TelemetryProxy\|telemetryState\|FEEDBACK_SUBMITTED" packages/kilo-vscode/src packages/kilo-vscode/webview-ui` → zero (salvo i18n neutrali).

**Compilazione**: obbligatoria.

**Rischi**: `vscode-host.ts` è un contratto largo: verificare il type del `VscodeHost` interface usato dal webview agent-manager e aggiornarlo coerentemente.

**Istruzioni per il subagente**: solo questo step; non rimuovere marketplace/claw/profilo (step 8–11); compila.

---

### Step 8 — Estensione: rimuovere auth/profile/notifications/cloud-sessions (host + webview + package.json)

**Obiettivo**: niente device-flow, profilo, balance, organizzazioni, notifiche remote, cloud sessions.

**File da modificare** (host):
- Rimuovere `src/kilo-provider/handlers/auth.ts` e `src/kilo-provider/handlers/cloud-session.ts`.
- `KiloProvider.ts`: rimuovere i case `login/logout/setOrganization/refreshProfile/requestProviderUsage/refreshProviderUsage/requestNotifications/dismissNotification/requestCloudSessions/requestCloudSessionData/requestGitRemoteUrl/requestKiloEmbeddingModels`, i metodi `fetchAndSendProviderUsage`, `fetchAndSendKiloEmbeddingModels` (e l'import `fetchKiloEmbeddingModelCatalog` da `@kilocode/kilo-gateway` — ultimo uso diretto del gateway nell'host), `fetchAndSendNotifications`, `syncWebviewState` (ridurre a ciò che resta: connection state, providers, agents...), `disposeGlobal`, i riferimenti `cachedProviderUsageMessage`/`invalidateProviderUsage`, il broadcast `notifyProfileChanged` (e la subscription L1862), i tipi `ProfileData`/`DeviceAuthState` dai message switch.
- `src/kilo-provider/notifications.ts`: rimuovere.
- `src/kilo-provider/sidebar-worktree.ts`: case `openProfilePanel` (L63).
- `src/provider-actions.ts`: rimuovere `authorizeProviderOAuth`/`completeProviderOAuth` **solo se** usati esclusivamente per `kilo` — verificare: il flow OAuth generico serve anche ad altri provider cloud (anthropic/openai?) che restano nel registro → **tenere** il meccanismo generico, rimuovere solo i riferimenti specifici `kilo` e `computeDefaultSelection`/`KILO_AUTO`/`createKiloFallbackProvider`/`PROVIDER_PRIORITY` da `src/shared/provider-model.ts` (riscrivere le costanti: priority senza `kilo`, default selection = primo provider attivo con modelli).
- `connection-service.ts`: rimuovere `onProfileChanged`/`notifyProfileChanged`/`profileChangeListeners`.
- `SettingsEditorProvider.ts`: rimuovere il pannello "profile" (o l'intero file se usato solo per quello — verificare: apre un `KiloProvider` come panel; se il file ospita anche altri view, ritagliare).
- `extension.ts`: rimuovere i comandi `kilo-code.new.profileButtonClicked` e `kilo-code.new.sidebarTitle.profileButtonClicked` (registration + handler).
- `types.ts` (cli-backend): già iniziato a step 6; completare la rimozione di `ProfileData` e relative union usate in `KiloProvider`.

**File da modificare** (webview):
- Rimuovere `components/profile/` (ProfileView, DeviceAuthCard, ProviderUsageCards), `components/shared/AccountSwitcher.tsx`, `BalanceChip.tsx`, `components/chat/KiloNotifications.tsx`, `context/notifications.tsx`.
- `context/server.tsx`: rimuovere segnali `profileData`/`deviceAuth`/`providerUsage*`, `startLogin`/`goToLogin`, i relativi handler messaggi (mantenere il resto del ServerContext: connection state, language...).
- `context/provider.tsx`: rimuovere l'uso di `authStates` del provider `kilo` come gate "logged in" (verificare dove viene usato come condizione di abilitazione di feature → renderlo sempre true o legarlo a "ha almeno un provider con credential").
- `App.tsx`: rimuovere il case `currentView()==="profile"` e il relativo rendering (L395–406).
- `MessageList.tsx`: rimuovere `<KiloNotifications>` e `AccountSwitcher`.
- `ProvidersTab.tsx` + `ProviderSelectDialog.tsx`: rimuovere la card "Kilo Gateway" e le chiamate `goToLogin` (i provider restanti restano selezionabili).
- `IndexingTab.tsx`: rimuovere `kiloAvailable` da `profileData` (l'indexing resta con embedder locali; la flag diventa sempre disponibile).
- `SidebarTopBar.tsx`: rimuovere pulsanti profile/marketplace/kiloclaw (questi ultimi due completati a step 9–11).
- Cloud sessions: `components/history/HistoryView.tsx` (rimuovere tab `cloud`), `CloudSessionList.tsx`, `CloudImportDialog.tsx`, in `context/session.tsx` rimuovere `selectCloudSession`/`cloudPreviewId`/handler cloud, in `context/local-tabs.tsx` rimuovere `previewCloud` e i listener, in `App.tsx` il routing `openCloudSession`.
- Tipi: `types/messages/profile.ts` (rimuovere), voci in `connection.ts` (`DeviceAuthState`), `sessions.ts` (`CloudSessionInfo`), union `extension-messages.ts`/`webview-messages.ts` (`profileData`, `deviceAuth*`, `notificationsLoaded`, `providerUsageLoaded`, `cloudSessions*`, `gitRemoteUrlLoaded`, `openCloudSession`, `requestCloudSessions`, ...).
- I18n: rimuovere le chiavi `deviceAuth.*`, `profile.*`, `sidebar.topBar.profile|marketplace|kiloClaw`, `history.cloud*` dai file `webview-ui/src/i18n/*.ts` (16 file) — solo le chiavi orfane (knip-like manuale); attenzione a non rompere la struttura dei file (ogni lingua deve restare parseable).

**package.json** (estensione): rimuovere da `contributes.commands` e dai menu `kilo-code.new.profileButtonClicked`, `kilo-code.new.sidebarTitle.profileButtonClicked` (le voci marketplace/kiloclaw si rimuovono a step 9/11 per coerenza dei diff — in realtà conviene rimuoverle tutte qui per package.json: sì, rimuovere anche `marketplaceButtonClicked` e `kiloClawOpen` qui, i codici corrispondono agli step 9/11).

**Verifiche**: typecheck host+webview; grep in webview su `profileData|deviceAuth|cloudSession|notificationsLoaded|providerUsage` → zero; `bun test tests/unit/` (alcuni test potrebbero simulare messaggi rimossi → aggiornare).

**Compilazione**: obbligatoria.

**Rischi**: `server.tsx` è un context centrale: il taglio deve essere chirurgico (segnali rimossi ma provider intatto); i file i18n sono 16 e strutturati identicamente → edit sistematico.

**Istruzioni per il subagente**: solo questo step; non toccare marketplace/claw/autocomplete; compila; se `SettingsEditorProvider` ospita altre view, ritaglia invece di cancellare.

---

### Step 9 — Estensione: rimuovere Marketplace (host + webview + build)

**File da modificare**:
- Rimuovere `src/services/marketplace/` (intero directory: api, index, actions, installer, paths, detection, relevance, notifier, notify, types).
- Rimuovere `src/MarketplacePanelProvider.ts`.
- `extension.ts`: rimuovere import/creazione provider+notifier (L309–317, L337–339), i comandi `marketplaceButtonClicked`/`sidebarTitle.marketplaceButtonClicked` (L398, L415).
- `esbuild.js`: rimuovere l'entrypoint `webview-ui/marketplace/index.tsx` → `dist/marketplace.js` (+ css) dalla configurazione di build.
- Webview: rimuovere `webview-ui/marketplace/` (directory), `webview-ui/src/components/marketplace/`, `webview-ui/src/context/marketplace-session.tsx`, `webview-ui/src/types/marketplace.ts`, `webview-ui/stories/marketplace.stories.tsx`, e le voci nelle union messaggi (`fetchMarketplaceData`, `installMarketplaceItem`, `removeInstalledMarketplaceItem`, `dismissAgentMigrationBanner`, `marketplaceData`, `marketplaceInstallResult`, `marketplaceRemoveResult`, `openInstallModal`, `OpenMarketplacePanelRequest`).
- `SidebarTopBar.tsx`: già preparato a step 8 (rimuovere anche qui definitivamente il pulsante).
- `project-directory.ts`: verificare `resolvePanelProjectDirectory` — se usato solo dal marketplace, rimuovere; altrimenti tenere.
- I18n: chiavi `sidebar.topBar.marketplace` e `marketplace.*` dai 16 file.
- `package.json`: conferma rimozione comandi/menù (fatta a step 8) + eventualmente `scripts` inesistenti legati.

**Verifiche**: typecheck; `bun run bundle` (verifica che esbuild non cerchi più l'entry marketplace); grep `marketplace` in src+webview-ui → solo riferimenti innocui (es. keyword package.json, docs).

**Compilazione**: obbligatoria (bundle incluso).

**Rischi**: `esbuild.js` condiviso tra i 3/4 bundle: cura nel rimuovere solo l'entry corretta.

**Istruzioni per il subagente**: solo questo step; compila + bundle; non toccare kiloclaw (step 10).

---

### Step 10 — Estensione: rimuovere KiloClaw (host + webview + build)

**File da modificare**:
- Rimuovere `src/kiloclaw/` (intero directory: token-manager, KiloClawProvider, types).
- `extension.ts`: rimuovere import (L5) e registration del comando `kiloClawOpen`.
- `esbuild.js`: rimuovere l'entry `webview-ui/kiloclaw/index.tsx` → dist kiloclaw (verificare il nome output nel file).
- Webview: rimuovere `webview-ui/kiloclaw/` (intero bundle separato), `OpenKiloClawRequest` dalle union, `hooks/useSlashCommand.ts` (L193 slash `/kiloclaw`), pulsante in `SidebarTopBar.tsx` (definitivo).
- I18n: chiavi `sidebar.topBar.kiloClaw` (+ eventuale namespace `kiloclaw.*` self-contained in `webview-ui/kiloclaw/i18n/` che sparisce col directory).
- `package.json`: comandi `kiloClawOpen`/`sidebarTitle.kiloClawOpen` + menu (fatti a step 8 se lì, altrimenti qui).

**Verifiche**: typecheck + bundle; grep `kiloclaw|KiloClaw` in src+webview-ui → zero.

**Compilazione**: obbligatoria.

**Rischi**: basso — modulo ben isolato.

**Istruzioni per il subagente**: solo questo step; compila + bundle.

---

### Step 11 — Estensione: rimuovere autocomplete FIM/next-edit (host + webview)

**Obiettivo** (D1): rimuovere completamente l'autocompletamento inline servito dal gateway.

**File da modificare**:
- Rimuovere `src/services/autocomplete/` (intero directory: `AutocompleteServiceManager.ts`, `fim.ts`, `settings.ts`, `migrate-default.ts`, `shared` dentro, `classic-auto-complete/` (incl. `AutocompleteInlineCompletionProvider.ts`, `ErrorBackoff.ts`, `AutocompleteTelemetry.ts`), `next-edit/` (MercuryEditProvider, NextEditInlineCompletionProvider, constants), `chat-autocomplete/ChatTextAreaAutocomplete.ts`, `AutocompleteTelemetry` già parzialmente trattato a step 7).
- `src/shared/autocomplete-models.ts`: rimuovere (ultimo re-export `@kilocode/kilo-gateway/autocomplete` nell'host).
- `extension.ts`: rimuovere la registration di `AutocompleteServiceManager` (singleton, `onStateChange`/`onEventFiltered` wiring) e i comandi `kilo-code.new.autocomplete.*` (4 comandi) + keybinding `ctrl+l`/escape/`tab` associati in `package.json`; rimuovere anche `showIncompatibilityExtensionPopup` (keybinding + command, dipende da Copilot comparison ma è parte della superficie autocomplete — verificare se il popup ha altra utilità: è legato a smart-inline-task → rimuovere).
- Impatti su `KiloProvider.ts`: rimuovere i case messaggi autocomplete (`requestAutocompleteSettings`, `speechToText*` no—quelli restano a step 12; `chatAutocomplete` wiring, `autocompleteSettingsLoaded` cached message) e i riferimenti al service manager (L1433 già trattato a step 7).
- Webview: rimuovere `settings/AutocompleteTab.tsx` (+ tab registration in `Settings.tsx`), `settings/autocomplete-model-selector.ts`, la row "Autocomplete model" in `settings/ModelsTab.tsx` (+ `handleAutocompleteModelSelect`), `hooks/useGhostText.ts` (ghost-text chat autocomplete), setting `kilo-code.new.autocomplete.*` in `package.json` (4 setting: model, provider, enableAutoTrigger, enableSmartInlineTaskKeybinding, enableChatAutocomplete — 5 totali).
- `package.json`: rimuovere setting `kilo-code.new.autocomplete.*`, comandi `autocomplete.*`, keybinding correlate; rimuovere la dipendenza `@kilocode/kilo-gateway` **se** nessun altro import resta nell'host (dopo step 8–11 dovrebbe essere zero → rimuoverla qui).
- Test: `tests/unit/...AutocompleteServiceManager.spec.ts` e altri test autocomplete → rimuovere/aggiornare.
- I18n: chiavi `settings.autocomplete.*` / `autocomplete.*`.

**Verifiche**: typecheck + bundle; `bun test tests/unit/`; grep `autocomplete|Autocomplete|ghost|nextEdit` in src → zero (il termine "autocomplete" può apparire in i18n di altre lingue: pulire); `grep -rn "kilo-gateway" packages/kilo-vscode/src` → zero.

**Compilazione**: obbligatoria.

**Rischi**: `package.json` `contributes.configuration` è grande: edit preciso sulle chiavi; la keybinding `ctrl+l` ha due varianti (enable/disable smart keybinding + incompatibility popup) → rimuovere entrambe le righe.

**Istruzioni per il subagente**: solo questo step; compila + typecheck + unit test; attenzione a non rimuovere speech-to-text (step 12).

---

### Step 12 — Estensione + CLI: adattare speech-to-text e image generation a endpoint locali (D5)

**Obiettivo**: mic/speech-to-text e image generation restano disponibili ma puntano a provider locali OpenAI-compatibili (vLLM/llama.cpp/Ollama) configurati dall'utente, non al gateway.

**Design del sottostep** (da confermare durante l'implementazione con lettura dei file):
1. **CLI — nuovi handler leggeri** (sostituiono le route `/kilo/*` rimosse a step 3): aggiungere un piccolo gruppo HTTP (o riusare un gruppo kilocode esistente appropriato, es. `KilocodeApi`) con:
   - `GET /stt/models` → elenco dei modelli speech dichiarati in config (da un nuovo campo config `experimental.speech_to_text_models` o derivati dai modelli `output_modalities` dei provider locali — decisione: **derivare dai modelli del provider selezionato**, più semplice: il campo config indica `{providerID, modelID, baseUrl?}`).
   - `POST /stt/transcribe` → riceve audio base64 + `{providerID, modelID}`, risolve il provider loader (`@ai-sdk/openai-compatible`) e invoca `{baseURL}/audio/transcriptions` (formato OpenAI) con il modello scelto.
   - `GET /img/models` + `POST /img/generate` analoghi verso `{baseURL}/images/generations`.
   Implementazione minima: un modulo `packages/opencode/src/kilocode/media-local/` (handler + resolve provider via `Provider.get`/loader esistente). Marker `kilocode_change` non necessari (dir kilocode).
2. **CLI — config**: estendere lo schema `experimental` (o `media`) con `speech_to_text: { provider: string, model: string }` e `image_generation: { provider: string, model: string }` (stringhe `providerID/modelID` riferite a provider in `cfg.provider`); verificare lo schema in `packages/core/src/v1/config/experimental.ts` (o equivalente) e aggiornare.
3. **Estensione host**: `src/speech-to-text/catalog.ts` → `fetchSpeechToTextModels` legge ora `GET /stt/models` (path aggiornato, stessa forma response ridotta: lista `{id, name}`); `transcribe.ts` POSTa a `/stt/transcribe` col corpo esteso; fallback statico `SPEECH_TO_TEXT_MODELS` mantenuto come ultima ratio. `src/image-generation/models.ts` → `GET /img/models`; il provider invia la richiesta di generazione tramite nuovo SDK method (dopo regen) o fetch diretto al backend locale (pattern già usato).
4. **Estensione webview**: `context/speech-to-text-models.tsx` e `context/image-models.tsx` — stessi messaggi (`requestSpeechToTextModels`/`speechToTextModelsLoaded`, `requestImageModels`/`imageModelsLoaded`) con payload aggiornato; `ModelsTab.tsx` / `ExperimentalTab.tsx`: i selector mostrano i modelli locali (label `providerID/modelID`); rimuovere il gate `hasSpeechToTextAccess` legato a `profileData` (diventa: c'è un provider speech configurato?).
5. **SDK**: le nuove route richiedono rigenerazione → eseguire di nuovo `bun run script/generate.ts` (root) e verificare che `prepare-sdk` dell'estensione lo pickup.

**File da leggere**: `packages/opencode/src/kilocode/server/httpapi/groups/kilocode.ts` (esempio di gruppo esistente da imitare), `packages/opencode/src/provider/provider.ts` (come risolversi un provider+model dal loader per fare una chiamata raw — verificare se esiste già un helper per chiamate non-AI-SDK; in alternativa l'handler può fare `fetch` diretto usando `baseURL` dalla config, approccio più semplice e robusto), `packages/core/src/v1/config/` (schema experimental), `packages/kilo-vscode/src/speech-to-text/*`, `src/image-generation/*`.

**Decisione implementativa consigliata** (minimo rischio): gli handler fanno **fetch diretto** a `{options.baseURL del provider}/audio/transcriptions` (o `/images/generations`) con `Authorization: Bearer {apiKey}` dalla config — niente passaggio per AI SDK. Meno code path, nessun coupling con il loader runtime.

**Verifiche**: typecheck CLI + estensione; bundle estensione; test CLI `./test/kilocode/` se presenti per media; smoke: config con provider locale + `experimental.speech_to_text` → `GET /stt/models` risponde.

**Compilazione**: obbligatoria in entrambi i package.

**Rischi**: schema config in `packages/core` è condiviso → se si aggiungono campi, usare estensioni `kilocode_change` appropriate nei file core (marker obbligatori); il formato audio OpenAI (`file` multipart vs base64) va verificato contro vLLM/llama.cpp (documentato: alcuni accettano solo multipart → l'handler può passare in through il body).

**Istruzioni per il subagente**: solo questo step; se il formato request di un engine locale differisce, implementare il passthrough più semplice e documentare; compila CLI ed estensione; rigenera SDK se hai aggiunto route.

---

### Step 13 — Pulizia dipendenze, costi morti e package.json finali

**Obiettivo** (D4): rimuovere dipendenze orfane e codice morto residuo in entrambi i package; verificare `packages/core`.

**File da modificare**:
- `packages/kilo-vscode/package.json`: rimuovere da `dependencies` `openai` (zero usi), `@anthropic-ai/sdk` (type-only per legacy-migration: se la migrazione legacy resta — Assunzione A9 — **tenere** `@anthropic-ai/sdk` perché serve al typecheck della migration; rimuovere solo `openai`), `@kilocode/kilo-gateway` (dovrebbe già essere rimossa a step 11 — verificare), `js-tiktoken`/`friendly-words` solo se orfane dopo i tagli (verificare con knip).
- Aggiornare `description`/`keywords` in `package.json` (riferimenti a "500+ AI models including Claude, Gemini, Grok, GPT..." e a gateway/marketplace → riscrivere per "works fully offline with local OpenAI-compatible providers (llama.cpp, vLLM, Ollama)").
- `packages/opencode/package.json`: rimuovere `@kilocode/kilo-gateway` e `@kilocode/kilo-telemetry` se nessun import resta (verificare con grep in `src/` e `test/`); `@kilocode/kilo-indexing` resta (embedder locali).
- `packages/core/src/v1/config/provider.ts` (Assunzione A2): se ancora importa `PROMPTS`/`AI_SDK_PROVIDERS` da `@kilocode/kilo-gateway` e il package è stato rimosso dal workspace → definire localmente le costanti (sono semplici mappe: `AI_SDK_PROVIDERS` = lista di id sdk; `PROMPTS` = map prompt per modello) copiandole in `packages/opencode/src/kilocode/provider/constants.ts` e facendo re-importare da core via path relativo **non è possibile** (core non dipende da opencode) → alternativa: definire le costanti in `packages/core/src/v1/config/` stesso e farle usare da opencode. **Se il package gateway resta nel workspace (opzione conservativa A2), questo step si limita a verificare e non muove nulla.**
- Knip in `packages/kilo-vscode/`: `bun run knip` → rimuovere export orfani creati dai tagli (es. tipi esportati non più importati) o unexportarli.
- `CHANGELOG.md` (kilo-vscode): append entry utente-facing ("removed online services: Kilo Gateway auth, marketplace, KiloClaw, cloud sessions, notifications, telemetry, gateway autocomplete; speech/image now use local OpenAI-compatible endpoints").
- Rimozione fisica del directory `packages/kilo-gateway/` e `packages/kilo-telemetry/`: **solo se** nessun package li dichiara più (dopo i punti sopra) e il workspace build passa; altrimenti lasciarli come dead code e annotare in PRUNE-NOTES.md.
- `PRUNE-NOTES.md` (repo root): append nota di questa rimozione.

**Verifiche**: `bun install` al root (aggiorne lockfile); `bun turbo typecheck`; `bun run lint` in kilo-vscode; `bun run knip` in kilo-vscode (pulito); `bun run check-kilocode-change` in kilo-vscode; `bun run script/check-opencode-annotations.ts --worktree` dal root (marker corretti nei file opencode modificati); `bun test` in `packages/kilo-vscode/` (suite unitaria completa) e `bun test` in `packages/opencode/` (o subset `./test/`).

**Compilazione**: obbligatoria (typecheck root + package).

**Rischi**: rimozione package dal workspace può invalidare `bun.lock` → eseguire `bun install` e verificare che la build SDK non richieda più i package rimossi (il fingerprint di `prepare-sdk.ts` include `kilo-gateway`/`kilo-telemetry` nei suoi input L11–31 → rimuovere quelle voci dal fingerprint per evitare rebuild infiniti).

**Istruzioni per il subagente**: solo questo step; eseguire realmente i comandi di verifica elencati; non introdurre refactoring extra; se knip segnala export usati da test, unexportare o rimodellare minimamente.

---

### Step 14 — Validazione end-to-end finale

**Obiettivo**: dimostrare che l'estensione funziona offline con provider locali.

**Attività** (nessuna modifica di codice attesa; se emergono bug, aprire fix minimali e tornare allo step pertinente):
1. `bun run extension:isolated:clean` dal root (build completo + launch VS Code isolato).
2. Nel workspace di prova: creare `kilo.json` (o config equivalente) con un provider locale fittizio (es. `npm:"@ai-sdk/openai-compatible"`, `env:[]`, `options.baseURL:"http://localhost:11434/v1"`, un modello dichiarato) e `model` impostato su di esso.
3. Verifiche manuali checklist:
   - Sidebar si apre; chat invia un messaggio al provider locale (mock o Ollama reale se disponibile) senza errori "provider not found".
   - Nessun pulsante Profile/Marketplace/KiloClaw nella top bar; storia senza tab Cloud.
   - Agent Manager si apre e crea sessioni/worktrees normalmente.
   - Settings: tab Autocomplete assente; Models tab senza row autocomplete; Experimental tab mostra speech/image con modelli locali.
   - `curl -s localhost:<porta>/kilo/profile` → 404; `/telemetry/capture` → 404.
   - Nessun traffico verso `api.kilo.ai`/`us.i.posthog.com` (verificabile con `NO_PROXY`/log, o ispezionando che il processo figlio non ha quelle connessioni — es. `ss -tnp` durante una sessione).
4. Suite: `bun test` in `packages/kilo-vscode/` e `bun test ./test/` in `packages/opencode/` verdi.

**Output atteso**: report di validazione con esiti; eventuale lista di fix residui.

**Istruzioni per il subagente**: esegui la checklist; non rilanciare build pesanti inutilmente (usa `--no-build` se dist è fresco); riporta esattamente cosa è stato verificato e cosa no.

---

## Criteri di completamento

- Tutti gli step 1–14 completati in ordine, ciascuno con compilazione verde.
- `grep` sentinelle a fine lavoro (deve restituire zero in `packages/kilo-vscode/src`, `packages/kilo-vscode/webview-ui`, `packages/opencode/src`):
  - `kilocode/kilo-gateway` (import), `KiloGateway`, `KILO_API_BASE`, `KILO_OPENROUTER_BASE`, `KILO_CHAT_URL`, `KILO_EVENT_SERVICE_URL`
  - `posthog`, `Telemetry.track`, `KILO_TELEMETRY_LEVEL`
  - `api.kilo.ai`, `kilosessions.ai`, `kiloapps.io`, `app.kilo.ai`
  - `client.kilo.`, `deviceAuth`, `kiloclaw`, `MarketplaceApiClient`, `KILO_PROVIDER_ID`
- L'estensione compila, passa lint/typecheck/unit test e lancia in ambiente isolato.
- Il CLI serve senza route `/kilo/*` e `/telemetry/*` (verificato su OpenAPI generata).
- Nessuna funzionalità extra introdotta; i provider locali OpenAI-compatibili (llama.cpp/vLLM/Ollama via config) funzionano per chat/agent.
- I servizi online rimanenti accettabili (documentati): webfetch/browser tool (feature agente), fetch models.dev disabilitato via `KILO_DISABLE_MODELS_FETCH=1`, probe `session/network.ts` (domini neutri), websearch Byok Exa/Parallel (opt-in con chiave utente), GitHub integration opzionale.