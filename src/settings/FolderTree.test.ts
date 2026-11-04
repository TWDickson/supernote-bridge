import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { FakeEl } from "../__mocks__/obsidian";
import type { SupernoteClient } from "../api/client";
import type { ServerFile } from "../api/types";
import type { FolderRule } from "../sync/paths";
import type { FolderSelection } from "../sync/selection";
import { FolderTree } from "./FolderTree";
import { DEFAULT_SETTINGS } from "./settings";

const folder = (id: string, fileName: string): ServerFile => ({ id, directoryId: "0", fileName, isFolder: true, md5: null, updateTime: null });
const tree: Record<string, ServerFile[]> = {
	"0": [folder("1", "Document"), folder("2", "Note")],
	"2": [folder("3", "Journal"), folder("4", "Work")],
};
const client = { listFolder: async (id: string) => tree[id] ?? [] } as unknown as SupernoteClient;

function mountTree(rules: FolderRule[] = []) {
	let selection: FolderSelection = { include: ["Note"], exclude: ["Note/Journal"] };
	const settings = { ...DEFAULT_SETTINGS, folderRules: rules };
	const host = {
		app: {} as App,
		client,
		canLoad: () => true,
		selection: () => selection,
		setSelection: vi.fn((next: FolderSelection) => (selection = next)),
		settings: () => settings,
		setRules: vi.fn(async () => {}),
	};
	return { host, tree: new FolderTree(host), selection: () => selection };
}

async function rendered(el: FakeEl, until: (els: FakeEl[]) => boolean): Promise<FakeEl[]> {
	await vi.waitFor(() => expect(until(el.all())).toBe(true));
	return el.all();
}

describe("FolderTree", () => {
	it("shows each folder with this device's checkbox and where it goes", async () => {
		const el = new FakeEl();
		const { tree: t } = mountTree();
		t.mount(el as unknown as HTMLElement);

		const els = await rendered(el, (all) => all.some((e) => e.tag === "input"));
		/* Note is on except Journal, so its box is partly ticked. */
		const boxes = els.filter((e) => e.tag === "input");
		expect(boxes.map((b) => [b.checked, b.indeterminate])).toEqual([[false, false], [false, true]]);
		/* Only folders this device syncs show where they go; the default split isn't repeated. */
		expect(els.filter((e) => e.tag === "button").map((b) => b.text)).toEqual(["→ Supernote"]);
	});

	it("marks a folder with its own rule, and expands to its subfolders", async () => {
		const el = new FakeEl();
		const { tree: t } = mountTree([{ supernotePrefix: "Note/Work", vaultFolder: "Work/Planners", splitMode: "page" }]);
		t.mount(el as unknown as HTMLElement);
		const first = await rendered(el, (all) => all.some((e) => e.tag === "input"));

		first.filter((e) => e.cls.includes("snb-folder-toggle"))[1]?.fire("click");
		const els = await rendered(el, (all) => all.filter((e) => e.tag === "input").length === 4);

		const summaries = els.filter((e) => e.tag === "button");
		expect(summaries.map((b) => b.text)).toEqual(["→ Supernote", "→ Work/Planners · Per page"]);
		expect(summaries[1]?.cls).toContain("snb-own");
		expect(els.filter((e) => e.tag === "input").map((b) => b.checked)).toEqual([false, false, false, true]);
	});

	it("saves this device's choice when a box is ticked", async () => {
		const el = new FakeEl();
		const { tree: t, host, selection } = mountTree();
		t.mount(el as unknown as HTMLElement);
		const els = await rendered(el, (all) => all.some((e) => e.tag === "input"));

		els.filter((e) => e.tag === "input")[0]?.fire("change");
		expect(host.setSelection).toHaveBeenCalledOnce();
		expect(selection().include).toContain("Document");
	});
});

describe("FolderTree leaves", () => {
	it("hide their chevron once they're known to have no subfolders, keeping rows aligned", async () => {
		const el = new FakeEl();
		const { tree: t } = mountTree();
		t.mount(el as unknown as HTMLElement);
		await vi.waitFor(() => {
			const toggles = el.all().filter((e) => e.cls.includes("snb-folder-toggle"));
			expect(toggles.map((e) => e.cls.includes("is-leaf"))).toEqual([true, false]);
		});
	});
});

describe("FolderTree settings panels", () => {
	it("open independently, so a folder and its subfolder show together", async () => {
		const el = new FakeEl();
		const { tree: t } = mountTree();
		t.mount(el as unknown as HTMLElement);
		const first = await rendered(el, (all) => all.some((e) => e.tag === "input"));
		first.filter((e) => e.cls.includes("snb-folder-toggle"))[1]?.fire("click");
		await rendered(el, (all) => all.filter((e) => e.tag === "input").length === 4);

		const open = (text: string) => el.all().find((e) => e.tag === "button" && e.text === text)?.fire("click");
		open("→ Supernote");
		open("→ Supernote/Work");

		const panels = () => el.all().filter((e) => e.cls.includes("snb-folder-panel")).length;
		expect(panels()).toBe(2);
		open("→ Supernote");
		expect(panels()).toBe(1);
	});
});
