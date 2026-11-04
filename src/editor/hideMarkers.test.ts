import { describe, expect, it } from "vitest";
import { markerRanges } from "./hideMarkers";

const doc = ["# Notebook", "", "%% sn:page id=P1 hash=0a7ad9e3 %%", "text", "%% sn:end %%", "%% my own comment %%"].join("\n");
const lineAt = (n: number) => {
	const lines = doc.split("\n");
	const from = lines.slice(0, n).join("\n").length + (n > 0 ? 1 : 0);
	return { from, to: from + (lines[n] ?? "").length };
};

describe("markerRanges", () => {
	it("hides the sync's marker lines and nothing else", () => {
		expect(markerRanges(doc, [{ from: 0, to: 0 }])).toEqual([lineAt(2), lineAt(4)]);
	});

	it("shows a marker line the selection touches", () => {
		const caret = lineAt(4).from + 3;
		expect(markerRanges(doc, [{ from: caret, to: caret }])).toEqual([lineAt(2)]);
	});
});
