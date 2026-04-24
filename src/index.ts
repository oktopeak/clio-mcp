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
import { registerNoteTools } from "./tools/notes.js";
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

// ── Resources ─────────────────────────────────────────────────────
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
        const tokens = await loadTokens();
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

// ── Matter tools ──────────────────────────────────────────────────
registerMatterTools(server);
registerContactTools(server);
registerDocumentTools(server);
registerTaskTools(server);
registerCalendarTools(server);
registerActivityTools(server);
registerBillingTools(server);
registerNoteTools(server);

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
