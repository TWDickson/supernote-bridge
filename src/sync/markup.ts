/**
 * Obsidian markup a user adds to synced text: links, embeds, tags and block
 * ids. Adding these is not a correction to the handwriting, so edit detection
 * compares text with them stripped, and a server update puts them back.
 *
 * Formatting the OCR itself writes (such as `~~struck~~` items) is text, not
 * markup, and is left alone.
 */

interface Markup {
	/** The markup as written, e.g. `[[People/Sam|Sam]]`. */
	raw: string;
	/** What it shows in place of itself: a link's label; empty for tags, embeds and block ids. */
	label: string;
	start: number;
	end: number;
}

/* Embeds first, so `![[x]]` isn't read as a link; then wikilinks, Markdown
   links, tags (after a space or line start) and block ids (at line end).
   (No lookbehind: iOS before 16.4 can't run it, so a tag's leading space is
   matched and skipped.) */
const MARKUP =
	/!\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^)\n]*\)|\[\[(?<target>[^\]|\n]+)(?:\|(?<alias>[^\]\n]+))?\]\]|\[(?<label>[^\]\n]+)\]\([^)\n]+\)|(?<lead>^|[ \t])(?<tag>#[\p{L}_][\p{L}\p{N}_/-]*)|[ \t]\^[A-Za-z0-9-]+$/gmu;

function findMarkup(text: string): Markup[] {
	const found: Markup[] = [];
	for (const m of text.matchAll(MARKUP)) {
		const g = m.groups ?? {};
		const skip = g.lead?.length ?? 0;
		const raw = g.tag ?? m[0];
		let label = "";
		if (g.alias !== undefined) label = g.alias;
		else if (g.target !== undefined) label = g.target.replace(/#.*$/, "");
		else if (g.label !== undefined) label = g.label;
		found.push({ raw, label, start: m.index + skip, end: m.index + skip + raw.length });
	}
	return found;
}

/** Text as it reads with user markup removed: links become their label;
 *  tags, embeds and block ids go; runs of spaces left behind collapse. */
export function stripMarkup(text: string): string {
	let out = "";
	let cursor = 0;
	for (const item of findMarkup(text)) {
		out += text.slice(cursor, item.start) + item.label;
		cursor = item.end;
	}
	out += text.slice(cursor);
	return out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/gm, "");
}


function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Where `needle` appears as whole words in `text` outside existing markup,
 *  in order. */
function occurrences(text: string, needle: string): number[] {
	if (needle.trim() === "") return [];
	const taken = findMarkup(text);
	const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(needle)}(?![\\p{L}\\p{N}])`, "gu");
	return [...text.matchAll(pattern)]
		.map((m) => m.index + (m[1]?.length ?? 0))
		.filter((at) => !taken.some((item) => at < item.end && at + needle.length > item.start));
}

/** The few words just before `at` on its line, used to re-anchor markup that
 *  has no label of its own. */
function anchorBefore(text: string, at: number): string {
	const lineStart = text.lastIndexOf("\n", at - 1) + 1;
	const before = stripMarkup(text.slice(lineStart, at)).trimEnd();
	return before.split(/\s+/).slice(-3).join(" ");
}

/**
 * Put the user's markup from `oldText` back into `newText`, the server's
 * updated text for the same page. A link wraps the same words again (the
 * same occurrence when it can tell); a tag, embed or block id goes back after
 * the words it followed. Returns the markup that no longer has a place.
 */
export function reapplyMarkup(oldText: string, newText: string): { text: string; lost: string[] } {
	let text = newText;
	const lost: string[] = [];
	const oldPlain = (end: number) => stripMarkup(oldText.slice(0, end));

	for (const item of findMarkup(oldText)) {
		if (text.includes(item.raw)) continue;

		if (item.label !== "") {
			/* Which occurrence of the label this was, counted in the old text. */
			const nth = occurrences(oldPlain(item.start), item.label).length;
			const spots = occurrences(text, item.label);
			const at = spots[nth] ?? spots[0];
			if (at === undefined) {
				lost.push(item.raw);
				continue;
			}
			text = text.slice(0, at) + item.raw + text.slice(at + item.label.length);
			continue;
		}

		const anchor = anchorBefore(oldText, item.start);
		const spots = occurrences(text, anchor);
		const at = spots[occurrences(oldPlain(item.start), anchor).length - 1] ?? spots[0];
		if (anchor === "" || at === undefined) {
			lost.push(item.raw.trim());
			continue;
		}
		const isBlockId = /^[ \t]\^/.test(item.raw);
		const insertAt = isBlockId ? (text.indexOf("\n", at) === -1 ? text.length : text.indexOf("\n", at)) : at + anchor.length;
		const piece = isBlockId ? item.raw : ` ${item.raw.trim()}`;
		text = text.slice(0, insertAt) + piece + text.slice(insertAt);
	}
	return { text, lost };
}
