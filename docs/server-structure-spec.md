# Server spec — SV-3: notebook structure (titles, keywords, links)

**For:** the agent working on the Supernote sync server (`allenporter/supernote`
fork, production branch `local-ocr`, checkout
`~/.supernote-ocr/experiments/upstream-supernote`).
**From:** the Supernote Bridge plugin (`~/Projects/supernote-bridge`).
**Date:** 2026-10-31.

> This repo is public. Keep real notebook names, titles and OCR text out of
> anything you paste back. Fixtures and screenshots should use invented content.

## Why

The plugin can't split a notebook at its titles, or put headings in a note,
because the server doesn't give it the title *text*. The page OCR barely marks
titles: 27 of 883 pages have any `#` line, and the prompts don't ask for
headings. The device stores each title's handwriting as its own bitmap
(`TITLEBITMAP`, a tight crop of the ink), so the server can read it directly.

## What we found in the data (2026-10-31, 293 stored notebooks)

- Title metadata keys: `TITLEBITMAP`, `TITLELEVEL`, `TITLEPROTOCOL`,
  `TITLERECT`, `TITLERECTORI`, `TITLESEQNO`, `TITLESTYLE`.
- **`TITLELEVEL` is `"1"` on every one of 3,701 titles.** It doesn't
  distinguish anything. `/api/extended/note/sections` builds its ranges on
  `TITLELEVEL`, so in practice every title is level 1.
- **`TITLESTYLE` is what varies**, with four values: `1000254` (3,001),
  `1157254` (581), `1201000` (99) and `1000000` (20). These are the device's
  four title looks. They read as `1` + background grey + ink grey (0–255), but
  that's unconfirmed; please confirm or correct if you can, for example from
  the device firmware or upstream knowledge.
- The `TITLEBITMAP` content decodes with `RattaRleDecoder` at the
  `TITLERECT` width × height into a clean, cropped image of the title
  handwriting. The style box isn't part of the bitmap.

## Requirements

### S1 — Title text

- **OCR every title's bitmap** with the configured OCR engine, as a processor
  module next to page OCR.
- **Cache by content hash** of the bitmap, so unchanged titles are never
  re-read.
- **Store it** in a table keyed by `(file_id, page_id, title seqno or rect)`,
  with `user_id` in the primary key per the schema rules. Include the text, the
  engine/source, and an update time.
- **Keep it short.** A title is a line or two, so request a single short line:
  no markdown and no surrounding quotes.
- **Optional:** a Claude re-read of titles may reuse the existing refine
  machinery. Not required for this spec.

### S2 — Structure endpoint

`POST /api/extended/note/structure {fileId}` returns, in page order:

```json
{
  "success": true,
  "pageWidth": 1404, "pageHeight": 1872,
  "pages": [{"pageIndex": 0, "pageId": "P…"}],
  "titles": [{
    "pageIndex": 3, "pageId": "P…",
    "rect": [left, top, width, height],
    "style": "1000254",
    "text": "Kickoff notes",            // null until title OCR has run
    "updateTime": 1793379296356
  }],
  "keywords": [{"pageIndex": 2, "pageId": "P…", "rect": [...], "text": "budget"}],
  "links": [{
    "pageIndex": 1, "pageId": "P…", "rect": [...],
    "type": "page" | "file" | "web",
    "targetFileId": "770…",              // string: ids are 64-bit
    "targetPageId": "P…",                // when the link points at a page
    "url": "https://…"                   // web links only
  }]
}
```

- **IDs as strings.** File IDs exceed 2^53. Return every file ID as a
  **string**, as `UserFileVO` already does.
- **Titles:** sort by `(pageIndex, rect top)`. Include `style` as the raw
  `TITLESTYLE` string. Don't compute ranges; the plugin computes its own from
  the styles the user picks.
- **Keywords:** the text the device stores for each keyword; the vocabulary
  harvester already reads it.
- **Links:** `LINKTYPE` 0 = page, 1 = file, 4 = web. Resolve file and page
  targets to server IDs where the target is on this server. Otherwise return
  `targetFileId: null` plus whatever path the link stores.
- **Paths:** the same auth and path limits as the other `/api/extended/*`
  routes. It's reachable with the plugin's `notebooks:sync` tokens.

### S3 — Leave `note/sections` alone

The web UI uses it. Optionally add `style` to each section there too.

## Tests (minimum)

1. Title OCR runs once per distinct bitmap, and a second pass with the same
   bitmap is a cache hit.
2. The structure endpoint on a synthetic notebook (the existing test fixtures)
   returns titles sorted by page and top, with `style` and `text`; `text` is
   `null` before OCR and filled in after.
3. Links of each type resolve, or come back unresolved, as specified. File IDs
   are strings.
4. A `notebooks:sync` OAuth token can call it; an MCP token gets 401.

Gate with `supernote-dev-preflight`, then deploy with `supernote-upstream-sync`
after Taylor's go-ahead.

**Backfill:** running title OCR over existing notebooks should be a one-off
job, or happen lazily on the next processing pass. Say which you chose, and how
long the backfill of ~3,700 titles takes on the local engine.

## Report back

1. The deployed sha.
2. The final response shape, if it differs from S2.
3. Whether the `TITLESTYLE` reading is confirmed, and what each code looks like
   on the device.
4. The backfill approach and its status.
