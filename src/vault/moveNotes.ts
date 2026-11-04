import { type App, normalizePath, TFile } from "obsidian";
import { cleanPath, type FolderRule, ruleFor, vaultFolderFor } from "../sync/paths";
import { FM } from "../sync/schema";

/** A synced note, by where it is and which notebook it holds. */
export interface PlacedNote {
	path: string;
	/** Device path of its notebook, e.g. `Note/Work/Plan.note`. */
	source: string;
}

export interface Move {
	from: string;
	to: string;
}

/**
 * Notes that `scope` places (a rule, or `null` for notebooks no rule covers)
 * and that sit somewhere other than where it puts them now. Each keeps its
 * file name, so a note renamed by hand stays renamed.
 */
export function planMoves(notes: readonly PlacedNote[], rules: readonly FolderRule[], vaultRoot: string, scope: FolderRule | null): Move[] {
	const key = (rule: FolderRule | null) => (rule === null ? null : cleanPath(rule.supernotePrefix));
	const moves: Move[] = [];
	for (const note of notes) {
		if (key(ruleFor(note.source, rules)) !== key(scope)) continue;
		const name = note.path.split("/").pop() ?? note.path;
		const to = cleanPath(`${vaultFolderFor(note.source, rules, vaultRoot)}/${name}`);
		if (to !== cleanPath(note.path)) moves.push({ from: note.path, to });
	}
	return moves;
}

/** Every note the sync wrote, from its frontmatter. */
export function placedNotes(app: App): PlacedNote[] {
	return app.vault.getMarkdownFiles().flatMap((file) => {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		const source = fm?.[FM.source] as unknown;
		return fm?.[FM.fileId] !== undefined && typeof source === "string" ? [{ path: file.path, source }] : [];
	});
}

/** Carry out moves through the file manager, so links to the notes follow.
 *  A move whose destination is taken is skipped, never overwritten. Folders
 *  the moves leave empty go to the trash, so the old layout doesn't linger. */
export async function applyMoves(app: App, moves: readonly Move[]): Promise<{ moved: number; skipped: string[] }> {
	let moved = 0;
	const skipped: string[] = [];
	for (const { from, to } of moves) {
		const file = app.vault.getAbstractFileByPath(from);
		if (!(file instanceof TFile) || app.vault.getAbstractFileByPath(to)) {
			skipped.push(from);
			continue;
		}
		const folder = to.split("/").slice(0, -1).join("/");
		if (folder !== "" && !app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
		await app.fileManager.renameFile(file, normalizePath(to));
		moved++;
	}
	for (const folder of emptiedFolders(moves.map((move) => move.from))) {
		const handle = app.vault.getFolderByPath(folder);
		if (handle && handle.children.length === 0) await app.fileManager.trashFile(handle);
	}
	return { moved, skipped };
}

/** Folders that held the moved notes, and their parents, deepest first, so a
 *  folder is checked after anything inside it has gone. */
export function emptiedFolders(movedFrom: readonly string[]): string[] {
	const folders = new Set<string>();
	for (const path of movedFrom) {
		const parts = cleanPath(path).split("/").slice(0, -1);
		for (let i = parts.length; i > 0; i--) folders.add(parts.slice(0, i).join("/"));
	}
	return [...folders].sort((a, b) => b.split("/").length - a.split("/").length || a.localeCompare(b));
}
