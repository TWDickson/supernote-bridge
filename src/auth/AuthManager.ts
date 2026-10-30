import { type App, type ObsidianProtocolData, requestUrl } from "obsidian";
import type { DeviceStore } from "../device";
import { hashText } from "../sync/blocks";
import {
	authorizeUrl,
	endpointsFromMetadata,
	formBody,
	parseTokenResponse,
	redirectUri,
	registrationBody,
	type ServerEndpoints,
} from "./oauth";
import { codeChallenge, randomToken } from "./pkce";

/** A sign-in started on this device is good for as long as the server keeps
 *  the pending request. */
const PENDING_TTL_MS = 10 * 60 * 1000;
/** Refresh a little before expiry so a request never races the deadline. */
const EXPIRY_MARGIN_MS = 60 * 1000;

export class AuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AuthError";
	}
}

/**
 * OAuth sign-in against the sync server, one grant per device.
 *
 * The refresh token lives in Obsidian's secret storage under a per-vault id.
 * The access token is only held in memory. The server rotates refresh tokens,
 * so each new one is stored before it is used.
 */
export class AuthManager {
	private access: { token: string; expiresAt: number } | null = null;
	private refreshing: Promise<string | null> | null = null;
	private endpointsCache: { serverUrl: string; endpoints: ServerEndpoints } | null = null;

	constructor(
		private readonly app: App,
		private readonly device: DeviceStore,
		private readonly serverUrl: () => string,
		private readonly appTokenSecretId: () => string,
	) {}

	private get secretId(): string {
		/* Secret ids are lowercase alphanumerics and dashes, and on mobile the
		   store is shared by every vault, so key it by vault. */
		return `supernote-bridge-refresh-${hashText(this.app.vault.getName())}`;
	}

	private get refreshToken(): string | null {
		return this.app.secretStorage.getSecret(this.secretId) || null;
	}

	private set refreshToken(value: string | null) {
		this.app.secretStorage.setSecret(this.secretId, value ?? "");
	}

	isSignedIn(): boolean {
		const client = this.device.oauthClient;
		return this.refreshToken !== null && client?.serverUrl === this.serverUrl();
	}

	hasAppToken(): boolean {
		return this.appToken() !== null;
	}

	private appToken(): string | null {
		const id = this.appTokenSecretId();
		return id ? this.app.secretStorage.getSecret(id) || null : null;
	}

	/** A bearer token for the API: the OAuth access token when signed in,
	 *  otherwise a pasted app token. */
	async bearer(forceRefresh = false): Promise<string | null> {
		if (!this.isSignedIn()) return this.appToken();
		if (!forceRefresh && this.access && this.access.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
			return this.access.token;
		}
		this.refreshing ??= this.refresh().finally(() => {
			this.refreshing = null;
		});
		return this.refreshing;
	}

	async signIn(): Promise<void> {
		const serverUrl = this.serverUrl();
		const endpoints = await this.endpoints();
		const client = await this.ensureClient(endpoints);
		const verifier = randomToken();
		const state = randomToken(16);
		this.device.pendingSignIn = {
			serverUrl,
			clientId: client.clientId,
			redirectUri: client.redirectUri,
			state,
			verifier,
			createdAt: Date.now(),
		};
		const url = authorizeUrl(endpoints, {
			clientId: client.clientId,
			redirectUri: client.redirectUri,
			state,
			challenge: await codeChallenge(verifier),
		});
		window.open(url);
	}

