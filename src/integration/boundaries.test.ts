import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* Modules that must run outside Obsidian (the sync engine is tested with
   synthetic notebooks in plain vitest). Add a directory or file here when you
   create a new pure module. */
const PURE_PATHS = ["src/sync", "src/auth/oauth.ts", "src/auth/pkce.ts", "src/api/types.ts"];

function tsFiles(target: string): string[] {
	if (!statSync(target).isDirectory()) return [target];
	return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(target, entry.name);
		if (entry.isDirectory()) return tsFiles(full);
		return entry.name.endsWith(".ts") ? [full] : [];
	});
}

describe("architecture boundaries", () => {
	it("lists only paths that exist", () => {
		expect(PURE_PATHS.filter((p) => !existsSync(p))).toEqual([]);
	});

	it.each(PURE_PATHS.filter(existsSync).flatMap(tsFiles))("%s does not import obsidian", (file) => {
		expect(readFileSync(file, "utf8")).not.toMatch(/from\s+["']obsidian["']/);
	});
});
