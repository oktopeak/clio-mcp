import { timingSafeEqual } from "crypto";
import type express from "express";

/** Minimum length for MCP_API_KEY. 24 characters is the floor; `openssl rand -hex 32` gives 64. */
export const MIN_API_KEY_LENGTH = 24;

export interface HttpAuthConfig {
  /** Bearer token every client must present. null only when the dev-only opt-out was explicitly enabled. */
  apiKey: string | null;
}

/**
 * Paths reachable without the API key: the health probe, and the OAuth
 * redirect target, because Clio's browser redirect cannot carry a bearer
 * token. Everything else, including unknown paths, requires the key.
 */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/health", "/oauth/callback"]);

/**
 * Resolve the HTTP-mode auth configuration from the environment, or throw a
 * clear error. Called at startup so a misconfigured server never listens.
 *
 * - MCP_API_KEY set: must be at least MIN_API_KEY_LENGTH characters.
 * - MCP_API_KEY unset: only allowed with MCP_ALLOW_UNAUTHENTICATED=true (local development).
 */
export function resolveHttpAuthConfig(env: NodeJS.ProcessEnv = process.env): HttpAuthConfig {
  const apiKey = (env.MCP_API_KEY ?? "").trim();
  const allowUnauthenticated = (env.MCP_ALLOW_UNAUTHENTICATED ?? "").trim().toLowerCase() === "true";

  if (apiKey !== "") {
    if (apiKey.length < MIN_API_KEY_LENGTH) {
      throw new Error(
        `MCP_API_KEY is too short (${apiKey.length} characters). HTTP mode requires a secret of at least ` +
        `${MIN_API_KEY_LENGTH} characters. Generate one with: openssl rand -hex 32`
      );
    }
    return { apiKey };
  }

  if (allowUnauthenticated) {
    return { apiKey: null };
  }

  throw new Error(
    `MCP_API_KEY is required in HTTP mode. Set it to a secret of at least ${MIN_API_KEY_LENGTH} characters ` +
    `(generate one with: openssl rand -hex 32) and send the same value from the client as ` +
    `"Authorization: Bearer <key>". For local development only, MCP_ALLOW_UNAUTHENTICATED=true starts the ` +
    `server without a key; never use that on a public host. Set TRANSPORT=stdio for local single-user mode, ` +
    `which does not need an API key.`
  );
}

/** Constant-time check of the Authorization header against the configured key. */
export function isAuthorized(config: HttpAuthConfig, authorizationHeader: string | undefined): boolean {
  if (config.apiKey === null) return true;
  const expected = Buffer.from(`Bearer ${config.apiKey}`, "utf8");
  const actual = Buffer.from(authorizationHeader ?? "", "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Express middleware: 401 on every path except PUBLIC_PATHS unless the bearer key matches. */
export function createApiKeyMiddleware(config: HttpAuthConfig): express.RequestHandler {
  return (req, res, next) => {
    if (PUBLIC_PATHS.has(req.path)) { next(); return; }
    if (!isAuthorized(config, req.headers.authorization)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}
