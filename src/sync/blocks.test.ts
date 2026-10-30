import { describe, expect, it } from "vitest";
import { hashText, mergeBlocks, parseBlocks, renderBlock, type ServerPage } from "./blocks";

const page = (pageId: string, text: string): ServerPage => ({ pageId, text });
const note = (...parts: string[]) => parts.join("\n\n") + "\n";

describe("hashText", () => {
	it("ignores line endings and surrounding blank lines", () => {
		expect(hashText("a\r\nb\n\n")).toBe(hashText("\na\nb"));
		expect(hashText("a b")).not.toBe(hashText("a  b"));
	});
});

describe("parseBlocks", () => {
	it("round-trips rendered blocks", () => {
		const content = note("# Title", renderBlock(page("P1", "one")), renderBlock(page("P2", "")));
		expect(parseBlocks(content).map((b) => [b.pageId, b.text])).toEqual([
			["P1", "one"],
			["P2", ""],
		]);
	});
});

describe("mergeBlocks", () => {
	it("writes every page into an empty note", () => {
		const { content, outcomes } = mergeBlocks("", [page("P1", "one"), page("P2", "two")]);
		expect(parseBlocks(content).map((b) => b.text)).toEqual(["one", "two"]);
		expect(outcomes.map((o) => o.kind)).toEqual(["added", "added"]);
	});

	it("keeps text outside blocks and updates unedited blocks", () => {
		const before = note("intro I wrote", renderBlock(page("P1", "old")), "my notes");
		const { content, outcomes } = mergeBlocks(before, [page("P1", "new")]);
		expect(content).toBe(note("intro I wrote", renderBlock(page("P1", "new")), "my notes"));
		expect(outcomes).toEqual([{ kind: "updated", pageId: "P1" }]);
	});

	it("is a no-op when nothing changed", () => {
		const before = note(renderBlock(page("P1", "same")));
		expect(mergeBlocks(before, [page("P1", "same")])).toEqual({
			content: before,
			outcomes: [{ kind: "unchanged", pageId: "P1" }],
		});
	});

	it("keeps a local edit when the server is unchanged", () => {
		const before = note(renderBlock(page("P1", "teh cat")).replace("teh cat", "the cat"));
		const { content, outcomes } = mergeBlocks(before, [page("P1", "teh cat")]);
		expect(content).toBe(before);
		expect(outcomes).toEqual([{ kind: "local-edit", pageId: "P1" }]);
	});

	it("keeps a local edit when the server changed too, as a conflict", () => {
		const before = note(renderBlock(page("P1", "teh cat")).replace("teh cat", "the cat"));
		const { content, outcomes } = mergeBlocks(before, [page("P1", "teh cat sat")]);
		expect(content).toBe(before);
		expect(outcomes).toEqual([{ kind: "conflict", pageId: "P1" }]);
	});

	it("inserts a new page after the page before it", () => {
		const before = note(renderBlock(page("P1", "one")), "between", renderBlock(page("P3", "three")));
		const { content } = mergeBlocks(before, [page("P1", "one"), page("P2", "two"), page("P3", "three")]);
		expect(content).toBe(
			note(renderBlock(page("P1", "one")), renderBlock(page("P2", "two")), "between", renderBlock(page("P3", "three"))),
		);
	});

	it("inserts a new first page before the existing blocks", () => {
		const before = note("# Title", renderBlock(page("P2", "two")));
		const { content } = mergeBlocks(before, [page("P1", "one"), page("P2", "two")]);
		expect(content).toBe(note("# Title", renderBlock(page("P1", "one")), renderBlock(page("P2", "two"))));
	});

	it("removes an unedited page the server no longer has, but keeps an edited one", () => {
		const edited = renderBlock(page("P2", "two")).replace("two", "two, fixed");
		const before = note(renderBlock(page("P1", "one")), edited, renderBlock(page("P3", "three")));
		const { content, outcomes } = mergeBlocks(before, [page("P3", "three")]);
		expect(content).toBe(note(edited, renderBlock(page("P3", "three"))));
		expect(outcomes.map((o) => o.kind).sort()).toEqual(["orphaned", "removed", "unchanged"]);
	});
});
