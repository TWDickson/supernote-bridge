import { type App, normalizePath, TFile } from "obsidian";
import type { SupernoteClient } from "../api/client";
import type { ServerFile } from "../api/types";
import type { SupernoteBridgeSettings } from "../settings/settings";
import { mergeBlocks, type PageOutcome, type ServerPage } from "../sync/blocks";
import { cleanPath, notebookName, vaultFolderFor } from "../sync/paths";
import { isSelected, shouldWalkInto, type FolderSelection } from "../sync/selection";
import { FM, LEGACY_MD5_KEY, renderNewNote } from "../sync/schema";

interface Notebook {
	file: ServerFile;
	/** Device path, e.g. `Note/Work/Plan.note`. */
	path: string;
}

export interface SyncReport {
	created: number;
	updated: number;
	unchanged: number;
	/** Notebooks whose OCR hasn't produced text yet. */
	waitingForOcr: number;
	/** Pages corrected in Obsidian; kept, and sent back in a later version. */
	localEdits: number;
	/** Notes with pages edited here *and* changed on the server; the local text was kept. */
	conflicts: string[];
	errors: string[];
}

/**
 * One read-only pull: every synced notebook on the server becomes, or
 * updates, one note in the vault. Notes are found by `sn_file_id`, so the user
 * can rename or move them.
 */
export class SyncRunner {
	constructor(
		private readonly app: App,
		private readonly client: SupernoteClient,
		private readonly settings: () => SupernoteBridgeSettings,
		private readonly selection: () => FolderSelection,
	) {}

	async run(): Promise<SyncReport> {
		const report: SyncReport = { created: 0, updated: 0, unchanged: 0, waitingForOcr: 0, localEdits: 0, conflicts: [], errors: [] };
		const notebooks = await this.listNotebooks();
		const notes = this.indexNotes();

		for (const notebook of notebooks) {
			try {
				await this.syncNotebook(notebook, notes.get(notebook.file.id) ?? null, report);
			} catch (err) {
				report.errors.push(`${notebook.path}: ${(err as Error).message}`);
			}
		}
		return report;
	}

	/* Every sync reads every notebook's text. The .note file's md5 can't stand
	   in for it: OCR finishes after upload, and a re-read (e.g. by Claude)
	   rewrites a page's text on the server without touching the file. */
	private async syncNotebook(notebook: Notebook, existing: TFile | null, report: SyncReport): Promise<void> {
		const transcript = await this.client.transcript(notebook.file.id);
		if (transcript === null) {
			report.waitingForOcr++;
			return;
		}
		const pages: ServerPage[] = [...transcript]
			.sort((a, b) => a.pageIndex - b.pageIndex)
			.map((p) => ({ pageId: p.pageId, text: p.text ?? "" }));
		const syncedAt = new Date().toISOString();

		if (!existing) {
			const identity = { fileId: notebook.file.id, source: notebook.path };
			await this.create(notebook, renderNewNote(identity, notebookName(notebook.path), pages, syncedAt));
			report.created++;
			return;
		}

		let outcomes: PageOutcome[] = [];
		let changed = false;
		await this.app.vault.process(existing, (content) => {
			const merged = mergeBlocks(content, pages);
			outcomes = merged.outcomes;
			changed = merged.content !== content;
			return merged.content;
		});
		const recordedSource = this.app.metadataCache.getFileCache(existing)?.frontmatter?.[FM.source] as unknown;
		if (changed || recordedSource !== notebook.path) {
			await this.app.fileManager.processFrontMatter(existing, (fm: Record<string, unknown>) => {
				fm[FM.source] = notebook.path;
				delete fm[LEGACY_MD5_KEY];
				if (changed) fm[FM.synced] = syncedAt;
			});
		}

		report.localEdits += outcomes.filter((o) => o.kind === "local-edit").length;
		if (outcomes.some((o) => o.kind === "conflict")) report.conflicts.push(existing.path);
		if (changed) report.updated++;
		else report.unchanged++;
	}

	private async create(notebook: Notebook, content: string): Promise<void> {
		const { folderRules, vaultRoot } = this.settings();
		const folder = normalizePath(vaultFolderFor(notebook.path, folderRules, vaultRoot) || "/");
		if (folder !== "/" && !this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
		const base = notebookName(notebook.path);
		let path = normalizePath(`${folder}/${base}.md`);
		/* A note of the same name that isn't this notebook's stays untouched. */
		if (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${folder}/${base} (${notebook.file.id}).md`);
		await this.app.vault.create(path, content);
	}

	/** Notes already written for a notebook, by server file id. */
	private indexNotes(): Map<string, TFile> {
		const index = new Map<string, TFile>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const id = this.app.metadataCache.getFileCache(file)?.frontmatter?.[FM.fileId] as unknown;
			if (typeof id === "string" || typeof id === "number") index.set(String(id), file);
		}
		return index;
	}

	private async listNotebooks(): Promise<Notebook[]> {
		const selection = this.selection();
		const notebooks: Notebook[] = [];
		const walk = async (directoryId: string, prefix: string) => {
			for (const file of await this.client.listFolder(directoryId)) {
				const path = cleanPath(`${prefix}/${file.fileName}`);
				if (file.isFolder) {
					if (shouldWalkInto(path, selection)) await walk(file.id, path);
				} else if (/\.note$/i.test(file.fileName) && isSelected(path, selection)) {
					notebooks.push({ file, path });
				}
			}
		};
		await walk("0", "");
		return notebooks;
	}
}
