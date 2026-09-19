---
name: upstream-sync
description: Use when syncing `origin/main` (github.com/Kilo-Org/kilocode) into the offline VS Code extension fork branch `leocode`. Covers pre-conditions, exact commands, conflict-resolution matrix, invariants I1–I10 verification, rollback, and final smoke/test gates.
---

# Upstream Sync (`origin/main` → `leocode`)

Use this skill whenever you merge upstream Kilo Code into the offline fork, resolve its conflicts, or verify that the fork is still fully offline afterward. The full procedure lives in `docs/upstream-sync.md`; the structural constraints (pruned packages, explicit workspace list, residual-online matrix) live in `PRUNE-NOTES.md`. This skill is the operational checklist that ties them together.

## When to use

- Before running any `git merge main` on `leocode`.
- While resolving merge conflicts from an upstream sync.
- After a sync, to re-verify the offline invariants and run the final gates.

## Inputs / outputs

| | |
|---|---|
| Input | Repo on `leocode` with a clean tree; system bun (`~/.bun/bin/bun`, otherwise `source ~/.bashrc` first); network access for `git fetch`/`bun install` only |
| Output | Merged + reconciled `leocode` with all offline invariants intact; report per step (conflict count, decisions, invariant evidence, test/smoke results); local backup tag `pre-sync-*` |

## Operational checklist (10 points)

1. **Pre-condizioni**: `git branch --show-current` == `leocode`; `git remote -v` mostra solo `origin`; albero pulito; system bun disponibile.
2. **Fetch + aggiornamento di main**: `git fetch origin && git switch main && git pull --ff-only origin main && git switch leocode`. Verifica che `git rev-parse main` == `git rev-parse origin/main`.
3. **Tag di backup**: `git tag -f pre-sync-$(date +%Y%m%d)` sul HEAD di `leocode`. Il tag è il punto di roll-back e resta locale (mai spinto).
4. **Dry-run esatto**: `git merge-tree --write-tree --name-only $(git rev-parse main) leocode > /tmp/conflicts.txt` (fuori sandbox se necessario; riga 1 = OID tree, resto = path in conflitto). Confrontare l'elenco con la matrice delle categorie in `docs/upstream-sync.md` e annotare sorprese (rinominati, add/add sotto dir pruned).
5. **Merge**: `git merge main`. Risolvere ogni conflitto secondo la matrice take-ours/take-theirs; dove tace, la porzione marcata `kilocode_change` vince; in assenza di marker preferire la versione che mantiene l'applicazione offline.
6. **Riconciliazione dipendenze**: `bun install` da root (non frozen: rigenera `bun.lock` contro la workspace list esplicita a 22 voci); verificare che `patchedDependencies` continui ad applicarsi e che `packages/kilo-gateway`/`kilo-telemetry` non siano riacquistate.
7. **Rigenerazione**: `bun run script/generate.ts` da root se la superficie server è cambiata (rigenera SDK + OpenAPI e preferisce lo snapshot committo `models-dev.local.json`).
8. **Check + invarianti**: `bun turbo typecheck`, `bun run lint`, `bun run script/check-workflows.ts` da root; poi verificare una per una le invarianti I1–I10 con i comandi grep della matrice in `docs/upstream-sync.md`; infine verificare il floor VS Code 1.103: `grep -n '"vscode"' packages/kilo-vscode/package.json` deve mostrare `"vscode": "^1.103.0"` (e `@types/vscode` allineata) — mai alzato oltre 1.103 dal merge.
9. **Test + packaging**: da `packages/kilo-vscode/`: `bun run test:unit` (MAI `bun test` da root), poi `bun run compile` quando il sync tocca SDK/bundle.
10. **Smoke offline**: dal `packages/opencode/` eseguire `bun dev serve` e con `curl`: `GET /provider` deve mostrare SOLO provider locali/configurati — nessun `kilo`, nessun gateway; suite unit verde. Solo a questo punto il sync è completo (criteri in `docs/upstream-sync.md`).

## Cross-references

- `docs/upstream-sync.md`: comandi esatti, matrice take-ours/take-theirs, verifiche post-merge I1–I10, casi limite, rollback, definizione di sync completo.
- `PRUNE-NOTES.md`: cosa è stato rimosso e perché, vincoli strutturali (workspace list esplicita, patchedDependencies, zdiff3), matrice dei residui online gated, comandi validi dopo il prune.

## `kilocode_change` markers during conflict resolution

Every Kilo-specific change in shared opencode files must carry a `kilocode_change` marker so future syncs resolve mechanically (marked portions win):

- Single line: `const value = 42 // kilocode_change`
- Multi-line block: wrap with `// kilocode_change start` / `// kilocode_change end`
- New file in a shared path: `// kilocode_change - new file` at the top
- JSX/TSX: `{/* kilocode_change */}` (and `{/* kilocode_change start */}` / `end`)

Markers are NOT needed in paths that contain `kilocode` in the name (e.g. `packages/opencode/src/kilocode/`, `packages/opencode/test/kilocode/`) or in entirely-Kilo packages like `packages/kilo-vscode/` and `packages/kilo-ui/` — these cannot conflict with upstream. Prefer extracting Kilo logic into mirror files under `src/kilocode/<same/path>.ts` over inlining it into shared upstream files.

## Final verification

- Smoke: `bun dev serve` from `packages/opencode/` + `curl GET /provider` showing only local providers (no `kilo`, no gateway namespace).
- Unit suite green: `bun run test:unit` from `packages/kilo-vscode/`.
- Root guards green: `bun turbo typecheck`, `bun run lint`, `bun run script/check-workflows.ts`, `bun run script/check-md-table-padding.ts`, plus the duplication guard once carried over from the merge (`bun run script/check-kilocode-duplication.ts`).