import express from "express";
import { readFileSync } from "fs";
import { randomUUID, timingSafeEqual } from "crypto";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAuthTools } from "../auth/authTools.js";
import { registerResources } from "../resources/index.js";
import { registerMatterTools } from "../tools/matters.js";
import { registerContactTools } from "../tools/contacts.js";
import { registerDocumentTools } from "../tools/documents.js";
import { registerTaskTools } from "../tools/tasks.js";
import { registerCalendarTools } from "../tools/calendar.js";
import { registerActivityTools } from "../tools/activities.js";
import { registerBillingTools } from "../tools/billing.js";
import { registerNoteTools } from "../tools/notes.js";
import { registerUserTools } from "../tools/users.js";
import { registerAuditExportTool } from "../tools/auditExport.js";
import { buildAuthorizationUrl, exchangeCodeForTokensPure, refreshTokensPure } from "../auth/oauth.js";
import type { ClioTokens } from "../auth/oauth.js";
import { sessionStorage, SessionContext } from "../utils/sessionContext.js";
import { appendAuditLog } from "../utils/auditLog.js";
import { getClioApiBaseUrl } from "../utils/clioRegion.js";
import { createApiKeyMiddleware, resolveHttpAuthConfig, PUBLIC_PATHS } from "./httpAuth.js";
import type { HttpAuthConfig } from "./httpAuth.js";

interface SessionRecord {
  transport: StreamableHTTPServerTransport;
  mcpServer: McpServer | null;
  tokens: ClioTokens | null;
  pendingOAuthNonce: string | null;
  createdAt: number;
}

const sessions = new Map<string, SessionRecord>();

function createMcpServer(): McpServer {
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
  return server;
}

function buildSessionContext(record: SessionRecord, sessionId: string): SessionContext {
  return {
    sessionId,
    getAccessToken: async () => {
      if (!record.tokens) {
        throw new Error(
          "Not authenticated. Call the 'authenticate' tool to get a login URL, " +
          "complete OAuth in your browser, then try again."
        );
      }
      if (Date.now() > record.tokens.expires_at - 5 * 60 * 1000) {
        const refreshed = await refreshTokensPure(record.tokens.refresh_token);
        record.tokens = { ...refreshed, clio_user_id: record.tokens.clio_user_id };
      }
      return record.tokens.access_token;
    },
    storeTokens: (tokens: ClioTokens) => { record.tokens = tokens; },
    getTokens: () => record.tokens,
    clearTokens: () => { record.tokens = null; },
    setPendingNonce: (nonce: string) => { record.pendingOAuthNonce = nonce; },
  };
}

