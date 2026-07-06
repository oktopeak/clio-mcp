import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadTokens } from "../auth/tokenStorage.js";
import { requireSessionContext } from "../utils/sessionContext.js";

export function registerResources(server: McpServer): void {
  server.registerResource(
    "compliance-notice",
    "clio://compliance/notice",
    {
      title: "Compliance Notice",
      description: "Privilege and compliance reminder for AI-assisted legal work",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        text: "This connector gives Claude read and limited write access to your Clio account. Every interaction — including the data retrieved and actions taken — is logged to an append-only audit file on this machine (~/.clio-mcp/audit.log) in compliance with ABA Formal Opinion 512. AI-generated content, summaries, and suggestions must be reviewed by a licensed attorney before any client-facing use. No client data is transmitted to third-party services; all data flows directly between Clio's API and your local MCP client session.",
      }],
    })
  );

  server.registerResource(
    "auth-status",
    "clio://auth/status",
    {
      title: "Auth Status",
      description: "Current authentication state with Clio",
      mimeType: "application/json",
    },
    async (uri) => {
      const ctx = requireSessionContext();
      let tokens = ctx ? ctx.getTokens() : await loadTokens();

      if (ctx && !tokens && ctx.getPendingBrokerSession()) {
        try {
          await ctx.getAccessToken();
        } catch {
          // still pending, or the broker session died — fall through to unauthenticated below
        }
        tokens = ctx.getTokens();
      }

      const payload = tokens
        ? {
          authenticated: true,
          clio_user_id: tokens.clio_user_id
            ?? (tokens.user_id_unavailable
              ? "unavailable — Clio app lacks user-profile permission"
              : "unknown"),
          token_expires_in_minutes: Math.floor((tokens.expires_at - Date.now()) / 60000),
          token_expired: Date.now() > tokens.expires_at,
        }
        : { authenticated: false };
      return {
        contents: [{ uri: uri.href, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
