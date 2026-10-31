import { renderBlock, type ServerPage } from "./blocks";

/** Every frontmatter key the plugin writes. Name keys through this table,
 *  never as literals elsewhere. */
export const FM = {
	fileId: "sn_file_id",
	source: "sn_source",
	synced: "sn_synced",
} as const;

/** Written by 0.1.0 and no longer meaningful; removed when a note is next updated. */
export const LEGACY_MD5_KEY = "sn_md5";

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
export function renderNewNote(identity: NotebookIdentity, title: string, pages: readonly ServerPage[], syncedAt: string): string {
	const frontmatter = [
		"---",
		`${FM.fileId}: ${yamlString(identity.fileId)}`,
		`${FM.source}: ${yamlString(identity.source)}`,
		`${FM.synced}: ${yamlString(syncedAt)}`,
		"---",
	].join("\n");
	const blocks = pages.map(renderBlock).join("\n\n");
	return `${frontmatter}\n# ${title}\n\n${blocks}\n`;
}
