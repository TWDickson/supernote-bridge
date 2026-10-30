/** A user rule: notebooks under `supernotePrefix` land in `vaultFolder`. */
export interface FolderRule {
	supernotePrefix: string;
	vaultFolder: string;
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

	let best: { prefix: string; target: string } | null = null;
	for (const rule of rules) {
		const prefix = cleanPath(rule.supernotePrefix);
		if (!isUnder(folder, prefix)) continue;
		if (best === null || prefix.length > best.prefix.length) {
			best = { prefix, target: cleanPath(rule.vaultFolder) };
		}
	}

	if (best === null) {
		const mirrored = isUnder(folder, NOTEBOOK_ROOT) ? folder.slice(NOTEBOOK_ROOT.length) : folder;
		return cleanPath(`${defaultRoot}/${mirrored}`);
	}
	const rest = best.prefix === "" ? folder : folder.slice(best.prefix.length);
	return cleanPath(`${best.target}/${rest}`);
}

/** Notebook display name from its Supernote path: `Note/Work/Plan.note` → `Plan`. */
export function notebookName(notebookPath: string): string {
	const file = cleanPath(notebookPath).split("/").pop() ?? "";
	return file.replace(/\.note$/i, "");
}

/** Whether a device path is inside one of the folders chosen for syncing. */
export function isSyncedPath(devicePath: string, syncFolders: readonly string[]): boolean {
	const path = cleanPath(devicePath);
	return syncFolders.some((folder) => {
		const prefix = cleanPath(folder);
		return prefix !== "" && isUnder(path, prefix);
	});
}

/** Whether walking into a device folder can reach anything synced: it is
 *  synced itself, or it is an ancestor of a synced folder. */
export function shouldWalk(folderPath: string, syncFolders: readonly string[]): boolean {
	const path = cleanPath(folderPath);
	return syncFolders.some((folder) => {
		const prefix = cleanPath(folder);
		return prefix !== "" && (isUnder(path, prefix) || isUnder(prefix, path));
	});
}
