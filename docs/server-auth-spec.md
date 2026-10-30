# Server spec — SV-1b: OAuth sign-in for the Obsidian plugin

**For:** the agent working on the Supernote sync server (`allenporter/supernote`
fork, production branch `local-ocr`, checkout
`~/.supernote-ocr/experiments/upstream-supernote`).
**From:** the Supernote Bridge plugin (`~/Projects/supernote-bridge`).
**Date:** 2026-10-30.

> This repo is public. The spec contains no secrets; keep it that way when
> you report back (no tokens, no real notebook names).

## Goal

The plugin signs in the way Claude's MCP connector does. The user points the
plugin at the server, approves on the existing consent screen, and is sent back
to Obsidian with tokens. Each device gets its **own grant**, listed under
Settings → Connected apps and revocable on its own. The tokens reach the REST
notebook API. They must **not** reach `/mcp`, and MCP tokens must not reach the
REST API.

## Starting point

- **Build on `feat/plugin-tokens`** (`97e1b00`, SV-1 app tokens, preflight
  READY, *not deployed*). Branch `feat/plugin-oauth` from it. Deploying the new
  branch ships both.
- The OAuth server already exists in `supernote/server/mcp/auth.py`
  (`SupernoteOAuthProvider`):
  - dynamic client registration and client ID metadata documents (CIMD);
  - consent through the web UI (`OAuthConsent.js`, `/api/extended/oauth/*`);
  - 1h access tokens and 30-day **rotating** refresh tokens;
  - revocation, with grants in `mcp_grants`.
- Single scope today: `supernote:all`. Single resource: `{mcp_base_url}/mcp`.
- REST auth lives in `jwt_auth_middleware` (`supernote/server/app.py`). SV-1 added
  a branch there: `Authorization: Bearer snb_…` → app token, limited to
  `API_TOKEN_PATH_PREFIXES` minus `API_TOKEN_DENIED_PREFIXES`.

## Requirements

### R1 — A second resource and scope for the REST API

- Define `API_RESOURCE = f"{config.base_url}/api"` and scope
  `SYNC_SCOPE = "notebooks:sync"`.
- `authorize()` accepts `resource` ∈ {MCP resource, API resource}. The pairing
  is fixed:
  - API resource ⇒ scopes must be exactly `[notebooks:sync]`;
  - MCP resource (or no resource, as today) ⇒ `[supernote:all]`;
  - anything else ⇒ `invalid_scope` / `invalid_request`.
- Add `notebooks:sync` to `ClientRegistrationOptions.valid_scopes`. Keep
  `supernote:all` the default scope so existing MCP clients don't change.
- The issued access and refresh tokens carry the resource they were granted
  for (they already store `resource`). Refreshing keeps that resource; it can't
  be switched to another one.
- The authorization-server metadata (`/.well-known/oauth-authorization-server`)
  lists both scopes in `scopes_supported`.
- **Optional:** a protected-resource metadata document for the API at
  `/.well-known/oauth-protected-resource/api`. The plugin won't depend on it.

### R2 — Audience separation (security-critical)

`load_access_token` currently checks `resource == self.resource_url` (MCP).
Make the check per surface:
- **MCP's token verifier** accepts only MCP-resource tokens, i.e. today's
  behaviour, unchanged.
- **The REST middleware** (R3) accepts only API-resource tokens that carry
  `notebooks:sync`.

A token for one surface presented to the other gets a 401. **This needs tests in
both directions.**

### R3 — REST middleware accepts OAuth access tokens

In `jwt_auth_middleware`, after the `snb_` branch, handle any other
`Authorization: Bearer <token>`:
1. Look it up as an OAuth access token for the API resource, with the grant
   live and touched (as `load_access_token` already does for MCP).
2. If valid, set `request["user"]` to the grant user's **email** and
   `request["equipment_no"] = None`.
3. Apply the **same path limits as app tokens**: allowed
   `/api/extended/`, `/api/file/`, `/api/oss/`; denied `/api/extended/tokens*`
   and `/api/extended/oauth/*` → 403. Reuse `_api_token_allowed`.
4. If the lookup fails, return 401. **Don't** fall through to the
   `x-access-token` JWT path for a request that sent a Bearer token.
   Careful: the test fixture `auth_headers` sends *both* `x-access-token` and
   `Authorization: Bearer <session JWT>`. Session JWTs must keep working, so
   fall through to the JWT path only when the Bearer value isn't an OAuth
   token *and* an `x-access-token` header is present. Alternatively, recognise a
   JWT by shape. Pick one rule, document it in a comment, and test it.

### R4 — `obsidian://` redirect URIs

The plugin registers per device via dynamic client registration, with:

