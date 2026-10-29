import type { FolderRule } from "../sync/paths";

export type SplitMode = "notebook" | "title" | "page";

export interface SupernoteBridgeSettings {
	/** Base URL of the sync server, without a trailing slash. */
	serverUrl: string;
	/** Name of the entry in Obsidian's secret storage that holds the API token.
	 *  The token itself is never stored in data.json, which syncs between devices. */
	tokenSecretId: string;
	/** Vault folder that mirrors the Supernote tree when no folder rule matches. */
	vaultRoot: string;
	folderRules: FolderRule[];
	splitMode: SplitMode;
	/** Split at titles of this level or higher (1 = top level only). */
	splitTitleLevel: number;
}

export const DEFAULT_SETTINGS: SupernoteBridgeSettings = {
	serverUrl: "https://sn.twdickson.com",
	tokenSecretId: "",
	vaultRoot: "Supernote",
	folderRules: [],
	splitMode: "title",
	splitTitleLevel: 1,
};

const SPLIT_MODES: readonly SplitMode[] = ["notebook", "title", "page"];

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
	const level = Number(data.splitTitleLevel);

	return {
		serverUrl: str(data.serverUrl, DEFAULT_SETTINGS.serverUrl).trim().replace(/\/+$/, ""),
		tokenSecretId: str(data.tokenSecretId, DEFAULT_SETTINGS.tokenSecretId),
		vaultRoot: str(data.vaultRoot, DEFAULT_SETTINGS.vaultRoot),
		folderRules: rules.map(({ supernotePrefix, vaultFolder }) => ({ supernotePrefix, vaultFolder })),
		splitMode: SPLIT_MODES.includes(data.splitMode as SplitMode)
			? (data.splitMode as SplitMode)
			: DEFAULT_SETTINGS.splitMode,
		splitTitleLevel: Number.isInteger(level) && level >= 1 && level <= 4 ? level : DEFAULT_SETTINGS.splitTitleLevel,
	};
}
