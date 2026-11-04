import type { SplitMode, SupernoteBridgeSettings } from "../settings/settings";

/** A user rule for a device folder and its subfolders: where their notebooks
 *  land, how they split, or both. Each part left unset is inherited from the
 *  nearest folder above that sets it, or from the defaults. */
export interface FolderRule {
	supernotePrefix: string;
	/** Empty: the location is inherited. */
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
	return folderLocation(parentOf(notebookPath), rules, defaultRoot);
}

/** Vault folder for a device folder's own notebooks. */
export function folderLocation(devicePath: string, rules: readonly FolderRule[], defaultRoot: string): string {
	const folder = cleanPath(devicePath);
	const rule = nearestRule(folder, rules, (r) => r.vaultFolder !== "");
	if (rule === null) {
		const mirrored = isUnder(folder, NOTEBOOK_ROOT) ? folder.slice(NOTEBOOK_ROOT.length) : folder;
		return cleanPath(`${defaultRoot}/${mirrored}`);
	}
	const prefix = cleanPath(rule.supernotePrefix);
	const rest = prefix === "" ? folder : folder.slice(prefix.length);
	return cleanPath(`${rule.vaultFolder}/${rest}`);
}

/** The rule that decides where a notebook goes: the most specific one that sets a location. */
export function ruleFor(notebookPath: string, rules: readonly FolderRule[]): FolderRule | null {
	return nearestRule(parentOf(notebookPath), rules, (r) => r.vaultFolder !== "");
}

/** How a device folder's notebooks split: the most specific rule that sets a split, or the default. */
export function folderSplit(devicePath: string, settings: SupernoteBridgeSettings): { mode: SplitMode; titleStyles: string[] } {
	const rule = nearestRule(cleanPath(devicePath), settings.folderRules, (r) => r.splitMode !== undefined);
	return {
		mode: rule?.splitMode ?? settings.splitMode,
		titleStyles: rule?.splitTitleStyles ?? settings.splitTitleStyles,
	};
}

/** The rule written for exactly this folder, if any. */
export function ownRule(devicePath: string, rules: readonly FolderRule[]): FolderRule | null {
	const folder = cleanPath(devicePath);
	return rules.find((rule) => cleanPath(rule.supernotePrefix) === folder) ?? null;
}

/** Rules with the one for `devicePath` changed by `patch`. A rule left setting
 *  nothing is removed. */
export function withRule(rules: readonly FolderRule[], devicePath: string, patch: Partial<Omit<FolderRule, "supernotePrefix">>): FolderRule[] {
	const prefix = cleanPath(devicePath);
	const current = ownRule(prefix, rules) ?? { supernotePrefix: prefix, vaultFolder: "" };
	const next: FolderRule = { ...current, ...patch, supernotePrefix: prefix };
	next.vaultFolder = cleanPath(next.vaultFolder);
	if (next.splitMode === undefined || next.splitMode !== "title") delete next.splitTitleStyles;
	if (next.splitMode === undefined) delete next.splitMode;
	const others = rules.filter((rule) => cleanPath(rule.supernotePrefix) !== prefix);
	const keep = next.vaultFolder !== "" || next.splitMode !== undefined;
	return (keep ? [...others, next] : others).sort((a, b) => a.supernotePrefix.localeCompare(b.supernotePrefix));
}

function parentOf(notebookPath: string): string {
	return cleanPath(notebookPath).split("/").slice(0, -1).join("/");
}

function nearestRule(folder: string, rules: readonly FolderRule[], applies: (rule: FolderRule) => boolean): FolderRule | null {
	let best: FolderRule | null = null;
	for (const rule of rules) {
		const prefix = cleanPath(rule.supernotePrefix);
		if (!applies(rule) || !isUnder(folder, prefix)) continue;
		if (best === null || prefix.length > cleanPath(best.supernotePrefix).length) best = rule;
	}
	return best;
}

/** Notebook display name from its Supernote path: `Note/Work/Plan.note` → `Plan`. */
export function notebookName(notebookPath: string): string {
	const file = cleanPath(notebookPath).split("/").pop() ?? "";
	return file.replace(/\.note$/i, "");
}
