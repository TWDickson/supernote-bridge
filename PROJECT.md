# Supernote Bridge — Project Plan

The single live doc: goals, architecture, the server work this needs, and every
open item. Read before starting work; update when work lands.

> **Privacy:** this repo is public (BRAT installs from public GitHub releases).
> Never commit real notebook names, folder names, OCR text or fixtures cut from
> real notes. Test fixtures are synthetic.

## 1. Goal

Bring Supernote notebooks into the Obsidian vault as real, searchable,
linkable markdown — sourced from our self-hosted sync server
(`allenporter/supernote` fork, `local-ocr` branch, which already owns OCR).

**In scope (core):**

1. Pull OCR text + metadata (titles, keywords, links, dates) for every notebook.
2. Place each notebook in the right vault folder via configurable folder mapping.
3. Split a notebook into one note, one note per title (heading level
   configurable), or one note per page.
4. Turn Supernote links (page ↔ page, note ↔ note) into Obsidian wikilinks.
5. **Two-way text:** correct OCR in Obsidian and push it to the server; pull
   newer OCR from the server into notes, without silently losing either side.

**Extra (later):** page images beside the text (side-by-side view), embedding
`.note` renders, PDF/doc attachments.

**Out of scope:** writing ink back to the device; submitting to the community
plugin list (BRAT-only, like TTasks).

## 2. Ground truth about the server (2026-10-29)

What already exists, so the plugin doesn't reinvent it:

| Need | Server today |
| --- | --- |
| Per-page OCR text | `POST /api/extended/transcript {fileId, startIndex?, endIndex?}` → `pages[{pageIndex, pageId, text, date}]` |
| Titles / sections | `POST /api/extended/note/sections {fileId}` → `sections[{startPage, endPage, level, rect}]` (no title *text* yet) |
| File tree | `POST /api/file/list/query`, `/api/file/folder/list/query` (web API) |
| Processing state | `POST /api/extended/file/processing/status {fileIds}` |
| Page images | `GET /api/oss/png/{file_id}/{page_no}`, `GET /api/oss/pdf/{file_id}` |
| Semantic search | `POST /api/extended/search` |
| Auth | `x-access-token` header, obtained via the device-style login challenge |
| Storage of OCR | `NotePageContentDO.text_content` per `(file_id, page_id)` with `content_hash`; **not** written back into the `.note` |

Reachable at `https://sn.twdickson.com` (Traefik → `127.0.0.1:18075`), so it
works from phones off-LAN.

### Gaps — server work required (fork, `local-ocr`)

These are prerequisites, tracked as **SV-*** items. Each lands as a server
branch, goes through `supernote-dev-preflight`, and deploys with
`supernote-upstream-sync`. Upstreamable pieces go via
`supernote-upstream-contribute` later.

- **SV-1 — Plugin auth token** *(decided 2026-10-29: build it before P1; no
  password stopgap)*. A long-lived, revocable token minted from the server
  web UI's Settings tab (like an app password), accepted as
  `Authorization: Bearer`, stored hashed. Keeps the account password out of
  Obsidian and skips the device login dance.
- **SV-1b — OAuth sign-in** *(decided 2026-10-30)*. The plugin signs in the
  way the MCP connector does: dynamic registration per device, PKCE, consent
  in the web UI, an `obsidian://supernote-bridge-auth?vault=…` redirect, and
  rotating refresh tokens. A new `notebooks:sync` scope for an `<base>/api`
  resource is kept strictly apart from MCP tokens. Each device is its own
  grant under Connected apps. App tokens (SV-1) stay as the manual fallback.
  Spec: [`docs/server-auth-spec.md`](docs/server-auth-spec.md).
- **SV-2 — Change feed.** `POST /api/extended/sync/changes {cursor}` →
  notebooks changed since `cursor` (file id, path, md5, update time, page
  list with `pageId` + per-page text revision), plus deletions/moves, plus the
  next cursor. Without it every sync re-reads every transcript.
- **SV-3 — Structure endpoint** (spec handed over 2026-10-31:
  [`docs/server-structure-spec.md`](docs/server-structure-spec.md)). Key
  finding: `TITLELEVEL` is 1 on all 3,701 stored titles; the four looks are
  `TITLESTYLE` codes `1000254` / `1157254` / `1201000` / `1000000`. Title text
  comes from OCR of the stored title bitmap.
