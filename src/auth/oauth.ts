/**
 * Env-driven Clio OAuth for the stdio and built-in HTTP modes. Credentials and
 * endpoints come from process.env; the actual protocol lives in clioOAuth.ts.
 */
import http from "http";
import crypto from "crypto";
import { saveTokens, loadTokens } from "./tokenStorage.js";
import { getClioAuthorizeUrl, getClioTokenUrl } from "../utils/clioRegion.js";
import {
  buildClioAuthorizeUrl,
  exchangeClioCode,
  refreshClioTokens,
  fetchClioWhoAmI,
  ClioOAuthError,
} from "./clioOAuth.js";
import type { ClioTokens } from "./clioOAuth.js";
import { singleFlight } from "../utils/singleFlight.js";

export type { ClioTokens } from "./clioOAuth.js";
export { generateCodeVerifier, deriveCodeChallenge } from "./clioOAuth.js";
import { generateCodeVerifier, deriveCodeChallenge } from "./clioOAuth.js";

function envClient() {
  return {
    clientId: (process.env.CLIO_CLIENT_ID ?? "").trim(),
    clientSecret: (process.env.CLIO_CLIENT_SECRET ?? "").trim(),
    authorizeUrl: getClioAuthorizeUrl(),
    tokenUrl: getClioTokenUrl(),
  };
}

async function exchangeWithDiagnostics(p: {
  clientId: string; clientSecret: string; tokenUrl: string; redirectUri: string; code: string;
}): Promise<ClioTokens> {
  console.error(`[auth] Token exchange → POST ${p.tokenUrl}`);
  console.error(`[auth]   client_id   : ${p.clientId.substring(0, 8)}...`);
  console.error(`[auth]   redirect_uri: ${p.redirectUri}`);
  try {
    const tokens = await exchangeClioCode(p);
    console.error(`[auth] Token response: HTTP 200`);
    return tokens;
  } catch (err: any) {
    if (err instanceof ClioOAuthError) {
      console.error(`[auth] Token response: HTTP ${err.status}`);
      throw new Error(
        `Token exchange failed.\n` +
        `  Token URL  : ${p.tokenUrl}\n` +
        `  Redirect   : ${p.redirectUri}\n` +
        `  client_id  : ${p.clientId.substring(0, 6)}... (length ${p.clientId.length})\n` +
        `  Response   : ${err.body}\n` +
        `\nIf the error is "invalid_client": verify CLIO_CLIENT_ID and CLIO_CLIENT_SECRET match your Clio developer app exactly.`
      );
    }
    throw err;
  }
}

/** Best-effort who_am_i; never fails the login. */
async function attachUserId(tokens: ClioTokens): Promise<void> {
  try {
    const me = await fetchClioWhoAmI(tokens.access_token);
    tokens.clio_user_id = me.id;
  } catch { /* non-fatal */ }
}

export async function runOAuthFlow(): Promise<ClioTokens> {
  const { clientId, clientSecret, authorizeUrl, tokenUrl } = envClient();
  const port = (process.env.CLIO_REDIRECT_PORT || "5678").trim();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const state = crypto.randomBytes(16).toString("hex");

  const authUrl = buildClioAuthorizeUrl({ clientId, authorizeUrl, redirectUri, state });

  const { default: open } = await import("open");
  await open(authUrl);
  console.error(`[auth] Please complete the login in your browser...`);

  const code = await waitForCallback(port, state);
  const tokens = await exchangeWithDiagnostics({ clientId, clientSecret, tokenUrl, redirectUri, code });
  await attachUserId(tokens);

  await saveTokens(tokens);
  console.error(`[auth] ✅ Authentication successful, tokens saved.`);
  return tokens;
}

// ─── Broker mode (listed / App Directory variant) ───────────────────────────
//
// Used when TOKEN_BROKER_URL is set instead of CLIO_CLIENT_ID/CLIO_CLIENT_SECRET.
// The connector never holds the shared app's client_secret — it generates a
// PKCE verifier locally, and the hosted broker (a separate service) performs
// the actual Clio token exchange after Clio's redirect lands on the broker's
// own callback endpoint, not here.

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

  await attachUserId(tokens);
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

/** Built-in HTTP mode: the login URL for a session, with the nonce to verify on callback. */
export function buildAuthorizationUrl(sessionId: string): { url: string; nonce: string } {
  const { clientId, authorizeUrl } = envClient();
  const baseUrl = (process.env.MCP_BASE_URL ?? "").trim();
  const redirectUri = `${baseUrl}/oauth/callback`;
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = Buffer.from(`${sessionId}:${nonce}`).toString("base64url");
  const url = buildClioAuthorizeUrl({ clientId, authorizeUrl, redirectUri, state });
  return { url, nonce };
}

export async function exchangeCodeForTokensPure(code: string, redirectUri: string): Promise<ClioTokens> {
  const { clientId, clientSecret, tokenUrl } = envClient();
  return exchangeWithDiagnostics({ clientId, clientSecret, tokenUrl, redirectUri, code });
}

export async function refreshTokensPure(refreshToken: string): Promise<ClioTokens> {
  const { clientId, clientSecret, tokenUrl } = envClient();
  try {
    return await refreshClioTokens({ clientId, clientSecret, tokenUrl, refreshToken });
  } catch {
    throw new Error("Token refresh failed, please re-authenticate.");
  }
}

async function refreshAccessToken(tokens: ClioTokens): Promise<ClioTokens> {
  const { clientId, clientSecret, tokenUrl } = envClient();
  let refreshed: ClioTokens;
  try {
    refreshed = await refreshClioTokens({ clientId, clientSecret, tokenUrl, refreshToken: tokens.refresh_token });
  } catch {
    throw new Error("Token refresh failed, please log in again.");
  }
  const newTokens: ClioTokens = { ...refreshed, clio_user_id: tokens.clio_user_id };
  await saveTokens(newTokens);
  return newTokens;
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
      const me = await fetchClioWhoAmI(tokens.access_token);
      tokens.clio_user_id = me.id;
      await saveTokens(tokens);
      console.error(`[auth] Resolved missing clio_user_id: ${me.id}`);
    } catch (err: any) {
      if (err instanceof ClioOAuthError) {
        tokens.user_id_unavailable = true;
        await saveTokens(tokens);
        console.error(`[auth] who_am_i returned HTTP ${err.status} — user ID unavailable, will not retry`);
      } else {
        console.error(`[auth] Failed to resolve clio_user_id: ${err.message}`);
      }
    }
  }

  return tokens.access_token;
}

/**
 * stdio mode token access. Concurrent callers share one in-flight run so two
 * overlapping tool calls cannot both refresh and stomp each other's tokens.
 */
export const getValidAccessToken: () => Promise<string> = singleFlight(doGetValidAccessToken);
