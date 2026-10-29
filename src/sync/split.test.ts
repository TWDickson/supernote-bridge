import { describe, expect, it } from "vitest";
import { splitAtTitles, type NoteTitle } from "./split";

const title = (page: number, style: number, top = 100): NoteTitle => ({ page, top, style, text: `p${page}s${style}` });

describe("splitAtTitles", () => {
	it("returns one untitled range when there are no split titles", () => {
		expect(splitAtTitles([title(2, 2)], [1], 4)).toEqual([{ title: null, startPage: 0, endPage: 3 }]);
	});

	it("puts pages before the first split title in an untitled range", () => {
		const ranges = splitAtTitles([title(1, 1), title(3, 1)], [1], 5);
		expect(ranges.map((r) => [r.title?.page ?? null, r.startPage, r.endPage])).toEqual([
			[null, 0, 0],
			[1, 1, 2],
			[3, 3, 4],
		]);
	});

	it("ignores titles of styles that aren't split points", () => {
		const ranges = splitAtTitles([title(0, 1), title(1, 3), title(2, 1)], [1], 4);
		expect(ranges.map((r) => [r.startPage, r.endPage])).toEqual([
			[0, 1],
			[2, 3],
		]);
	});

	it("treats every selected style as a split point regardless of number", () => {
		const ranges = splitAtTitles([title(0, 3), title(2, 1)], [1, 3], 3);
		expect(ranges.map((r) => [r.title?.style, r.startPage, r.endPage])).toEqual([
			[3, 0, 1],
			[1, 2, 2],
		]);
	});

	it("gives a shared page to the later title", () => {
		const ranges = splitAtTitles([title(1, 1, 50), title(1, 1, 900)], [1], 3);
		expect(ranges.map((r) => [r.title?.top ?? null, r.startPage, r.endPage])).toEqual([
			[null, 0, 0],
			[900, 1, 2],
		]);
	});
});
