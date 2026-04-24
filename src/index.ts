import dotenv from 'dotenv';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { clearTokens, loadTokens } from "./auth/tokenStorage.js";
import { getValidAccessToken } from "./auth/oauth.js";
import { registerMatterTools } from "./tools/matters.js";
import { registerContactTools } from "./tools/contacts.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerCalendarTools } from "./tools/calendar.js";
import { registerActivityTools } from "./tools/activities.js";
import { registerBillingTools } from "./tools/billing.js";
import { appendAuditLog } from "./utils/auditLog.js";
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '../.env') });

const server = new McpServer({
    name: "clio-mcp",
    version: "1.0.0",
});

// ── Tool: Auth status ─────────────────────────────────────────────
server.registerTool(
    "auth_status",
    { description: "Check whether the connector is authenticated with Clio and when the token expires" },
    async () => {
        const tokens = await loadTokens();

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
                    clio_user_id: tokens.clio_user_id ?? "unknown",
                    token_expires_in_minutes: expiresIn,
                    token_expired,
                    ...(token_expired && { warning: "Token has expired. Run the 'authenticate' tool to refresh." }),
                }),
            }],
        };
    }
);

// ── Tool: Authenticate ────────────────────────────────────────────
server.registerTool(
    "authenticate",
    { description: "Trigger the Clio OAuth login flow" },
    async () => {
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

// ── Tool: Logout ──────────────────────────────────────────────────
server.registerTool(
    "logout",
    { description: "Log out of Clio (clears local tokens)" },
    async () => {
        try {
            const tokens = await loadTokens();
            const clio_user_id = tokens?.clio_user_id;
            await clearTokens();
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

// ── Matter tools ──────────────────────────────────────────────────
registerMatterTools(server);
registerContactTools(server);
registerDocumentTools(server);
registerTaskTools(server);
registerCalendarTools(server);
registerActivityTools(server);
registerBillingTools(server);

async function main() {
    const missing = (["CLIO_CLIENT_ID", "CLIO_CLIENT_SECRET", "ENCRYPTION_KEY"] as const)
        .filter((k) => !process.env[k]);
    if (missing.length > 0) {
        console.error(`[startup] Fatal: missing required env var(s): ${missing.join(", ")}. Check your .env file.`);
        process.exit(1);
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Clio MCP server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
