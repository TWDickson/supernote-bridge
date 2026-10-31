import { type App, Modal, Notice, setIcon } from "obsidian";
import type { SupernoteClient } from "../api/client";
import { cleanPath } from "../sync/paths";
import { setFolder, subtreeState, type FolderSelection } from "../sync/selection";

interface FolderNode {
	id: string;
	path: string;
	name: string;
	children: FolderNode[] | null;
	expanded: boolean;
}

/** Pick which device folders this device syncs, from the server's real tree.
 *  Folders load as they're expanded. */
export class FolderPickerModal extends Modal {
	private selection: FolderSelection;
	private roots: FolderNode[] | null = null;
	private listEl!: HTMLElement;

	constructor(
		app: App,
		private readonly client: SupernoteClient,
		initial: FolderSelection,
		private readonly onSave: (selection: FolderSelection) => void,
	) {
		super(app);
		this.selection = { include: [...initial.include], exclude: [...initial.exclude] };
	}

	override async onOpen(): Promise<void> {
		this.setTitle("Folders to sync on this device");
		this.contentEl.addClass("snb-folder-picker");
		this.contentEl.createEl("p", {
			cls: "setting-item-description",
			text: "Notes already in your vault for a folder you turn off are kept; they just stop updating.",
		});
		this.listEl = this.contentEl.createDiv({ cls: "snb-folder-list" });
		this.listEl.createEl("p", { cls: "snb-muted", text: "Loading folders…" });

		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		const save = buttons.createEl("button", { cls: "mod-cta", text: "Save" });
		save.addEventListener("click", () => {
			this.onSave(this.selection);
			this.close();
		});

		try {
			this.roots = await this.loadChildren("0", "");
			this.render();
		} catch (err) {
			this.listEl.empty();
			this.listEl.createEl("p", { cls: "snb-muted", text: `Couldn't load folders: ${(err as Error).message}` });
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private async loadChildren(directoryId: string, parentPath: string): Promise<FolderNode[]> {
		const files = await this.client.listFolder(directoryId);
		return files
			.filter((file) => file.isFolder)
			.map((file) => ({
				id: file.id,
				path: cleanPath(`${parentPath}/${file.fileName}`),
				name: file.fileName,
				children: null,
				expanded: false,
			}));
	}

	private render(): void {
		this.listEl.empty();
		if (!this.roots?.length) {
			this.listEl.createEl("p", { cls: "snb-muted", text: "No folders on the server." });
			return;
		}
		for (const node of this.roots) this.renderNode(node, this.listEl, 0);
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

	private renderNode(node: FolderNode, parent: HTMLElement, depth: number): void {
		const row = parent.createDiv({ cls: "snb-folder-row" });
		row.setCssProps({ "--snb-depth": String(depth) });

		const toggle = row.createSpan({ cls: "snb-folder-toggle clickable-icon" });
		setIcon(toggle, node.expanded ? "chevron-down" : "chevron-right");
		toggle.setAttr("aria-label", node.expanded ? "Collapse" : "Expand");
		toggle.addEventListener("click", () => void this.toggleExpanded(node));

		const label = row.createEl("label", { cls: "snb-folder-label" });
		const box = label.createEl("input", { type: "checkbox" });
		const state = subtreeState(node.path, this.selection);
		box.checked = state === "on";
		box.indeterminate = state === "mixed";
		box.addEventListener("change", () => {
			/* A mixed folder turns fully on, like a file manager's checkbox. */
			this.selection = setFolder(this.selection, node.path, state !== "on");
			this.render();
		});
		label.createSpan({ text: node.name });

		if (node.expanded && node.children) {
			if (node.children.length === 0) {
				const empty = parent.createDiv({ cls: "snb-folder-row snb-muted", text: "No subfolders" });
				empty.setCssProps({ "--snb-depth": String(depth + 1) });
			}
			for (const child of node.children) this.renderNode(child, parent, depth + 1);
		}
	}
}
