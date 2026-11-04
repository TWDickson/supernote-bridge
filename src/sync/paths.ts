import type { SplitMode } from "../settings/settings";

/** A user rule: notebooks under `supernotePrefix` land in `vaultFolder`,
 *  optionally split their own way. */
export interface FolderRule {
	supernotePrefix: string;
	vaultFolder: string;
	/** Absent: the default split mode applies. */
	splitMode?: SplitMode;
	/** Title styles that start a note in `title` mode; absent: the default set. */
	splitTitleStyles?: string[];
}

/** Collapse repeated slashes and trim leading/trailing ones. Mirrors what
 *  Obsidian's `normalizePath` does to separators, without importing it, so
 *  this module stays testable outside Obsidian. */
export function cleanPath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.split("/")
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0)
		.join("/");
}

/** The device's notebook folder. Mirrored notebooks drop it, so `Note/Work/Plan.note`
 *  lands in `<root>/Work`; other synced device folders keep their name. */
export const NOTEBOOK_ROOT = "Note";

function isUnder(path: string, prefix: string): boolean {
	return prefix === "" || path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Vault folder for a notebook at Supernote path `notebookPath`
 * (e.g. `Note/Work/Plan.note`).
 *
 * The longest matching rule wins and the part of the notebook's folder below
 * the rule's prefix is kept, so a rule maps a whole subtree. Matching is by
 * whole path segment: a `Note/Work` rule does not capture `Note/Workshop`.
 * With no matching rule the device tree is mirrored under `defaultRoot`, minus
 * the leading `Note` folder.
 */
export function vaultFolderFor(notebookPath: string, rules: readonly FolderRule[], defaultRoot: string): string {
	const folder = cleanPath(notebookPath).split("/").slice(0, -1).join("/");
	const rule = ruleFor(notebookPath, rules);
	if (rule === null) {
		const mirrored = isUnder(folder, NOTEBOOK_ROOT) ? folder.slice(NOTEBOOK_ROOT.length) : folder;
		return cleanPath(`${defaultRoot}/${mirrored}`);
	}
	const prefix = cleanPath(rule.supernotePrefix);
	const rest = prefix === "" ? folder : folder.slice(prefix.length);
	return cleanPath(`${rule.vaultFolder}/${rest}`);
}

/** The rule that places a notebook: the one with the longest matching prefix. */
export function ruleFor(notebookPath: string, rules: readonly FolderRule[]): FolderRule | null {
	const folder = cleanPath(notebookPath).split("/").slice(0, -1).join("/");
	let best: FolderRule | null = null;
	for (const rule of rules) {
		const prefix = cleanPath(rule.supernotePrefix);
		if (!isUnder(folder, prefix)) continue;
		if (best === null || prefix.length > cleanPath(best.supernotePrefix).length) best = rule;
	}
	return best;
}

/** Notebook display name from its Supernote path: `Note/Work/Plan.note` → `Plan`. */
export function notebookName(notebookPath: string): string {
	const file = cleanPath(notebookPath).split("/").pop() ?? "";
	return file.replace(/\.note$/i, "");
}
