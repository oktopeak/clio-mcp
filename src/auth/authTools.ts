import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { clearTokens, loadTokens } from "./tokenStorage.js";
import {
  getValidAccessToken,
  buildAuthorizationUrl,
  isBrokerMode,
  generateCodeVerifier,
  deriveCodeChallenge,
  startBrokerLogin,
} from "./oauth.js";
import { appendAuditLog } from "../utils/auditLog.js";
import { requireSessionContext } from "../utils/sessionContext.js";

export function registerAuthTools(server: McpServer): void {
  server.registerTool(
    "auth_status",
    { description: "Check whether the connector is authenticated with Clio and when the token expires" },
    async () => {
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

      await appendAuditLog({
        tool: "auth_status",
        args: {},
        outcome: "success",
        clio_user_id: tokens?.clio_user_id,
      });

      if (!tokens) {
        return {
          content: [{ type: "text", text: JSON.stringify({ authenticated: false }) }],
        };
      }

      const expiresIn = Math.floor((tokens.expires_at - Date.now()) / 1000 / 60);
      const token_expired = expiresIn < 0;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            authenticated: true,
            clio_user_id: tokens.clio_user_id
              ?? (tokens.user_id_unavailable
                ? "unavailable — Clio app lacks user-profile permission (HTTP 403 on who_am_i)"
                : "unknown"),
            token_expires_in_minutes: expiresIn,
            token_expired,
            ...(token_expired && { warning: "Token has expired. Run the 'authenticate' tool to refresh." }),
          }),
        }],
      };
    }
  );

  server.registerTool(
    "authenticate",
    { description: "Trigger the Clio OAuth login flow" },
    async () => {
      const ctx = requireSessionContext();
      if (ctx) {
        // HTTP mode: return a URL for the user to visit in their browser
        try {
          if (isBrokerMode()) {
            const codeVerifier = generateCodeVerifier();
            const codeChallenge = deriveCodeChallenge(codeVerifier);
            const { sessionId: brokerSessionId, authorizeUrl } = await startBrokerLogin(codeChallenge);
            ctx.setPendingBrokerSession({ brokerSessionId, codeVerifier });
            await appendAuditLog({ tool: "authenticate", args: {}, outcome: "success" });
            return {
              content: [{
                type: "text",
                text: `Please authenticate by visiting this URL:\n\n${authorizeUrl}\n\nAfter completing login in your browser, return here and call any Clio tool.`,
              }],
            };
          }

          const { url, nonce } = buildAuthorizationUrl(ctx.sessionId);
          ctx.setPendingNonce(nonce);
          await appendAuditLog({ tool: "authenticate", args: {}, outcome: "success" });
          return {
            content: [{
              type: "text",
              text: `Please authenticate by visiting this URL:\n\n${url}\n\nAfter completing login in your browser, return here and call any Clio tool.`,
            }],
          };
        } catch (err: any) {
          await appendAuditLog({ tool: "authenticate", args: {}, outcome: "error", error_message: err.message });
          return {
            content: [{ type: "text", text: `❌ Error: ${err.message}` }],
            isError: true,
          };
        }
      }

      // stdio mode: run browser-based OAuth flow
      try {
        await getValidAccessToken();
        await appendAuditLog({ tool: "authenticate", args: {}, outcome: "success" });
        return {
          content: [{ type: "text", text: "✅ Successfully authenticated with Clio!" }],
        };
      } catch (err: any) {
        await appendAuditLog({ tool: "authenticate", args: {}, outcome: "error", error_message: err.message });
        return {
          content: [{ type: "text", text: `❌ Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "logout",
    { description: "Log out of Clio (clears local tokens)" },
    async () => {
      const ctx = requireSessionContext();
      try {
        const clio_user_id = ctx
          ? ctx.getTokens()?.clio_user_id
          : (await loadTokens())?.clio_user_id;
        if (ctx) {
          ctx.clearTokens();
          ctx.setPendingBrokerSession(null);
        } else {
          await clearTokens();
        }
        await appendAuditLog({ tool: "logout", args: {}, outcome: "success", clio_user_id });
        return {
          content: [{ type: "text", text: "✅ Logged out. Tokens cleared." }],
        };
      } catch (err: any) {
        await appendAuditLog({ tool: "logout", args: {}, outcome: "error", error_message: err.message });
        return {
          content: [{ type: "text", text: `❌ Logout failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );
}
