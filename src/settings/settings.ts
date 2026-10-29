import type { FolderRule } from "../sync/paths";

export type SplitMode = "notebook" | "title" | "page";

export interface SupernoteBridgeSettings {
	/** Base URL of the sync server, without a trailing slash. */
	serverUrl: string;
	/** Name of the entry in Obsidian's secret storage that holds the API token.
	 *  The token itself is never stored in data.json, which syncs between devices. */
	tokenSecretId: string;
	/** Device folders to sync. `Note` holds the notebooks; the rest are opt-in. */
	syncFolders: string[];
	/** Vault folder that mirrors the device tree (minus `Note`) when no folder rule matches. */
	vaultRoot: string;
	folderRules: FolderRule[];
	splitMode: SplitMode;
	/** Title styles (device TITLELEVEL 1–4) that start a new note in `title`
	 *  mode. A set, not a depth: people pick title styles by look, not as a
	 *  hierarchy. */
	splitTitleStyles: number[];
}

export const DEFAULT_SETTINGS: SupernoteBridgeSettings = {
	serverUrl: "https://sn.twdickson.com",
	tokenSecretId: "",
	syncFolders: ["Note"],
	vaultRoot: "Supernote",
	folderRules: [],
	splitMode: "title",
	splitTitleStyles: [1],
};

const SPLIT_MODES: readonly SplitMode[] = ["notebook", "title", "page"];
export const TITLE_STYLES = [1, 2, 3, 4] as const;

/** Merge stored data over the defaults, dropping anything malformed, so the
 *  rest of the plugin can trust every field. */
export function normalizeSettings(raw: unknown): SupernoteBridgeSettings {
	const data = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof SupernoteBridgeSettings, unknown>>;
	const str = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);

	const rules = Array.isArray(data.folderRules)
		? data.folderRules.filter(
				(rule): rule is FolderRule =>
					!!rule &&
					typeof (rule as FolderRule).supernotePrefix === "string" &&
					typeof (rule as FolderRule).vaultFolder === "string",
			)
		: [];
	const strings = (value: unknown) =>
		Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()) : null;
	const styles = Array.isArray(data.splitTitleStyles)
		? TITLE_STYLES.filter((style) => (data.splitTitleStyles as unknown[]).includes(style))
		: null;

	return {
		serverUrl: str(data.serverUrl, DEFAULT_SETTINGS.serverUrl).trim().replace(/\/+$/, ""),
		tokenSecretId: str(data.tokenSecretId, DEFAULT_SETTINGS.tokenSecretId),
		syncFolders: strings(data.syncFolders) ?? [...DEFAULT_SETTINGS.syncFolders],
		vaultRoot: str(data.vaultRoot, DEFAULT_SETTINGS.vaultRoot),
		folderRules: rules.map(({ supernotePrefix, vaultFolder }) => ({ supernotePrefix, vaultFolder })),
		splitMode: SPLIT_MODES.includes(data.splitMode as SplitMode)
			? (data.splitMode as SplitMode)
			: DEFAULT_SETTINGS.splitMode,
		// An empty selection is kept: it means "no title splits" and the user chose it.
		splitTitleStyles: styles ?? [...DEFAULT_SETTINGS.splitTitleStyles],
	};
}
