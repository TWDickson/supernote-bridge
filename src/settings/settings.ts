import type { FolderRule } from "../sync/paths";

export type SplitMode = "notebook" | "title" | "page";

export interface SupernoteBridgeSettings {
	/** Base URL of the sync server, without a trailing slash. */
	serverUrl: string;
	/** Name of the entry in Obsidian's secret storage that holds the API token.
	 *  The token itself is never stored in data.json, which syncs between devices. */
	tokenSecretId: string;
	/** Vault folder that mirrors the device tree (minus `Note`) when no folder rule matches. */
	vaultRoot: string;
	folderRules: FolderRule[];
	splitMode: SplitMode;
	/** Title styles (the device's TITLESTYLE codes) that start a new note in
	 *  `title` mode. A set, not a depth: people pick title styles by look. */
	splitTitleStyles: string[];
}

export const DEFAULT_SETTINGS: SupernoteBridgeSettings = {
	serverUrl: "https://sn.twdickson.com",
	tokenSecretId: "",
	vaultRoot: "Supernote",
	folderRules: [],
	splitMode: "title",
	splitTitleStyles: ["1000254"],
};

const SPLIT_MODES: readonly SplitMode[] = ["notebook", "title", "page"];
/**
 * The device's four title styles, keyed by the TITLESTYLE code stored with
 * each title. (TITLELEVEL is always 1, so it can't tell them apart.) The code
 * reads as 1, then background grey, then ink grey, each 0–255; the labels
 * follow from that and are still to be checked against the device.
 */
export const TITLE_STYLES = [
	{ code: "1000254", label: "Black" },
	{ code: "1157254", label: "Dark grey" },
	{ code: "1201000", label: "Light grey" },
	{ code: "1000000", label: "Fourth style" },
] as const;

const TITLE_STYLE_CODES: readonly string[] = TITLE_STYLES.map((style) => style.code);

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
	/* 0.1.0 stored TITLELEVEL numbers, which never varied; those fall back to the default. */
	const styles = Array.isArray(data.splitTitleStyles) && data.splitTitleStyles.every((v) => typeof v === "string")
		? TITLE_STYLE_CODES.filter((code) => (data.splitTitleStyles as string[]).includes(code))
		: null;

	return {
		serverUrl: str(data.serverUrl, DEFAULT_SETTINGS.serverUrl).trim().replace(/\/+$/, ""),
		tokenSecretId: str(data.tokenSecretId, DEFAULT_SETTINGS.tokenSecretId),
		vaultRoot: str(data.vaultRoot, DEFAULT_SETTINGS.vaultRoot),
		folderRules: rules.map(({ supernotePrefix, vaultFolder }) => ({ supernotePrefix, vaultFolder })),
		splitMode: SPLIT_MODES.includes(data.splitMode as SplitMode)
			? (data.splitMode as SplitMode)
			: DEFAULT_SETTINGS.splitMode,
		// An empty selection is kept: it means "no title splits" and the user chose it.
		splitTitleStyles: styles ?? [...DEFAULT_SETTINGS.splitTitleStyles],
	};
}
