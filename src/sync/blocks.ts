import { reapplyMarkup, stripMarkup } from "./markup";

/** One page of a notebook as the server has it. */
export interface ServerPage {
	pageId: string;
	text: string;
}

/** A page block found in a note. `hash` is the hash of the server text the
 *  block was last written with, so a mismatch with `text` is a local edit. */
export interface NoteBlock {
	pageId: string;
	hash: string;
	text: string;
}

/** What happened to a page during a merge, for the sync report. */
export type PageOutcome =
	| { kind: "unchanged"; pageId: string }
	/** `lostMarkup`: links, tags or block ids the user added that no longer fit the new text. */
	| { kind: "updated"; pageId: string; lostMarkup?: string[] }
	| { kind: "added"; pageId: string }
	| { kind: "removed"; pageId: string }
	/** Edited in Obsidian, server unchanged: a correction waiting to be sent. */
	| { kind: "local-edit"; pageId: string }
	/** Edited in Obsidian and changed on the server: the local text is kept. */
	| { kind: "conflict"; pageId: string }
	/** Gone from the server but edited locally: kept rather than deleted. */
	| { kind: "orphaned"; pageId: string };

const BLOCK_PATTERN = /^%% sn:page id=(\S+) hash=([0-9a-f]+) %%\n([\s\S]*?)\n?%% sn:end %%$/gm;

/** Line endings and surrounding blank lines don't count as an edit. */
export function normalizeText(text: string): string {
	return text.replace(/\r\n?/g, "\n").replace(/^\n+|\s+$/g, "");
}

function fnv1a(normalized: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < normalized.length; i++) {
		hash ^= normalized.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

/** FNV-1a, 32-bit, of the text as written. Detects edits; it is not a security
 *  boundary. Blocks written before link-aware comparison carry this hash. */
export function hashText(text: string): string {
	return fnv1a(normalizeText(text));
}

/** Hash of the text with user markup stripped, so adding a link or tag
 *  doesn't change it. Blocks are written with this hash. */
export function hashPlain(text: string): string {
	return fnv1a(normalizeText(stripMarkup(normalizeText(text))));
}

/** Whether `text` reads the same as the text a block's `hash` was taken from. */
function matchesHash(text: string, hash: string): boolean {
	return hashPlain(text) === hash || hashText(text) === hash;
}

export function renderBlock(page: ServerPage, text = page.text): string {
	return `%% sn:page id=${page.pageId} hash=${hashPlain(page.text)} %%\n${normalizeText(text)}\n%% sn:end %%`;
}

/** Every page block in a note, in order, with where it sits. */
export function parseBlocks(content: string): Array<NoteBlock & { start: number; end: number }> {
	const blocks: Array<NoteBlock & { start: number; end: number }> = [];
	for (const match of content.matchAll(BLOCK_PATTERN)) {
		const [whole, pageId, hash, text] = match;
		if (pageId === undefined || hash === undefined) continue;
		blocks.push({ pageId, hash, text: text ?? "", start: match.index, end: match.index + whole.length });
	}
	return blocks;
}

/** Whether the words of a block were changed in Obsidian. Added links, tags
 *  and block ids don't count. */
export function isLocallyEdited(block: NoteBlock): boolean {
	return !matchesHash(block.text, block.hash);
}

/**
 * Bring a note's page blocks in line with the server, without losing anything
 * typed in Obsidian.
 *
 * Text outside blocks is never touched. A block nobody edited follows the
 * server. A block edited in Obsidian is kept as it is, whether or not the
 * server changed too. New server pages are inserted after the block of the
 * page before them, so they keep notebook order.
 */
export function mergeBlocks(
	content: string,
	pages: readonly ServerPage[],
	/** Pages whose Obsidian edits are dropped in favour of the server's text
	 *  ("take server text"). Links and tags added to them are kept. */
	takeServer: ReadonlySet<string> = new Set(),
): { content: string; outcomes: PageOutcome[] } {
	const existing = parseBlocks(content);
	const byId = new Map(existing.map((block) => [block.pageId, block]));
	const serverIds = new Set(pages.map((page) => page.pageId));
	const outcomes: PageOutcome[] = [];

	/* Replacement text for each existing block, keyed by its start offset. */
	const replacements = new Map<number, string>();
	/* New blocks, placed after the block of the server page before them; before
	   the first block when no earlier page is in the note; or at the end. */
	const insertAfter = new Map<number, string[]>();
	const insertBeforeFirst: string[] = [];
	const appended: string[] = [];
	const push = (map: Map<number, string[]>, key: number, text: string) => map.set(key, [...(map.get(key) ?? []), text]);

	let anchor: number | null = null;
	for (const page of pages) {
		const block = byId.get(page.pageId);
		if (!block) {
			const rendered = renderBlock(page);
			if (anchor !== null) push(insertAfter, anchor, rendered);
			else if (existing.length > 0) insertBeforeFirst.push(rendered);
			else appended.push(rendered);
			outcomes.push({ kind: "added", pageId: page.pageId });
			continue;
		}
		anchor = block.end;
		const serverUnchanged = matchesHash(page.text, block.hash);
		if (isLocallyEdited(block) && !takeServer.has(page.pageId)) {
			outcomes.push({ kind: serverUnchanged ? "local-edit" : "conflict", pageId: page.pageId });
		} else if (serverUnchanged && !isLocallyEdited(block)) {
			outcomes.push({ kind: "unchanged", pageId: page.pageId });
		} else {
			const { text, lost } = reapplyMarkup(block.text, normalizeText(page.text));
			replacements.set(block.start, renderBlock(page, text));
			outcomes.push(lost.length ? { kind: "updated", pageId: page.pageId, lostMarkup: lost } : { kind: "updated", pageId: page.pageId });
		}
	}

	for (const block of existing) {
		if (serverIds.has(block.pageId)) continue;
		if (isLocallyEdited(block)) {
			outcomes.push({ kind: "orphaned", pageId: block.pageId });
		} else {
			replacements.set(block.start, "");
			outcomes.push({ kind: "removed", pageId: block.pageId });
		}
	}

	let result = "";
	let cursor = 0;
	existing.forEach((block, i) => {
		result += content.slice(cursor, block.start);
		if (i === 0) result += insertBeforeFirst.map((text) => `${text}\n\n`).join("");
		const replacement = replacements.get(block.start);
		result += replacement ?? content.slice(block.start, block.end);
		result += (insertAfter.get(block.end) ?? []).map((text) => `\n\n${text}`).join("");
		cursor = block.end;
		if (replacement === "") {
			/* Drop the blank line that separated the removed block from the next. */
			const rest = content.slice(cursor);
			const gap = /^\n{1,2}/.exec(rest);
			if (gap) cursor += gap[0].length;
		}
	});
	result += content.slice(cursor);
	if (appended.length > 0) {
		result = `${result.replace(/\s+$/, "")}${result.trim() ? "\n\n" : ""}${appended.join("\n\n")}\n`;
	}
	return { content: result, outcomes };
}
