import http from "http";
import crypto from "crypto";
import { saveTokens, loadTokens } from "./tokenStorage.js";

function getClioBase() {
  const region = (process.env.CLIO_REGION ?? "us").toLowerCase();
  return region === "eu" ? "https://eu.app.clio.com" : "https://app.clio.com";
}
function getAuthUrl() { return process.env.CLIO_AUTH_URL ?? `${getClioBase()}/oauth/authorize`; }
function getTokenUrl() { return process.env.CLIO_TOKEN_URL ?? `${getClioBase()}/oauth/token`; }

export interface ClioTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp
  clio_user_id?: string;
  user_id_unavailable?: boolean; // true when who_am_i returned 403 — stops further retries
}

export async function runOAuthFlow(): Promise<ClioTokens> {
  const clientId = (process.env.CLIO_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CLIO_CLIENT_SECRET ?? "").trim();
  const port = (process.env.CLIO_REDIRECT_PORT || "5678").trim();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const state = crypto.randomBytes(16).toString("hex");

  const authUrl =
    `${getAuthUrl()}?` +
    new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
    });

  const { default: open } = await import("open");
  await open(authUrl);
  console.error(`[auth] Please complete the login in your browser...`);

  const code = await waitForCallback(port, state);

  const tokens = await exchangeCodeForTokens(
    code,
    clientId,
    clientSecret,
    redirectUri
  );

  await resolveClioUserId(tokens);

  await saveTokens(tokens);
  console.error(`[auth] ✅ Authentication successful, tokens saved.`);
  return tokens;
}

export async function resolveClioUserId(tokens: ClioTokens): Promise<void> {
  try {
    const meRes = await fetch(`${getClioBase()}/api/v4/users/who_am_i.json`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (meRes.ok) {
      const me = await meRes.json() as any;
      tokens.clio_user_id = String(me.data?.id);
    }
  } catch { /* non-fatal */ }
}

// ─── Broker mode (listed / App Directory variant) ───────────────────────────
//
// Used when TOKEN_BROKER_URL is set instead of CLIO_CLIENT_ID/CLIO_CLIENT_SECRET.
// The connector never holds the shared app's client_secret — it generates a
// PKCE verifier locally, and the hosted broker (a separate service) performs
// the actual Clio token exchange after Clio's redirect lands on the broker's
// own callback endpoint, not here.

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function deriveCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function isBrokerMode(): boolean {
  return !!(process.env.TOKEN_BROKER_URL ?? "").trim();
}

export function getBrokerUrl(): string {
  return (process.env.TOKEN_BROKER_URL ?? "").trim().replace(/\/+$/, "");
}

// Starts a broker login session: POSTs the PKCE code_challenge to the
// broker's /auth/start and returns the session to poll plus the URL the
// user needs to visit to complete Clio's consent screen.
export async function startBrokerLogin(
  codeChallenge: string
): Promise<{ sessionId: string; authorizeUrl: string }> {
  const brokerUrl = getBrokerUrl();
  const startRes = await fetch(`${brokerUrl}/auth/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code_challenge: codeChallenge }),
  });
  if (!startRes.ok) {
    throw new Error(`Failed to start broker login (HTTP ${startRes.status}).`);
  }
  const { session_id: sessionId, authorize_url: authorizeUrl } = await startRes.json() as {
    session_id: string;
    authorize_url: string;
  };
  return { sessionId, authorizeUrl };
}

export type BrokerPollResult =
  | { status: "pending" }
  | { status: "ready"; tokens: ClioTokens };

// Single, non-blocking check of a broker login session. Callers that want
// stdio's "block until done" behavior should loop this themselves (see
// pollBrokerForTokens below); callers on a request/response transport (e.g.
// the HTTP server) should call this once per invocation and return control
// immediately rather than blocking a request for minutes.
export async function pollBrokerOnce(
  brokerUrl: string,
  sessionId: string,
  codeVerifier: string
): Promise<BrokerPollResult> {
  const res = await fetch(`${brokerUrl}/auth/poll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, code_verifier: codeVerifier }),
  });

  if (res.status === 202) {
    return { status: "pending" };
  }

  if (!res.ok) {
    throw new Error(`Broker login failed (HTTP ${res.status}). Please try again.`);
  }

  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  return {
    status: "ready",
    tokens: {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    },
  };
}

export async function runBrokerOAuthFlow(): Promise<ClioTokens> {
  const brokerUrl = getBrokerUrl();
  const verifier = generateCodeVerifier();
  const challenge = deriveCodeChallenge(verifier);

  const { sessionId, authorizeUrl } = await startBrokerLogin(challenge);

  const { default: open } = await import("open");
  await open(authorizeUrl);
  console.error(`[auth] Please complete the login in your browser...`);

  const tokens = await pollBrokerForTokens(brokerUrl, sessionId, verifier);

  await resolveClioUserId(tokens);
  await saveTokens(tokens);
  console.error(`[auth] ✅ Authentication successful, tokens saved.`);
  return tokens;
}

async function pollBrokerForTokens(
  brokerUrl: string,
  sessionId: string,
  codeVerifier: string
): Promise<ClioTokens> {
  const deadline = Date.now() + 5 * 60 * 1000; // same 5-minute budget as the local-callback flow

  while (Date.now() < deadline) {
    const result = await pollBrokerOnce(brokerUrl, sessionId, codeVerifier);

    if (result.status === "pending") {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }

    return result.tokens;
  }

  throw new Error("OAuth timeout — no response received within 5 minutes");
}

