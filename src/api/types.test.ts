import { describe, expect, it } from "vitest";
import { fileIdBody, listFolderBody, parseServerFile } from "./types";

describe("request bodies", () => {
	it("keeps 64-bit ids exact", () => {
		const id = "770747265093468819";
		expect(fileIdBody(id)).toBe('{"fileId":770747265093468819}');
		expect(JSON.stringify({ fileId: Number(id) })).not.toContain(id);
		expect(JSON.parse(listFolderBody("0", 2, 100))).toMatchObject({ directoryId: 0, pageNo: 2, pageSize: 100 });
	});

	it("refuses anything that isn't digits", () => {
		expect(() => fileIdBody('1,"x":2')).toThrow();
	});
});

describe("parseServerFile", () => {
	it("reads the web API's file entry", () => {
		expect(
			parseServerFile({ id: "5", directoryId: "0", fileName: "Plan.note", isFolder: "N", md5: "abc", updateTime: 7 }),
		).toEqual({ id: "5", directoryId: "0", fileName: "Plan.note", isFolder: false, md5: "abc", updateTime: 7 });
		expect(parseServerFile({ id: 5 })).toBeNull();
	});
});
