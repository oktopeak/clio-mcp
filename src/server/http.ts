import express from "express";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { timingSafeEqual } from "crypto";

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
import {
  exchangeCodeForTokensPure,
  refreshTokensPure,
  isBrokerMode,
  getBrokerUrl,
  pollBrokerOnce,
  refreshTokensViaBroker,
  resolveClioUserId,
} from "../auth/oauth.js";
import type { ClioTokens } from "../auth/oauth.js";
import { sessionStorage, SessionContext, PendingBrokerSession } from "../utils/sessionContext.js";
import { appendAuditLog } from "../utils/auditLog.js";

export interface SessionRecord {
  transport: StreamableHTTPServerTransport;
  mcpServer: McpServer | null;
  tokens: ClioTokens | null;
  pendingOAuthNonce: string | null;
  pendingBroker: PendingBrokerSession | null;
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

async function pollPendingBrokerSession(record: SessionRecord): Promise<void> {
  const pending = record.pendingBroker;
  if (!pending) return;

  let result;
  try {
    result = await pollBrokerOnce(getBrokerUrl(), pending.brokerSessionId, pending.codeVerifier);
  } catch (err: any) {
    // Broker session is dead (expired/forged/already consumed) — clear it so
    // the firm gets a clean "call authenticate again" path instead of
    // retrying a session that can never succeed.
    record.pendingBroker = null;
    throw err;
  }

  if (result.status === "pending") {
    throw new Error(
      "Login is still in progress. Finish the Clio login in your browser, then try again."
    );
  }

  record.pendingBroker = null;
  record.tokens = result.tokens;
  await resolveClioUserId(record.tokens);

  await appendAuditLog({
    tool: "oauth_callback",
    args: {},
    outcome: "success",
    clio_user_id: record.tokens.clio_user_id,
  });
}

export function buildSessionContext(record: SessionRecord, sessionId: string): SessionContext {
  return {
    sessionId,
    getAccessToken: async () => {
      if (!record.tokens) {
        if (isBrokerMode() && record.pendingBroker) {
          await pollPendingBrokerSession(record);
        } else {
          throw new Error(
            "Not authenticated. Call the 'authenticate' tool to get a login URL, " +
            "complete OAuth in your browser, then try again."
          );
        }
      }
      if (record.tokens && Date.now() > record.tokens.expires_at - 5 * 60 * 1000) {
        const refreshed = isBrokerMode()
          ? await refreshTokensViaBroker(record.tokens.refresh_token)
          : await refreshTokensPure(record.tokens.refresh_token);
        record.tokens = { ...refreshed, clio_user_id: record.tokens.clio_user_id };
      }
      return record.tokens!.access_token;
    },
    storeTokens: (tokens: ClioTokens) => { record.tokens = tokens; },
    getTokens: () => record.tokens,
    clearTokens: () => { record.tokens = null; },
    setPendingNonce: (nonce: string) => { record.pendingOAuthNonce = nonce; },
    setPendingBrokerSession: (session: PendingBrokerSession | null) => { record.pendingBroker = session; },
    getPendingBrokerSession: () => record.pendingBroker,
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

function requireApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const key = process.env.MCP_API_KEY;
  if (!key) { next(); return; }
  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${key}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

const app = express();

app.get("/health", (_req, res) => {
  res.json({ ok: true, sessions: sessions.size });
});

app.all("/mcp", requireApiKey, express.json(), async (req, res) => {
  try {
    const incomingSessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!incomingSessionId) {
      // New connection: allocate record and create transport
      const record: SessionRecord = {
        transport: null!,
        mcpServer: null,
        tokens: null,
        pendingOAuthNonce: null,
        pendingBroker: null,
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
        setPendingBrokerSession: () => {},
        getPendingBrokerSession: () => null,
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
    res.status(400).send("<h1>Invalid State</h1><p>State mismatch — possible CSRF attack.</p>");
    return;
  }

  record.pendingOAuthNonce = null;

  try {
    const redirectUri = `${(process.env.MCP_BASE_URL ?? "").trim()}/oauth/callback`;
    const tokens = await exchangeCodeForTokensPure(code, redirectUri);
    await resolveClioUserId(tokens);

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

export function startHttpServer(): void {
  const port = parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, () => {
    const baseUrl = (process.env.MCP_BASE_URL ?? `http://127.0.0.1:${port}`).trim();
    console.error(`[http] Clio MCP server listening on port ${port}`);
    console.error(`[http] MCP endpoint : ${baseUrl}/mcp`);
    console.error(`[http] Health check : ${baseUrl}/health`);
  });
}
