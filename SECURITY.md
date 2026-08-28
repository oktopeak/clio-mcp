# Security policy

## Reporting a vulnerability

Email **office@oktopeak.com** with the subject line `clio-mcp security`. Include the version (`npm ls @oktopeak/clio-mcp`), the transport you run (`stdio` or `http`), steps to reproduce, and what you believe the impact is. Please do not open a public GitHub issue for anything that could expose a firm's Clio data or tokens.

- We acknowledge reports within 3 business days.
- We aim to ship a fix within 30 days of confirming the issue, faster for anything that exposes tokens or client data.
- We ask for 90 days of coordinated disclosure from the first acknowledgement. We will credit you in the release notes unless you prefer otherwise.

## Supported versions

Only the latest 2.x minor receives security fixes. Upgrade with `npm install -g @oktopeak/clio-mcp@latest` or bump the version in your Claude Desktop config.

## What is in scope

- The encrypted token file (`~/.clio-mcp/tokens.enc`) and the keychain-held encryption key.
- The audit log (`~/.clio-mcp/audit.log`): anything that lets client data reach it that the documented redaction rules say should not.
- The HTTP transport: the `MCP_API_KEY` gate, session isolation between concurrent users, and the OAuth callback.
- The OAuth flow against Clio (state handling, redirect URIs, token exchange).
- The `READ_ONLY` gate: any path that lets a write tool run while it is on.

## What is out of scope

- Clio's own API and web application (report those to Clio).
- Claude Desktop, Claude.ai, or other MCP clients.
- Issues that require an attacker to already control the machine or the user account the connector runs under.

## Hardening notes for operators

- Never run the HTTP transport with `MCP_ALLOW_UNAUTHENTICATED=true` on a host other people can reach.
- Keep `MCP_API_KEY` at 24 characters or more and rotate it when staff change.
- Set `READ_ONLY=true` if the firm has not decided to let Claude write to Clio yet.
- The audit log is append-only by convention, not by enforcement. Ship it to storage the firm controls if it has to survive a dispute.
