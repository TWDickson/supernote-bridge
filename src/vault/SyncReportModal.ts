import { type App, Modal, Notice, Setting, TFile } from "obsidian";
import type { NoteReport, PageRef, SyncReport } from "./SyncRunner";

/** What the report needs from the plugin. */
export interface ReportHost {
	app: App;
	report(): SyncReport | null;
	/** Take the server's text for these pages, after the user confirmed, and
	 *  drop them from the stored report. */
	takeServerText(path: string, pages: readonly PageRef[]): Promise<void>;
}

const pageList = (pages: readonly PageRef[]) => pages.map((p) => `page ${p.page}`).join(", ");

/**
 * The last sync on this device, note by note: what changed, which edited
 * pages were kept (and whether the server also changed them), and links that
 * no longer fit. Kept pages can be given the server's text from here.
 * Fields are prefixed `snb`: Obsidian's Modal keeps its own state on the instance.
 */
export class SyncReportModal extends Modal {
	constructor(private readonly snbHost: ReportHost) {
		super(snbHost.app);
	}

	override onOpen(): void {
		this.setTitle("Last Supernote sync");
		this.snbRender();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private snbRender(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("snb-report");
		const report = this.snbHost.report();
		if (!report) {
			contentEl.createEl("p", { cls: "snb-muted", text: "This device hasn't synced yet." });
			return;
		}

		contentEl.createEl("p", {
			cls: "snb-muted",
			text: `${new Date(report.at).toLocaleString()} · ${report.created} new, ${report.updated} updated, ${report.unchanged} unchanged${
				report.waitingForOcr ? `, ${report.waitingForOcr} waiting for OCR` : ""
			}.`,
		});

		const conflicts = report.notes.filter((n) => n.conflicts.length);
		const edited = report.notes.filter((n) => n.edited.length);
		const lost = report.notes.filter((n) => n.lostMarkup.length);
		const changed = report.notes.filter((n) => n.created || n.updatedPages);

		if (conflicts.length) {
			this.snbSection(
				"Edited here and changed on the server",
				"Your edits were kept. The server has newer text for these pages, for example from a re-read.",
			);
			for (const note of conflicts) this.snbPagesRow(note, note.conflicts);
		}
		if (edited.length) {
			this.snbSection("Edited here", "Kept as you wrote them; they'll be offered for sending back once that's supported.");
			for (const note of edited) this.snbPagesRow(note, note.edited);
		}
		if (lost.length) {
			this.snbSection("Links and tags that no longer fit", "Their words left the page when the server's text changed.");
			for (const note of lost) {
				const setting = this.snbNoteRow(note);
				setting.setDesc(note.lostMarkup.map((m) => `page ${m.page}: ${m.markup}`).join(" · "));
			}
		}
		if (report.errors.length) {
			this.snbSection("Errors", "");
			const list = contentEl.createEl("ul");
			for (const error of report.errors) list.createEl("li", { text: error });
		}
		if (changed.length) {
			const details = contentEl.createEl("details", { cls: "snb-report-changed" });
			details.createEl("summary", { text: `${changed.length} ${changed.length === 1 ? "note" : "notes"} written` });
			for (const note of changed) {
				const setting = new Setting(details).setName(note.path).setDesc(note.created ? "New" : `${note.updatedPages} pages updated`);
				setting.addExtraButton((button) => button.setIcon("file-text").setTooltip("Open").onClick(() => this.snbOpen(note.path)));
			}
		}
		if (!conflicts.length && !edited.length && !lost.length && !report.errors.length && !changed.length) {
			contentEl.createEl("p", { text: "Nothing changed." });
		}
	}

	private snbSection(heading: string, desc: string): void {
		this.contentEl.createEl("h4", { text: heading });
		if (desc) this.contentEl.createEl("p", { cls: "setting-item-description", text: desc });
	}

	private snbNoteRow(note: NoteReport): Setting {
		const setting = new Setting(this.contentEl).setName(note.path);
		setting.addExtraButton((button) => button.setIcon("file-text").setTooltip("Open").onClick(() => this.snbOpen(note.path)));
		return setting;
	}

	private snbPagesRow(note: NoteReport, pages: PageRef[]): void {
		this.snbNoteRow(note)
			.setDesc(pageList(pages))
			.addButton((button) =>
				button.setButtonText("Take server text").onClick(() => {
					new ConfirmModal(
						this.app,
						`Replace your edits on ${pageList(pages)}?`,
						`${note.path}: these pages get the server's current text. Links and tags you added stay where their words still are; any other change you made to them is lost.`,
						"Replace",
						() =>
							void this.snbHost.takeServerText(note.path, pages).then(() => this.snbRender()),
					).open();
				}),
			);
	}

	private snbOpen(path: string): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(`${path} isn't in the vault any more.`);
			return;
		}
		void this.app.workspace.getLeaf(false).openFile(file);
		this.close();
	}
}

/** A yes/no question before something that can't be undone. */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly snbTitle: string,
		private readonly snbBody: string,
		private readonly snbAction: string,
		private readonly snbConfirm: () => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(this.snbTitle);
		this.contentEl.createEl("p", { text: this.snbBody });
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText(this.snbAction)
					.setDestructive()
					.setCta()
					.onClick(() => {
						this.close();
						this.snbConfirm();
					}),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
