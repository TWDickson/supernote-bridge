import { describe, expect, it } from "vitest";
import { authorizeUrl, endpointsFromMetadata, parseTokenResponse, redirectUri, registrationBody } from "./oauth";

const server = "https://sn.example.test";

describe("endpointsFromMetadata", () => {
	it("reads the metadata and derives the API resource", () => {
		const endpoints = endpointsFromMetadata(server, {
			authorization_endpoint: `${server}/authorize`,
			token_endpoint: `${server}/token`,
			registration_endpoint: `${server}/register`,
			revocation_endpoint: `${server}/revoke`,
			scopes_supported: ["supernote:all", "notebooks:sync"],
		});
		expect(endpoints).toEqual({
			authorize: `${server}/authorize`,
			token: `${server}/token`,
			register: `${server}/register`,
			revoke: `${server}/revoke`,
			resource: `${server}/api`,
		});
	});

	it("refuses a server without the sync scope", () => {
		expect(() => endpointsFromMetadata(server, { scopes_supported: ["supernote:all"] })).toThrow(/doesn't support/);
	});
});

describe("authorize request", () => {
	it("carries PKCE, the API resource and the exact redirect URI", () => {
		const redirect = redirectUri("My Vault");
		const url = new URL(
			authorizeUrl(endpointsFromMetadata(server, {}), { clientId: "c1", redirectUri: redirect, state: "s1", challenge: "ch" }),
		);
		expect(url.searchParams.get("redirect_uri")).toBe("obsidian://supernote-bridge-auth?vault=My%20Vault");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("resource")).toBe(`${server}/api`);
		expect(url.searchParams.get("scope")).toBe("notebooks:sync");
	});

	it("registers as a public client for the sync scope", () => {
		expect(registrationBody("Supernote Bridge — Mac", "obsidian://x")).toMatchObject({
			token_endpoint_auth_method: "none",
			scope: "notebooks:sync",
			redirect_uris: ["obsidian://x"],
		});
	});
});

describe("parseTokenResponse", () => {
	it("computes the expiry", () => {
		expect(parseTokenResponse({ access_token: "a", refresh_token: "r", expires_in: 60 }, 1000)).toEqual({
			accessToken: "a",
			refreshToken: "r",
			expiresAt: 61_000,
		});
	});

	it("rejects a response without tokens", () => {
		expect(() => parseTokenResponse({ error: "invalid_grant" }, 0)).toThrow();
	});
});
