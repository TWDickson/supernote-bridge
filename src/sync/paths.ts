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
 * With no matching rule the Supernote tree is mirrored under `defaultRoot`.
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

	if (best === null) return cleanPath(`${defaultRoot}/${folder}`);
	const rest = best.prefix === "" ? folder : folder.slice(best.prefix.length);
	return cleanPath(`${best.target}/${rest}`);
}

/** Notebook display name from its Supernote path: `Note/Work/Plan.note` → `Plan`. */
export function notebookName(notebookPath: string): string {
	const file = cleanPath(notebookPath).split("/").pop() ?? "";
	return file.replace(/\.note$/i, "");
}
