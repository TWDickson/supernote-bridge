import { type App, Platform } from "obsidian";

const PREFIX = "supernote-bridge:";

export interface OAuthClient {
	serverUrl: string;
	clientId: string;
	redirectUri: string;
	clientName: string;
}

export interface PendingSignIn {
	serverUrl: string;
	clientId: string;
	redirectUri: string;
	state: string;
	verifier: string;
	createdAt: number;
}

/**
 * State that belongs to this device, not the vault. It lives in Obsidian's
 * vault-scoped localStorage, so it doesn't travel with data.json through
 * Obsidian Sync: which device syncs, its name, and its OAuth registration.
 */
export class DeviceStore {
	constructor(private readonly app: App) {}

	private get<T>(key: string): T | null {
		return (this.app.loadLocalStorage(PREFIX + key) as T | null) ?? null;
	}

	private set(key: string, value: unknown): void {
		this.app.saveLocalStorage(PREFIX + key, value ?? null);
	}

	get deviceName(): string {
		return this.get<string>("device-name") || defaultDeviceName();
	}

	set deviceName(value: string) {
		this.set("device-name", value.trim() || null);
	}

	/** Whether this device pulls from and pushes to the server. Only one device
	 *  should: the rest receive the notes through Obsidian Sync. Off until the
	 *  device signs in or the user turns it on. */
	get syncsWithServer(): boolean {
		return this.get<boolean>("syncs") === true;
	}

	set syncsWithServer(value: boolean) {
		this.set("syncs", value);
	}

	get oauthClient(): OAuthClient | null {
		return this.get<OAuthClient>("oauth-client");
	}

	set oauthClient(value: OAuthClient | null) {
		this.set("oauth-client", value);
	}

	get pendingSignIn(): PendingSignIn | null {
		return this.get<PendingSignIn>("pending-sign-in");
	}

	set pendingSignIn(value: PendingSignIn | null) {
		this.set("pending-sign-in", value);
	}

	get lastSync(): number | null {
		return this.get<number>("last-sync");
	}

	set lastSync(value: number | null) {
		this.set("last-sync", value);
	}
}

function defaultDeviceName(): string {
	if (Platform.isIosApp) return Platform.isTablet ? "iPad" : "iPhone";
	if (Platform.isAndroidApp) return Platform.isTablet ? "Android tablet" : "Android phone";
	if (Platform.isMacOS) return "Mac";
	if (Platform.isWin) return "Windows PC";
	if (Platform.isLinux) return "Linux PC";
	return "Device";
}
