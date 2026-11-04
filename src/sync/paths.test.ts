import { describe, expect, it } from "vitest";
import { cleanPath, folderLocation, notebookName, ownRule, ruleFor, vaultFolderFor, withRule, type FolderRule } from "./paths";

describe("cleanPath", () => {
	it("collapses and trims separators", () => {
		expect(cleanPath("//a//b/ c /")).toBe("a/b/c");
		expect(cleanPath("a\\b")).toBe("a/b");
	});
});

describe("vaultFolderFor", () => {
	const rules: FolderRule[] = [
		{ supernotePrefix: "Note/Work", vaultFolder: "Work/Handwritten" },
		{ supernotePrefix: "Note/Work/Meetings", vaultFolder: "Work/Meetings" },
	];

	it("mirrors the tree under the default root, minus Note, when no rule matches", () => {
		expect(vaultFolderFor("Note/Personal/Ideas.note", rules, "Supernote")).toBe("Supernote/Personal");
		expect(vaultFolderFor("Note/Top.note", rules, "Supernote")).toBe("Supernote");
	});

	it("keeps the name of other device folders", () => {
		expect(vaultFolderFor("Document/Books/A.pdf", rules, "Supernote")).toBe("Supernote/Document/Books");
	});

	it("keeps the subtree below a matching rule", () => {
		expect(vaultFolderFor("Note/Work/Alpha/Plan.note", rules, "Supernote")).toBe("Work/Handwritten/Alpha");
	});

	it("prefers the longest matching prefix", () => {
		expect(vaultFolderFor("Note/Work/Meetings/Standup.note", rules, "Supernote")).toBe("Work/Meetings");
	});

	it("matches whole segments only", () => {
		expect(vaultFolderFor("Note/Workshop/Clay.note", rules, "Supernote")).toBe("Supernote/Workshop");
	});

	it("treats an empty prefix as a catch-all", () => {
		expect(vaultFolderFor("Note/X/Y.note", [{ supernotePrefix: "", vaultFolder: "Inbox" }], "Supernote")).toBe(
			"Inbox/Note/X",
		);
	});
});

describe("notebookName", () => {
	it("drops the folder and the .note extension", () => {
		expect(notebookName("Note/Work/Plan.note")).toBe("Plan");
	});
});

describe("rules set per folder", () => {
	const rules = [
		{ supernotePrefix: "Note/Work", vaultFolder: "Work/Planners" },
		{ supernotePrefix: "Note/Work/Weeks", vaultFolder: "", splitMode: "page" as const },
	];

	it("inherit the location from the folder above when they only set a split", () => {
		expect(folderLocation("Note/Work/Weeks", rules, "Supernote")).toBe("Work/Planners/Weeks");
		expect(ruleFor("Note/Work/Weeks/2026-W45.note", rules)?.supernotePrefix).toBe("Note/Work");
	});

	it("are added, changed and removed through withRule", () => {
		const added = withRule(rules, "Note/Journal", { vaultFolder: "Journal/" });
		expect(ownRule("Note/Journal", added)).toEqual({ supernotePrefix: "Note/Journal", vaultFolder: "Journal" });

		const moved = withRule(added, "Note/Work/Weeks", { vaultFolder: "Work/Weekly" });
		expect(ownRule("Note/Work/Weeks", moved)).toEqual({ supernotePrefix: "Note/Work/Weeks", vaultFolder: "Work/Weekly", splitMode: "page" });

		const cleared = withRule(moved, "Note/Work/Weeks", { vaultFolder: "", splitMode: undefined });
		expect(ownRule("Note/Work/Weeks", cleared)).toBeNull();
	});

	it("drop title styles unless they split by title", () => {
		const next = withRule([], "Note/Work", { splitMode: "title", splitTitleStyles: ["1157254"] });
		expect(withRule(next, "Note/Work", { splitMode: "page" })).toEqual([{ supernotePrefix: "Note/Work", vaultFolder: "", splitMode: "page" }]);
	});
});
