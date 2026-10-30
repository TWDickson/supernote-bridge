import { type App, Notice, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type SupernoteBridgePlugin from "../main";
import { TITLE_STYLES, type SupernoteBridgeSettings } from "./settings";

/* Settings that aren't a plain field of the synced settings get a virtual key,
   mapped in getControlValue / setControlValue. */
type StyleKey = `splitTitleStyle${(typeof TITLE_STYLES)[number]}`;
type DeviceKey = "deviceName" | "deviceSyncs";
type SettingKey = keyof SupernoteBridgeSettings | StyleKey | DeviceKey;

const STYLE_KEY_PATTERN = /^splitTitleStyle(\d)$/;

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
				items: TITLE_STYLES.map((style) => ({
					name: `Title style ${style}`,
					desc: style === 1 ? "Titles in the styles you turn on here start a new note. Other titles become headings inside it." : undefined,
					visible: () => this.plugin.settings.splitMode === "title",
					control: { type: "toggle" as const, key: `splitTitleStyle${style}` as const },
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
		const style = STYLE_KEY_PATTERN.exec(key);
		if (style) return settings.splitTitleStyles.includes(Number(style[1]));
		if (key === "syncFolders") return settings.syncFolders.join(", ");
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
