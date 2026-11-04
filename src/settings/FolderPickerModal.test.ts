import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { FakeEl } from "../__mocks__/obsidian";
import type { SupernoteClient } from "../api/client";
import type { ServerFile } from "../api/types";
import { FolderPickerModal } from "./FolderPickerModal";
import type { FolderSelection } from "../sync/selection";

const folder = (id: string, fileName: string): ServerFile => ({
	id,
	directoryId: "0",
	fileName,
	isFolder: true,
	md5: null,
	updateTime: null,
});

const client = { listFolder: async () => [folder("1", "Document"), folder("2", "Note")] } as unknown as SupernoteClient;

describe("FolderPickerModal", () => {
	it("lists folders and saves the choice after Modal.open() runs", async () => {
		let saved: FolderSelection | null = null;
		const modal = new FolderPickerModal({} as App, client, { include: ["Note"], exclude: [] }, (s) => (saved = s));
		modal.open();
		const root = modal.contentEl as unknown as FakeEl;
		await vi.waitFor(() => expect(root.all().some((el) => el.text.includes("Loading"))).toBe(false));

		const els = root.all();
		expect(els.some((el) => el.text.startsWith("Couldn't load folders"))).toBe(false);
		const boxes = els.filter((el) => el.tag === "input");
		expect(boxes.map((b) => b.checked)).toEqual([false, true]);

		boxes[0]?.fire("change");
		els.find((el) => el.text === "Save")?.fire("click");
		expect(saved).toEqual({ include: ["Document", "Note"], exclude: [] });
	});
});
