import { type Editor, type MarkdownFileInfo, type MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { SupernoteClient } from "./api/client";
import { AuthManager } from "./auth/AuthManager";
import { CALLBACK_ACTION } from "./auth/oauth";
import { DeviceStore } from "./device";
import { hideMarkers } from "./editor/hideMarkers";
import { normalizeSettings, type SupernoteBridgeSettings } from "./settings/settings";
import { SupernoteBridgeSettingTab } from "./settings/SettingsTab";
import { settleObsidianSync } from "./vault/obsidianSync";
import { isLocallyEdited, parseBlocks } from "./sync/blocks";
import { FM } from "./sync/schema";
import { ConfirmModal, SyncReportModal } from "./vault/SyncReportModal";
import { type PageRef, SyncRunner, type SyncReport } from "./vault/SyncRunner";

/** How long a sync waits for Obsidian Sync to finish bringing in changes. */
const OBSIDIAN_SYNC_WAIT_MS = 60_000;

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

		this.registerEditorExtension(hideMarkers());

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
			this.settingTab.refreshFolders();
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
		this.addCommand({ id: "show-sync-report", name: "Show the last sync report", callback: () => this.openReport() });
		this.addCommand({
			id: "take-server-text-at-cursor",
			name: "Take the server's text for the page at the cursor",
			editorCheckCallback: (checking, editor, ctx) => this.takeServerTextCommand(checking, editor, ctx, "cursor"),
		});
		this.addCommand({
			id: "take-server-text-all",
			name: "Take the server's text for every page edited in this note",
			editorCheckCallback: (checking, editor, ctx) => this.takeServerTextCommand(checking, editor, ctx, "all"),
		});
		this.addRibbonIcon("refresh-cw", "Sync Supernote notebooks", () => void this.sync());

		this.statusBar = this.addStatusBarItem();
		this.statusBar.addClass("mod-clickable");
		this.statusBar.setAttr("aria-label", "Show the last sync report");
		this.statusBar.addEventListener("click", () => this.openReport());
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
			new Notice("This device doesn't sync with the server. Turn it on in the plugin settings.");
			return;
		}
		if (!this.auth.isSignedIn() && !this.auth.hasAppToken()) {
			new Notice("Sign in to the sync server first, in the plugin settings.");
			return;
		}
		this.syncing = true;
		try {
			const obsidianSync = await settleObsidianSync(this.app, OBSIDIAN_SYNC_WAIT_MS, () =>
				this.statusBar?.setText("Supernote: waiting for Obsidian Sync…"),
			);
			if (obsidianSync === "syncing") {
				new Notice("Obsidian Sync is still bringing in changes. Try the Supernote sync again once it's done.");
				return;
			}
			if (obsidianSync === "paused" || obsidianSync === "error" || obsidianSync === "disconnected") {
				new Notice(`Obsidian Sync is ${obsidianSync}, so edits from your other devices may not be here yet. Syncing from the server anyway.`);
			}
			this.statusBar?.setText("Supernote: syncing…");
			const report = await this.runner.run();
			this.device.lastSync = report.at;
			this.device.lastReport = report;
			const notice = new Notice(
				`${summarize(report)}\nClick for the full report.`,
				report.errors.length || report.conflicts.length || report.lostMarkup.length ? 15000 : 5000,
			);
			notice.messageEl.addEventListener("click", () => this.openReport());
			if (report.errors.length) console.error("Supernote Bridge sync errors:", report.errors);
		} catch (err) {
			new Notice(`Sync failed: ${(err as Error).message}`);
		} finally {
			this.syncing = false;
			this.showLastSync();
		}
	}

	private openReport(): void {
		new SyncReportModal({
			app: this.app,
			report: () => this.device.lastReport,
			takeServerText: (path, pages) => this.takeServerText(path, pages),
		}).open();
	}

	/** Drop the Obsidian edits on these pages for the server's text, and take
	 *  them off the stored report. */
	async takeServerText(path: string, pages: readonly PageRef[]): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(`${path} isn't in the vault any more.`);
			return;
		}
		if (!this.auth.isSignedIn() && !this.auth.hasAppToken()) {
			new Notice("Sign in to the sync server first, in the plugin settings.");
			return;
		}
		try {
			const changed = await this.runner.takeServerText(file, pages.map((p) => p.pageId));
			new Notice(changed ? `Took the server's text for ${changed} ${changed === 1 ? "page" : "pages"}.` : "Those pages already match the server.");
		} catch (err) {
			new Notice(`Couldn't take the server's text: ${(err as Error).message}`);
			return;
		}
		const report = this.device.lastReport;
		if (report) {
			const ids = new Set(pages.map((p) => p.pageId));
			for (const note of report.notes.filter((n) => n.path === path)) {
				note.edited = note.edited.filter((p) => !ids.has(p.pageId));
				note.conflicts = note.conflicts.filter((p) => !ids.has(p.pageId));
			}
			this.device.lastReport = report;
		}
	}

	/** Edited pages in a synced note: the one at the cursor, or all of them. */
	private takeServerTextCommand(checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo, scope: "cursor" | "all"): boolean {
		const file = ctx.file;
		if (!file || this.app.metadataCache.getFileCache(file)?.frontmatter?.[FM.fileId] === undefined) return false;
		const blocks = parseBlocks(editor.getValue());
		const offset = editor.posToOffset(editor.getCursor());
		const pages: PageRef[] = blocks
			.map((block, i) => ({ block, ref: { pageId: block.pageId, page: i + 1 } }))
			.filter(({ block }) => isLocallyEdited(block) && (scope === "all" || (offset >= block.start && offset <= block.end)))
			.map(({ ref }) => ref);
		if (pages.length === 0) return false;
		if (!checking) {
			const what = scope === "all" ? `all ${pages.length} edited ${pages.length === 1 ? "page" : "pages"}` : "this page";
			new ConfirmModal(
				this.app,
				`Replace your edits on ${what}?`,
				"They get the server's current text. Links and tags you added stay where their words still are; any other change you made is lost.",
				"Replace",
				() => void this.takeServerText(file.path, pages),
			).open();
		}
		return true;
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
	if (report.lostMarkup.length) {
		lines.push(`${report.lostMarkup.length} links or tags no longer fit the updated text: ${report.lostMarkup.join("; ")}.`);
	}
	if (report.errors.length) lines.push(`${report.errors.length} failed — see the developer console.`);
	return lines.join("\n");
}