- *(original note)* **SV-3 — Structure endpoint.** Extend `note/sections` (or add
  `note/structure`) with the **raw titles** — page, top, style
  (`TITLELEVEL`), and title **text** (OCR of the title rect). The plugin
  computes its own ranges (`src/sync/split.ts`): the server's `sections`
  ranges assume styles nest (`next_level <= level`), which isn't how people
  use them. Also keywords
  (text + page), and links: `LINKTYPE` 0 page / 1 file / 4 web, resolved to a
  target `fileId` + `pageId` where the target is on the server.
- **SV-4 — Correction model.** Today a reprocess overwrites `text_content`.
  Split it into `ocr_text` (machine, rewritten by OCR) and `user_text`
  (correction, never touched by OCR), plus a monotonic `text_revision`.
  Effective text = `user_text ?? ocr_text`. When OCR re-runs on a page that has
  a correction, keep the correction and flag `ocr_newer: true` so the plugin
  can offer "take new OCR".
- **SV-5 — Write endpoint.** `POST /api/extended/page/text {fileId, pageId,
  baseRevision, text}` with optimistic concurrency (409 + current state on a
  stale `baseRevision`). `text: null` clears the correction (revert to OCR).
  Corrections re-embed for search, and are a natural feed for the existing
  vocabulary harvester (a corrected word is a strong vocabulary signal).

Open question for later (not blocking): should corrections also be injected
into the `.note` RECOGNTEXT so the device shows them? Touches ink files the
device owns — high risk, park it.

## 3. Plugin architecture

```
src/
  main.ts            Plugin lifecycle, commands, ribbon, status bar — thin
  settings/          Settings model, defaults, normalisation, settings tab
  api/               SupernoteClient: requestUrl wrapper, typed DTOs, errors
  sync/              PURE — no `obsidian` import (enforced by a test)
    paths.ts         Supernote path → vault path via folder mapping rules
    split.ts         Notebook + pages + sections → planned vault notes
    render.ts        Planned note → markdown (frontmatter + managed blocks)
    parse.ts         Markdown → managed blocks (to detect local edits)
    reconcile.ts     3-way merge per page: base / local / remote → action
    links.ts         Supernote links → wikilinks given the plan
  vault/             The only place that writes the vault (Vault.process,
                     FileManager.processFrontMatter, createFolder)
  state/             Sync state (cursor, per-page base hashes) in plugin data
```

**Rules carried over from TTasks:**

- Pure modules (`src/sync/`, `src/api/types`) never import `obsidian`; a
  boundary test fails the build if they do. This is what makes the merge
  logic testable in vitest with synthetic notebooks.
- All network through Obsidian's `requestUrl` (CORS-free, works on mobile) —
  never `fetch`.
- Background note edits via `Vault.process()`; frontmatter via
  `FileManager.processFrontMatter()`; every constructed path through
  `normalizePath()`.
- Frontmatter keys prefixed `sn_` and named in one table
  (`src/sync/schema.ts`), never as literals elsewhere.
- No default hotkeys; sentence-case UI; headings via `setHeading()`.
- Settings tab is declarative (`getSettingDefinitions()`, ≥ 1.13.0 — `display()`
  is deprecated) so settings show up in Obsidian's settings search.
