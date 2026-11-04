import { describe, expect, it } from "vitest";
import { reflowText } from "./reflow";

describe("reflowText", () => {
	it("joins prose that wrapped at the page edge, keeping paragraphs apart", () => {
		const text = [
			"The picnic got moved indoors because the",
			"forecast called for rain all afternoon, so",
			"we set up in the community hall instead.",
			"",
			"Sam and I agreed to try the new bakery",
			"on Friday morning.",
		].join("\n");
		expect(reflowText(text)).toBe(
			[
				"The picnic got moved indoors because the forecast called for rain all afternoon, so we set up in the community hall instead.",
				"",
				"Sam and I agreed to try the new bakery on Friday morning.",
			].join("\n"),
		);
	});

	it("keeps planner slots, task marks and list items on their own lines", () => {
		const text = [
			"2026-01-05 Monday",
			"9",
			"10 Team sync about the quarterly roadmap",
			"11",
			"• Send the budget draft to finance today",
			"X Book the dentist appointment for next week",
			"- Note: ask about the parking pass",
			"  sub item that is indented under the note",
			"Planning Deck",
			"Review Document",
		].join("\n");
		expect(reflowText(text)).toBe(text);
	});

	it("keeps separate capitalised entries apart even when they are long", () => {
		const text = ["Team Meeting with the platform group today", "Phase 1 Dimensions Connect"].join("\n");
		expect(reflowText(text)).toBe(text);
	});

	it("joins across a capital when the line stopped on a word that can't end a sentence", () => {
		expect(reflowText("Tomorrow I am going out with\nBecky to the market.")).toBe("Tomorrow I am going out with Becky to the market.");
	});

	it("does not join after a colon", () => {
		const text = "Things I need to remember for the trip:\npassport, charger, and snacks";
		expect(reflowText(text)).toBe(text);
	});
});
