import { AbstractInputSuggest, type App, Modal, Notice, Setting, setIcon, type TFolder } from "obsidian";
import type { SupernoteClient } from "../api/client";
import { cleanPath, type FolderRule, folderLocation, folderSplit, ownRule, withRule } from "../sync/paths";
import { setFolder, subtreeState, type FolderSelection } from "../sync/selection";
import { applyMoves, placedNotes, planMoves } from "../vault/moveNotes";
import { SPLIT_LABELS, type SplitMode, type SupernoteBridgeSettings, TITLE_STYLES } from "./settings";

/** What the tree reads and writes. Selection is per device; rules are synced settings. */
export interface FolderTreeHost {
	app: App;
	client: SupernoteClient;
	canLoad(): boolean;
	selection(): FolderSelection;
	setSelection(selection: FolderSelection): void;
	settings(): SupernoteBridgeSettings;
	setRules(rules: FolderRule[]): Promise<void>;
}

interface FolderNode {
	id: string;
	path: string;
	name: string;
	children: FolderNode[] | null;
	expanded: boolean;
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
 * The server's folders, inline in settings. Each row has this device's sync
 * checkbox and shows where that folder's notebooks land and how they split;
 * clicking that opens the folder's own rule. Folders load as they're expanded,
 * and the tree keeps its state while the settings tab re-renders.
 */
export class FolderTree {
	private roots: FolderNode[] | null = null;
	private loadError: string | null = null;
	private loading = false;
	private openPath: string | null = null;
	private el: HTMLElement | null = null;

	constructor(private readonly host: FolderTreeHost) {}

	mount(el: HTMLElement): void {
		this.el = el;
		el.addClass("snb-folder-tree");
		if (this.roots === null && !this.loading && this.host.canLoad()) void this.loadRoots();
		this.render();
	}

	/** Forget loaded folders, e.g. after signing in or out. */
	reset(): void {
		this.roots = null;
		this.loadError = null;
	}

	private async loadRoots(): Promise<void> {
		this.loading = true;
		try {
			this.roots = await this.loadChildren("0", "");
			this.loadError = null;
		} catch (err) {
			this.loadError = (err as Error).message;
		} finally {
			this.loading = false;
			this.render();
		}
	}

	private async loadChildren(directoryId: string, parentPath: string): Promise<FolderNode[]> {
		const files = await this.host.client.listFolder(directoryId);
		return files
			.filter((file) => file.isFolder)
			.map((file) => ({ id: file.id, path: cleanPath(`${parentPath}/${file.fileName}`), name: file.fileName, children: null, expanded: false }));
	}

	private render(): void {
		const el = this.el;
		if (!el) return;
		el.empty();
		const note = (text: string) => el.createEl("p", { cls: "snb-muted", text });
		if (!this.host.canLoad()) return void note("Sign in to see the server's folders.");
		if (this.loadError !== null) return void note(`Couldn't load folders: ${this.loadError}`);
		if (this.roots === null) return void note("Loading folders…");
		if (this.roots.length === 0) return void note("No folders on the server.");
		for (const node of this.roots) this.renderNode(node, el, 0);
	}

	private renderNode(node: FolderNode, parent: HTMLElement, depth: number): void {
		const settings = this.host.settings();
		const row = parent.createDiv({ cls: "snb-folder-row" });
		row.setCssProps({ "--snb-depth": String(depth) });

		const toggle = row.createSpan({ cls: "snb-folder-toggle clickable-icon" });
		setIcon(toggle, node.expanded ? "chevron-down" : "chevron-right");
		toggle.setAttr("aria-label", node.expanded ? "Collapse" : "Expand");
		toggle.addEventListener("click", () => void this.toggleExpanded(node));

		const label = row.createEl("label", { cls: "snb-folder-label" });
		const box = label.createEl("input", { type: "checkbox" });
		const state = subtreeState(node.path, this.host.selection());
		box.checked = state === "on";
		box.indeterminate = state === "mixed";
		box.setAttr("aria-label", `Sync ${node.path} on this device`);
		box.addEventListener("change", () => {
			/* A mixed folder turns fully on, like a file manager's checkbox. */
			this.host.setSelection(setFolder(this.host.selection(), node.path, state !== "on"));
			this.render();
		});
		label.createSpan({ text: node.name });

		const own = ownRule(node.path, settings.folderRules);
		const split = folderSplit(node.path, settings);
		/* The destination is the button: clicking it opens this folder's rule. */
		const open = this.openPath === node.path;
		const summary = row.createEl("button", {
			cls: `snb-folder-summary${own ? " snb-own" : ""}${open ? " is-active" : ""}`,
			text: `→ ${folderLocation(node.path, settings.folderRules, settings.vaultRoot) || "/"} · ${SPLIT_LABELS[split.mode]}`,
		});
		summary.setAttr("aria-expanded", String(open));
		summary.setAttr("aria-label", `${own ? "Set on this folder" : "Inherited"}. Change where ${node.name} goes and how it splits`);
		summary.addEventListener("click", () => {
			this.openPath = open ? null : node.path;
			this.render();
		});

		if (this.openPath === node.path) this.renderPanel(node, parent, depth);

		if (node.expanded && node.children) {
			if (node.children.length === 0) {
				const empty = parent.createDiv({ cls: "snb-folder-row snb-muted", text: "No subfolders" });
				empty.setCssProps({ "--snb-depth": String(depth + 1) });
			}
			for (const child of node.children) this.renderNode(child, parent, depth + 1);
		}
	}

