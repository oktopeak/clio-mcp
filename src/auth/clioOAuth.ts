/**
 * Clio OAuth 2.0, as pure functions.
 *
 * Nothing in this module reads process.env for credentials: the caller passes
 * the client id, the client secret and either a region or explicit endpoint
 * URLs. The env-driven wrappers used by the stdio and built-in HTTP modes live
 * in oauth.ts and delegate here. Hosts that embed the connector as a library
 * (several firms, several regions, one process) call these directly.
 */
import crypto from "crypto";
import { getClioApiBaseUrl, getClioAuthorizeUrl, getClioTokenUrl } from "../utils/clioRegion.js";
import type { ClioRegion } from "../utils/clioRegion.js";

export interface ClioTokens {
  access_token: string;
  refresh_token: string;
  /** Unix timestamp in milliseconds. */
  expires_at: number;
  clio_user_id?: string;
  /** true when who_am_i returned 403; stops further retries. */
  user_id_unavailable?: boolean;
}

export interface ClioOAuthClient {
  clientId: string;
  clientSecret: string;
  /** Picks the regional endpoints. When omitted and no explicit URL is given, the process env decides (CLIO_REGION and overrides). */
  region?: ClioRegion;
  authorizeUrl?: string;
  tokenUrl?: string;
  apiBaseUrl?: string;
}

export interface ClioWhoAmI {
  id: string;
  name?: string;
  email?: string;
  accountId?: string;
  accountName?: string;
}

/** A non-2xx answer from Clio's OAuth or who_am_i endpoints. `code` is the OAuth error code when Clio sent one (e.g. invalid_grant). */
export class ClioOAuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly code?: string
  ) {
    super(`Clio OAuth request failed with HTTP ${status}${code ? ` (${code})` : ""}`);
    this.name = "ClioOAuthError";
  }
}

/** RFC 7636 code verifier: 43 base64url characters from 32 random bytes. */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** RFC 7636 S256 challenge for a verifier. */
export function deriveCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

type EndpointSource = { region?: ClioRegion; authorizeUrl?: string; tokenUrl?: string; apiBaseUrl?: string };

function authorizeEndpoint(p: EndpointSource): string {
  return p.authorizeUrl ?? getClioAuthorizeUrl(p.region ?? process.env);
}
function tokenEndpoint(p: EndpointSource): string {
  return p.tokenUrl ?? getClioTokenUrl(p.region ?? process.env);
}
function apiBase(p: EndpointSource): string {
  return p.apiBaseUrl ?? getClioApiBaseUrl(p.region ?? process.env);
}

export function buildClioAuthorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  region?: ClioRegion;
  authorizeUrl?: string;
  codeChallenge?: string;
  scope?: string;
}): string {
  const url = new URL(authorizeEndpoint(p));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("state", p.state);
  if (p.codeChallenge) {
    url.searchParams.set("code_challenge", p.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (p.scope) url.searchParams.set("scope", p.scope);
  return url.toString();
}

async function postToken(tokenUrl: string, body: URLSearchParams): Promise<Record<string, any>> {
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    let code: string | undefined;
    try { code = JSON.parse(text)?.error; } catch { /* not JSON */ }
    throw new ClioOAuthError(res.status, text, typeof code === "string" ? code : undefined);
  }
  return JSON.parse(text);
}

export async function exchangeClioCode(
  p: ClioOAuthClient & { redirectUri: string; code: string; codeVerifier?: string }
): Promise<ClioTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: p.code,
    client_id: p.clientId,
    client_secret: p.clientSecret,
    redirect_uri: p.redirectUri,
    ...(p.codeVerifier && { code_verifier: p.codeVerifier }),
  });
  const data = await postToken(tokenEndpoint(p), body);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + Number(data.expires_in) * 1000,
  };
}

/** Refresh. Clio's refresh tokens do not expire and are not documented as rotating; the old one is kept when the response has none. */
export async function refreshClioTokens(
  p: ClioOAuthClient & { refreshToken: string }
): Promise<ClioTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: p.refreshToken,
    client_id: p.clientId,
    client_secret: p.clientSecret,
  });
  const data = await postToken(tokenEndpoint(p), body);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || p.refreshToken,
    expires_at: Date.now() + Number(data.expires_in) * 1000,
  };
}

/**
 * GET /users/who_am_i.json. `fields` defaults to id,name,email; pass
 * "id,name,email,account{id,name}" once your Clio app is confirmed to have the
 * permission for it (Clio answers 400 to unknown fields).
 */
export async function fetchClioWhoAmI(
  accessToken: string,
  opts: EndpointSource & { fields?: string } = {}
): Promise<ClioWhoAmI> {
  const url = new URL(`${apiBase(opts)}/users/who_am_i.json`);
  url.searchParams.set("fields", opts.fields ?? "id,name,email");
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await res.text();
  if (!res.ok) throw new ClioOAuthError(res.status, text);
  const data = JSON.parse(text)?.data ?? {};
  return {
    id: String(data.id),
    ...(data.name && { name: String(data.name) }),
    ...(data.email && { email: String(data.email) }),
    ...(data.account?.id !== undefined && { accountId: String(data.account.id) }),
    ...(data.account?.name && { accountName: String(data.account.name) }),
  };
}
