/* Shapes of the server's JSON, and how to put file ids into a request body.
   File ids are 64-bit (above Number.MAX_SAFE_INTEGER), so they stay strings
   in the plugin and are written into JSON as bare digits, never via Number. */

export interface ServerFile {
	id: string;
	directoryId: string;
	fileName: string;
	isFolder: boolean;
	md5: string | null;
	updateTime: number | null;
}

export type ProcessingStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "NONE";

export interface TranscriptPage {
	pageIndex: number;
	pageId: string;
	text: string | null;
}

function idLiteral(id: string): string {
	if (!/^\d+$/.test(id)) throw new Error(`Not a file id: ${id}`);
	return id;
}

/** `{"fileId": 770747265093468819}` with the digits intact. */
export function fileIdBody(id: string): string {
	return `{"fileId":${idLiteral(id)}}`;
}

export function fileIdsBody(ids: readonly string[]): string {
	return `{"fileIds":[${ids.map(idLiteral).join(",")}]}`;
}

export function listFolderBody(directoryId: string, pageNo: number, pageSize: number): string {
	return `{"directoryId":${idLiteral(directoryId)},"pageNo":${pageNo},"pageSize":${pageSize},"order":"filename","sequence":"asc"}`;
}

export function parseServerFile(raw: unknown): ServerFile | null {
	const r = (raw ?? {}) as Record<string, unknown>;
	if (typeof r.id !== "string" || typeof r.fileName !== "string") return null;
	return {
		id: r.id,
		directoryId: typeof r.directoryId === "string" ? r.directoryId : "0",
		fileName: r.fileName,
		isFolder: r.isFolder === "Y",
		md5: typeof r.md5 === "string" && r.md5 !== "" ? r.md5 : null,
		updateTime: typeof r.updateTime === "number" ? r.updateTime : null,
	};
}
