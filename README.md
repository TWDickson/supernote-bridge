# Supernote Bridge

An Obsidian plugin that syncs handwritten Supernote notebooks from a
self-hosted [Supernote sync server](https://github.com/allenporter/supernote)
into your vault as searchable markdown: OCR text per page, notebooks split
by title or page, Supernote links turned into wikilinks, and OCR corrections
made in Obsidian sent back to the server.

> **Status:** early development. See [`PROJECT.md`](PROJECT.md) for the plan.

## Install (BRAT)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the
   community plugins list.
2. BRAT → *Add beta plugin* → `TWDickson/supernote-bridge`.
3. Enable **Supernote Bridge**. In its settings, set the server URL and press
   **Sign in**: approve the device on the server and you're sent back to
   Obsidian. (Or paste an app token from the server under *Advanced*.)
4. Turn on **This device syncs with the server**. Signing in turns it on.
   Do this on **one** device only; the others get the notes through Obsidian
   Sync and don't need to sign in.
5. Run **Sync now** from the command palette or the ribbon.

### What a sync does (0.1)

- You choose which device folders sync **on each device** (settings →
  *Folders to sync on this device*). Turning a folder off never deletes notes
  already in the vault.
- Every synced notebook becomes one note under
  `Supernote/`, mirroring the device folders (`Note/Work/Plan.note` →
  `Supernote/Work/Plan.md`).
- Each page's OCR text sits between hidden `%% sn:page … %%` markers. Text
  outside the markers is yours and is never touched.
- Corrections you make inside a page are kept on later syncs, even if the
  server's text changes. Sending them back to the server comes later.
- Notes are matched by the `sn_file_id` property, so you can rename and move
  them.

Requires Obsidian 1.13.0 or later. Works on desktop and mobile.

## Development

```sh
npm ci
npm run dev     # watch build → main.js
npm run check   # lint + type-check + build + tests (the CI gate)
```

Releases: `npm version patch && git push --follow-tags` — the tag triggers
the release workflow, which BRAT picks up.

## License

GPL-3.0-or-later
