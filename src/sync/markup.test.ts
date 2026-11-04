import { describe, expect, it } from "vitest";
import { reapplyMarkup, stripMarkup } from "./markup";

describe("stripMarkup", () => {
	it("reads links as their label and drops tags, embeds and block ids", () => {
		expect(stripMarkup("Lunch with [[People/Sam Lee|Sam]] and [[Robin]] at [the cafe](https://x.test) #social ^lunch")).toBe(
			"Lunch with Sam and Robin at the cafe",
		);
		expect(stripMarkup("Went to the #errands store ![[map.png]]")).toBe("Went to the store");
		expect(stripMarkup("[[Project X#Kickoff]] notes")).toBe("Project X notes");
	});

	it("leaves the OCR's own formatting alone", () => {
		expect(stripMarkup("~~Email the team~~\n• Buy milk\n#1 priority")).toBe("~~Email the team~~\n• Buy milk\n#1 priority");
	});
});

describe("reapplyMarkup", () => {
	it("re-wraps the same words in new text", () => {
		const result = reapplyMarkup("Lunch with [[Sam]] at noon", "Lunch with Sam at 12:30");
		expect(result).toEqual({ text: "Lunch with [[Sam]] at 12:30", lost: [] });
	});

	it("keeps which occurrence was linked", () => {
		const result = reapplyMarkup("Sam called. Later [[Sam Lee|Sam]] came by.", "Sam phoned. Later Sam came by.");
		expect(result.text).toBe("Sam phoned. Later [[Sam Lee|Sam]] came by.");
	});

	it("puts tags and block ids back after the words they followed", () => {
		const result = reapplyMarkup("Went to the #errands shop\nPaid the bills ^bills", "Went to the corner shop\nPaid the bills today");
		expect(result).toEqual({ text: "Went to the #errands corner shop\nPaid the bills today ^bills", lost: [] });
	});

	it("reports markup whose words are gone", () => {
		const result = reapplyMarkup("Call [[Robin]] back", "Call Sam back");
		expect(result).toEqual({ text: "Call Sam back", lost: ["[[Robin]]"] });
	});
});
