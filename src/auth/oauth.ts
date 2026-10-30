/* The server's OAuth contract for the plugin, as plain functions. The flow:
   register once per device → authorize (PKCE S256, API resource) → the
   server redirects to obsidian://supernote-bridge-auth → exchange the code →
   refresh (rotating) → revoke on sign-out. */

export const CALLBACK_ACTION = "supernote-bridge-auth";
export const SYNC_SCOPE = "notebooks:sync";

export interface ServerEndpoints {
	authorize: string;
	token: string;
	register: string;
	revoke: string;
	/** The REST API's resource indicator (RFC 8707). */
	resource: string;
}

export interface TokenSet {
	accessToken: string;
	refreshToken: string;
	/** Epoch milliseconds. */
	expiresAt: number;
}

/** Endpoints from the server's authorization-server metadata. */
export function endpointsFromMetadata(serverUrl: string, metadata: unknown): ServerEndpoints {
	const m = (metadata ?? {}) as Record<string, unknown>;
	const pick = (key: string, fallback: string) => {
		const value = m[key];
		return typeof value === "string" ? value : fallback;
	};
	if (Array.isArray(m.scopes_supported) && !m.scopes_supported.includes(SYNC_SCOPE)) {
		throw new Error("This server doesn't support Obsidian sign-in yet. Update it, or use an app token.");
	}
	return {
		authorize: pick("authorization_endpoint", `${serverUrl}/authorize`),
		token: pick("token_endpoint", `${serverUrl}/token`),
		register: pick("registration_endpoint", `${serverUrl}/register`),
		revoke: pick("revocation_endpoint", `${serverUrl}/revoke`),
		resource: `${serverUrl}/api`,
	};
}

/** The redirect URI this vault registers. It must be sent byte-for-byte the
 *  same to /authorize and /token. */
export function redirectUri(vaultName: string): string {
	return `obsidian://${CALLBACK_ACTION}?vault=${encodeURIComponent(vaultName)}`;
}

export function registrationBody(clientName: string, redirect: string): Record<string, unknown> {
	return {
		client_name: clientName,
		redirect_uris: [redirect],
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		token_endpoint_auth_method: "none",
		scope: SYNC_SCOPE,
	};
}

export function authorizeUrl(
	endpoints: ServerEndpoints,
	params: { clientId: string; redirectUri: string; state: string; challenge: string },
): string {
	const query = new URLSearchParams({
		response_type: "code",
		client_id: params.clientId,
		redirect_uri: params.redirectUri,
		state: params.state,
		code_challenge: params.challenge,
		code_challenge_method: "S256",
		scope: SYNC_SCOPE,
		resource: endpoints.resource,
	});
	const separator = endpoints.authorize.includes("?") ? "&" : "?";
	return `${endpoints.authorize}${separator}${query.toString()}`;
}

export function formBody(fields: Record<string, string>): string {
	return new URLSearchParams(fields).toString();
}

/** A token response, or a thrown error naming what was wrong with it. */
export function parseTokenResponse(body: unknown, now: number): TokenSet {
	const b = (body ?? {}) as Record<string, unknown>;
	if (typeof b.access_token !== "string" || typeof b.refresh_token !== "string") {
		throw new Error("The server's token response had no tokens");
	}
	const expiresIn = typeof b.expires_in === "number" ? b.expires_in : 3600;
	return { accessToken: b.access_token, refreshToken: b.refresh_token, expiresAt: now + expiresIn * 1000 };
}
