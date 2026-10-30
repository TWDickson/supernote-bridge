import { describe, expect, it } from "vitest";
import { codeChallenge, randomToken } from "./pkce";

describe("pkce", () => {
	it("matches the RFC 7636 appendix B example", async () => {
		expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
			"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		);
	});

	it("makes URL-safe verifiers of a valid length", () => {
		const token = randomToken();
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(randomToken()).not.toBe(token);
	});
});