	/** Handles `obsidian://supernote-bridge-auth?…` after the user approves. */
	async handleCallback(params: ObsidianProtocolData): Promise<void> {
		const pending = this.device.pendingSignIn;
		this.device.pendingSignIn = null;
		if (params.error) throw new AuthError(params.error === "access_denied" ? "Sign-in was declined." : `Sign-in failed: ${params.error}`);
		if (!pending || Date.now() - pending.createdAt > PENDING_TTL_MS) {
			throw new AuthError("This sign-in has expired. Start it again from the plugin settings.");
		}
		if (!params.code || params.state !== pending.state) {
			throw new AuthError("The sign-in response didn't match the request. Start it again.");
		}
		const endpoints = await this.endpoints();
		const response = await requestUrl({
			url: endpoints.token,
			method: "POST",
			contentType: "application/x-www-form-urlencoded",
			body: formBody({
				grant_type: "authorization_code",
				code: params.code,
				redirect_uri: pending.redirectUri,
				client_id: pending.clientId,
				code_verifier: pending.verifier,
				resource: endpoints.resource,
			}),
			throw: false,
		});
		if (response.status !== 200) throw new AuthError(`The server refused the sign-in (${response.status}).`);
		const tokens = parseTokenResponse(response.json, Date.now());
		this.refreshToken = tokens.refreshToken;
		this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt };
	}

	async signOut(): Promise<void> {
		const token = this.refreshToken;
		const client = this.device.oauthClient;
		this.refreshToken = null;
		this.access = null;
		if (!token || !client) return;
		try {
			const endpoints = await this.endpoints();
			/* Revoking either token ends this device's whole grant. The server
			   expects client_secret to be present even for a public client. */
			await requestUrl({
				url: endpoints.revoke,
				method: "POST",
				contentType: "application/x-www-form-urlencoded",
				body: formBody({ token, client_id: client.clientId, client_secret: "" }),
				throw: false,
			});
		} catch (_err) {
			/* Signed out locally either way; the grant can still be removed under
			   Connected apps on the server. */
		}
	}

	private async refresh(): Promise<string | null> {
		const token = this.refreshToken;
		const client = this.device.oauthClient;
		if (!token || !client) return null;
		const endpoints = await this.endpoints();
		const response = await requestUrl({
			url: endpoints.token,
			method: "POST",
			contentType: "application/x-www-form-urlencoded",
			body: formBody({
				grant_type: "refresh_token",
				refresh_token: token,
				client_id: client.clientId,
				resource: endpoints.resource,
			}),
			throw: false,
		});
		if (response.status === 400 || response.status === 401) {
			/* Spent, expired or revoked: the grant is gone and only a new sign-in
			   brings it back. */
			this.refreshToken = null;
			this.access = null;
			throw new AuthError("Signed out: the server no longer accepts this device's sign-in. Sign in again.");
		}
		if (response.status !== 200) throw new AuthError(`Couldn't refresh the sign-in (${response.status}).`);
		const tokens = parseTokenResponse(response.json, Date.now());
		this.refreshToken = tokens.refreshToken;
		this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt };
		return tokens.accessToken;
	}

	private async endpoints(): Promise<ServerEndpoints> {
		const serverUrl = this.serverUrl();
		if (this.endpointsCache?.serverUrl === serverUrl) return this.endpointsCache.endpoints;
		const response = await requestUrl({
			url: `${serverUrl}/.well-known/oauth-authorization-server`,
			method: "GET",
			throw: false,
		});
		if (response.status !== 200) throw new AuthError(`Couldn't read the server's sign-in settings (${response.status}).`);
		const endpoints = endpointsFromMetadata(serverUrl, response.json);
		this.endpointsCache = { serverUrl, endpoints };
		return endpoints;
	}

	/** Registers this device with the server once, and again when the server,
	 *  vault name or device name changes. */
	private async ensureClient(endpoints: ServerEndpoints) {
		const serverUrl = this.serverUrl();
		const redirect = redirectUri(this.app.vault.getName());
		const clientName = `Supernote Bridge — ${this.device.deviceName} (${this.app.vault.getName()})`;
		const existing = this.device.oauthClient;
		if (
			existing &&
			existing.serverUrl === serverUrl &&
			existing.redirectUri === redirect &&
			existing.clientName === clientName
		) {
			return existing;
		}
		const response = await requestUrl({
			url: endpoints.register,
			method: "POST",
			contentType: "application/json",
			body: JSON.stringify(registrationBody(clientName, redirect)),
			throw: false,
		});
		const clientId = (response.json as { client_id?: unknown } | undefined)?.client_id;
		if (response.status >= 300 || typeof clientId !== "string") {
			throw new AuthError(`The server refused to register this device (${response.status}).`);
		}
		const client = { serverUrl, clientId, redirectUri: redirect, clientName };
		this.device.oauthClient = client;
		return client;
	}
}