```json
{
  "client_name": "Supernote Bridge — <device name>",
  "redirect_uris": ["obsidian://supernote-bridge-auth?vault=<vault id>"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "scope": "notebooks:sync"
}
```

- **Accept the custom scheme.** The SDK parses redirect URIs as `AnyUrl`;
  confirm `obsidian://…` survives registration, the exact-match check in
  `validate_redirect_uri`, and the round trip through `PendingAuthorization`.
- **Keep the query string.** `PendingAuthorization.redirect()` already appends
  with `&` when a `?` is present. Test that the result is
  `obsidian://supernote-bridge-auth?vault=…&code=…&state=…`.
- **Require PKCE S256.** The SDK enforces it; add a test that a request
  without `code_challenge` fails.
- **Allowed schemes.** Allow `https`, loopback `http` (127.0.0.1, localhost),
  and `obsidian`. Reject any other custom scheme at registration. This is a
  small allowlist, not a general opening.

### R5 — Consent screen and Connected apps

- **Consent** (`OAuthConsent.js` + the `/api/extended/oauth/request` payload):
  - For a non-http(s) redirect, show **"Obsidian on this device"**, or more
    generally the scheme, instead of `redirectHost`. Today the netloc would read
    `supernote-bridge-auth`, which is meaningless.
  - Show what the scope grants. For `notebooks:sync`: "Read your notebooks
    and their text, and save text corrections. It can't change your account or
    connect other apps." For `supernote:all`: keep the current wording.
- **Connected apps** (`SettingsView.js`, `GET /api/extended/oauth/grants`):
  - Each plugin device shows as its own row with its client name, a kind
    label ("Obsidian sync" vs "MCP"), and connected and last-used times.
  - Revoke works as it does today.
  - Give the grant row the same scheme-aware host display as the consent screen.
- Check both screens in light and dark mode, at desktop and phone widths.
  *(Known nit from SV-1: the Connected apps MCP-URL `<code>` box and Copy button
  have no text colour, so they're likely invisible in dark mode. Fix it while
  you're there.)*

### R6 — Unchanged

- MCP sign-in for Claude/ChatGPT behaves exactly as before. The existing
  `tests/server/integration/mcp/test_oauth_flow.py` must pass unchanged.
- Lifetimes stay the same: 1h access, 30-day rotating refresh. A reused
  (already-spent) refresh token is rejected as it is today.
- Leave the SV-1 app tokens as they are; they stay the manual fallback.

## Tests (minimum)

1. **Full flow on the API resource:** register an `obsidian://…?vault=x`
   client, then authorize (S256) → pending → approve as the session user →
   redirect carries `vault=x&code=…&state=…` → token exchange with the verifier
   → `POST /api/extended/transcript` with Bearer gets past auth (404/200, not 401).
2. Refresh rotation on an API-resource token: the old refresh token is dead
   afterwards, and the new access token works on REST.
3. **Audience separation:** an API token on `/mcp` gets 401; an MCP token on
   `/api/extended/...` gets 401.
4. **Path limits:** an API OAuth token on `/api/extended/tokens`,
   `/api/extended/oauth/grants`, `/api/user/query` or `/api/admin/users` gets 403.
5. Revoking the grant makes the access and refresh tokens fail at once.
6. Wrong scope/resource pairings are rejected at authorize.
7. A disallowed redirect scheme (e.g. `javascript:` or `myapp://`) is rejected
   at registration.
8. Session-JWT requests that also send `Authorization: Bearer <jwt>` (the
   `auth_headers` fixture) still work.
9. An `snb_` app token still works, unchanged.

Gate with the `supernote-dev-preflight` skill (`verdict: READY`), then deploy
with `supernote-upstream-sync` (`sync.py deploy feat/plugin-oauth`). Deploying
needs Taylor's go-ahead in that session.

## After deploy — smoke test on the live server

Without touching real notebook content:
- `curl https://sn.twdickson.com/.well-known/oauth-authorization-server`
  lists `notebooks:sync`.
- Register a throwaway `obsidian://` client, then approve once in the browser
  as Taylor.
- Exchange the code, call `GET /api/extended/ai/status` with the token
  (expect 200), call `/mcp` with it (expect 401), then **revoke the grant**.

## Report back (paste this into the plugin session)

1. The deployed `local-ocr` sha, and the alembic head if it changed.
2. The exact values the plugin needs:
   - **Endpoints:** `authorization_endpoint`, `token_endpoint`,
     `registration_endpoint`, `revocation_endpoint`.
   - **Strings:** the API `resource` string and the scope string.
3. Anything that differs from this spec, and why. Especially:
   - the R3 rule for telling a session JWT from an OAuth token;
   - whether `obsidian://` needed changes beyond the scheme allowlist.
4. Results of the live smoke test.
5. Screenshot paths for the consent and Connected apps screens.
