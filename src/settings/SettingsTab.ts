import { type App, Notice, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type SupernoteBridgePlugin from "../main";
import type { SupernoteBridgeSettings } from "./settings";

type SettingKey = keyof SupernoteBridgeSettings;

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
						name: "Vault folder",
						desc: "Where notebooks go when no folder rule matches. The device's folder tree is mirrored inside it.",
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
		];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
	}
}
