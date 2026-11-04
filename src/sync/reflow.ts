/**
 * Rejoin prose that was split only because the handwriting reached the edge
 * of the page.
 *
 * The server keeps each handwritten line as its own line, which suits the
 * device and search but reads as ragged text in Obsidian. A line is joined to
 * the one after it only when both read as running prose; anything that looks
 * like structure (bullets, task marks, hour slots, indented items, headings)
 * keeps its own line, and blank lines still separate paragraphs.
 */

/* Bullet-journal marks, list markers, headings, quotes, tables, and lines
   that open with a number such as a planner's hour slot. */
const STRUCTURE = /^(?:[•◦▪‣·*+-]\s|[Xx>o<]\s|\d+[.)]?(?:\s|$)|\d{1,2}:\d{2}\b|#{1,6}\s|>|\||\[[ xX]\]|~~)/;
/* Wrapped prose shows itself at the seam: the next line carries on in
   lower case, or this line stopped on a word that can't end a sentence.
   List items and planner entries start with a capital, so they stay apart. */
const MIN_WORDS = 4;
const OPEN_ENDING =
	/\b(?:a|an|the|and|or|but|so|to|of|for|with|in|on|at|by|from|as|that|which|my|our|your|his|her|their|its|is|was|are|were|be|been|have|has|had|I|I'm|I've|we|it|not|just|about|into|than|then|because|if|when|while)$/i;

function words(line: string): number {
	return line.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
}

function isProse(line: string): boolean {
	return !/^\s/.test(line) && !STRUCTURE.test(line);
}

/** True when `line` was cut short by the page edge and `next` carries on from it. */
function continues(line: string, next: string): boolean {
	if (!isProse(line) || !isProse(next) || words(line) < MIN_WORDS) return false;
	const end = line.trim();
	/* A colon or semicolon introduces what follows on its own line. */
	if (/[:;]$/.test(end)) return false;
	if (/[.!?)\]]$/.test(end) && !/^\p{Ll}/u.test(next.trim())) return false;
	return /^\p{Ll}/u.test(next.trim()) || OPEN_ENDING.test(end);
}

export function reflowText(text: string): string {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const out: string[] = [];
	lines.forEach((line, i) => {
		/* Judged on the source lines, so a paragraph keeps joining for as long
		   as each of its lines ran to the page edge. */
		const before = lines[i - 1];
		if (before !== undefined && out.length > 0 && line.trim() !== "" && before.trim() !== "" && continues(before, line)) {
			out[out.length - 1] = `${(out[out.length - 1] ?? "").replace(/\s+$/, "")} ${line.trim()}`;
		} else {
			out.push(line);
		}
	});
	return out.join("\n");
}
