import { Plugin } from "obsidian";
import { SupernoteClient } from "./api/client";
import { normalizeSettings, type SupernoteBridgeSettings } from "./settings/settings";
import { SupernoteBridgeSettingTab } from "./settings/SettingsTab";

export default class SupernoteBridgePlugin extends Plugin {
	declare settings: SupernoteBridgeSettings;
	client!: SupernoteClient;

	override async onload(): Promise<void> {
		await this.loadSettings();
		this.client = new SupernoteClient(this.settings.serverUrl, () => this.token());
		this.addSettingTab(new SupernoteBridgeSettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		/* In place: the settings tab holds a reference to this object. */
		Object.assign(this.settings, normalizeSettings(this.settings));
		await this.saveData(this.settings);
		this.client = new SupernoteClient(this.settings.serverUrl, () => this.token());
	}

	private token(): string | null {
		const id = this.settings.tokenSecretId;
		return id ? this.app.secretStorage.getSecret(id) : null;
	}
}
