import type { App, EventRef } from "obsidian";

/**
 * Obsidian Sync's state, read through its core plugin. Obsidian has no public
 * API for this, so everything is feature-checked: if the internals change or
 * Sync isn't in use, the answer is "absent" and the sync goes ahead as before.
 */
export type ObsidianSyncState = "absent" | "synced" | "syncing" | "paused" | "error" | "disconnected" | "uninitialized";

interface SyncInstance {
	getStatus(): string;
	on(name: "status-change", callback: () => void): EventRef;
	offref(ref: EventRef): void;
}

const STATES: readonly string[] = ["synced", "syncing", "paused", "error", "disconnected", "uninitialized"];

function syncInstance(app: App): SyncInstance | null {
	const plugin = (app as unknown as { internalPlugins?: { plugins?: Record<string, { enabled?: boolean; instance?: unknown }> } })
		.internalPlugins?.plugins?.sync;
	const instance = plugin?.enabled ? (plugin.instance as Partial<SyncInstance> | undefined) : undefined;
	if (typeof instance?.getStatus !== "function" || typeof instance.on !== "function" || typeof instance.offref !== "function") {
		return null;
	}
	return instance as SyncInstance;
}

export function obsidianSyncState(app: App): ObsidianSyncState {
	const status = syncInstance(app)?.getStatus();
	return status !== undefined && STATES.includes(status) ? (status as ObsidianSyncState) : "absent";
}

/**
 * Wait while Obsidian Sync is still bringing in changes, so a server sync
 * doesn't start from a vault that's missing another device's edits. Returns
 * the state it settled on, or "syncing" if it was still busy at the timeout.
 */
export async function settleObsidianSync(app: App, timeoutMs: number, onWaiting: () => void): Promise<ObsidianSyncState> {
	const instance = syncInstance(app);
	if (!instance || obsidianSyncState(app) !== "syncing") return obsidianSyncState(app);
	onWaiting();
	return new Promise((resolve) => {
		const finish = () => {
			window.clearTimeout(timer);
			window.clearInterval(poll);
			instance.offref(ref);
			resolve(obsidianSyncState(app));
		};
		const check = () => {
			if (obsidianSyncState(app) !== "syncing") finish();
		};
		const ref = instance.on("status-change", check);
		/* The event is internal too; polling covers it going quiet. */
		const poll = window.setInterval(check, 1000);
		const timer = window.setTimeout(finish, timeoutMs);
	});
}
