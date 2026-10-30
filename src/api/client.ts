import { requestUrl, type RequestUrlResponse } from "obsidian";
import {
	fileIdBody,
	fileIdsBody,
	listFolderBody,
	parseServerFile,
	type ProcessingStatus,
	type ServerFile,
	type TranscriptPage,
} from "./types";

export class SupernoteApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "SupernoteApiError";
	}
}

const PAGE_SIZE = 100;

/**
 * Thin typed wrapper over the sync server's HTTP API.
 *
 * Goes through Obsidian's `requestUrl` rather than `fetch`: it is not subject
 * to CORS and behaves the same on desktop and mobile.
 */
export class SupernoteClient {
	constructor(
		private readonly baseUrl: () => string,
		/** A bearer token; `forceRefresh` asks for a new one after a 401. */
		private readonly bearer: (forceRefresh?: boolean) => Promise<string | null>,
	) {}

	/** Unauthenticated liveness check. */
	async health(): Promise<void> {
		const response = await requestUrl({ url: `${this.baseUrl()}/api/health`, throw: false });
		if (response.status !== 200) throw new SupernoteApiError("The server didn't answer its health check", response.status);
	}

	/** One folder's direct children, every page of them. */
	async listFolder(directoryId: string): Promise<ServerFile[]> {
		const files: ServerFile[] = [];
		for (let pageNo = 1; ; pageNo++) {
			const json = (await this.post("/api/file/list/query", listFolderBody(directoryId, pageNo, PAGE_SIZE))).json as {
				pages?: number;
				userFileVOList?: unknown[];
			};
			for (const raw of json.userFileVOList ?? []) {
				const file = parseServerFile(raw);
				if (file) files.push(file);
			}
			if (pageNo >= (json.pages ?? 1)) return files;
		}
	}

	/** Processing state per file id. It aggregates every task (OCR, summary,
	 *  embedding), so treat it as a hint, never as proof the text is final. */
	async processingStatus(fileIds: readonly string[]): Promise<Record<string, ProcessingStatus>> {
		if (fileIds.length === 0) return {};
		const json = (await this.post("/api/extended/file/processing/status", fileIdsBody(fileIds))).json as {
			statusMap?: Record<string, ProcessingStatus>;
		};
		return json.statusMap ?? {};
	}

	/** A notebook's OCR text per page, or null when it has none yet. */
	async transcript(fileId: string): Promise<TranscriptPage[] | null> {
		const response = await this.post("/api/extended/transcript", fileIdBody(fileId), [404]);
		if (response.status === 404) return null;
		const pages = (response.json as { pages?: unknown[] }).pages ?? [];
		return pages.flatMap((raw) => {
			const p = raw as Record<string, unknown>;
			if (typeof p.pageId !== "string" || typeof p.pageIndex !== "number") return [];
			return [{ pageIndex: p.pageIndex, pageId: p.pageId, text: typeof p.text === "string" ? p.text : null }];
		});
	}

	private async post(path: string, body: string, allowStatus: number[] = []): Promise<RequestUrlResponse> {
		const send = async (forceRefresh: boolean) => {
			const token = await this.bearer(forceRefresh);
			if (!token) throw new SupernoteApiError("Not signed in", 401);
			return requestUrl({
				url: `${this.baseUrl()}${path}`,
				method: "POST",
				contentType: "application/json",
				headers: { Authorization: `Bearer ${token}` },
				body,
				throw: false,
			});
		};
		let response = await send(false);
		/* 401: expired or revoked, so refresh once. 403 means the path is off
		   limits to this token, and a new token won't change that. */
		if (response.status === 401) response = await send(true);
		if (response.status >= 400 && !allowStatus.includes(response.status)) {
			throw new SupernoteApiError(`${path} failed (${response.status})`, response.status);
		}
		return response;
	}
}
