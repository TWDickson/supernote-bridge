/** A title as drawn on the device. `style` is the device's title style
 *  (TITLELEVEL 1–4); users pick styles by look, so it is not a reliable
 *  nesting depth. */
export interface NoteTitle {
	page: number;
	/** Top edge on the page, to order several titles on one page. */
	top: number;
	style: number;
	text: string | null;
}

/** A run of pages that becomes one vault note. `title` is null for the pages
 *  before the first split title, which go to the notebook's index note. */
export interface PageRange {
	title: NoteTitle | null;
	startPage: number;
	endPage: number;
}

/**
 * Cut a notebook into page ranges at every title whose style is in
 * `splitStyles`. Titles of other styles don't split; they stay inside the
 * range as headings. A page belongs to the last split title that starts on or
 * before it, so two split titles on one page leave the earlier one empty
 * rather than sharing the page.
 */
export function splitAtTitles(titles: readonly NoteTitle[], splitStyles: readonly number[], totalPages: number): PageRange[] {
	if (totalPages <= 0) return [];
	const splits = titles
		.filter((title) => splitStyles.includes(title.style) && title.page >= 0 && title.page < totalPages)
		.sort((a, b) => a.page - b.page || a.top - b.top);

	const ranges: PageRange[] = [];
	const firstPage = splits[0]?.page ?? totalPages;
	if (firstPage > 0) ranges.push({ title: null, startPage: 0, endPage: firstPage - 1 });

	splits.forEach((title, i) => {
		const next = splits[i + 1];
		const endPage = next ? (next.page === title.page ? title.page - 1 : next.page - 1) : totalPages - 1;
		if (endPage >= title.page) ranges.push({ title, startPage: title.page, endPage });
	});
	return ranges;
}