	private async toggleExpanded(node: FolderNode): Promise<void> {
		if (!node.expanded && node.children === null) {
			try {
				node.children = await this.loadChildren(node.id, node.path);
			} catch (err) {
				new Notice(`Couldn't load ${node.path}: ${(err as Error).message}`);
				return;
			}
		}
		node.expanded = !node.expanded;
		this.render();
	}

	/** The folder's own rule. Anything left empty is inherited, and the
	 *  inherited value shows as the placeholder. */
	private renderPanel(node: FolderNode, parent: HTMLElement, depth: number): void {
		const settings = this.host.settings();
		const rules = settings.folderRules;
		const own = ownRule(node.path, rules);
		const save = async (patch: Partial<Omit<FolderRule, "supernotePrefix">>) => {
			await this.host.setRules(withRule(this.host.settings().folderRules, node.path, patch));
			this.render();
		};
		const inheritedLocation = folderLocation(node.path, withRule(rules, node.path, { vaultFolder: "" }), settings.vaultRoot) || "/";
		const inheritedSplit = folderSplit(node.path, { ...settings, folderRules: withRule(rules, node.path, { splitMode: undefined }) });

		const panel = parent.createDiv({ cls: "snb-folder-panel" });
		panel.setCssProps({ "--snb-depth": String(depth + 1) });
		panel.createEl("p", {
			cls: "snb-muted",
			text: "Applies to this folder and its subfolders on every device. Leave a field empty to inherit it.",
		});

		new Setting(panel)
			.setName("Vault folder")
			.setDesc(`Subfolders are recreated inside it. Inherited: ${inheritedLocation}`)
			.addText((text) => {
				text.setPlaceholder(inheritedLocation).setValue(own?.vaultFolder ?? "");
				const commit = () => {
					const value = cleanPath(text.getValue());
					if (value !== (own?.vaultFolder ?? "")) void save({ vaultFolder: value });
				};
				text.inputEl.addEventListener("blur", commit);
				text.inputEl.addEventListener("keydown", (evt) => {
					if (evt.key === "Enter") commit();
				});
				new VaultFolderSuggest(this.host.app, text.inputEl).onSelect((folder) => {
					text.setValue(folder.path);
					commit();
				});
			});

		new Setting(panel)
			.setName("Split")
			.setDesc("Splitting by title or page arrives in a later version; until then every notebook syncs as one note.")
			.addDropdown((dropdown) => {
				dropdown.addOption("", `Inherit (${SPLIT_LABELS[inheritedSplit.mode]})`);
				for (const [mode, label] of Object.entries(SPLIT_LABELS)) dropdown.addOption(mode, label);
				dropdown.setValue(own?.splitMode ?? "").onChange((value) => {
					void save({ splitMode: value === "" ? undefined : (value as SplitMode) });
				});
			});

		if (own?.splitMode === "title") {
			const chosen = new Set(own.splitTitleStyles ?? settings.splitTitleStyles);
			for (const style of TITLE_STYLES) {
				const setting = new Setting(panel).setName(style.label).addToggle((toggle) =>
					toggle.setValue(chosen.has(style.code)).onChange((on) => {
						if (on) chosen.add(style.code);
						else chosen.delete(style.code);
						void save({ splitTitleStyles: TITLE_STYLES.map((s) => s.code).filter((code) => chosen.has(code)) });
					}),
				);
				setting.nameEl.prepend(createSpan({ cls: "snb-title-swatch", text: "Title", attr: { "data-style": style.code } }));
			}
		}

		if (own) {
			const actions = new Setting(panel);
			if (own.vaultFolder !== "") {
				actions.addButton((button) => button.setButtonText("Move existing notes here").onClick(() => this.moveNotesFor(own)));
			}
			actions.addButton((button) =>
				button.setButtonText("Reset to inherited").onClick(() => void save({ vaultFolder: "", splitMode: undefined })),
			);
		}
	}

	private moveNotesFor(rule: FolderRule): void {
		const { app } = this.host;
		const settings = this.host.settings();
		const moves = planMoves(placedNotes(app), settings.folderRules, settings.vaultRoot, rule);
		if (moves.length === 0) {
			new Notice("Every note for this folder is already in place.");
			return;
		}
		new ConfirmMoveModal(
			app,
			moves.map((move) => move.from),
			rule.vaultFolder,
			() =>
				void applyMoves(app, moves).then(({ moved, skipped }) => {
					const tail = skipped.length ? ` ${skipped.length} stayed put because their new path was taken: ${skipped.join(", ")}.` : "";
					new Notice(`Moved ${moved} ${moved === 1 ? "note" : "notes"}.${tail}`, skipped.length ? 15000 : 5000);
				}),
		).open();
	}
}

/** Ask before moving notes, listing a few of them. Fields are prefixed `snb`:
 *  Obsidian's Modal keeps its own state on the instance (it overwrites
 *  `selection` on open). */
class ConfirmMoveModal extends Modal {
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
		const list = this.contentEl.createEl("ul");
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
