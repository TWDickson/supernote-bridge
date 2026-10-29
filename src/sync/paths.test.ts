import { describe, expect, it } from "vitest";
import { cleanPath, notebookName, vaultFolderFor, type FolderRule } from "./paths";

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

	it("mirrors the tree under the default root when no rule matches", () => {
		expect(vaultFolderFor("Note/Personal/Ideas.note", rules, "Supernote")).toBe("Supernote/Note/Personal");
	});

	it("keeps the subtree below a matching rule", () => {
		expect(vaultFolderFor("Note/Work/Alpha/Plan.note", rules, "Supernote")).toBe("Work/Handwritten/Alpha");
	});

	it("prefers the longest matching prefix", () => {
		expect(vaultFolderFor("Note/Work/Meetings/Standup.note", rules, "Supernote")).toBe("Work/Meetings");
	});

	it("matches whole segments only", () => {
		expect(vaultFolderFor("Note/Workshop/Clay.note", rules, "Supernote")).toBe("Supernote/Note/Workshop");
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
