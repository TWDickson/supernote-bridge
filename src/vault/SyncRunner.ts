import { type App, normalizePath, TFile } from "obsidian";
import type { SupernoteClient } from "../api/client";
import type { ServerFile, TranscriptPage } from "../api/types";
import type { SupernoteBridgeSettings } from "../settings/settings";
import { mergeBlocks, type PageOutcome, type ServerPage } from "../sync/blocks";
import { cleanPath, notebookName, vaultFolderFor } from "../sync/paths";
import { isSelected, shouldWalkInto, type FolderSelection } from "../sync/selection";
import { reflowText } from "../sync/reflow";
import { FM, LEGACY_KEYS, renderNewNote } from "../sync/schema";

interface Notebook {
	file: ServerFile;
	/** Device path, e.g. `Note/Work/Plan.note`. */
	path: string;
}

/** A page in a report: its id and its 1-based page number in the notebook. */
export interface PageRef {
	pageId: string;
	page: number;
}

/** What a sync did to one note, kept only when there's something to say. */
export interface NoteReport {
	path: string;
	created: boolean;
	updatedPages: number;
	/** Edited in Obsidian; kept, and the server's text for them is unchanged. */
	edited: PageRef[];
	/** Edited in Obsidian *and* changed on the server; the edit was kept. */
	conflicts: PageRef[];
	lostMarkup: Array<PageRef & { markup: string }>;
}

export interface SyncReport {
	/** When the sync finished, in ms since the epoch. */
	at: number;
	notes: NoteReport[];
	created: number;
	updated: number;
	unchanged: number;
	/** Notebooks whose OCR hasn't produced text yet. */
	waitingForOcr: number;
	/** Pages corrected in Obsidian; kept, and sent back in a later version. */
	localEdits: number;
	/** Notes with pages edited here *and* changed on the server; the local text was kept. */
	conflicts: string[];
	/** Links, tags or block ids added in Obsidian whose words left the page in a
	 *  server update, as `note path: markup`. */
	lostMarkup: string[];
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
		const report: SyncReport = {
			at: 0,
			notes: [],
			created: 0,
			updated: 0,
			unchanged: 0,
			waitingForOcr: 0,
			localEdits: 0,
			conflicts: [],
			lostMarkup: [],
			errors: [],
		};
		const notebooks = await this.listNotebooks();
		const notes = this.indexNotes();

		for (const notebook of notebooks) {
			try {
				await this.syncNotebook(notebook, notes.get(notebook.file.id) ?? null, report);
			} catch (err) {
				report.errors.push(`${notebook.path}: ${(err as Error).message}`);
			}
		}
		report.at = Date.now();
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
		const pages = this.pagesFrom(transcript);

		if (!existing) {
			const identity = { fileId: notebook.file.id, source: notebook.path };
			const path = await this.create(notebook, renderNewNote(identity, notebookName(notebook.path), pages));
			report.created++;
			report.notes.push({ path, created: true, updatedPages: 0, edited: [], conflicts: [], lostMarkup: [] });
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
		const frontmatter = this.app.metadataCache.getFileCache(existing)?.frontmatter ?? {};
		if (frontmatter[FM.source] !== notebook.path || LEGACY_KEYS.some((key) => key in frontmatter)) {
			await this.app.fileManager.processFrontMatter(existing, (fm: Record<string, unknown>) => {
				fm[FM.source] = notebook.path;
				for (const key of LEGACY_KEYS) delete fm[key];
			});
		}

		const ref = (pageId: string): PageRef => ({ pageId, page: pages.findIndex((p) => p.pageId === pageId) + 1 });
		const note: NoteReport = {
			path: existing.path,
			created: false,
			updatedPages: outcomes.filter((o) => o.kind === "updated" || o.kind === "added" || o.kind === "removed").length,
			edited: outcomes.filter((o) => o.kind === "local-edit").map((o) => ref(o.pageId)),
			conflicts: outcomes.filter((o) => o.kind === "conflict").map((o) => ref(o.pageId)),
			lostMarkup: outcomes.flatMap((o) => (o.kind === "updated" ? (o.lostMarkup ?? []).map((markup) => ({ ...ref(o.pageId), markup })) : [])),
		};
		if (note.updatedPages || note.edited.length || note.conflicts.length) report.notes.push(note);

		report.localEdits += note.edited.length;
		if (note.conflicts.length) report.conflicts.push(existing.path);
		for (const lost of note.lostMarkup) report.lostMarkup.push(`${existing.path}: ${lost.markup}`);
		if (changed) report.updated++;
		else report.unchanged++;
	}

	/**
	 * Drop the Obsidian edits on some pages of a synced note and take the
	 * server's current text for them ("take server text"). Links and tags
	 * added there are kept where their words still are. Returns how many pages
	 * changed.
	 */
	async takeServerText(file: TFile, pageIds: readonly string[]): Promise<number> {
		const id = this.app.metadataCache.getFileCache(file)?.frontmatter?.[FM.fileId] as unknown;
		if (typeof id !== "string" && typeof id !== "number") throw new Error("This note isn't synced from a notebook.");
		const transcript = await this.client.transcript(String(id));
		if (transcript === null) throw new Error("The server has no text for this notebook yet.");
		const pages = this.pagesFrom(transcript);
		let changedPages = 0;
		await this.app.vault.process(file, (content) => {
			const merged = mergeBlocks(content, pages, new Set(pageIds));
			changedPages = merged.outcomes.filter((o) => o.kind === "updated" && pageIds.includes(o.pageId)).length;
			return merged.content;
		});
		return changedPages;
	}

	private pagesFrom(transcript: readonly TranscriptPage[]): ServerPage[] {
		const reflow = this.settings().reflowProse;
		return [...transcript]
			.sort((a, b) => a.pageIndex - b.pageIndex)
			.map((p) => ({ pageId: p.pageId, text: reflow ? reflowText(p.text ?? "") : (p.text ?? "") }));
	}

	private async create(notebook: Notebook, content: string): Promise<string> {
		const { folderRules, vaultRoot } = this.settings();
		const folder = normalizePath(vaultFolderFor(notebook.path, folderRules, vaultRoot) || "/");
		if (folder !== "/" && !this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
		const base = notebookName(notebook.path);
		let path = normalizePath(`${folder}/${base}.md`);
		/* A note of the same name that isn't this notebook's stays untouched. */
		if (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${folder}/${base} (${notebook.file.id}).md`);
		await this.app.vault.create(path, content);
		return path;
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
