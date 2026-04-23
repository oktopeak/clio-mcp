import http from "http";
import crypto from "crypto";
import { saveTokens, loadTokens } from "./tokenStorage.js";

// Override with CLIO_TOKEN_URL / CLIO_AUTH_URL env vars to use Clio Platform endpoints:
//   Platform auth:  https://auth.api.clio.com/oauth/authorize
//   Platform token: https://auth.api.clio.com/oauth/token
const CLIO_AUTH_URL = process.env.CLIO_AUTH_URL ?? "https://app.clio.com/oauth/authorize";
const CLIO_TOKEN_URL = process.env.CLIO_TOKEN_URL ?? "https://app.clio.com/oauth/token";

export interface ClioTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp
  clio_user_id?: string;
}

export async function runOAuthFlow(): Promise<ClioTokens> {
  const clientId = (process.env.CLIO_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CLIO_CLIENT_SECRET ?? "").trim();
  const port = (process.env.CLIO_REDIRECT_PORT || "5678").trim();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const state = crypto.randomBytes(16).toString("hex");

  const authUrl =
    `${CLIO_AUTH_URL}?` +
    new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: process.env.CLIO_SCOPE ?? "openid",
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

  const apiBase = process.env.CLIO_API_BASE ?? "https://app.clio.com/api/v4";
  try {
    const meRes = await fetch(`${apiBase}/users/who_am_i.json`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (meRes.ok) {
      const me = await meRes.json() as any;
      tokens.clio_user_id = String(me.data?.id);
    }
  } catch { /* non-fatal */ }

  await saveTokens(tokens);
  console.error(`[auth] ✅ Authentication successful, tokens saved.`);
  return tokens;
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
  console.error(`[auth] Token exchange → POST ${CLIO_TOKEN_URL}`);
  console.error(`[auth]   client_id   : ${clientId.substring(0, 8)}...`);
  console.error(`[auth]   redirect_uri: ${redirectUri}`);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const res = await fetch(CLIO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  console.error(`[auth] Token response: HTTP ${res.status}`);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(
      `Token exchange failed (redirect_uri used: "${redirectUri}"): ${err}\n` +
      `Verify this redirect URI is registered exactly in your Clio developer app.`
    );
  }

  const data = await res.json() as any;

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

export async function getValidAccessToken(): Promise<string> {
  let tokens = await loadTokens();

  if (!tokens) {
    tokens = await runOAuthFlow();
  }

  if (Date.now() > tokens.expires_at - 5 * 60 * 1000) {
    console.error("[auth] Token expiring soon, refreshing...");
    tokens = await refreshAccessToken(tokens);
  }

  return tokens.access_token;
}

async function refreshAccessToken(tokens: ClioTokens): Promise<ClioTokens> {
  const clientId = (process.env.CLIO_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CLIO_CLIENT_SECRET ?? "").trim();

  const res = await fetch(CLIO_TOKEN_URL, {
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