import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings";

describe("normalizeSettings", () => {
	it("returns defaults for empty data", () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});

	it("drops malformed values and trims the server URL", () => {
		const settings = normalizeSettings({
			serverUrl: " https://example.test/// ",
			splitMode: "chapter",
			splitTitleStyles: [3, 9, "1", 1],
			syncFolders: ["Note", "", 4, " Document "],
			folderRules: [{ supernotePrefix: "Note", vaultFolder: "SN" }, { supernotePrefix: 3 }],
		});
		expect(settings.serverUrl).toBe("https://example.test");
		expect(settings.splitMode).toBe(DEFAULT_SETTINGS.splitMode);
		expect(settings.splitTitleStyles).toEqual([1, 3]);
		expect(settings.syncFolders).toEqual(["Note", "Document"]);
		expect(settings.folderRules).toEqual([{ supernotePrefix: "Note", vaultFolder: "SN" }]);
	});
});
