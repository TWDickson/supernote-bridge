import { describe, expect, it } from "vitest";
import {
	DEFAULT_SELECTION,
	describeSelection,
	isSelected,
	normalizeSelection,
	setFolder,
	shouldWalkInto,
	subtreeState,
	type FolderSelection,
} from "./selection";

const sel = (include: string[], exclude: string[] = []): FolderSelection => ({ include, exclude });

describe("isSelected", () => {
	it("follows the nearest marked folder", () => {
		const s = sel(["Note", "Note/Personal/Shared"], ["Note/Personal"]);
		expect(isSelected("Note/Work/Plan.note", s)).toBe(true);
		expect(isSelected("Note/Personal/Diary.note", s)).toBe(false);
		expect(isSelected("Note/Personal/Shared/Trip.note", s)).toBe(true);
		expect(isSelected("Document/A.pdf", s)).toBe(false);
	});

	it("matches whole segments", () => {
		expect(isSelected("Notebook/X.note", DEFAULT_SELECTION)).toBe(false);
	});
});

describe("shouldWalkInto", () => {
	it("walks selected folders and ancestors of selected ones", () => {
		const s = sel(["Note/Work"]);
		expect(shouldWalkInto("Note", s)).toBe(true);
		expect(shouldWalkInto("Note/Work/Sub", s)).toBe(true);
		expect(shouldWalkInto("Note/Home", s)).toBe(false);
	});
});

describe("setFolder", () => {
	it("excludes a subfolder of an included folder", () => {
		expect(setFolder(DEFAULT_SELECTION, "Note/Personal", false)).toEqual(sel(["Note"], ["Note/Personal"]));
	});

	it("drops marks below a folder when the folder is set", () => {
		const s = sel(["Note"], ["Note/Personal", "Note/Old"]);
		expect(setFolder(s, "Note", false)).toEqual(sel([], []));
		expect(setFolder(s, "Note/Personal", true)).toEqual(sel(["Note"], ["Note/Old"]));
	});

	it("adds no mark when the folder already inherits the state", () => {
		expect(setFolder(DEFAULT_SELECTION, "Note/Work", true)).toEqual(DEFAULT_SELECTION);
	});
});

describe("subtreeState", () => {
	it("reports mixed when something below differs", () => {
		const s = sel(["Note"], ["Note/Personal"]);
		expect(subtreeState("Note", s)).toBe("mixed");
		expect(subtreeState("Note/Work", s)).toBe("on");
		expect(subtreeState("Note/Personal", s)).toBe("off");
		expect(subtreeState("Document", sel(["Document/Books"]))).toBe("mixed");
	});
});

describe("normalizeSelection / describeSelection", () => {
	it("cleans stored data", () => {
		expect(normalizeSelection({ include: ["/Note/", 3, ""], exclude: "x" })).toEqual(sel(["Note"], []));
		expect(normalizeSelection(null)).toBeNull();
	});

	it("describes the selection", () => {
		expect(describeSelection(sel(["Note"], ["Note/Personal"]))).toBe("Syncing Note except Note/Personal.");
		expect(describeSelection(sel([]))).toBe("Nothing selected.");
	});
});