export async function refreshTokensViaBroker(refreshToken: string): Promise<ClioTokens> {
  const brokerUrl = getBrokerUrl();
  const res = await fetch(`${brokerUrl}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    throw new Error("Token refresh failed, please re-authenticate.");
  }
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

async function refreshViaBrokerAndSave(tokens: ClioTokens): Promise<ClioTokens> {
  const refreshed = await refreshTokensViaBroker(tokens.refresh_token);
  const newTokens: ClioTokens = { ...refreshed, clio_user_id: tokens.clio_user_id };
  await saveTokens(newTokens);
  return newTokens;
}

function waitForCallback(port: string, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://127.0.0.1:${port}`);

      if (url.pathname !== "/callback") return;

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html" });

      if (error || !code) {
        res.end(`<h1>Error: ${error || "No code received"}</h1><p>You can close this tab.</p>`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (state !== expectedState) {
        res.end(`<h1>Error: Invalid state parameter</h1>`);
        server.close();
        reject(new Error("State mismatch — possible CSRF attack?"));
        return;
      }

      res.end(`<h1>Authentication successful!</h1><p>You can close this tab and continue in Claude.</p>`);
      server.close();
      resolve(code);
    });

    server.listen(parseInt(port), "127.0.0.1", () => {
      console.error(`[auth] Waiting for callback on http://127.0.0.1:${port}/callback`);
    });

    setTimeout(() => {
      server.close();
      reject(new Error("OAuth timeout — no response received within 5 minutes"));
    }, 5 * 60 * 1000);
  });
}

async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<ClioTokens> {
  const tokenUrl = getTokenUrl();
  console.error(`[auth] Token exchange → POST ${tokenUrl}`);
  console.error(`[auth]   client_id   : ${clientId.substring(0, 8)}...`);
  console.error(`[auth]   redirect_uri: ${redirectUri}`);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  console.error(`[auth] Token response: HTTP ${res.status}`);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(
      `Token exchange failed.\n` +
      `  Token URL  : ${tokenUrl}\n` +
      `  Redirect   : ${redirectUri}\n` +
      `  client_id  : ${clientId.substring(0, 6)}... (length ${clientId.length})\n` +
      `  Response   : ${err}\n` +
      `\nIf the error is "invalid_client": verify CLIO_CLIENT_ID and CLIO_CLIENT_SECRET match your Clio developer app exactly.`
    );
  }

  const data = await res.json() as any;

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

export function buildAuthorizationUrl(sessionId: string): { url: string; nonce: string } {
  const clientId = (process.env.CLIO_CLIENT_ID ?? "").trim();
  const baseUrl = (process.env.MCP_BASE_URL ?? "").trim();
  const redirectUri = `${baseUrl}/oauth/callback`;
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = Buffer.from(`${sessionId}:${nonce}`).toString("base64url");
  const url =
    `${getAuthUrl()}?` +
    new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
    });
  return { url, nonce };
}

export async function exchangeCodeForTokensPure(
  code: string,
  redirectUri: string
): Promise<ClioTokens> {
  const clientId = (process.env.CLIO_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CLIO_CLIENT_SECRET ?? "").trim();
  return exchangeCodeForTokens(code, clientId, clientSecret, redirectUri);
}

export async function refreshTokensPure(refreshToken: string): Promise<ClioTokens> {
  const clientId = (process.env.CLIO_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CLIO_CLIENT_SECRET ?? "").trim();

  const res = await fetch(getTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    throw new Error("Token refresh failed, please re-authenticate.");
  }

  const data = await res.json() as any;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

let inFlightAccessToken: Promise<string> | null = null;

// Concurrent callers await the same in-flight refresh instead of racing —
// otherwise two overlapping calls can both refresh, and since Clio may
// rotate the refresh token on use, the loser's saveTokens() can stomp the
// winner's and discard the only valid refresh token.
export async function getValidAccessToken(): Promise<string> {
  if (inFlightAccessToken) return inFlightAccessToken;
  inFlightAccessToken = doGetValidAccessToken();
  try {
    return await inFlightAccessToken;
  } finally {
    inFlightAccessToken = null;
  }
}

async function doGetValidAccessToken(): Promise<string> {
  let tokens = await loadTokens();

  if (!tokens) {
    tokens = isBrokerMode() ? await runBrokerOAuthFlow() : await runOAuthFlow();
  }

  if (Date.now() > tokens.expires_at - 5 * 60 * 1000) {
    console.error("[auth] Token expiring soon, refreshing...");
    tokens = isBrokerMode() ? await refreshViaBrokerAndSave(tokens) : await refreshAccessToken(tokens);
  }

  if (!tokens.clio_user_id && !tokens.user_id_unavailable) {
    try {
      const meRes = await fetch(`${getClioBase()}/api/v4/users/who_am_i.json`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (meRes.ok) {
        const me = await meRes.json() as any;
        const userId = me.data?.id ? String(me.data.id) : undefined;
        if (userId) {
          tokens.clio_user_id = userId;
          await saveTokens(tokens);
          console.error(`[auth] Resolved missing clio_user_id: ${userId}`);
        }
      } else {
        tokens.user_id_unavailable = true;
        await saveTokens(tokens);
        console.error(`[auth] who_am_i returned HTTP ${meRes.status} — user ID unavailable, will not retry`);
      }
    } catch (err: any) {
      console.error(`[auth] Failed to resolve clio_user_id: ${err.message}`);
    }
  }

  return tokens.access_token;
}

async function refreshAccessToken(tokens: ClioTokens): Promise<ClioTokens> {
  const clientId = (process.env.CLIO_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CLIO_CLIENT_SECRET ?? "").trim();

  const res = await fetch(getTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    throw new Error("Token refresh failed, please log in again.");
  }

  const data = await res.json() as any;
  const newTokens: ClioTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    clio_user_id: tokens.clio_user_id,
  };

  await saveTokens(newTokens);
  return newTokens;
}