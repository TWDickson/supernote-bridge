# Supernote Bridge — Obsidian plugin

Syncs Supernote notebooks (OCR text, titles, keywords, links) from our
self-hosted sync server into the vault, and pushes OCR corrections back.

**This file is conventions and workflow.** The plan, open items and status
live in **`PROJECT.md`** — read it before starting work and update it when
work lands.

> **Public repo.** Never commit real notebook names, folder names, OCR text or
> fixtures derived from real notes. Fixtures are synthetic.

## Tech stack

- TypeScript (6.x — typescript-eslint doesn't support 7 yet), plain Obsidian
  API for UI (no framework until a view needs one)
- esbuild (`esbuild.config.mjs`), vitest, ESLint 9 flat config with
  `eslint-plugin-obsidianmd` (the official Obsidian lint rules — treat its
  warnings as the review-bot's)
- Node ≥ 22.12 (`.nvmrc` pins 24); CI runs 22 + 24
- `minAppVersion` 1.13.0: declarative settings (`getSettingDefinitions`) and
  `SecretStorage`

| Command | Does |
| --- | --- |
| `npm run dev` | Watch build to `main.js` (inline sourcemap) |
| `npm run build` | `tsc --noEmit` + production bundle |
| `npm run check` | lint + build + test — the CI gate |

## Server

The sync server is the `allenporter/supernote` fork, production branch
`local-ocr`, checkout at `~/.supernote-ocr/experiments/upstream-supernote`,
public at `https://sn.twdickson.com`. Server-side items are `SV-*` in
`PROJECT.md`; build them in a worktree of that repo, gate with the
`supernote-dev-preflight` skill, deploy with `supernote-upstream-sync`.
Never edit the production checkout directly.

## Architecture rules

- **Pure modules don't import `obsidian`.** `src/sync/` and `src/api/types/`
  must run in plain vitest; `src/integration/boundaries.test.ts` enforces it.
  Add new pure directories to its list in the same commit.
- **Network only through `requestUrl`**, via `SupernoteClient` — never `fetch`.
- **Vault writes only from `src/vault/`**: `Vault.process()` for bodies,
  `FileManager.processFrontMatter()` for frontmatter, `normalizePath()` on
  every constructed path. Raw frontmatter strings only at file creation.
- **Frontmatter keys are `sn_*`** and named once in `src/sync/schema.ts`.
- **Identity is `sn_file_id` + page ids, never the file path or name** — the
  user may rename or move generated notes.
- **Text outside `%% sn:page … %%` / `%% sn:end %%` blocks belongs to the
  user** and is never rewritten. Never overwrite a locally edited block
  without logging the replaced text first.
- **Secrets**: the token lives in `app.secretStorage`; settings store only the
  secret's id. `data.json` syncs between devices — nothing sensitive in it.
- Settings: mutate through `plugin.saveSettings()` (normalises in place).
- Obsidian guidelines: no default hotkeys, sentence-case UI text, no
  `innerHTML`, no inline styles (classes in `styles.css` using Obsidian CSS
  variables), `registerEvent`/`registerInterval` for cleanup, no console
  output except errors.

## Comments

Comments state the current *why*. History ("used to", "fixed", "moved") goes
in commit messages, not code.

## Git & releases

Solo dev, branch `main`. Commit verified slices (gate green), push to
`origin`. **Confirm with Taylor before cutting a release** — it's
outward-facing and lands on devices via BRAT.

```sh
npm version patch       # bumps package.json, manifest.json, versions.json; bare-semver tag
git push --follow-tags  # tag triggers .github/workflows/release.yml
```

Use a pre-release version (`npm version prerelease --preid beta`) for
anything that writes to the server; BRAT installs pre-releases only when
asked. Never hand-edit versions in `manifest.json` / `versions.json`.

Taylor can only test a cut release, never a branch. Sessions are headless —
separate "test-green" from "reasoned, unobserved in Obsidian" in reports.
