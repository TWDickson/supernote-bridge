import { cleanPath } from "./paths";

/**
 * Which device folders sync. Each entry marks a folder, and its whole subtree,
 * in or out; the nearest marked folder above a path decides, so `Note` can be
 * in while `Note/Personal` is out. Unmarked paths are out.
 */
export interface FolderSelection {
	include: string[];
	exclude: string[];
}

export const DEFAULT_SELECTION: FolderSelection = { include: ["Note"], exclude: [] };

function isUnder(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}/`);
}

/** The nearest mark at or above `path`, or null when nothing above it is marked. */
function nearestMark(path: string, selection: FolderSelection): boolean | null {
	let best: { length: number; on: boolean } | null = null;
	const consider = (entries: string[], on: boolean) => {
		for (const entry of entries) {
			const prefix = cleanPath(entry);
			if (prefix === "" || !isUnder(path, prefix)) continue;
			if (best === null || prefix.length > best.length) best = { length: prefix.length, on };
		}
	};
	consider(selection.include, true);
	consider(selection.exclude, false);
	return best === null ? null : (best as { on: boolean }).on;
}

/** Whether a device path (folder or file) is synced. */
export function isSelected(devicePath: string, selection: FolderSelection): boolean {
	return nearestMark(cleanPath(devicePath), selection) ?? false;
}

/** Whether walking into a folder can reach anything synced. */
export function shouldWalkInto(folderPath: string, selection: FolderSelection): boolean {
	const path = cleanPath(folderPath);
	if (isSelected(path, selection)) return true;
	return selection.include.some((entry) => {
		const prefix = cleanPath(entry);
		return prefix !== "" && prefix.startsWith(`${path}/`);
	});
}

/** For a checkbox: everything in the subtree on, everything off, or mixed. */
export function subtreeState(folderPath: string, selection: FolderSelection): "on" | "off" | "mixed" {
	const path = cleanPath(folderPath);
	const self = isSelected(path, selection);
	const below = [...selection.include, ...selection.exclude].map(cleanPath).filter((p) => p.startsWith(`${path}/`));
	const differs = below.some((p) => isSelected(p, selection) !== self);
	return differs ? "mixed" : self ? "on" : "off";
}

/** Turn a folder and everything under it on or off, keeping the marks minimal. */
export function setFolder(selection: FolderSelection, folderPath: string, on: boolean): FolderSelection {
	const path = cleanPath(folderPath);
	const keep = (entries: string[]) => entries.map(cleanPath).filter((p) => p !== "" && !isUnder(p, path));
	const next: FolderSelection = { include: keep(selection.include), exclude: keep(selection.exclude) };
	if ((nearestMark(path, next) ?? false) !== on) (on ? next.include : next.exclude).push(path);
	next.include.sort();
	next.exclude.sort();
	return next;
}

export function normalizeSelection(raw: unknown): FolderSelection | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const list = (v: unknown) =>
		Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map(cleanPath).filter((x) => x !== "") : [];
	return { include: list(r.include), exclude: list(r.exclude) };
}

export function describeSelection(selection: FolderSelection): string {
	if (selection.include.length === 0) return "Nothing selected.";
	const parts = [`Syncing ${selection.include.join(", ")}`];
	if (selection.exclude.length > 0) parts.push(`except ${selection.exclude.join(", ")}`);
	return `${parts.join(" ")}.`;
}
