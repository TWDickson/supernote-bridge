import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { obsidianSyncState, settleObsidianSync } from "./obsidianSync";

/** Stand-in for Obsidian Sync's core plugin instance. */
function fakeApp(status: string | null, enabled = true) {
	const listeners = new Set<() => void>();
	const instance = {
		status,
		getStatus: () => instance.status,
		on: (_: string, cb: () => void) => (listeners.add(cb), cb),
		offref: (ref: () => void) => listeners.delete(ref),
		set(next: string) {
			instance.status = next;
			for (const cb of listeners) cb();
		},
		listeners,
	};
	const app = { internalPlugins: { plugins: status === null ? {} : { sync: { enabled, instance } } } } as unknown as App;
	return { app, instance };
}

describe("Obsidian Sync state", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		/* Tests run in Node: give the module a window with the faked timers. */
		vi.stubGlobal("window", { setTimeout, clearTimeout, setInterval, clearInterval });
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("is absent when Sync isn't set up, is turned off, or its internals changed", () => {
		expect(obsidianSyncState(fakeApp(null).app)).toBe("absent");
		expect(obsidianSyncState(fakeApp("synced", false).app)).toBe("absent");
		expect(obsidianSyncState({} as App)).toBe("absent");
		expect(obsidianSyncState(fakeApp("something-new").app)).toBe("absent");
	});

	it("doesn't wait when Sync is idle", async () => {
		const onWaiting = vi.fn();
		await expect(settleObsidianSync(fakeApp("synced").app, 60_000, onWaiting)).resolves.toBe("synced");
		expect(onWaiting).not.toHaveBeenCalled();
	});

	it("waits for Sync to finish, then stops listening", async () => {
		const { app, instance } = fakeApp("syncing");
		const onWaiting = vi.fn();
		const settled = settleObsidianSync(app, 60_000, onWaiting);
		expect(onWaiting).toHaveBeenCalledOnce();
		instance.set("synced");
		await expect(settled).resolves.toBe("synced");
		expect(instance.listeners.size).toBe(0);
	});

	it("gives up at the timeout and reports it's still syncing", async () => {
		const { app } = fakeApp("syncing");
		const settled = settleObsidianSync(app, 60_000, () => {});
		vi.advanceTimersByTime(60_000);
		await expect(settled).resolves.toBe("syncing");
	});
});
