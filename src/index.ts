#!/usr/bin/env node
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getClioRegion, CLIO_REGION_BASE_URLS } from './utils/clioRegion.js';
import { resolveHttpAuthConfig } from './server/httpAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function fatal(message: string): never {
    console.error(`[startup] Fatal: ${message}`);
    process.exit(1);
}

async function main() {
    const missing = (["CLIO_CLIENT_ID", "CLIO_CLIENT_SECRET"] as const)
        .filter((k) => !process.env[k]);
    if (missing.length > 0) {
        fatal(`missing required env var(s): ${missing.join(", ")}. Check your .env file.`);
    }

    // Fail fast on an unknown CLIO_REGION (both transports). No silent fallback to the US endpoint.
    const region = (() => {
        try { return getClioRegion(); }
        catch (err: any) { return fatal(err.message); }
    })();
    console.error(`[startup] Clio region: ${region} (${CLIO_REGION_BASE_URLS[region]})`);

    const mode = (process.env.TRANSPORT ?? "http").toLowerCase();

    if (mode === "stdio") {
        const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
        const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
        const { registerAuthTools } = await import("./auth/authTools.js");
        const { registerResources } = await import("./resources/index.js");
        const { registerMatterTools } = await import("./tools/matters.js");
        const { registerContactTools } = await import("./tools/contacts.js");
        const { registerDocumentTools } = await import("./tools/documents.js");
        const { registerTaskTools } = await import("./tools/tasks.js");
        const { registerCalendarTools } = await import("./tools/calendar.js");
        const { registerActivityTools } = await import("./tools/activities.js");
        const { registerBillingTools } = await import("./tools/billing.js");
        const { registerNoteTools } = await import("./tools/notes.js");
        const { registerUserTools } = await import("./tools/users.js");
        const { registerAuditExportTool } = await import("./tools/auditExport.js");

        const server = new McpServer({ name: "clio-mcp", version: pkg.version });
        registerAuthTools(server);
        registerResources(server);
        registerMatterTools(server);
        registerContactTools(server);
        registerDocumentTools(server);
        registerTaskTools(server);
        registerCalendarTools(server);
        registerActivityTools(server);
        registerBillingTools(server);
        registerNoteTools(server);
        registerUserTools(server);
        registerAuditExportTool(server);

        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("Clio MCP server running on stdio");
    } else {
        if (!process.env.MCP_BASE_URL) {
            fatal("MCP_BASE_URL is required in HTTP mode (e.g. https://mcp.example.com). Set TRANSPORT=stdio for local single-user mode.");
        }
        // MCP_API_KEY is mandatory in HTTP mode (min 24 chars). Only MCP_ALLOW_UNAUTHENTICATED=true
        // (local development) lets the server start without it, with a loud warning.
        const auth = (() => {
            try { return resolveHttpAuthConfig(); }
            catch (err: any) { return fatal(err.message); }
        })();
        const { startHttpServer } = await import("./server/http.js");
        startHttpServer(auth);
    }
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
