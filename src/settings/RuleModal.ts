import { AbstractInputSuggest, type App, FuzzySuggestModal, Modal, Notice, Setting, type TFolder } from "obsidian";
import type { SupernoteClient } from "../api/client";
import { cleanPath, type FolderRule } from "../sync/paths";
import { type SplitMode, TITLE_STYLES } from "./settings";

export const SPLIT_LABELS: Record<SplitMode, string> = {
	notebook: "Per notebook",
	title: "Per title",
	page: "Per page",
};

/** Every folder on the server, as device paths such as `Note/Work/Weeks`. */
async function serverFolders(client: SupernoteClient): Promise<string[]> {
	const found: string[] = [];
	const walk = async (id: string, prefix: string): Promise<void> => {
		for (const file of await client.listFolder(id)) {
			if (!file.isFolder) continue;
			const path = cleanPath(`${prefix}/${file.fileName}`);
			found.push(path);
			await walk(file.id, path);
		}
	};
	await walk("0", "");
	return found.sort();
}

class ServerFolderModal extends FuzzySuggestModal<string> {
	constructor(
		app: App,
		private readonly snbFolders: string[],
		private readonly snbChoose: (path: string) => void,
	) {
		super(app);
		this.setPlaceholder("Device folder");
	}
	getItems(): string[] {
		return this.snbFolders;
	}
	getItemText(path: string): string {
		return path;
	}
	onChooseItem(path: string): void {
		this.snbChoose(path);
	}
}

class VaultFolderSuggest extends AbstractInputSuggest<TFolder> {
	protected getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault.getAllFolders(false).filter((folder) => folder.path.toLowerCase().includes(q));
	}
	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}
}

/**
 * Add or edit a folder rule: which device folder, where its notebooks go in
 * the vault, and how they split. Fields here are prefixed `snb`: Obsidian's
 * Modal keeps its own state on the instance (it overwrites `selection` on open).
 */
export class RuleModal extends Modal {
	private snbRule: FolderRule;
	private snbStylesEl!: HTMLElement;
	/** Fills the device-folder field; set once that field exists. */
	private snbBrowse: (path: string) => void = () => {};

	constructor(
		app: App,
		private readonly snbClient: SupernoteClient,
		existing: FolderRule | null,
		private readonly snbDefaults: { mode: SplitMode; titleStyles: string[] },
		private readonly snbOtherPrefixes: string[],
		private readonly snbSave: (rule: FolderRule) => void,
	) {
		super(app);
		this.snbRule = existing ? { ...existing } : { supernotePrefix: "", vaultFolder: "" };
	}

	override onOpen(): void {
		this.setTitle(this.snbRule.supernotePrefix ? "Edit folder rule" : "Add folder rule");
		const { contentEl } = this;

		new Setting(contentEl)
			.setName("Device folder")
			.setDesc("Notebooks in this folder and its subfolders follow this rule, unless a rule for a subfolder is more specific.")
			.addText((text) => {
				text.setPlaceholder("Choose or type a path").setValue(this.snbRule.supernotePrefix);
				text.onChange((value) => (this.snbRule.supernotePrefix = cleanPath(value)));
				this.snbBrowse = (path) => {
					text.setValue(path);
					this.snbRule.supernotePrefix = path;
				};
			})
			.addButton((button) =>
				button.setButtonText("Browse…").onClick(async () => {
					button.setDisabled(true);
					try {
						new ServerFolderModal(this.app, await serverFolders(this.snbClient), (path) => this.snbBrowse(path)).open();
					} catch (err) {
						new Notice(`Couldn't load the server's folders: ${(err as Error).message}`);
					} finally {
						button.setDisabled(false);
					}
				}),
			);

		new Setting(contentEl)
			.setName("Vault folder")
			.setDesc("Where those notebooks go. Their subfolders are recreated inside it.")
			.addText((text) => {
				text.setPlaceholder("Choose or type a path").setValue(this.snbRule.vaultFolder);
				text.onChange((value) => (this.snbRule.vaultFolder = cleanPath(value)));
				new VaultFolderSuggest(this.app, text.inputEl).onSelect((folder) => {
					text.setValue(folder.path);
					this.snbRule.vaultFolder = folder.path;
				});
			});

		new Setting(contentEl)
			.setName("Split")
			.setDesc("Splitting by title or page arrives in a later version; until then every notebook syncs as one note.")
			.addDropdown((dropdown) => {
				dropdown.addOption("", `Default (${SPLIT_LABELS[this.snbDefaults.mode]})`);
				for (const [mode, label] of Object.entries(SPLIT_LABELS)) dropdown.addOption(mode, label);
				dropdown.setValue(this.snbRule.splitMode ?? "").onChange((value) => {
					if (value === "") delete this.snbRule.splitMode;
					else this.snbRule.splitMode = value as SplitMode;
					this.snbRenderStyles();
				});
			});

		this.snbStylesEl = contentEl.createDiv();
		this.snbRenderStyles();

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => button.setButtonText("Save").setCta().onClick(() => this.snbTrySave()));
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private snbRenderStyles(): void {
		this.snbStylesEl.empty();
		if (this.snbRule.splitMode !== "title") return;
		const chosen = new Set(this.snbRule.splitTitleStyles ?? this.snbDefaults.titleStyles);
		for (const style of TITLE_STYLES) {
			const setting = new Setting(this.snbStylesEl).setName(style.label).addToggle((toggle) =>
				toggle.setValue(chosen.has(style.code)).onChange((on) => {
					if (on) chosen.add(style.code);
					else chosen.delete(style.code);
					this.snbRule.splitTitleStyles = TITLE_STYLES.map((s) => s.code).filter((code) => chosen.has(code));
				}),
			);
			setting.nameEl.prepend(createSpan({ cls: "snb-title-swatch", text: "Title", attr: { "data-style": style.code } }));
		}
	}

	private snbTrySave(): void {
		const rule = this.snbRule;
		if (rule.supernotePrefix === "" || rule.vaultFolder === "") {
			new Notice("Choose both a device folder and a vault folder.");
			return;
		}
		if (this.snbOtherPrefixes.includes(rule.supernotePrefix)) {
			new Notice(`There's already a rule for ${rule.supernotePrefix}.`);
			return;
		}
		if (rule.splitMode !== "title") delete rule.splitTitleStyles;
		this.snbSave(rule);
		this.close();
	}
}

/** Ask before moving notes, listing a few of them. */
export class ConfirmMoveModal extends Modal {
	constructor(
		app: App,
		private readonly snbFrom: string[],
		private readonly snbTarget: string,
		private readonly snbConfirm: () => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const count = this.snbFrom.length;
		this.setTitle(`Move ${count} ${count === 1 ? "note" : "notes"} to ${this.snbTarget}?`);
		this.contentEl.createEl("p", {
			cls: "setting-item-description",
			text: "Links to them are updated. A note whose new path is already taken stays where it is.",
		});
		const list = this.contentEl.createEl("ul", { cls: "snb-move-list" });
		for (const path of this.snbFrom.slice(0, 8)) list.createEl("li", { text: path });
		if (count > 8) list.createEl("li", { cls: "snb-muted", text: `and ${count - 8} more` });
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText("Move")
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