- Token lives in Obsidian **SecretStorage** (`app.secretStorage`; the setting
  stores only the secret's *name*), never in `data.json` — `data.json` syncs between devices via Obsidian Sync.
  Each device enters the token once.

### 3.1 Note format

One notebook may become several vault notes (per split mode). Each generated
note:

```markdown
---
sn_file_id: 1234567890
sn_source: Note/Work/Project X.note
sn_pages: [P20261029abc, P20261029abd]
sn_synced: 2026-10-29T14:03:00Z
sn_keywords: [budget, q4]
tags: [supernote]
---
# Project X — Kickoff        ← from title text (per-title split)

%% sn:page id=P20261029abc rev=3 %%
…OCR / corrected text for this page…
%% sn:end %%

%% sn:page id=P20261029abd rev=1 %%
…
%% sn:end %%

## My notes                 ← anything outside sn: blocks is yours; never touched
```

- **Managed blocks** are delimited by `%% … %%` comments — invisible in
  reading view, survive every editor, and carry the page id + revision.
- Edits *inside* a block are OCR corrections (candidates for push).
- Text *outside* blocks is personal annotation and is never overwritten.
- Anchors: each page block gets a `^sn-<pageId>` block id so links can
  target a page (`[[Project X#^sn-P2026…]]`).
- Notebook index note (MOC) when split into more than one note: lists parts
  in order with dates. Always generated for split modes; optional otherwise.

### 3.1a Folders

Only the device's `Note` folder syncs by default; other device folders
(`Document`, …) are opt-in in settings. Unmatched notebooks mirror under the
vault folder (default `Supernote/`) **without** the `Note/` level —
`Note/Work/Plan.note` → `Supernote/Work/`; another synced device folder keeps
its name (`Supernote/Document/…`). Folder rules override per subtree, longest
prefix wins (`src/sync/paths.ts`).

### 3.2 Split modes (setting, per-folder override later)

| Mode | Result |
| --- | --- |
| `notebook` | one note per notebook, title headings become `#`/`##` inside |
| `title` **(default)** | a new note at every title whose style is in the chosen set (default: style 1); titles in other styles become headings inside; pages before the first split title go to the index note |
| `page` | one note per page |

Title styles are a **set, not a depth** (decided 2026-10-29). *Correction
2026-10-31:* the look is `TITLESTYLE` (four codes), not `TITLELEVEL`, which is
always 1. Settings show a swatch per style; labels still to be confirmed
against the device. The device's `TITLELEVEL` 1–4 was assumed to be which of the four title looks was picked, and people pick
by look rather than as a hierarchy. Settings show one toggle per style.
*To verify on a synthetic test notebook:* which device look is which
`TITLELEVEL`, so the toggles can be labelled by appearance instead of number.

Note names come from title text when available, else `<Notebook> — p<N>`;
the stable identity is `sn_file_id` + `sn_pages`, **never the filename**, so
renaming or moving a generated note in Obsidian is safe.

### 3.3 Two-way text — reconcile per page

The plugin stores, per page, the hash of the text it last wrote (`base`).
On each sync, for each page:

| local vs base | remote vs base | Action |
| --- | --- | --- |
| same | same | nothing |
| same | changed | pull remote into the block |
| changed | same | push (if auto-push on) or queue as a pending correction |
| changed | changed | **conflict** → keep local, record conflict, show in the review view; never auto-resolve |

Settings: `pull: auto | manual`, `push: manual (default) | auto | off`
(decided 2026-10-29). A server `409` on push is treated as a conflict, not
an error. Every overwrite of a local block first copies the replaced text
into the sync log, so nothing is ever lost.

**What gets sent is not the block as-is.** A local change is not necessarily
an OCR correction: the user may expand on the page, and the plugin itself
(and other plugins) put Obsidian markup in the block. Before diffing against
the server, the block goes through a push normaliser (pure,
`src/sync/pushText.ts`) that removes what the plugin generated — `^sn-` block
ids, wikilinks rendered from Supernote links (back to their source text),
title headings — and the push compares *that* to the server's text. The
review list then shows, per page, exactly the text that would be sent, with
actions: **send**, **edit before sending**, **keep local only** (marks the
page so later edits aren't offered again until the server text changes).
Heuristic flag: a change that mostly *adds* text rather than substituting
words is labelled "looks like an expansion" and defaults to keep local.

### 3.4 Links

- Page link (type 0) → `[[<note containing target page>#^sn-<pageId>]]`
- File link (type 1) to a synced notebook → same, resolved through the plan
  of the *target* notebook; unsynced target → `sn://` text with a warning.
- Web link (type 4) → markdown link.
- Placed where the link sits on the page if the server gives a position,
  otherwise in a "Links" footer inside the page block.

### 3.5 Images / side-by-side (extra)

Option A (preferred): `supernote-page` code block processor renders the PNG
live from `/api/oss/png` with a local cache — no vault bloat, no Sync traffic.
Option B: download PNGs as attachments (works offline, costs storage and
Obsidian Sync quota). Side-by-side via a two-column CSS layout in a
reading-view post-processor.

## 4. Phases

Item IDs are stable; check them off here, journal in `HISTORY.md` once it
exists.

### P0 — Setup ✅ (this commit)
- [x] Repo, toolchain (TS 6, esbuild, ESLint 9 + `eslint-plugin-obsidianmd`,
      vitest), CI + release workflows (bare-semver tags for BRAT)
- [x] Plugin skeleton: settings tab with SecretStorage token, "Test
      connection" against `/api/health`
- [x] Pure `paths.ts` with tests + boundary test

### P1 — Read-only pull (MVP, works against today's server)
- [x] **PL-1** sign-in: OAuth (SV-1b) through `registerObsidianProtocolHandler`,
      tokens in SecretStorage, refresh + rotation; "paste an app token" fallback
- [x] **PL-1a** "This device syncs with the server" switch, stored per device
      (`loadLocalStorage`, not the synced `data.json`). Only that device pulls
      and pushes; other devices get the notes and edits through Obsidian Sync,
      so they need no token. Prevents two devices writing the same notes.
- [x] **PL-2** list notebooks under configured Supernote roots
- [x] **PL-3** folder mapping rules (model + mirroring; no rules editor UI yet) (Supernote prefix → vault folder) + default
- [x] **PL-4** `notebook` split mode, transcript → managed blocks, frontmatter
- [x] **PL-5** idempotent re-sync (rewrite only changed blocks; preserve outside text)
- [x] **PL-6a** (0.1.1) folder selection is **per device** (`DeviceStore`),
      chosen in a picker over the server's real folder tree; include/exclude
      marks, nearest wins (`src/sync/selection.ts`). Turning a folder off never
      deletes notes.
- [x] **PL-6b** (0.1.1) every sync re-reads every notebook's text. md5 can't
      gate it: a Claude re-read changes page text without touching the file
      (found in 0.1.0). Fine at ~30 notebooks; SV-2 makes it incremental.
- [~] **PL-6** commands: *Sync now* ✅, sign in/out ✅, ribbon + status bar ✅;
      *Sync this note* / *Open on server* not yet
- [ ] **PL-7** sync log note / modal with last run results

### P2 — Structure (needs SV-3)
- [ ] **PL-8** `title` and `page` split modes + index note
- [ ] **PL-9** keywords → `sn_keywords` / tags
- [ ] **PL-10** links → wikilinks with page block ids

### P3 — Incremental (needs SV-1, SV-2)
- [ ] **PL-11** cursor-based sync; interval sync + sync on startup (setting)
- [ ] **PL-12** move/rename/delete handling (deleted on server → mark, never delete
      the vault note)

### P4 — Two-way text (needs SV-4, SV-5)
- [ ] **PL-13** per-page base hashes, local-edit detection
- [ ] **PL-14** push corrections (manual review list first, then auto)
- [ ] **PL-15** conflict view; "take new OCR" when server flags `ocr_newer`

### P5 — Extras
- [ ] **PL-16** `supernote-page` image code block + cache
- [ ] **PL-17** side-by-side reading layout
- [ ] **PL-18** per-folder split-mode overrides

### Server track (parallel, in the fork)
- [~] **SV-1** plugin token — built + preflight READY on server branch
      `feat/plugin-tokens` (`97e1b00`), **not deployed yet**. `snb_…` tokens
      minted under Settings → App tokens, `Authorization: Bearer`, limited to
      `/api/extended/`, `/api/file/`, `/api/oss/` (token/OAuth management → 403) ·
      [ ] **SV-1b** OAuth sign-in (spec handed to the server agent 2026-10-30) ·
      [ ] **SV-2** change feed · [ ] **SV-3** structure
- [ ] **SV-4** correction model · [ ] **SV-5** write endpoint

Suggested order: SV-1 + SV-1b → P1 → SV-3 → P2 → SV-2 → P3 → SV-4/SV-5 → P4 → P5.
P1 is useful on its own and proves the note format before anything writes back.

## 5. Decisions (2026-10-29)

1. **Name:** stays "Supernote Bridge"; repo `TWDickson/supernote-bridge`
   matches the plugin id, so the BRAT link reads the same as the plugin.
2. **Split:** per title by default, split points = a chosen *set* of title
   styles (default style 1), not a depth (§3.2).
3. **Folders:** mirror under `Supernote/` without `Note/`; only `Note` syncs
   by default, other device folders opt-in (§3.1a).
4. **Auth:** server token (SV-1), no password stopgap.
5. **Push:** manual review by default; the normaliser + review list keep
   expansions and Obsidian markup off the server (§3.3).
6. **Mobile:** stays mobile-capable (`isDesktopOnly: false`).

## 6. Open questions

- Which device title look maps to which `TITLELEVEL` (verify with a synthetic
  notebook, then label the toggles by look).
