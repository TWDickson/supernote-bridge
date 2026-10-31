import { Notice, Plugin } from "obsidian";
import { SupernoteClient } from "./api/client";
import { AuthManager } from "./auth/AuthManager";
import { CALLBACK_ACTION } from "./auth/oauth";
import { DeviceStore } from "./device";
import { normalizeSettings, type SupernoteBridgeSettings } from "./settings/settings";
import { SupernoteBridgeSettingTab } from "./settings/SettingsTab";
import { SyncRunner, type SyncReport } from "./vault/SyncRunner";

export default class SupernoteBridgePlugin extends Plugin {
	declare settings: SupernoteBridgeSettings;
	device!: DeviceStore;
	auth!: AuthManager;
	client!: SupernoteClient;
	private runner!: SyncRunner;
	private settingTab!: SupernoteBridgeSettingTab;
	private syncing = false;
	private statusBar: HTMLElement | null = null;

	override async onload(): Promise<void> {
		this.device = new DeviceStore(this.app);
		await this.loadSettings();
		this.auth = new AuthManager(
			this.app,
			this.device,
			() => this.settings.serverUrl,
			() => this.settings.tokenSecretId,
		);
		this.client = new SupernoteClient(
			() => this.settings.serverUrl,
			(forceRefresh) => this.auth.bearer(forceRefresh),
		);
		this.runner = new SyncRunner(
			this.app,
			this.client,
			() => this.settings,
			() => this.device.folderSelection,
		);

		this.settingTab = new SupernoteBridgeSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.registerObsidianProtocolHandler(CALLBACK_ACTION, async (params) => {
			try {
				await this.auth.handleCallback(params);
				this.device.syncsWithServer = true;
				new Notice("Signed in. This device now syncs your notebooks; use the sync command or the ribbon button to pull them.");
			} catch (err) {
				new Notice((err as Error).message);
			}
			this.settingTab.update();
		});

		this.addCommand({ id: "sync-now", name: "Sync now", callback: () => void this.sync() });
		this.addCommand({
			id: "sign-in",
			name: "Sign in to the sync server",
			checkCallback: (checking) => {
				if (this.auth.isSignedIn()) return false;
				if (!checking) void this.auth.signIn().catch((err: Error) => new Notice(err.message));
				return true;
			},
		});
		this.addCommand({
			id: "sign-out",
			name: "Sign out of the sync server",
			checkCallback: (checking) => {
				if (!this.auth.isSignedIn()) return false;
				if (!checking) void this.auth.signOut().then(() => new Notice("Signed out."));
				return true;
			},
		});
		this.addRibbonIcon("refresh-cw", "Sync Supernote notebooks", () => void this.sync());

		this.statusBar = this.addStatusBarItem();
		this.showLastSync();
	}

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as { syncFolders?: unknown } | null;
		this.settings = normalizeSettings(raw);
		this.adoptSyncedFolderList(raw?.syncFolders);
	}

	/* 0.1.0 kept the folder list in the synced settings. A device that has no
	   choice of its own starts from that list. */
	private adoptSyncedFolderList(folders: unknown): void {
		if (this.device.hasFolderSelection() || !Array.isArray(folders)) return;
		const include = folders.filter((f): f is string => typeof f === "string" && f.trim() !== "");
		if (include.length > 0) this.device.folderSelection = { include, exclude: [] };
	}

	async saveSettings(): Promise<void> {
		/* In place: the settings tab holds a reference to this object. */
		Object.assign(this.settings, normalizeSettings(this.settings));
		await this.saveData(this.settings);
	}

	async sync(): Promise<void> {
		if (this.syncing) {
			new Notice("A sync is already running.");
			return;
		}
		if (!this.device.syncsWithServer) {
			new Notice("This device doesn't sync with the server. Turn it on in the plugin settings, on one device only.");
			return;
		}
		if (!this.auth.isSignedIn() && !this.auth.hasAppToken()) {
			new Notice("Sign in to the sync server first, in the plugin settings.");
			return;
		}
		this.syncing = true;
		this.statusBar?.setText("Supernote: syncing…");
		try {
			const report = await this.runner.run();
			this.device.lastSync = Date.now();
			new Notice(summarize(report), report.errors.length || report.conflicts.length ? 15000 : 5000);
			if (report.errors.length) console.error("Supernote Bridge sync errors:", report.errors);
		} catch (err) {
			new Notice(`Sync failed: ${(err as Error).message}`);
		} finally {
			this.syncing = false;
			this.showLastSync();
		}
	}

	private showLastSync(): void {
		const last = this.device.lastSync;
		this.statusBar?.setText(last ? `Supernote: synced ${new Date(last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "");
	}
}

function summarize(report: SyncReport): string {
	const lines = [
		`Supernote: ${report.created} new, ${report.updated} updated, ${report.unchanged} unchanged.`,
	];
	if (report.waitingForOcr) lines.push(`${report.waitingForOcr} waiting for OCR.`);
	if (report.localEdits) lines.push(`${report.localEdits} corrected pages kept.`);
	if (report.conflicts.length) {
		lines.push(`Kept your edits where the server also changed: ${report.conflicts.join(", ")}.`);
	}
	if (report.errors.length) lines.push(`${report.errors.length} failed — see the developer console.`);
	return lines.join("\n");
}
