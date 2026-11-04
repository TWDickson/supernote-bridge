import { describe, expect, it } from "vitest";
import type { FolderRule } from "../sync/paths";
import { planMoves } from "./moveNotes";

const weeks: FolderRule = { supernotePrefix: "Note/Work/Weeks", vaultFolder: "Work/Weekly" };
const work: FolderRule = { supernotePrefix: "Note/Work", vaultFolder: "Work/Planners" };
const rules = [weeks, work];
const notes = [
	{ path: "Supernote/Work/Weeks/2026-W45.md", source: "Note/Work/Weeks/2026-W45.note" },
	{ path: "Supernote/Work/2026-11 Daily Planner.md", source: "Note/Work/2026-11 Daily Planner.note" },
	{ path: "Work/Planners/2026-10 Daily Planner.md", source: "Note/Work/2026-10 Daily Planner.note" },
	{ path: "Supernote/Journal/Journal 2026-11.md", source: "Note/Journal/Journal 2026-11.note" },
	{ path: "Somewhere/My renamed week.md", source: "Note/Work/Weeks/2026-W44.note" },
];

describe("planMoves", () => {
	it("moves only the notes a rule places, keeping their file names", () => {
		expect(planMoves(notes, rules, "Supernote", { ...weeks })).toEqual([
			{ from: "Supernote/Work/Weeks/2026-W45.md", to: "Work/Weekly/2026-W45.md" },
			{ from: "Somewhere/My renamed week.md", to: "Work/Weekly/My renamed week.md" },
		]);
	});

	it("leaves notes already in place, and those a more specific rule owns", () => {
		expect(planMoves(notes, rules, "Supernote", work)).toEqual([
			{ from: "Supernote/Work/2026-11 Daily Planner.md", to: "Work/Planners/2026-11 Daily Planner.md" },
		]);
	});

	it("handles notebooks no rule covers with the default folder", () => {
		expect(planMoves(notes, rules, "Handwritten", null)).toEqual([
			{ from: "Supernote/Journal/Journal 2026-11.md", to: "Handwritten/Journal/Journal 2026-11.md" },
		]);
	});
});
