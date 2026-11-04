import { renderBlock, type ServerPage } from "./blocks";

/** Every frontmatter key the plugin writes. Name keys through this table,
 *  never as literals elsewhere. */
export const FM = {
	fileId: "sn_file_id",
	source: "sn_source",
} as const;

/** Keys earlier versions wrote; removed at the next sync. A note holds nothing
 *  device-specific, such as a sync time, so every device that syncs a notebook
 *  writes the same bytes and Obsidian Sync has nothing to merge. */
export const LEGACY_KEYS = ["sn_md5", "sn_synced"] as const;

export interface NotebookIdentity {
	fileId: string;
	/** Device path, e.g. `Note/Work/Plan.note`. */
	source: string;
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

/** The full text of a note created for a notebook. Frontmatter is written as
 *  a string only here; later changes go through processFrontMatter. */
export function renderNewNote(identity: NotebookIdentity, title: string, pages: readonly ServerPage[]): string {
	const frontmatter = [
		"---",
		`${FM.fileId}: ${yamlString(identity.fileId)}`,
		`${FM.source}: ${yamlString(identity.source)}`,
		"---",
	].join("\n");
	const blocks = pages.map((page) => renderBlock(page)).join("\n\n");
	return `${frontmatter}\n# ${title}\n\n${blocks}\n`;
}
