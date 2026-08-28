# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Releases before this file existed are described on the [GitHub Releases](https://github.com/oktopeak/clio-mcp/releases) page.

## [Unreleased]

### Added
- `READ_ONLY=true|1|yes` leaves the nine write tools unregistered on both transports, so Claude can read Clio but never change it. A server-side guarantee: the tools are absent from `tools/list` and a call to one is rejected.
- Every tool now carries a `title` and MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).
- `src/tools/index.ts`: one registry (`registerAllTools`, `TOOL_META`, `WRITE_TOOLS`) used by the stdio and HTTP entry points; new tools must be listed there (`registry.test.ts` enforces it).
- `SECURITY.md` with the reporting address, response times and scope.
- Audit log: `user_id` and `request_id` fields for hosted deployments; `configureAudit({ sink, redact })` lets a host replace the file with its own store; `readAuditLog` accepts `user_id` and `session_id` filters.
- **Library entry point** `@oktopeak/clio-mcp/lib` (also the package default export) with typings: the tool registry, the session-context seam (`runWithSessionContext`, `requireSessionContext`), the audit sink, pure Clio OAuth functions that take explicit credentials and a region (`buildClioAuthorizeUrl`, `exchangeClioCode`, `refreshClioTokens`, `fetchClioWhoAmI`) with PKCE helpers, region helpers that accept a region code, and the Clio HTTP client. See "Using the connector as a library" in the README.
- `registerAllTools` options `exclude` and `complianceNotice`; `registerResources(server, { complianceNotice })`.
- CI workflow (Node 20 and 22: build, test, secret scan) and `npm run verify:no-secrets`, which now also runs in `prepublishOnly`.
- `CLIO_REGION` now accepts `au` (https://au.app.clio.com) and `ca` (https://ca.app.clio.com) in addition to `us` and `eu`, for both the API base URL and the OAuth authorize/token URLs. The region-to-hostname map lives in one place (`src/utils/clioRegion.ts`) and is imported by the API client, the OAuth flow, and the HTTP server.
- `MCP_ALLOW_UNAUTHENTICATED=true` opt-out for local development of the HTTP transport. Prints a loud warning at startup; must never be used on a public host.
- Unit tests for the region map, the OAuth URLs per region, and HTTP authentication (startup validation and the per-route gate).

### Changed
- **Audit log arguments are now recorded by allowlist.** For each tool only ids, limits, dates, page tokens, enums and booleans are written verbatim; every other argument that was passed appears as `"[redacted]"`. Contact and document search queries, note subjects and bodies, task names and descriptions, calendar summaries, descriptions and locations, matter descriptions and client references, time-entry and activity notes, file paths and file names, and the `list_users` name filter no longer reach the log.
- `machine_ip` is written in stdio mode only; in HTTP mode (typically a container) it is omitted.
- `SessionContext.getTokens`, `storeTokens` and `clearTokens` are now async and `setPendingNonce` is optional (only affects code that embeds the connector; the stdio and HTTP modes behave as before). Outside stdio mode a missing session context is now an error instead of a silent fall back to the shared token file.
- HTTP mode refreshes an expiring Clio token once per session even when several tool calls arrive at the same time; stdio mode coalesces concurrent `getValidAccessToken` calls the same way.
- `package.json` `main`/`exports` point at the library entry; the `clio-mcp` binary is unchanged.
- README: the compliance section now states the real write surface (nine write tools, all logged, all removable with `READ_ONLY`) instead of claiming the connector cannot create matters or calendar entries.
- **Breaking for HTTP mode:** `MCP_API_KEY` is now required when `TRANSPORT=http`. The server refuses to start if the key is missing or shorter than 24 characters. stdio mode is unaffected.
- The API key check now applies to every HTTP route except `/health` and `/oauth/callback`: all methods on `/mcp` (POST, GET/SSE stream, DELETE) and any unknown path return `401` without a valid key. The comparison is constant-time.
- An unknown `CLIO_REGION` value now stops startup with an error listing the valid values instead of silently using the US endpoint.
- Blank `CLIO_API_BASE`, `CLIO_AUTH_URL`, and `CLIO_TOKEN_URL` values are treated as unset instead of producing broken URLs.

### Fixed
- README: the regions text lists all four Clio data regions with exact hostnames and explains that the region is fixed at Clio account creation and must match the firm's Clio server.
- README: the HTTP mode section documents the required key and the dev-only opt-out.
- README: the stale `@1.0.1` version pin example now uses the current release.
- README: Trust Model wording on zero-data-retention (available on the Anthropic API at the organization level; Claude Enterprise is one option, not the only one) plus a model-version caveat.
- README: em-dashes removed throughout.
- `server.json` and `.env.example` describe all four regions and the HTTP API key.
