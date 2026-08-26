# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Releases before this file existed are described on the [GitHub Releases](https://github.com/oktopeak/clio-mcp/releases) page.

## [Unreleased]

### Added
- `CLIO_REGION` now accepts `au` (https://au.app.clio.com) and `ca` (https://ca.app.clio.com) in addition to `us` and `eu`, for both the API base URL and the OAuth authorize/token URLs. The region-to-hostname map lives in one place (`src/utils/clioRegion.ts`) and is imported by the API client, the OAuth flow, and the HTTP server.
- `MCP_ALLOW_UNAUTHENTICATED=true` opt-out for local development of the HTTP transport. Prints a loud warning at startup; must never be used on a public host.
- Unit tests for the region map, the OAuth URLs per region, and HTTP authentication (startup validation and the per-route gate).

### Changed
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
