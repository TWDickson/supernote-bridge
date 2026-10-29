import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* Modules that must run outside Obsidian (the sync engine is tested with
   synthetic notebooks in plain vitest). Add a directory here when you create
   a new pure area. */
const PURE_DIRS = ["src/sync", "src/api/types"];

function tsFiles(dir: string): string[] {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return tsFiles(full);
		return entry.name.endsWith(".ts") ? [full] : [];
	});
}

describe("architecture boundaries", () => {
	it.each(PURE_DIRS.flatMap(tsFiles))("%s does not import obsidian", (file) => {
		expect(readFileSync(file, "utf8")).not.toMatch(/from\s+["']obsidian["']/);
	});
});
