import { type App, Notice, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type SupernoteBridgePlugin from "../main";
import { describeSelection } from "../sync/selection";
import { FolderPickerModal } from "./FolderPickerModal";
import { TITLE_STYLES, type SupernoteBridgeSettings } from "./settings";

/* Settings kept per device rather than in the synced settings get a virtual
   key, mapped in getControlValue / setControlValue. */
type DeviceKey = "deviceName" | "deviceSyncs";
type SettingKey = keyof SupernoteBridgeSettings | DeviceKey;

export class SupernoteBridgeSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: SupernoteBridgePlugin,
	) {
		super(app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		const { auth } = this.plugin;
		return [
			{
				name: "Server URL",
				desc: "Base URL of your sync server.",
				control: { type: "text", key: "serverUrl", placeholder: "https://supernote.example.com" },
			},
			{
				name: "Account",
				desc: auth.isSignedIn()
					? "Signed in. This device is listed under connected apps on the server."
					: "Sign in on the server and approve this device. You'll be brought back here.",
				render: (setting) => {
					if (auth.isSignedIn()) {
						setting.addButton((button) =>
							button.setButtonText("Sign out").onClick(async () => {
								await auth.signOut();
								new Notice("Signed out.");
								this.update();
							}),
						);
					} else {
						setting.addButton((button) =>
							button
								.setButtonText("Sign in")
								.setCta()
								.onClick(async () => {
									try {
										await auth.signIn();
									} catch (err) {
										new Notice((err as Error).message);
									}
								}),
						);
					}
				},
			},
			{
				name: "Device name",
				desc: "How this device appears under connected apps on the server. Takes effect at the next sign-in.",
				control: { type: "text", key: "deviceName" },
			},
			{
				name: "This device syncs with the server",
				desc: "Turn this on for one device only. Your other devices get the notes through Obsidian Sync and don't need to sign in.",
				control: { type: "toggle", key: "deviceSyncs" },
			},
			{
				type: "group",
				heading: "Notes",
				items: [
					{
						name: "Folders to sync on this device",
						desc: `${describeSelection(this.plugin.device.folderSelection)} Chosen per device, so other devices aren't affected.`,
						render: (setting) => {
							setting.addButton((button) =>
								button.setButtonText("Choose…").onClick(() => {
									if (!auth.isSignedIn() && !auth.hasAppToken()) {
										new Notice("Sign in first, so the folders can be read from the server.");
										return;
									}
									new FolderPickerModal(this.app, this.plugin.client, this.plugin.device.folderSelection, (selection) => {
										this.plugin.device.folderSelection = selection;
										this.update();
									}).open();
								}),
							);
						},
					},
					{
						name: "Vault folder",
						desc: "Where notebooks go when no folder rule matches. The device's folders are mirrored inside it, without the Note folder.",
						control: { type: "folder", key: "vaultRoot" },
					},
					{
						name: "Split notebooks",
						desc: "One note per notebook, per title, or per page. For now every notebook syncs as one note; splitting arrives in a later version.",
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
				items: TITLE_STYLES.map((style, i) => ({
					name: style.label,
					desc:
						i === 0
							? "Titles in the styles you turn on start a new note; the rest become headings inside it. Splitting arrives in a later version."
							: undefined,
					visible: () => this.plugin.settings.splitMode === "title",
					render: (setting) => {
						setting.nameEl.prepend(
							createSpan({ cls: "snb-title-swatch", text: "Title", attr: { "data-style": style.code } }),
						);
						setting.addToggle((toggle) =>
							toggle.setValue(this.plugin.settings.splitTitleStyles.includes(style.code)).onChange(async (on) => {
								const others = this.plugin.settings.splitTitleStyles.filter((code) => code !== style.code);
								this.plugin.settings.splitTitleStyles = on ? [...others, style.code] : others;
								await this.plugin.saveSettings();
							}),
						);
					},
				})),
			},
			{
				type: "group",
				heading: "Advanced",
				items: [
					{
						name: "App token",
						desc: "Instead of signing in, use a token created on the server under settings → app tokens. Signing in takes precedence.",
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
				],
			},
		];
	}

	override getControlValue(key: string): unknown {
		const { settings, device } = this.plugin;
		if (key === "deviceName") return device.deviceName;
		if (key === "deviceSyncs") return device.syncsWithServer;
		return (settings as unknown as Record<string, unknown>)[key];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		const { settings, device } = this.plugin;
		if (key === "deviceName") {
			device.deviceName = String(value);
			return;
		}
		if (key === "deviceSyncs") {
			device.syncsWithServer = value === true;
			return;
		}
		(settings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
		// The title-style toggles show only in "Per title" mode.
		if (key === "splitMode") this.refreshDomState();
	}
}
