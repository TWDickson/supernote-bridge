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
			splitTitleStyles: ["1201000", "nope", "1000254"],
			folderRules: [{ supernotePrefix: "Note", vaultFolder: "SN" }, { supernotePrefix: 3 }],
		});
		expect(settings.serverUrl).toBe("https://example.test");
		expect(settings.splitMode).toBe(DEFAULT_SETTINGS.splitMode);
		expect(settings.splitTitleStyles).toEqual(["1000254", "1201000"]);
		expect(settings.folderRules).toEqual([{ supernotePrefix: "Note", vaultFolder: "SN" }]);
	});

	it("replaces 0.1.0's numeric title levels with the default", () => {
		expect(normalizeSettings({ splitTitleStyles: [1] }).splitTitleStyles).toEqual(DEFAULT_SETTINGS.splitTitleStyles);
	});
});