// Stale session GC: remove sessions older than 24 hours
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, rec] of sessions) {
    if (rec.createdAt < cutoff) {
      rec.transport.close().catch(() => {});
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000).unref();

/**
 * Build the Express app. The API-key gate is installed before every route, so
 * all methods on /mcp (POST, GET/SSE stream, DELETE) and any unknown path
 * return 401 without a valid key. Only PUBLIC_PATHS (/health and the OAuth
 * redirect target) are reachable without it. Exported for tests.
 */
export function createApp(auth: HttpAuthConfig): express.Express {
  const app = express();

  app.use(createApiKeyMiddleware(auth));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, sessions: sessions.size });
  });

  app.all("/mcp", express.json(), async (req, res) => {
    try {
      const incomingSessionId = req.headers["mcp-session-id"] as string | undefined;

      if (!incomingSessionId) {
        // New connection: allocate record and create transport
        const record: SessionRecord = {
          transport: null!,
          mcpServer: null,
          tokens: null,
          pendingOAuthNonce: null,
          createdAt: Date.now(),
        };

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: async (sessionId) => {
            record.mcpServer = createMcpServer();
            sessions.set(sessionId, record);
            await record.mcpServer.connect(transport);
          },
          onsessionclosed: (sessionId) => {
            sessions.delete(sessionId);
          },
        });
        record.transport = transport;

        // Use a temporary placeholder context for the initialize request.
        // No tools run during initialization, so getAccessToken is never called.
        const tempCtx: SessionContext = {
          sessionId: "",
          getAccessToken: async () => { throw new Error("Not authenticated"); },
          storeTokens: () => {},
          getTokens: () => null,
          clearTokens: () => {},
          setPendingNonce: () => {},
        };

        await sessionStorage.run(tempCtx, () =>
          transport.handleRequest(req, res, req.body)
        );
      } else {
        // Existing session: route to correct transport
        const record = sessions.get(incomingSessionId);
        if (!record) {
          res.status(404).json({ error: "Session not found" });
          return;
        }
        const ctx = buildSessionContext(record, incomingSessionId);
        await sessionStorage.run(ctx, () =>
          record.transport.handleRequest(req, res, req.body)
        );
      }
    } catch (err: any) {
      console.error("[http] /mcp error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.get("/oauth/callback", async (req, res) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;

    if (oauthError) {
      res.status(400).send(
        `<h1>Authentication Error</h1><p>${oauthError}</p><p>You can close this tab.</p>`
      );
      return;
    }

    if (!code || !state) {
      res.status(400).send("<h1>Bad Request</h1><p>Missing code or state parameter.</p>");
      return;
    }

    let sessionId: string;
    let nonce: string;
    try {
      const payload = Buffer.from(state, "base64url").toString("utf8");
      const colonIdx = payload.indexOf(":");
      sessionId = payload.slice(0, colonIdx);
      nonce = payload.slice(colonIdx + 1);
    } catch {
      res.status(400).send("<h1>Bad Request</h1><p>Invalid state parameter.</p>");
      return;
    }

    const record = sessions.get(sessionId);
    if (!record || !record.pendingOAuthNonce) {
      res.status(400).send("<h1>Session Not Found</h1><p>Unknown or expired session. Please try again.</p>");
      return;
    }

    // Constant-time comparison to prevent timing attacks
    const expectedBuf = Buffer.from(record.pendingOAuthNonce, "utf8");
    const actualBuf = Buffer.from(nonce, "utf8");
    const nonceValid =
      expectedBuf.length === actualBuf.length &&
      timingSafeEqual(expectedBuf, actualBuf);

    if (!nonceValid) {
      res.status(400).send("<h1>Invalid State</h1><p>State mismatch: possible CSRF attack.</p>");
      return;
    }

    record.pendingOAuthNonce = null;

    try {
      const redirectUri = `${(process.env.MCP_BASE_URL ?? "").trim()}/oauth/callback`;
      const tokens = await exchangeCodeForTokensPure(code, redirectUri);

      // Attempt to resolve clio_user_id from who_am_i
      try {
        const meRes = await fetch(`${getClioApiBaseUrl()}/users/who_am_i.json`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (meRes.ok) {
          const me = await meRes.json() as any;
          tokens.clio_user_id = String(me.data?.id);
        }
      } catch { /* non-fatal */ }

      record.tokens = tokens;

      await appendAuditLog({
        tool: "oauth_callback",
        args: {},
        outcome: "success",
        clio_user_id: tokens.clio_user_id,
      });

      res.send(
        `<!DOCTYPE html><html><head><title>Authentication Successful</title></head>` +
        `<body><h1>✅ Authentication Successful</h1>` +
        `<p>You are now connected to Clio. You can close this tab and return to Claude.</p>` +
        `</body></html>`
      );
    } catch (err: any) {
      console.error("[http] OAuth callback error:", err.message);
      res.status(500).send(
        `<h1>Authentication Failed</h1><p>${err.message}</p><p>Please try authenticating again.</p>`
      );
    }
  });

  return app;
}

/**
 * Start the HTTP transport. Auth configuration is resolved first (and throws
 * with a clear message if MCP_API_KEY is missing or too short), so the server
 * never listens in a misconfigured state.
 */
export function startHttpServer(auth: HttpAuthConfig = resolveHttpAuthConfig()): void {
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const app = createApp(auth);
  app.listen(port, () => {
    const baseUrl = (process.env.MCP_BASE_URL ?? `http://127.0.0.1:${port}`).trim();
    console.error(`[http] Clio MCP server listening on port ${port}`);
    console.error(`[http] MCP endpoint : ${baseUrl}/mcp`);
    console.error(`[http] Health check : ${baseUrl}/health`);
    if (auth.apiKey === null) {
      console.error("[http] ****************************************************************************");
      console.error("[http] WARNING: MCP_ALLOW_UNAUTHENTICATED=true. NO API KEY IS REQUIRED ON ANY ROUTE.");
      console.error("[http] Anyone who can reach this port can drive the connector with your Clio access.");
      console.error("[http] This is for local development only. Never run like this on a public host.");
      console.error("[http] ****************************************************************************");
    } else {
      console.error(
        `[http] Auth         : MCP_API_KEY required (Authorization: Bearer <key>) on every route except ` +
        `${[...PUBLIC_PATHS].join(", ")}`
      );
    }
  });
}
