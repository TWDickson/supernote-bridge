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
3. Enable **Supernote Bridge**, then in its settings set the server URL and
   the API token (stored in Obsidian's secret storage on each device).

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
