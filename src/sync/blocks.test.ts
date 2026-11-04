import { describe, expect, it } from "vitest";
import { hashText, isLocallyEdited, mergeBlocks, parseBlocks, renderBlock, type ServerPage } from "./blocks";

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

	describe("links added in Obsidian", () => {
		const lunch = page("P1", "Lunch with Sam at noon");
		const linked = renderBlock(lunch).replace("Sam", "[[Sam]]");

		it("are not an edit, and stay put while the server is unchanged", () => {
			const { content, outcomes } = mergeBlocks(linked, [lunch]);
			expect(outcomes).toEqual([{ kind: "unchanged", pageId: "P1" }]);
			expect(content).toBe(linked);
		});

		it("follow the server's new text", () => {
			const { content, outcomes } = mergeBlocks(linked, [{ pageId: "P1", text: "Lunch with Sam at 12:30" }]);
			expect(outcomes).toEqual([{ kind: "updated", pageId: "P1" }]);
			expect(parseBlocks(content)[0]?.text).toBe("Lunch with [[Sam]] at 12:30");
			expect(isLocallyEdited(parseBlocks(content)[0]!)).toBe(false);
		});

		it("are reported when the linked words are gone", () => {
			const { outcomes } = mergeBlocks(linked, [{ pageId: "P1", text: "Lunch alone at noon" }]);
			expect(outcomes).toEqual([{ kind: "updated", pageId: "P1", lostMarkup: ["[[Sam]]"] }]);
		});

		it("still count a changed word as an edit", () => {
			const corrected = linked.replace("noon", "midday");
			expect(mergeBlocks(corrected, [lunch]).outcomes).toEqual([{ kind: "local-edit", pageId: "P1" }]);
		});

		it("don't make blocks written with the older hash look edited", () => {
			const legacy = `%% sn:page id=P1 hash=${hashText("A  spaced   line")} %%\nA  spaced   line\n%% sn:end %%`;
			expect(mergeBlocks(legacy, [{ pageId: "P1", text: "A  spaced   line" }]).outcomes).toEqual([{ kind: "unchanged", pageId: "P1" }]);
		});
	});

	describe("taking the server's text", () => {
		const lunch = page("P1", "Lunch with Sam at noon");
		const edited = renderBlock(lunch).replace("noon", "midday").replace("Sam", "[[Sam]]");

		it("replaces an edited page, keeping the links added to it", () => {
			const server = page("P1", "Lunch with Sam at 12:30");
			const { content, outcomes } = mergeBlocks(edited, [server], new Set(["P1"]));
			expect(outcomes).toEqual([{ kind: "updated", pageId: "P1" }]);
			const block = parseBlocks(content)[0]!;
			expect(block.text).toBe("Lunch with [[Sam]] at 12:30");
			expect(isLocallyEdited(block)).toBe(false);
		});

		it("reverts an edit even when the server hasn't changed", () => {
			const { content } = mergeBlocks(edited, [lunch], new Set(["P1"]));
			expect(parseBlocks(content)[0]?.text).toBe("Lunch with [[Sam]] at noon");
		});

		it("leaves other edited pages alone", () => {
			expect(mergeBlocks(edited, [lunch], new Set(["P2"])).outcomes).toEqual([{ kind: "local-edit", pageId: "P1" }]);
		});
	});
});
