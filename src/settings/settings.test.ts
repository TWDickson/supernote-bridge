import { describe, expect, it } from "vitest";
import { folderSplit } from "../sync/paths";
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

describe("folder rules", () => {
	it("keep a valid split and title styles, and drop bad ones", () => {
		const { folderRules } = normalizeSettings({
			folderRules: [
				{ supernotePrefix: "Note/Work/Weeks", vaultFolder: "Work/Weekly", splitMode: "page" },
				{ supernotePrefix: "Note/Work", vaultFolder: "Work/Planners", splitMode: "title", splitTitleStyles: ["1157254", "bogus"] },
				{ supernotePrefix: "Note/Journal", vaultFolder: "Journal", splitMode: "chapter" },
			],
		});
		expect(folderRules).toEqual([
			{ supernotePrefix: "Note/Work/Weeks", vaultFolder: "Work/Weekly", splitMode: "page" },
			{ supernotePrefix: "Note/Work", vaultFolder: "Work/Planners", splitMode: "title", splitTitleStyles: ["1157254"] },
			{ supernotePrefix: "Note/Journal", vaultFolder: "Journal" },
		]);
	});

	it("drop a rule that sets nothing, and keep one that only sets a split", () => {
		const { folderRules } = normalizeSettings({
			folderRules: [
				{ supernotePrefix: "Note/Empty", vaultFolder: "" },
				{ supernotePrefix: "Note/Work/Weeks", vaultFolder: "", splitMode: "page" },
			],
		});
		expect(folderRules).toEqual([{ supernotePrefix: "Note/Work/Weeks", vaultFolder: "", splitMode: "page" }]);
	});

	it("split their own way, or inherit from the folder above, or the default", () => {
		const settings = {
			...DEFAULT_SETTINGS,
			folderRules: [
				{ supernotePrefix: "Note/Work", vaultFolder: "W", splitMode: "page" as const },
				{ supernotePrefix: "Note/Work/Weeks", vaultFolder: "Weekly" },
			],
		};
		expect(folderSplit("Note/Work/Weeks", settings).mode).toBe("page");
		expect(folderSplit("Note/Journal", settings).mode).toBe(DEFAULT_SETTINGS.splitMode);
	});
});
