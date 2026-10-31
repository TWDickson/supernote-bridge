import { beforeEach, describe, expect, it } from "vitest";
import { MemoryVault } from "../__mocks__/obsidian";
import type { SupernoteClient } from "../api/client";
import type { ServerFile, TranscriptPage } from "../api/types";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { parseBlocks } from "../sync/blocks";
import { DEFAULT_SELECTION, type FolderSelection } from "../sync/selection";
import { SyncRunner } from "./SyncRunner";

const BIG_ID = "770747265093468819";

/** A server holding a folder tree and per-notebook transcripts. */
class FakeServer {
	tree = new Map<string, ServerFile[]>();
	transcripts = new Map<string, TranscriptPage[]>();
	transcriptCalls: string[] = [];

	folder(id: string, parent: string, name: string): void {
		this.add(parent, { id, directoryId: parent, fileName: name, isFolder: true, md5: null, updateTime: null });
	}

	notebook(id: string, parent: string, name: string, md5: string, pages: string[]): void {
		this.add(parent, { id, directoryId: parent, fileName: name, isFolder: false, md5, updateTime: 1 });
		this.setPages(id, pages);
	}

	setPages(id: string, pages: string[]): void {
		this.transcripts.set(
			id,
			pages.map((text, i) => ({ pageIndex: i, pageId: `P${id}-${i}`, text })),
		);
	}

	private add(parent: string, file: ServerFile): void {
		this.tree.set(parent, [...(this.tree.get(parent) ?? []), file]);
	}

	client = {
		listFolder: async (id: string) => this.tree.get(id) ?? [],
		transcript: async (id: string) => {
			this.transcriptCalls.push(id);
			return this.transcripts.get(id) ?? null;
		},
	} as unknown as SupernoteClient;
}

describe("SyncRunner", () => {
	let server: FakeServer;
	let vault: MemoryVault;
	let settings: typeof DEFAULT_SETTINGS;
	let selection: FolderSelection;
	let runner: SyncRunner;

	beforeEach(() => {
		server = new FakeServer();
		vault = new MemoryVault();
		settings = { ...DEFAULT_SETTINGS, folderRules: [{ supernotePrefix: "Note/Work", vaultFolder: "Work/Handwritten" }] };
		selection = DEFAULT_SELECTION;
		runner = new SyncRunner(vault.app as never, server.client, () => settings, () => selection);

		server.folder("10", "0", "Note");
		server.folder("11", "10", "Work");
		server.folder("12", "0", "Document");
		server.notebook(BIG_ID, "10", "Ideas.note", "m1", ["first idea", "second idea"]);
		server.notebook("2", "11", "Plan.note", "m2", ["plan page"]);
		server.notebook("3", "12", "Manual.note", "m3", ["not synced"]);
	});

	it("creates one note per notebook in the mapped folders, only for synced device folders", async () => {
		const report = await runner.run();

		expect(report).toMatchObject({ created: 2, updated: 0, errors: [] });
		expect([...vault.files.keys()].sort()).toEqual(["Supernote/Ideas.md", "Work/Handwritten/Plan.md"]);
		const ideas = vault.files.get("Supernote/Ideas.md") ?? "";
		expect(ideas).toContain(`sn_file_id: "${BIG_ID}"`);
		expect(ideas).toContain('sn_source: "Note/Ideas.note"');
		expect(parseBlocks(ideas).map((b) => b.text)).toEqual(["first idea", "second idea"]);
	});

	it("writes nothing when nothing changed", async () => {
		await runner.run();
		const before = new Map(vault.files);

		const report = await runner.run();

		expect(report).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
		expect(vault.files).toEqual(before);
	});

	it("picks up text re-read on the server even though the notebook file is unchanged", async () => {
		await runner.run();
		server.setPages("2", ["plan page, re-read by a better model"]);

		const report = await runner.run();

		expect(report).toMatchObject({ updated: 1 });
		expect(parseBlocks(vault.files.get("Work/Handwritten/Plan.md") ?? "").map((b) => b.text)).toEqual([
			"plan page, re-read by a better model",
		]);
	});

	it("updates text from the server, keeps local corrections, and finds moved notes", async () => {
		await runner.run();
		vault.move("Supernote/Ideas.md", "Elsewhere/Renamed.md");
		vault.files.set(
			"Elsewhere/Renamed.md",
			(vault.files.get("Elsewhere/Renamed.md") ?? "").replace("second idea", "second idea, corrected") + "\nmy own notes\n",
		);
		server.setPages(BIG_ID, ["first idea, re-read", "second idea"]);
		server.tree.get("10")!.find((f) => f.id === BIG_ID)!.md5 = "m1b";

		const report = await runner.run();

		expect(report).toMatchObject({ created: 0, updated: 1, localEdits: 1, conflicts: [] });
		const note = vault.files.get("Elsewhere/Renamed.md") ?? "";
		expect(parseBlocks(note).map((b) => b.text)).toEqual(["first idea, re-read", "second idea, corrected"]);
		expect(note).toContain("my own notes");
		expect(vault.files.has("Supernote/Ideas.md")).toBe(false);
	});

	it("skips excluded folders and never deletes notes already written for them", async () => {
		await runner.run();
		selection = { include: ["Note"], exclude: ["Note/Work"] };
		server.setPages("2", ["changed on the server"]);

		const report = await runner.run();

		expect(report).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
		expect(parseBlocks(vault.files.get("Work/Handwritten/Plan.md") ?? "").map((b) => b.text)).toEqual(["plan page"]);
	});

	it("waits for OCR, and doesn't overwrite an unrelated note of the same name", async () => {
		server.transcripts.delete("2");
		vault.files.set("Supernote/Ideas.md", "my own note called Ideas\n");

		const report = await runner.run();

		expect(report.waitingForOcr).toBe(1);
		expect(vault.files.get("Supernote/Ideas.md")).toBe("my own note called Ideas\n");
		expect(vault.files.has(`Supernote/Ideas (${BIG_ID}).md`)).toBe(true);
	});
});
