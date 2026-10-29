import { requestUrl, type RequestUrlParam } from "obsidian";

export class SupernoteApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "SupernoteApiError";
	}
}

/**
 * Thin typed wrapper over the sync server's HTTP API.
 *
 * Goes through Obsidian's `requestUrl` rather than `fetch`: it is not subject
 * to CORS and behaves the same on desktop and mobile.
 */
export class SupernoteClient {
	constructor(
		private readonly baseUrl: string,
		private readonly getToken: () => string | null,
	) {}

	/** Unauthenticated liveness check. */
	async health(): Promise<void> {
		await this.request({ method: "GET", url: `${this.baseUrl}/api/health` }, false);
	}

	private async request(params: RequestUrlParam, authenticated = true) {
		const headers: Record<string, string> = { ...params.headers };
		if (authenticated) {
			const token = this.getToken();
			if (!token) throw new SupernoteApiError("No app token configured", 0);
			headers.Authorization = `Bearer ${token}`;
		}
		const response = await requestUrl({ ...params, headers, throw: false });
		if (response.status >= 400) {
			throw new SupernoteApiError(`${params.method ?? "GET"} ${params.url} failed`, response.status);
		}
		return response;
	}
}
