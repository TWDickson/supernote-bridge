import { type App, Notice, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type SupernoteBridgePlugin from "../main";
import { TITLE_STYLES, type SupernoteBridgeSettings } from "./settings";

/* Settings that aren't a plain field get a virtual key, mapped in
   getControlValue / setControlValue. */
type StyleKey = `splitTitleStyle${(typeof TITLE_STYLES)[number]}`;
type SettingKey = keyof SupernoteBridgeSettings | StyleKey;

const STYLE_KEY_PATTERN = /^splitTitleStyle(\d)$/;

export class SupernoteBridgeSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: SupernoteBridgePlugin,
	) {
		super(app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{
				name: "Server URL",
				desc: "Base URL of your sync server.",
				control: { type: "text", key: "serverUrl", placeholder: "https://supernote.example.com" },
			},
			{
				name: "API token",
				desc: "Kept in this device's secret storage, not in the synced plugin data.",
				control: { type: "secret", key: "tokenSecretId" },
			},
			{
				name: "Test connection",
				desc: "Check that the server is reachable.",
				render: (setting) => {
					setting.addButton((button) =>
						button.setButtonText("Test").onClick(async () => {
							try {
								await this.plugin.client.health();
								new Notice("Server is reachable.");
							} catch (err) {
								new Notice(`Could not reach the server: ${(err as Error).message}`);
							}
						}),
					);
				},
			},
			{
				type: "group",
				heading: "Notes",
				items: [
					{
						name: "Device folders",
						desc: "Comma-separated folders on the device to sync. Note holds your notebooks.",
						control: { type: "text", key: "syncFolders", placeholder: "Note" },
					},
					{
						name: "Vault folder",
						desc: "Where notebooks go when no folder rule matches. The device's folders are mirrored inside it, without the Note folder.",
						control: { type: "folder", key: "vaultRoot" },
					},
					{
						name: "Split notebooks",
						desc: "Create one note per notebook, per title, or per page.",
						control: {
							type: "dropdown",
							key: "splitMode",
							options: { notebook: "Per notebook", title: "Per title", page: "Per page" },
						},
					},
				],
			},
			{
				type: "group",
				heading: "Title splits",
				items: TITLE_STYLES.map((style) => ({
					name: `Title style ${style}`,
					desc: style === 1 ? "Titles in the styles you turn on here start a new note. Other titles become headings inside it." : undefined,
					visible: () => this.plugin.settings.splitMode === "title",
					control: { type: "toggle" as const, key: `splitTitleStyle${style}` as const },
				})),
			},
		];
	}

	override getControlValue(key: string): unknown {
		const { settings } = this.plugin;
		const style = STYLE_KEY_PATTERN.exec(key);
		if (style) return settings.splitTitleStyles.includes(Number(style[1]));
		if (key === "syncFolders") return settings.syncFolders.join(", ");
		return (settings as unknown as Record<string, unknown>)[key];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		const { settings } = this.plugin;
		const style = STYLE_KEY_PATTERN.exec(key);
		if (style) {
			const n = Number(style[1]);
			const others = settings.splitTitleStyles.filter((s) => s !== n);
			settings.splitTitleStyles = value === true ? [...others, n] : others;
		} else if (key === "syncFolders") {
			settings.syncFolders = String(value).split(",");
		} else {
			(settings as unknown as Record<string, unknown>)[key] = value;
		}
		await this.plugin.saveSettings();
		// The title-style toggles show only in "Per title" mode.
		if (key === "splitMode") this.refreshDomState();
	}
}
